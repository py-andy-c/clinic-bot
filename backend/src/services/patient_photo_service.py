import boto3 # type: ignore
import hashlib
import io
from typing import List, Optional, Tuple, Any
from datetime import datetime, timezone
from PIL import Image
import pillow_heif # type: ignore
from fastapi import UploadFile, HTTPException
from sqlalchemy.orm import Session

from core.config import S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
from models.patient_photo import PatientPhoto
from models.medical_record import MedicalRecord

# Register HEIF opener
pillow_heif.register_heif_opener() # type: ignore

class PatientPhotoService:
    def __init__(self):
        self.s3_client: Any = boto3.client( # type: ignore
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )
        self.bucket = S3_BUCKET

    def _calculate_content_hash(self, file_content: bytes) -> str:
        return hashlib.sha256(file_content).hexdigest()

    def _generate_thumbnail(self, image_content: bytes, max_size: Tuple[int, int] = (300, 300)) -> bytes:
        try:
            image = Image.open(io.BytesIO(image_content))
            image.thumbnail(max_size)
            buffer = io.BytesIO()
            # Convert to RGB if necessary (e.g. for PNGs with transparency or CMYK)
            if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
                image = image.convert('RGBA')
                background = Image.new('RGB', image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1])
                image = background
            elif image.mode != 'RGB':
                image = image.convert('RGB')
            
            image.save(buffer, format="JPEG", quality=85)
            return buffer.getvalue()
        except Exception as e:
            # Fallback if image processing fails
            print(f"Thumbnail generation failed: {e}")
            return image_content

    def upload_photo(
        self,
        db: Session,
        clinic_id: int,
        patient_id: int,
        file: UploadFile,
        uploaded_by_user_id: Optional[int] = None,
        description: Optional[str] = None
    ) -> PatientPhoto:
        content = file.file.read()
        content_hash = self._calculate_content_hash(content)
        
        # Check for duplicates within the same clinic
        existing_photo = db.query(PatientPhoto).filter(
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.content_hash == content_hash,
            PatientPhoto.is_deleted == False
        ).first()

        if existing_photo:
            # Deduplication: Reuse storage keys if content is identical
            object_name = existing_photo.storage_key
            thumbnail_name = existing_photo.thumbnail_key
            
            # Create new record pointing to same S3 objects
            photo = PatientPhoto(
                clinic_id=clinic_id,
                patient_id=patient_id,
                filename=file.filename or "unknown.jpg",
                storage_key=object_name,
                thumbnail_key=thumbnail_name,
                content_hash=content_hash,
                content_type=file.content_type or "application/octet-stream",
                size_bytes=len(content),
                description=description,
                is_pending=True,
                uploaded_by_user_id=uploaded_by_user_id
            )
            
            db.add(photo)
            db.commit()
            db.refresh(photo)
            return photo

        # Generate unique storage keys based on content hash (Clinic Level Assets)
        # Format: clinic_assets/{clinic_id}/{content_hash}.{ext}
        filename = file.filename or "unknown.jpg"
        ext = filename.split('.')[-1].lower() if '.' in filename else 'jpg'
        
        # If extension is heic, we might want to keep it or convert. 
        # For original storage, we keep original extension.
        
        object_name = f"clinic_assets/{clinic_id}/{content_hash}.{ext}"
        thumbnail_name = f"clinic_assets/{clinic_id}/thumbnails/{content_hash}.jpg"

        # Upload original
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=object_name,
            Body=content,
            ContentType=file.content_type
        )

        # Generate and upload thumbnail
        thumbnail_content = self._generate_thumbnail(content)
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=thumbnail_name,
            Body=thumbnail_content,
            ContentType='image/jpeg'
        )

        photo = PatientPhoto(
            clinic_id=clinic_id,
            patient_id=patient_id,
            filename=filename,
            storage_key=object_name,
            thumbnail_key=thumbnail_name,
            content_hash=content_hash,
            content_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            description=description,
            is_pending=True, # Uploaded but not necessarily attached to a record yet
            uploaded_by_user_id=uploaded_by_user_id
        )
        
        db.add(photo)
        db.commit()
        db.refresh(photo)
        return photo

    def attach_photos_to_record(
        self,
        db: Session,
        record_id: int,
        photo_ids: List[int],
        clinic_id: int
    ) -> List[PatientPhoto]:
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()
        
        if not record:
            raise HTTPException(status_code=404, detail="Medical record not found")

        photos = db.query(PatientPhoto).filter(
            PatientPhoto.id.in_(photo_ids),
            PatientPhoto.clinic_id == clinic_id
        ).all()

        for photo in photos:
            photo.medical_record_id = record_id
            photo.is_pending = False
        
        db.commit()
        return photos

    def get_photo_url(self, storage_key: str, expiration: int = 3600) -> str:
        """Generate presigned URL for accessing the photo"""
        return self.s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.bucket, 'Key': storage_key},
            ExpiresIn=expiration
        )

    def get_photo(self, db: Session, photo_id: int, clinic_id: int) -> Optional[PatientPhoto]:
        return db.query(PatientPhoto).filter(
            PatientPhoto.id == photo_id,
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.is_deleted == False
        ).first()

    def delete_photo(
        self,
        db: Session,
        photo_id: int,
        clinic_id: int,
        deleted_by_user_id: Optional[int] = None
    ) -> bool:
        photo = self.get_photo(db, photo_id, clinic_id)
        if not photo:
            return False
            
        # Soft delete in DB
        photo.is_deleted = True
        photo.deleted_at = datetime.now(timezone.utc)
        # We don't delete from S3 immediately to allow recovery or for historical integrity
        
        db.commit()
        return True

    def list_photos(
        self,
        db: Session,
        clinic_id: int,
        patient_id: int,
        medical_record_id: Optional[int] = None,
        unlinked_only: bool = False,
        skip: int = 0,
        limit: int = 100
    ) -> List[PatientPhoto]:
        query = db.query(PatientPhoto).filter(
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.patient_id == patient_id,
            PatientPhoto.is_deleted == False
        )
        
        if medical_record_id:
            query = query.filter(PatientPhoto.medical_record_id == medical_record_id)
        
        if unlinked_only:
            query = query.filter(PatientPhoto.medical_record_id.is_(None))
            
        return query.order_by(PatientPhoto.created_at.desc()).offset(skip).limit(limit).all()
