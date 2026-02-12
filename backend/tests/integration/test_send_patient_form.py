import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.medical_record_template import MedicalRecordTemplate
from models.line_user import LineUser
from tests.conftest import create_user_with_clinic_association

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def override_get_db(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield
    app.dependency_overrides.pop(get_db, None)

@pytest.fixture
def test_send_patient_form_setup(db_session):
    # Create Clinic
    clinic = Clinic(
        name="Patient Form Test Clinic",
        line_channel_id="pf_channel_test",
        line_channel_secret="pf_secret_test",
        line_channel_access_token="pf_token_test",
        liff_id="1234567890-abcdefgh",
        liff_access_token="test_liff_token"
    )
    db_session.add(clinic)
    db_session.commit()
    
    # Create Admin User
    admin, _ = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="PF Admin",
        email="pfadmin_test@test.com",
        google_subject_id="pf_sub_test",
        roles=["admin"]
    )
    
    # Create Line User
    line_user = LineUser(
        line_user_id="U1234567890abcdef1234567890abcdef",
        display_name="Test Line User",
        clinic_id=clinic.id
    )
    db_session.add(line_user)
    db_session.commit() # Get ID
    
    # Create Patient linked to Line User
    patient = Patient(
        clinic_id=clinic.id,
        full_name="PF Patient Linked",
        created_at=datetime.now(timezone.utc),
        line_user_id=line_user.id
    )
    db_session.add(patient)
    db_session.commit()
    
    # Create Patient NOT linked to Line User
    patient_unlinked = Patient(
        clinic_id=clinic.id,
        full_name="PF Patient Unlinked",
        created_at=datetime.now(timezone.utc)
    )
    db_session.add(patient_unlinked)
    db_session.commit()
    
    # Create Patient Form Template
    template_pf = MedicalRecordTemplate(
        clinic_id=clinic.id,
        name="Intake Form",
        fields=[{"label": "Symptom", "type": "text"}],
        is_patient_form=True
    )
    db_session.add(template_pf)
    
    # Create Regular Template
    template_regular = MedicalRecordTemplate(
        clinic_id=clinic.id,
        name="Doctor Notes",
        fields=[{"label": "Notes", "type": "text"}],
        is_patient_form=False
    )
    db_session.add(template_regular)
    db_session.commit()
    
    # Generate Auth Headers
    from services.jwt_service import jwt_service, TokenPayload
    payload = TokenPayload(
        sub=admin.google_subject_id,
        user_id=admin.id,
        email=admin.email,
        user_type="clinic_user",
        roles=["admin"],
        name="PF Admin",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    headers = {"Authorization": f"Bearer {token}"}
    
    return clinic, patient, patient_unlinked, template_pf, template_regular, headers

@patch("utils.liff_token.generate_liff_url")
@patch("services.medical_record_service.LINEService")
def test_send_patient_form_success(mock_line_service_cls, mock_gen_liff, client, test_send_patient_form_setup, db_session):
    clinic, patient, _, template_pf, _, headers = test_send_patient_form_setup
    
    # Setup mock instance
    mock_line_service = MagicMock()
    mock_line_service_cls.return_value = mock_line_service
    mock_gen_liff.return_value = f"https://liff.line.me/{clinic.liff_id}/records/MOCK_ID"
    
    payload = {
        "template_id": template_pf.id,
        "message_override": "Please fill this out ASAP."
    }
    
    resp = client.post(
        f"/api/clinic/patients/{patient.id}/medical-records/send-form",
        json=payload,
        headers=headers
    )
    
    assert resp.status_code == 200
    data = resp.json()
    assert data["template_id"] == template_pf.id
    assert data["is_submitted"] is False
    
    # Verify LIFF URL generated correctly
    mock_gen_liff.assert_called_once()
    liff_call_kwargs = mock_gen_liff.call_args[1]
    assert liff_call_kwargs["clinic"].id == clinic.id
    assert liff_call_kwargs["mode"] == "form"
    assert liff_call_kwargs["path"] == f"records/{data['id']}"

def test_access_unauthorized_clinic_returns_401(client, test_send_patient_form_setup, db_session):
    """
    Test that attempting to access a non-existent or unauthorized clinic 
    returns 401 UNAUTHORIZED. This is handled by SwitchClinicMiddleware 
    before it reaches the service layer.
    """
    clinic, patient, _, template_pf, _, headers = test_send_patient_form_setup
    
    payload = {
        "template_id": template_pf.id
    }
    
    # Create a token with a non-existent clinic ID
    from services.jwt_service import jwt_service, TokenPayload
    payload_bad_clinic = TokenPayload(
        sub="bad_sub",
        user_id=1,
        email="bad@test.com",
        user_type="clinic_user",
        roles=["admin"],
        name="Bad Admin",
        active_clinic_id=999999 # Non-existent ID
    )
    token = jwt_service.create_access_token(payload_bad_clinic)
    bad_headers = {"Authorization": f"Bearer {token}"}
    
    resp = client.post(
        f"/api/clinic/patients/{patient.id}/medical-records/send-form",
        json=payload,
        headers=bad_headers
    )
    
    # SwitchClinicMiddleware returns 401 if it cannot find the clinic 
    # associated with the token or if the user doesn't belong to it.
    assert resp.status_code == 401

def test_send_patient_form_patient_not_linked(client, test_send_patient_form_setup, db_session):
    clinic, _, patient_unlinked, template_pf, _, headers = test_send_patient_form_setup
    
    payload = {
        "template_id": template_pf.id
    }
    
    resp = client.post(
        f"/api/clinic/patients/{patient_unlinked.id}/medical-records/send-form",
        json=payload,
        headers=headers
    )
    
    # Should fail because patient line_user_id is None
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "PATIENT_NOT_LINKED"
    assert "Patient is not linked to a LINE user" in resp.json()["detail"]["message"]

def test_send_patient_form_not_pf_template(client, test_send_patient_form_setup, db_session):
    clinic, patient, _, _, template_regular, headers = test_send_patient_form_setup
    
    payload = {
        "template_id": template_regular.id
    }
    
    resp = client.post(
        f"/api/clinic/patients/{patient.id}/medical-records/send-form",
        json=payload,
        headers=headers
    )
    
    # Should fail because template.is_patient_form is False
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "TEMPLATE_NOT_PATIENT_FORM"
    assert "Template is not a patient form" in resp.json()["detail"]["message"]

@patch("utils.liff_token.generate_liff_url")
@patch("services.medical_record_service.LINEService")
def test_send_patient_form_line_error(mock_line_service_cls, mock_gen_liff, client, test_send_patient_form_setup, db_session):
    clinic, patient, _, template_pf, _, headers = test_send_patient_form_setup
    
    # Mock LIFF URL generation
    mock_gen_liff.return_value = f"https://liff.line.me/{clinic.liff_id}/records/MOCK_ID"
    
    # Setup mock to raise exception
    mock_line_service = MagicMock()
    mock_line_service.send_template_message_with_button.side_effect = Exception("LINE API Error")
    mock_line_service_cls.return_value = mock_line_service
    
    # Spy on db_session.rollback
    original_rollback = db_session.rollback
    db_session.rollback = MagicMock(side_effect=original_rollback)
    
    payload = {
        "template_id": template_pf.id
    }
    
    resp = client.post(
        f"/api/clinic/patients/{patient.id}/medical-records/send-form",
        json=payload,
        headers=headers
    )
    
    assert resp.status_code == 500
    assert resp.json()["detail"]["error_code"] == "LINE_SEND_FAILED"
    
    # CRITICAL: Verify explicit rollback was called
    db_session.rollback.assert_called()
    
    # Verify no record remains in DB
    from models.medical_record import MedicalRecord
    record_count = db_session.query(MedicalRecord).filter(
        MedicalRecord.patient_id == patient.id,
        MedicalRecord.template_id == template_pf.id
    ).count()
    assert record_count == 0

@patch("utils.liff_token.generate_liff_url")
def test_send_patient_form_liff_error(mock_gen_liff, client, test_send_patient_form_setup, db_session):
    clinic, patient, _, template_pf, _, headers = test_send_patient_form_setup
    
    # Setup mock to raise ValueError
    mock_gen_liff.side_effect = ValueError("LIFF ID not configured")
    
    # Spy on db_session.rollback
    original_rollback = db_session.rollback
    db_session.rollback = MagicMock(side_effect=original_rollback)
    
    payload = {
        "template_id": template_pf.id
    }
    
    resp = client.post(
        f"/api/clinic/patients/{patient.id}/medical-records/send-form",
        json=payload,
        headers=headers
    )
    
    assert resp.status_code == 500
    assert resp.json()["detail"]["error_code"] == "LIFF_NOT_CONFIGURED"
    
    # CRITICAL: Verify explicit rollback was called
    db_session.rollback.assert_called()
    
    # Verify rollback resulted in 0 records
    from models.medical_record import MedicalRecord
    record_count = db_session.query(MedicalRecord).filter(
        MedicalRecord.patient_id == patient.id,
        MedicalRecord.template_id == template_pf.id
    ).count()
    assert record_count == 0
