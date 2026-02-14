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
from models.line_user import LineUser
from models.clinic import Clinic
from services.line_service import LINEService
from services.message_template_service import MessageTemplateService
from core.sentinels import MISSING


class RecordVersionConflictError(Exception):
    """Exception raised when a record version conflict is detected during update."""
    def __init__(self, message: str, current_record: MedicalRecord, updated_by_user_name: Optional[str] = None):
        self.message = message
        self.current_record = current_record
        self.updated_by_user_name = updated_by_user_name
        super().__init__(self.message)


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
        commit: bool = True
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
            template_snapshot={"name": template.name, "description": template.description, "fields": template.fields},
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
        
        if commit:
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
            joinedload(MedicalRecord.patient),
            joinedload(MedicalRecord.photos),
            joinedload(MedicalRecord.appointment).joinedload(Appointment.calendar_event),
            joinedload(MedicalRecord.appointment).joinedload(Appointment.appointment_type),
            joinedload(MedicalRecord.created_by_user),
            joinedload(MedicalRecord.updated_by_user),
            joinedload(MedicalRecord.template)
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
            joinedload(MedicalRecord.template)
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
        is_submitted: Any = MISSING,
        patient_last_edited_at: Any = MISSING,
        updated_by_user_id: Optional[int] = None
    ) -> MedicalRecord:
        record = MedicalRecordService.get_record(db, record_id, clinic_id)
        if not record:
            raise HTTPException(
                status_code=404, 
                detail={"error_code": "RECORD_NOT_FOUND", "message": "Record not found"}
            )
        
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
            
            raise RecordVersionConflictError(
                "Record has been modified by another user",
                current_record=record,
                updated_by_user_name=updated_by_user_name
            )

        if values is not MISSING:
            record.values = values
        if appointment_id is not MISSING:
            # Validate appointment if changing
            if appointment_id is not None and appointment_id != record.appointment_id:
                appt = db.query(Appointment).filter(Appointment.calendar_event_id == appointment_id).first()
                if not appt:
                    raise HTTPException(
                        status_code=404, 
                        detail={"error_code": "APPOINTMENT_NOT_FOUND", "message": "Appointment not found"}
                    )
                if appt.patient_id != record.patient_id:
                    raise HTTPException(
                        status_code=400, 
                        detail={"error_code": "INVALID_APPOINTMENT", "message": "Appointment does not belong to this patient"}
                    )
            record.appointment_id = appointment_id
        if is_submitted is not MISSING:
            record.is_submitted = is_submitted
        if patient_last_edited_at is not MISSING:
            record.patient_last_edited_at = patient_last_edited_at
            
        # Handle Photo Updates
        if photo_ids is not MISSING:
            # Get current photos
            current_photos = db.query(PatientPhoto).filter(
                PatientPhoto.medical_record_id == record_id,
                PatientPhoto.clinic_id == clinic_id
            ).all()
            current_ids = {p.id for p in current_photos}
            new_ids: set[int] = set(photo_ids) if photo_ids is not None else set()
            
            # Unlink removed photos
            ids_to_unlink = current_ids - new_ids
            if ids_to_unlink:
                db.query(PatientPhoto).filter(
                    PatientPhoto.id.in_(ids_to_unlink)
                ).update({
                    "medical_record_id": None,
                    # If unlinked, they become standalone gallery photos, so ensure they are active
                    "is_pending": False 
                }, synchronize_session=False)
            
            # Link new photos
            ids_to_link = new_ids - current_ids
            if ids_to_link:
                # Verify existence and access
                photos_to_link = db.query(PatientPhoto).filter(
                    PatientPhoto.id.in_(ids_to_link),
                    PatientPhoto.clinic_id == clinic_id,
                    PatientPhoto.patient_id == record.patient_id
                ).with_for_update().all()
                
                if len(photos_to_link) != len(ids_to_link):
                    found_ids = {p.id for p in photos_to_link}
                    missing = ids_to_link - found_ids
                    raise HTTPException(status_code=404, detail=f"Photos not found, access denied, or belong to another patient: {missing}")
                
                for photo in photos_to_link:
                    photo.medical_record_id = record_id
                    photo.is_pending = False
            
            # Ensure all currently linked photos are committed (not pending)
            # This handles photos that were already linked from previous saves
            ids_to_keep = current_ids & new_ids
            if ids_to_keep:
                db.query(PatientPhoto).filter(
                    PatientPhoto.id.in_(ids_to_keep)
                ).update({
                    "is_pending": False
                }, synchronize_session=False)

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
            PatientPhoto.medical_record_id == record_id,
            PatientPhoto.clinic_id == clinic_id
        ).delete(synchronize_session=False)
        
        db.delete(record)
        db.commit()
        return True

    @staticmethod
    def send_patient_form(
        db: Session,
        clinic_id: int,
        patient_id: int,
        template_id: int,
        created_by_user_id: int,
        appointment_id: Optional[int] = None,
        message_override: Optional[str] = None
    ) -> MedicalRecord:
        # 1. Verify Clinic
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=404, 
                detail={"error_code": "CLINIC_NOT_FOUND", "message": "Clinic not found"}
            )

        # 2. Verify Patient and Line linkage
        patient = db.query(Patient).filter(
            Patient.id == patient_id, 
            Patient.clinic_id == clinic_id
        ).first()
        
        if not patient:
            raise HTTPException(
                status_code=404, 
                detail={"error_code": "PATIENT_NOT_FOUND", "message": "Patient not found"}
            )
            
        if not patient.line_user_id:
            raise HTTPException(
                status_code=400, 
                detail={
                    "error_code": "PATIENT_NOT_LINKED",
                    "message": "Patient is not linked to a LINE user"
                }
            )
            
        line_user = db.query(LineUser).filter(LineUser.id == patient.line_user_id).first()
        if not line_user:
             raise HTTPException(
                 status_code=404, 
                 detail={"error_code": "LINE_USER_NOT_FOUND", "message": "Linked LINE user not found"}
             )

        # 3. Verify Template
        template = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id
        ).first()
        
        if not template:
            raise HTTPException(
                status_code=404, 
                detail={"error_code": "TEMPLATE_NOT_FOUND", "message": "Template not found"}
            )
        
        if not template.is_patient_form:
            raise HTTPException(
                status_code=400, 
                detail={
                    "error_code": "TEMPLATE_NOT_PATIENT_FORM",
                    "message": "Template is not a patient form"
                }
            )

        # Wrap the transactional operations
        try:
            # 4. Create Record (NO COMMIT)
            record = MedicalRecordService.create_record(
                db=db,
                clinic_id=clinic_id,
                patient_id=patient_id,
                template_id=template_id,
                values={},  # Empty values for patient to fill
                appointment_id=appointment_id,
                created_by_user_id=created_by_user_id,
                commit=False
            )
            
            # Flush to get record.id for LIFF URL
            db.flush()

            # 5. Construct LIFF URL using utility
            from utils.liff_token import generate_liff_url
            
            try:
                liff_url = generate_liff_url(
                    clinic=clinic,
                    mode="form",
                    path=f"records/{record.id}"
                )
            except ValueError as e:
                # Wrap ValueError from LIFF configuration as structured error
                raise HTTPException(
                    status_code=500, 
                    detail={
                        "error_code": "LIFF_NOT_CONFIGURED",
                        "message": str(e)
                    }
                )
            
            # 6. Prepare Message
            # Default message if none configured
            default_template = (
                "{病患姓名}，您好：\n"
                "請填寫「{模板名稱}」，謝謝您。"
            )
            message_template_str = template.message_template or default_template
            
            context = {
                "病患姓名": patient.full_name,
                "模板名稱": template.name,
                "診所名稱": clinic.effective_display_name or ""
            }
            
            # message_override is still respected if provided (though frontend won't send it)
            text_message = message_override or MessageTemplateService.render_message(message_template_str, context)
            
            # 7. Send Message
            line_service = LINEService(clinic.line_channel_secret, clinic.line_channel_access_token)
            
            line_service.send_template_message_with_button(
                line_user_id=line_user.line_user_id,
                text=text_message,
                button_label="填寫表單 (Fill Form)",
                button_uri=liff_url,
                clinic_id=clinic_id,
                labels={
                    "event_type": "patient_form_request", 
                    "recipient_type": "patient", 
                    "trigger_source": "clinic_triggered"
                }
            )
            
            # 8. Final Commit on success
            db.commit()
            db.refresh(record)
            return record
            
        except HTTPException:
            # Atomic rollback for any structured errors raised
            db.rollback()
            raise
        except Exception as e:
            # Atomic rollback for any unexpected errors (e.g. LINE API connection)
            db.rollback()
            raise HTTPException(
                status_code=500, 
                detail={
                    "error_code": "LINE_SEND_FAILED",
                    "message": f"Failed to send LINE message: {str(e)}"
                }
            )
