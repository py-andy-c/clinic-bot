from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy import desc
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.medical_record import MedicalRecord
from models.medical_record_template import MedicalRecordTemplate
from models.patient_photo import PatientPhoto

class MedicalRecordService:
    @staticmethod
    def create_record(
        db: Session,
        clinic_id: int,
        patient_id: int,
        template_id: int,
        values: Dict[str, Any],
        photo_ids: Optional[List[int]] = None,
        appointment_id: Optional[int] = None,
        created_by_user_id: Optional[int] = None
    ) -> MedicalRecord:
        # Fetch template to snapshot it
        template = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id
        ).first()
        
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

        record = MedicalRecord(
            clinic_id=clinic_id,
            patient_id=patient_id,
            template_id=template_id,
            template_name=template.name,
            template_snapshot={"fields": template.fields},
            values=values,
            appointment_id=appointment_id,
            created_by_user_id=created_by_user_id,
            updated_by_user_id=created_by_user_id,
            version=1
        )
        db.add(record)
        db.flush() # Flush to get record.id

        # Atomic Photo Linking
        if photo_ids:
            photos = db.query(PatientPhoto).filter(
                PatientPhoto.id.in_(photo_ids),
                PatientPhoto.clinic_id == clinic_id
            ).all()
            
            # Verify all photos were found
            if len(photos) != len(photo_ids):
                # Check which ones are missing or invalid
                found_ids = {p.id for p in photos}
                missing = set(photo_ids) - found_ids
                raise HTTPException(status_code=404, detail=f"Photos not found or access denied: {missing}")

            for photo in photos:
                photo.medical_record_id = record.id
                photo.is_pending = False
        
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def get_record(
        db: Session,
        record_id: int,
        clinic_id: int
    ) -> Optional[MedicalRecord]:
        return db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id,
            MedicalRecord.is_deleted == False
        ).first()

    @staticmethod
    def list_patient_records(
        db: Session,
        clinic_id: int,
        patient_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[MedicalRecord]:
        return db.query(MedicalRecord).filter(
            MedicalRecord.clinic_id == clinic_id,
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.is_deleted == False
        ).order_by(desc(MedicalRecord.created_at)).offset(skip).limit(limit).all()

    @staticmethod
    def update_record(
        db: Session,
        record_id: int,
        clinic_id: int,
        version: int,
        values: Optional[Dict[str, Any]] = None,
        appointment_id: Optional[int] = None,
        updated_by_user_id: Optional[int] = None
    ) -> MedicalRecord:
        record = MedicalRecordService.get_record(db, record_id, clinic_id)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        
        if record.version != version:
            raise HTTPException(status_code=409, detail="Record has been modified by another user")

        if values is not None:
            record.values = values
        if appointment_id is not None:
            record.appointment_id = appointment_id
            
        record.version += 1
        record.updated_by_user_id = updated_by_user_id
        record.updated_at = datetime.now(timezone.utc)
        
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def delete_record(
        db: Session,
        record_id: int,
        clinic_id: int,
        deleted_by_user_id: Optional[int] = None
    ) -> bool:
        record = MedicalRecordService.get_record(db, record_id, clinic_id)
        if not record:
            return False
            
        # Unified Fate: Soft delete record and its photos
        record.is_deleted = True
        record.deleted_at = datetime.now(timezone.utc)
        record.updated_by_user_id = deleted_by_user_id
        
        # Soft delete associated photos
        db.query(PatientPhoto).filter(
            PatientPhoto.medical_record_id == record_id,
            PatientPhoto.clinic_id == clinic_id
        ).update({
            "is_deleted": True, 
            "deleted_at": datetime.now(timezone.utc)
        }, synchronize_session=False)
        
        db.commit()
        return True

    @staticmethod
    def restore_record(
        db: Session,
        record_id: int,
        clinic_id: int
    ) -> Optional[MedicalRecord]:
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id,
            MedicalRecord.is_deleted == True
        ).first()
        
        if not record:
            return None
            
        record.is_deleted = False
        record.deleted_at = None
        
        # Restore associated photos
        db.query(PatientPhoto).filter(
            PatientPhoto.medical_record_id == record_id,
            PatientPhoto.clinic_id == clinic_id
        ).update({
            "is_deleted": False, 
            "deleted_at": None
        }, synchronize_session=False)
        
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def hard_delete_record(
        db: Session,
        record_id: int,
        clinic_id: int
    ) -> bool:
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()
        
        if not record:
            return False
            
        # Hard delete photos first (cascade would handle this if configured in DB, but explicit is safer for logic)
        # Actually, let's rely on DB cascade if possible, but our model defines cascade on relationship?
        # Model: medical_record_id ... ondelete="CASCADE"
        # That means if MedicalRecord row is deleted, medical_record_id in Photo becomes NULL (or row deleted?)
        # Let's check model definition.
        # medical_record_id: Mapped[Optional[int]] = mapped_column(..., ForeignKey(..., ondelete="CASCADE"), ...)
        # If I delete MedicalRecord, the Photo rows might NOT be deleted if it's just setting FK to null or if the DB constraint isn't "ON DELETE CASCADE" for the whole row.
        # But we want to delete the photo rows entirely if we are hard deleting the record? 
        # Wait, if a photo is reused (deduplication is at storage level, not row level), we can delete the row.
        # Yes, delete the photo rows.
        
        db.query(PatientPhoto).filter(
            PatientPhoto.medical_record_id == record_id
        ).delete(synchronize_session=False)
        
        db.delete(record)
        db.commit()
        return True
