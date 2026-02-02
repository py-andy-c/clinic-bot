
import pytest
from datetime import datetime
from sqlalchemy.orm import Session
from fastapi import HTTPException
from models.clinic import Clinic
from models.user import User
from models.patient import Patient
from models.medical_record_template import MedicalRecordTemplate
from models.medical_record import MedicalRecord
from models.patient_photo import PatientPhoto
from services.medical_record_service import MedicalRecordService
from services.patient_photo_service import PatientPhotoService
from tests.conftest import create_user_with_clinic_association

def create_clinic(db: Session, name: str) -> Clinic:
    clinic = Clinic(name=name, line_channel_id=f"id_{name}", line_channel_secret="secret", line_channel_access_token="token")
    db.add(clinic)
    db.flush()
    return clinic

def create_patient(db: Session, clinic: Clinic, name: str) -> Patient:
    patient = Patient(clinic_id=clinic.id, full_name=name, phone_number=f"123_{name}")
    db.add(patient)
    db.flush()
    return patient

def create_template(db: Session, clinic: Clinic, name: str) -> MedicalRecordTemplate:
    template = MedicalRecordTemplate(clinic_id=clinic.id, name=name, fields=[{"id": "f1", "label": "Notes", "type": "text"}])
    db.add(template)
    db.flush()
    return template

def create_photo(db: Session, clinic: Clinic, patient: Patient, is_pending: bool = False) -> PatientPhoto:
    photo = PatientPhoto(
        clinic_id=clinic.id,
        patient_id=patient.id,
        filename="test.jpg",
        content_type="image/jpeg",
        storage_key=f"clinic_assets/{clinic.id}/hash123.jpg",
        content_hash=f"hash123_{datetime.now().timestamp()}",
        size_bytes=1024,
        is_pending=is_pending
    )
    db.add(photo)
    db.flush()
    return photo

class TestMedicalRecordSecurity:
    
    def test_cross_clinic_record_creation(self, db_session: Session):
        """Verify User A cannot create a record for Patient B (different clinic)."""
        clinic_a = create_clinic(db_session, "Clinic A")
        clinic_b = create_clinic(db_session, "Clinic B")
        
        user_a, _ = create_user_with_clinic_association(db_session, clinic_a, "User A", "a@test.com", "sub_a", ["admin"])
        patient_b = create_patient(db_session, clinic_b, "Patient B")
        template = create_template(db_session, clinic_a, "General")
        
        # User A tries to create record for Patient B using Clinic A context
        with pytest.raises(HTTPException) as excinfo:
            MedicalRecordService.create_record(
                db=db_session,
                clinic_id=clinic_a.id,
                patient_id=patient_b.id, # Belongs to Clinic B!
                template_id=template.id,
                values={"f1": "test"},
                created_by_user_id=user_a.id
            )
        assert "Patient does not belong to this clinic" in str(excinfo.value.detail)

    def test_cross_clinic_photo_linking(self, db_session: Session):
        """Verify User A cannot link Patient B's photo to Patient A's record."""
        clinic_a = create_clinic(db_session, "Clinic A")
        clinic_b = create_clinic(db_session, "Clinic B")
        
        user_a, _ = create_user_with_clinic_association(db_session, clinic_a, "User A", "a@test.com", "sub_a", ["admin"])
        patient_a = create_patient(db_session, clinic_a, "Patient A")
        patient_b = create_patient(db_session, clinic_b, "Patient B")
        
        photo_b = create_photo(db_session, clinic_b, patient_b)
        template = create_template(db_session, clinic_a, "General")
        
        # User A creates record for Patient A, trying to link Photo B
        with pytest.raises(HTTPException) as excinfo:
            MedicalRecordService.create_record(
                db=db_session,
                clinic_id=clinic_a.id,
                patient_id=patient_a.id,
                template_id=template.id,
                values={"f1": "test"},
                photo_ids=[photo_b.id], # Belongs to Clinic B/Patient B
                created_by_user_id=user_a.id
            )
        assert "Photos not found, access denied, or belong to another patient" in str(excinfo.value.detail)
        
        # Verify photo was NOT linked

    def test_cross_patient_photo_linking_same_clinic(self, db_session: Session):
        """Verify User cannot link Patient X's photo to Patient Y's record (same clinic)."""
        clinic = create_clinic(db_session, "Clinic A")
        user, _ = create_user_with_clinic_association(db_session, clinic, "User A", "a@test.com", "sub_a", ["admin"])
        
        patient_x = create_patient(db_session, clinic, "Patient X")
        patient_y = create_patient(db_session, clinic, "Patient Y")
        
        photo_x = create_photo(db_session, clinic, patient_x)
        template = create_template(db_session, clinic, "General")
        
        # Create record for Patient Y, try to link Photo X
        with pytest.raises(HTTPException) as excinfo:
            MedicalRecordService.create_record(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient_y.id,
                template_id=template.id,
                values={"f1": "test"},
                photo_ids=[photo_x.id], # Belongs to Patient X
                created_by_user_id=user.id
            )
        assert "Photos not found, access denied, or belong to another patient" in str(excinfo.value.detail)

    def test_update_record_photo_ids(self, db_session: Session):
        """Verify updating record with new photo_ids works."""
        clinic = create_clinic(db_session, "Clinic A")
        user, _ = create_user_with_clinic_association(db_session, clinic, "User A", "a@test.com", "sub_a", ["admin"])
        patient = create_patient(db_session, clinic, "Patient A")
        template = create_template(db_session, clinic, "General")
        photo1 = create_photo(db_session, clinic, patient)
        photo2 = create_photo(db_session, clinic, patient)
        
        # Create with Photo 1
        record = MedicalRecordService.create_record(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            template_id=template.id,
            values={"f1": "v1"},
            photo_ids=[photo1.id],
            created_by_user_id=user.id
        )
        assert len(record.photos) == 1
        assert record.photos[0].id == photo1.id
        
        # Update to use Photo 2 instead
        updated = MedicalRecordService.update_record(
            db=db_session,
            record_id=record.id,
            clinic_id=clinic.id,
            version=record.version,
            photo_ids=[photo2.id],
            updated_by_user_id=user.id
        )
        
        db_session.refresh(updated)
        assert len(updated.photos) == 1
        assert updated.photos[0].id == photo2.id

    def test_list_photos_visibility(self, db_session: Session):
        """Verify list_photos hides pending photos by default."""
        clinic = create_clinic(db_session, "Clinic A")
        patient = create_patient(db_session, clinic, "Patient A")
        
        active_photo = create_photo(db_session, clinic, patient, is_pending=False)
        pending_photo = create_photo(db_session, clinic, patient, is_pending=True)
        
        service = PatientPhotoService()
        
        # List photos without record_id -> should only show active
        photos = service.list_photos(db_session, clinic.id, patient.id)
        ids = [p.id for p in photos]
        assert active_photo.id in ids
        assert pending_photo.id not in ids
        
        # Simulate record creation linking the pending photo
        pending_photo.is_pending = False
        db_session.add(pending_photo)
        db_session.commit()
        
        photos_after = service.list_photos(db_session, clinic.id, patient.id)
        ids_after = [p.id for p in photos_after]
        assert active_photo.id in ids_after
        assert pending_photo.id in ids_after

