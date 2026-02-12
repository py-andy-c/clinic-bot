import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from sqlalchemy.orm import Session
from services.medical_record_service import MedicalRecordService
from models.clinic import Clinic
from models.patient import Patient
from models.medical_record import MedicalRecord
from models.medical_record_template import MedicalRecordTemplate
from models.line_user import LineUser

def test_send_patient_form_clinic_not_found(db_session):
    # Setup: No clinic in DB
    with pytest.raises(HTTPException) as exc:
        MedicalRecordService.send_patient_form(
            db=db_session,
            clinic_id=999,
            patient_id=1,
            template_id=1,
            created_by_user_id=1
        )
    assert exc.value.status_code == 404
    assert exc.value.detail["error_code"] == "CLINIC_NOT_FOUND"

def test_send_patient_form_patient_not_found(db_session):
    # Create Clinic
    clinic = Clinic(name="Test", line_channel_id="c", line_channel_secret="s", line_channel_access_token="t")
    db_session.add(clinic)
    db_session.commit()
    
    with pytest.raises(HTTPException) as exc:
        MedicalRecordService.send_patient_form(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=888, # Non-existent
            template_id=1,
            created_by_user_id=1
        )
    assert exc.value.status_code == 404
    assert exc.value.detail["error_code"] == "PATIENT_NOT_FOUND"

def test_send_patient_form_line_user_not_found(db_session):
    # Create Clinic
    clinic = Clinic(name="Test", line_channel_id="c", line_channel_secret="s", line_channel_access_token="t")
    db_session.add(clinic)
    db_session.commit()
    
    # Create Line User first to satisfy FK
    line_user = LineUser(line_user_id="U_TEMP", display_name="Temp", clinic_id=clinic.id)
    db_session.add(line_user)
    db_session.commit()
    
    # Create Patient with line_user_id
    patient = Patient(clinic_id=clinic.id, full_name="John", line_user_id=line_user.id)
    db_session.add(patient)
    db_session.commit()
    
    # Now delete the Line User to simulate a dangling link (if DB allows, though FK should prevent it)
    # Actually, let's just mock the DB query for line_user to return None
    with patch.object(db_session, 'query') as mock_query:
        # Mocking complex SQLAlchemy queries is hard, so let's just test that it RAISES if it doesn't find it
        # I'll just skip the DB-level FK test and use a mock for the service layer.
        pass

def test_send_patient_form_line_user_not_found_mocked(db_session):
    clinic = Clinic(id=1, name="Test")
    patient = Patient(id=1, clinic_id=1, full_name="John", line_user_id=99)
    
    with patch("sqlalchemy.orm.Session.query") as mock_query:
        # 1st call for clinic, 2nd for patient, 3rd for line_user
        mock_query.return_value.filter.return_value.first.side_effect = [clinic, patient, None]
        
        with pytest.raises(HTTPException) as exc:
            MedicalRecordService.send_patient_form(
                db=db_session,
                clinic_id=1,
                patient_id=1,
                template_id=1,
                created_by_user_id=1
            )
        assert exc.value.status_code == 404
        assert exc.value.detail["error_code"] == "LINE_USER_NOT_FOUND"
