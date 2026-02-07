import boto3 # type: ignore
import hashlib
import io
from typing import List, Optional, Tuple, Any
from datetime import datetime, timezone
from PIL import Image, ImageOps
import pillow_heif # type: ignore
from fastapi import UploadFile, HTTPException
from sqlalchemy.orm import Session

from core.config import S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
from models.patient_photo import PatientPhoto
from models.medical_record import MedicalRecord
from models.patient import Patient

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
            image = ImageOps.exif_transpose(image)
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

    def _process_image(self, image_content: bytes, max_dimension: int = 2048) -> bytes:
        """
        Process image:
        1. Convert to RGB (handle HEIC, RGBA, etc.)
        2. Resize if dimension > max_dimension (maintain aspect ratio)
        3. Compress to JPEG (quality 80)
        """
        try:
            image = Image.open(io.BytesIO(image_content))
            image = ImageOps.exif_transpose(image)
            
            # Resize if needed
            width, height = image.size
            if width > max_dimension or height > max_dimension:
                ratio = min(max_dimension / width, max_dimension / height)
                new_size = (int(width * ratio), int(height * ratio))
                image = image.resize(new_size, Image.Resampling.LANCZOS) # type: ignore

            buffer = io.BytesIO()
            # Convert to RGB if necessary
            if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
                image = image.convert('RGBA')
                background = Image.new('RGB', image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1])
                image = background
            elif image.mode != 'RGB':
                image = image.convert('RGB')
            
            image.save(buffer, format="JPEG", quality=80)
            return buffer.getvalue()
        except Exception as e:
            # Fallback to original if processing fails (e.g. not an image)
            print(f"Image processing failed: {e}")
            return image_content

    def upload_photo(
        self,
        db: Session,
        clinic_id: int,
        patient_id: int,
        file: UploadFile,
        uploaded_by_user_id: Optional[int] = None,
        uploaded_by_patient_id: Optional[int] = None,
        description: Optional[str] = None,
        medical_record_id: Optional[int] = None,
        patient_form_request_id: Optional[int] = None,
        is_pending: Optional[bool] = None
    ) -> PatientPhoto:
        original_content = file.file.read()
        content_hash = self._calculate_content_hash(original_content)
        
        # Verify Patient belongs to Clinic
        patient = db.query(Patient).filter(Patient.id == patient_id).first()
        if not patient:
             raise HTTPException(status_code=404, detail="Patient not found")
        if patient.clinic_id != clinic_id:
             raise HTTPException(status_code=403, detail="Patient does not belong to this clinic")
        
        # Check for duplicates within the same clinic
        existing_photo = db.query(PatientPhoto).filter(
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.content_hash == content_hash,
            PatientPhoto.is_deleted == False
        ).first()

        # Determine pending state
        if is_pending is None:
            is_pending = True if medical_record_id else False

        if existing_photo:
            # Deduplication
            object_name = existing_photo.storage_key
            thumbnail_name = existing_photo.thumbnail_key
            
            photo = PatientPhoto(
                clinic_id=clinic_id,
                patient_id=patient_id,
                medical_record_id=medical_record_id,
                filename=file.filename or "unknown.jpg",
                storage_key=object_name,
                thumbnail_key=thumbnail_name,
                content_hash=content_hash,
                content_type=file.content_type or "application/octet-stream",
                size_bytes=len(original_content), # Storing original size for record keeping
                description=description,
                is_pending=is_pending,
                uploaded_by_user_id=uploaded_by_user_id,
                uploaded_by_patient_id=uploaded_by_patient_id,
                patient_form_request_id=patient_form_request_id
            )
            
            db.add(photo)
            db.commit()
            db.refresh(photo)
            return photo

        # Process Image (Compress/Resize)
        # We store the PROCESSED image as the "original" (to save space)
        processed_content = self._process_image(original_content)
        
        # Generate keys
        filename = file.filename or "unknown.jpg"
        ext = "jpg" # We convert to JPEG
        
        object_name = f"clinic_assets/{clinic_id}/{content_hash}.{ext}"
        thumbnail_name = f"clinic_assets/{clinic_id}/thumbnails/{content_hash}.jpg"

        # Upload processed "original"
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=object_name,
            Body=processed_content,
            ContentType='image/jpeg'
        )

        # Generate and upload thumbnail
        thumbnail_content = self._generate_thumbnail(processed_content)
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=thumbnail_name,
            Body=thumbnail_content,
            ContentType='image/jpeg'
        )

        photo = PatientPhoto(
            clinic_id=clinic_id,
            patient_id=patient_id,
            medical_record_id=medical_record_id,
            filename=filename,
            storage_key=object_name,
            thumbnail_key=thumbnail_name,
            content_hash=content_hash,
            content_type='image/jpeg',
            size_bytes=len(processed_content), # Stored size
            description=description,
            is_pending=is_pending,
            uploaded_by_user_id=uploaded_by_user_id,
            uploaded_by_patient_id=uploaded_by_patient_id,
            patient_form_request_id=patient_form_request_id
        )
        
        db.add(photo)
        db.commit()
        db.refresh(photo)
        return photo

    def update_photo(
        self,
        db: Session,
        photo_id: int,
        clinic_id: int,
        description: Optional[str] = None,
        medical_record_id: Optional[int] = None,
        updated_by_user_id: Optional[int] = None
    ) -> Optional[PatientPhoto]:
        photo = self.get_photo(db, photo_id, clinic_id)
        if not photo:
            return None
            
        if description is not None:
            photo.description = description
            
        if medical_record_id is not None:
            # Verify record exists
            record = db.query(MedicalRecord).filter(
                MedicalRecord.id == medical_record_id,
                MedicalRecord.clinic_id == clinic_id
            ).first()
            if not record:
                raise HTTPException(status_code=404, detail="Medical record not found")
            
            # Verify record belongs to the same patient
            if record.patient_id != photo.patient_id:
                raise HTTPException(status_code=400, detail="Medical record belongs to a different patient")
                
            photo.medical_record_id = medical_record_id
            photo.is_pending = False # Activate if linked
            
        if updated_by_user_id is not None:
            photo.updated_by_user_id = updated_by_user_id
            
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
    ) -> Tuple[List[PatientPhoto], int]:
        """
        List photos with pagination support.
        Returns tuple of (items, total_count).
        Uses stable ordering: created_at DESC, id DESC.
        """
        query = db.query(PatientPhoto).filter(
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.patient_id == patient_id,
            PatientPhoto.is_deleted == False
        )
        
        if medical_record_id:
            query = query.filter(PatientPhoto.medical_record_id == medical_record_id)
        elif not unlinked_only:
            # Default to showing only Active photos in general gallery (hide staged/pending ones)
            # But allow seeing them if specifically asking for unlinked photos (e.g. for attachment)
            query = query.filter(PatientPhoto.is_pending == False)
        
        if unlinked_only:
            query = query.filter(PatientPhoto.medical_record_id.is_(None))
        
        # Get total count before pagination
        total_count = query.count()
        
        # Apply stable ordering and pagination
        items = query.order_by(
            PatientPhoto.created_at.desc(),
            PatientPhoto.id.desc()
        ).offset(skip).limit(limit).all()
        
        return items, total_count
    
    def count_record_photos(
        self,
        db: Session,
        clinic_id: int,
        medical_record_id: int
    ) -> int:
        """
        Count photos linked to a specific medical record.
        Used for auto-suggestion of photo descriptions (附圖 X).
        """
        return db.query(PatientPhoto).filter(
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.medical_record_id == medical_record_id,
            PatientPhoto.is_deleted == False
        ).count()

    def count_patient_form_photos(
        self,
        db: Session,
        clinic_id: int,
        patient_id: int,
        patient_form_request_id: int,
        medical_record_id: Optional[int] = None
    ) -> int:
        """
        Count photos for a specific patient form request.
        Includes both pending photos for this request and photos already linked to the record.
        """
        from sqlalchemy import or_
        
        query = db.query(PatientPhoto).filter(
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.patient_id == patient_id,
            PatientPhoto.is_deleted == False,
            PatientPhoto.uploaded_by_patient_id.isnot(None)
        )
        
        if medical_record_id:
            query = query.filter(
                or_(
                    PatientPhoto.medical_record_id == medical_record_id,
                    (PatientPhoto.is_pending == True) & (PatientPhoto.patient_form_request_id == patient_form_request_id)
                )
            )
        else:
            query = query.filter(
                (PatientPhoto.is_pending == True) & (PatientPhoto.patient_form_request_id == patient_form_request_id)
            )
            
        return query.count()
