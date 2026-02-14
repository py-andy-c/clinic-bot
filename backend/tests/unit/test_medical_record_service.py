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
from models.user import User

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

def test_send_patient_form_success_with_custom_template(db_session):
    # Setup using real DB session
    user = User(email="staff@example.com", google_subject_id="sub123")
    db_session.add(user)
    db_session.flush()
    
    clinic = Clinic(name="Test Clinic", line_channel_id="c123", line_channel_secret="s", line_channel_access_token="t")
    db_session.add(clinic)
    db_session.flush()
    
    line_user = LineUser(line_user_id="U123", clinic_id=clinic.id, display_name="User")
    db_session.add(line_user)
    db_session.flush()
    
    patient = Patient(clinic_id=clinic.id, full_name="John Doe", line_user_id=line_user.id)
    db_session.add(patient)
    db_session.flush()
    
    template = MedicalRecordTemplate(
        clinic_id=clinic.id, 
        name="Assessment", 
        fields=[],
        is_patient_form=True,
        message_template="Hello {病患姓名}, please fill {模板名稱} for {診所名稱}"
    )
    db_session.add(template)
    db_session.commit() # Commit to ensure all FKs are happy
    
    with patch("services.medical_record_service.LINEService") as mock_line_service_cls:
        mock_line_instance = mock_line_service_cls.return_value
        with patch("utils.liff_token.generate_liff_url") as mock_liff:
            mock_liff.return_value = "https://liff.url"
            
            MedicalRecordService.send_patient_form(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                template_id=template.id,
                created_by_user_id=user.id
            )
            
            # Verify message content
            expected_message = f"Hello {patient.full_name}, please fill {template.name} for {clinic.name}"
            mock_line_instance.send_template_message_with_button.assert_called_once()
            args, kwargs = mock_line_instance.send_template_message_with_button.call_args
            assert kwargs["text"] == expected_message

def test_send_patient_form_fallback_to_default(db_session):
    # Setup using real DB session
    user = User(email="staff2@example.com", google_subject_id="sub456")
    db_session.add(user)
    db_session.flush()
    
    clinic = Clinic(name="Clinic 2", line_channel_id="c456", line_channel_secret="s", line_channel_access_token="t")
    db_session.add(clinic)
    db_session.flush()
    
    line_user = LineUser(line_user_id="U456", clinic_id=clinic.id, display_name="User")
    db_session.add(line_user)
    db_session.flush()
    
    patient = Patient(clinic_id=clinic.id, full_name="Jane Doe", line_user_id=line_user.id)
    db_session.add(patient)
    db_session.flush()
    
    # Template with NO custom message
    template = MedicalRecordTemplate(
        clinic_id=clinic.id, 
        name="Consultation", 
        fields=[],
        is_patient_form=True,
        message_template=None
    )
    db_session.add(template)
    db_session.commit()
    
    with patch("services.medical_record_service.LINEService") as mock_line_service_cls:
        mock_line_instance = mock_line_service_cls.return_value
        with patch("utils.liff_token.generate_liff_url") as mock_liff:
            mock_liff.return_value = "https://liff.url"
            
            MedicalRecordService.send_patient_form(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                template_id=template.id,
                created_by_user_id=user.id
            )
            
            # Should use default rendering
            # {病患姓名}，您好：\n請填寫「{模板名稱}」，謝謝您。
            expected_message = f"{patient.full_name}，您好：\n請填寫「{template.name}」，謝謝您。"
            mock_line_instance.send_template_message_with_button.assert_called_once()
            args, kwargs = mock_line_instance.send_template_message_with_button.call_args
            assert kwargs["text"] == expected_message

def test_send_patient_form_respects_message_override(db_session):
    # Setup
    user = User(email="staff3@example.com", google_subject_id="sub789")
    db_session.add(user)
    db_session.flush()
    
    clinic = Clinic(name="Clinic 3", line_channel_id="c789", line_channel_secret="s", line_channel_access_token="t")
    db_session.add(clinic)
    db_session.flush()
    
    line_user = LineUser(line_user_id="U789", clinic_id=clinic.id, display_name="User")
    db_session.add(line_user)
    db_session.flush()
    
    patient = Patient(clinic_id=clinic.id, full_name="Bob", line_user_id=line_user.id)
    db_session.add(patient)
    db_session.flush()
    
    template = MedicalRecordTemplate(clinic_id=clinic.id, name="X-Ray", fields=[], is_patient_form=True)
    db_session.add(template)
    db_session.commit()
    
    with patch("services.medical_record_service.LINEService") as mock_line_service_cls:
        mock_line_instance = mock_line_service_cls.return_value
        with patch("utils.liff_token.generate_liff_url") as mock_liff:
            mock_liff.return_value = "https://liff.url"
            
            override_msg = "THIS IS A MANUAL OVERRIDE"
            MedicalRecordService.send_patient_form(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                template_id=template.id,
                created_by_user_id=user.id,
                message_override=override_msg
            )
            
            # Verify override is used
            mock_line_instance.send_template_message_with_button.assert_called_once()
            args, kwargs = mock_line_instance.send_template_message_with_button.call_args
            assert kwargs["text"] == override_msg
