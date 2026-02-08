from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException

from models.medical_record import MedicalRecord
from models.medical_record_template import MedicalRecordTemplate
from models.patient_photo import PatientPhoto
from models.patient import Patient
from models.appointment import Appointment
from models.user_clinic_association import UserClinicAssociation
from core.constants import CLINIC_SOURCE_TYPE


class RecordVersionConflictError(Exception):
    """Exception raised when a record version conflict is detected during update."""
    def __init__(self, message: str, current_record: MedicalRecord, updated_by_user_name: Optional[str] = None):
        self.message = message
        self.current_record = current_record
        self.updated_by_user_name = updated_by_user_name
        super().__init__(self.message)

# Sentinel for optional parameters not provided in an update
MISSING = object()

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
        created_by_user_id: Optional[int] = None,
        source_type: str = CLINIC_SOURCE_TYPE,
        last_updated_by_patient_id: Optional[int] = None,
        patient_form_request_id: Optional[int] = None
    ) -> MedicalRecord:
        # Verify Patient belongs to Clinic
        patient = db.query(Patient).filter(Patient.id == patient_id).first()
        if not patient:
             raise HTTPException(status_code=404, detail="Patient not found")
        if patient.clinic_id != clinic_id:
             raise HTTPException(status_code=403, detail="Patient does not belong to this clinic")

        # Verify Appointment (if provided)
        if appointment_id:
            appt = db.query(Appointment).filter(Appointment.calendar_event_id == appointment_id).first()
            # Note: Appointment primary key is calendar_event_id
            if not appt:
                raise HTTPException(status_code=404, detail="Appointment not found")
            # We need to check clinic_id via the associated CalendarEvent or Patient?
            # Appointment doesn't have clinic_id directly visible in the snippet I read, 
            # but Patient does. And Appointment -> Patient.
            if appt.patient_id != patient_id:
                raise HTTPException(status_code=400, detail="Appointment does not belong to this patient")
            # Indirect clinic check via patient is sufficient since patient is already checked.
            
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
            template_snapshot={"name": template.name, "fields": template.fields},
            values=values,
            appointment_id=appointment_id,
            created_by_user_id=created_by_user_id,
            updated_by_user_id=created_by_user_id,
            source_type=source_type,
            last_updated_by_user_id=created_by_user_id,
            last_updated_by_patient_id=last_updated_by_patient_id,
            patient_form_request_id=patient_form_request_id,
            version=1
        )
        db.add(record)
        db.flush() # Flush to get record.id

        # Atomic Photo Linking
        if photo_ids:
            photos = db.query(PatientPhoto).filter(
                PatientPhoto.id.in_(photo_ids),
                PatientPhoto.clinic_id == clinic_id,
                PatientPhoto.patient_id == patient_id
            ).all()
            
            # Verify all photos were found (handle duplicates by using set)
            if len(photos) != len(set(photo_ids)):
                # Check which ones are missing or invalid
                found_ids = {p.id for p in photos}
                missing = set(photo_ids) - found_ids
                raise HTTPException(status_code=404, detail=f"Photos not found, access denied, or belong to another patient: {missing}")

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
        ).options(
            joinedload(MedicalRecord.photos),
            joinedload(MedicalRecord.appointment).joinedload(Appointment.calendar_event),
            joinedload(MedicalRecord.appointment).joinedload(Appointment.appointment_type),
            joinedload(MedicalRecord.created_by_user),
            joinedload(MedicalRecord.updated_by_user),
            joinedload(MedicalRecord.patient)
        ).first()

    @staticmethod
    def list_patient_records(
        db: Session,
        clinic_id: int,
        patient_id: int,
        skip: int = 0,
        limit: int = 100,
        include_deleted: bool = False,
        status: Optional[str] = None
    ) -> List[MedicalRecord]:
        """
        List patient medical records with optional filtering by deletion status.
        
        Args:
            status: Filter by record status - 'active', 'deleted', or 'all'
                   If not provided, falls back to include_deleted for backward compatibility
        """
        query = db.query(MedicalRecord).filter(
            MedicalRecord.clinic_id == clinic_id,
            MedicalRecord.patient_id == patient_id
        )
        
        # Use status parameter if provided, otherwise fall back to include_deleted
        if status is not None:
            if status == 'active':
                query = query.filter(MedicalRecord.is_deleted == False)
            elif status == 'deleted':
                query = query.filter(MedicalRecord.is_deleted == True)
            elif status == 'all':
                pass  # No filter
            else:
                raise ValueError(f"Invalid status value: {status}. Must be 'active', 'deleted', or 'all'")
        else:
            # Backward compatibility: use include_deleted
            if not include_deleted:
                query = query.filter(MedicalRecord.is_deleted == False)
        
        # Eagerly load relationships for metadata display
        query = query.options(
            joinedload(MedicalRecord.photos),
            joinedload(MedicalRecord.appointment).joinedload(Appointment.calendar_event),
            joinedload(MedicalRecord.appointment).joinedload(Appointment.appointment_type),
            joinedload(MedicalRecord.created_by_user),
            joinedload(MedicalRecord.updated_by_user),
            joinedload(MedicalRecord.patient)
        )
        
        return query.order_by(desc(MedicalRecord.created_at)).offset(skip).limit(limit).all()

    @staticmethod
    def count_patient_records(
        db: Session,
        clinic_id: int,
        patient_id: int,
        include_deleted: bool = False,
        status: Optional[str] = None
    ) -> int:
        """
        Get total count of patient records with optional filtering by deletion status.
        
        Args:
            status: Filter by record status - 'active', 'deleted', or 'all'
                   If not provided, falls back to include_deleted for backward compatibility
        """
        query = db.query(MedicalRecord).filter(
            MedicalRecord.clinic_id == clinic_id,
            MedicalRecord.patient_id == patient_id
        )
        
        # Use status parameter if provided, otherwise fall back to include_deleted
        if status is not None:
            if status == 'active':
                query = query.filter(MedicalRecord.is_deleted == False)
            elif status == 'deleted':
                query = query.filter(MedicalRecord.is_deleted == True)
            elif status == 'all':
                pass  # No filter
            else:
                raise ValueError(f"Invalid status value: {status}. Must be 'active', 'deleted', or 'all'")
        else:
            # Backward compatibility: use include_deleted
            if not include_deleted:
                query = query.filter(MedicalRecord.is_deleted == False)
        
        return query.count()

    @staticmethod
    def update_record(
        db: Session,
        record_id: int,
        clinic_id: int,
        version: int,
        values: Any = MISSING,
        photo_ids: Any = MISSING,
        appointment_id: Any = MISSING,
        updated_by_user_id: Optional[int] = None,
        last_updated_by_patient_id: Optional[int] = None
    ) -> MedicalRecord:
        record = MedicalRecordService.get_record(db, record_id, clinic_id)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        
        if record.version != version:
            # Refresh record to get latest state including relationships
            db.refresh(record)
            
            # Fetch the user name who last updated the record
            updated_by_user_name = None
            if record.updated_by_user_id:
                # Join with UserClinicAssociation to get the clinic-specific name
                user_assoc = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == record.updated_by_user_id,
                    UserClinicAssociation.clinic_id == clinic_id
                ).first()
                if user_assoc:
                    updated_by_user_name = user_assoc.full_name
            elif record.last_updated_by_patient_id:
                # If updated by patient, show patient name
                patient = db.query(Patient).filter(Patient.id == record.last_updated_by_patient_id).first()
                if patient:
                    updated_by_user_name = f"病患 {patient.full_name}"
            
            raise RecordVersionConflictError(
                "Record has been modified by another user",
                current_record=record,
                updated_by_user_name=updated_by_user_name
            )

        # 1. Determine if anything changed
        values_changed = values is not MISSING and values != record.values
        appointment_changed = appointment_id is not MISSING and appointment_id != record.appointment_id
        
        # Note: max_photos limit is intentionally ignored for clinic-side edits (updated_by_user_id is not None)
        # as per design doc, to allow practitioners full control over the record.
        # However, we still enforce a system-wide absolute maximum to prevent abuse.
        ABSOLUTE_MAX_PHOTOS = 50
        
        photos_changed = False
        current_photos = []
        if photo_ids is not MISSING:
            if photo_ids is not None and len(photo_ids) > ABSOLUTE_MAX_PHOTOS:
                raise HTTPException(status_code=400, detail=f"照片數量超過系統上限 ({ABSOLUTE_MAX_PHOTOS} 張)")

            current_photos = db.query(PatientPhoto).filter(
                PatientPhoto.medical_record_id == record_id,
                PatientPhoto.clinic_id == clinic_id
            ).all()
            current_ids = {p.id for p in current_photos}
            new_ids: set[int] = set(photo_ids) if photo_ids is not None else set()
            if current_ids != new_ids:
                photos_changed = True

        # 2. Increment version if changed
        if values_changed or appointment_changed or photos_changed:
            record.version += 1
            record.updated_at = datetime.now(timezone.utc)

        # 3. Apply changes
        if values is not MISSING:
            record.values = values
        if appointment_id is not MISSING:
            if appointment_id is not None and appointment_id != record.appointment_id:
                appt = db.query(Appointment).filter(Appointment.calendar_event_id == appointment_id).first()
                if not appt:
                    raise HTTPException(status_code=404, detail="Appointment not found")
                if appt.patient_id != record.patient_id:
                    raise HTTPException(status_code=400, detail="Appointment does not belong to this patient")
            record.appointment_id = appointment_id
            
        if photo_ids is not MISSING:
            # We already fetched current_photos above if photo_ids is not MISSING
            current_ids = {p.id for p in current_photos}
            new_ids: set[int] = set(photo_ids) if photo_ids is not None else set()
            
            if current_ids != new_ids:
                # Unlink removed photos
                ids_to_unlink = current_ids - new_ids
                if ids_to_unlink:
                    db.query(PatientPhoto).filter(
                        PatientPhoto.id.in_(ids_to_unlink)
                    ).update({
                        "medical_record_id": None,
                        "is_pending": False 
                    }, synchronize_session=False)
                
                # Link new photos
                ids_to_link = new_ids - current_ids
                if ids_to_link:
                    photos_to_link = db.query(PatientPhoto).filter(
                        PatientPhoto.id.in_(ids_to_link),
                        PatientPhoto.clinic_id == clinic_id,
                        PatientPhoto.patient_id == record.patient_id
                    ).all()
                    
                    if len(photos_to_link) != len(ids_to_link):
                        found_ids = {p.id for p in photos_to_link}
                        missing = ids_to_link - found_ids
                        raise HTTPException(status_code=404, detail=f"Photos not found, access denied, or belong to another patient: {missing}")
                    
                    for photo in photos_to_link:
                        photo.medical_record_id = record_id
                        photo.is_pending = False
            
            # Ensure all currently linked photos are committed
            ids_to_keep = current_ids & new_ids
            if ids_to_keep:
                db.query(PatientPhoto).filter(
                    PatientPhoto.id.in_(ids_to_keep)
                ).update({
                    "is_pending": False
                }, synchronize_session=False)

        record.updated_by_user_id = updated_by_user_id
        if updated_by_user_id is not None:
            record.last_updated_by_user_id = updated_by_user_id
        if last_updated_by_patient_id is not None:
            record.last_updated_by_patient_id = last_updated_by_patient_id
        
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
        # Check if record exists (including already deleted ones for idempotency)
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()
        
        if not record:
            return False
        
        # If already deleted, return success (idempotent operation)
        if record.is_deleted:
            return True
            
        # Unified Fate: Soft delete record and its photos
        record.is_deleted = True
        record.deleted_at = datetime.now(timezone.utc)
        record.updated_by_user_id = deleted_by_user_id
        
        # Soft delete associated photos (only non-deleted ones)
        db.query(PatientPhoto).filter(
            PatientPhoto.medical_record_id == record_id,
            PatientPhoto.clinic_id == clinic_id,
            PatientPhoto.is_deleted == False
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
            
        # Hard delete photos first
        db.query(PatientPhoto).filter(
            PatientPhoto.medical_record_id == record_id,
            PatientPhoto.clinic_id == clinic_id
        ).delete(synchronize_session=False)
        
        db.delete(record)
        db.commit()
        return True
