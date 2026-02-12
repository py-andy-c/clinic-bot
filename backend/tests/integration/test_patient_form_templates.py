import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
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
def test_clinic_setup(db_session):
    clinic = Clinic(
        name="Patient Form Clinic",
        line_channel_id="pf_channel",
        line_channel_secret="pf_secret",
        line_channel_access_token="pf_token"
    )
    db_session.add(clinic)
    db_session.commit()
    
    admin, _ = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="PF Admin",
        email="pfadmin@test.com",
        google_subject_id="pf_sub",
        roles=["admin"]
    )
    
    patient = Patient(
        clinic_id=clinic.id,
        full_name="PF Patient",
        created_at=datetime.now(timezone.utc)
    )
    db_session.add(patient)
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
    
    return clinic, patient, headers

def test_patient_form_template_setting(client, test_clinic_setup, db_session):
    """
    Verifies that is_patient_form can be set during creation and update.
    """
    clinic, patient, headers = test_clinic_setup
    
    # 1. Create Template with is_patient_form=True
    template_data = {
        "name": "Intake Form",
        "fields": [{"label": "Current Symptoms", "type": "text", "required": False}],
        "is_patient_form": True
    }
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_patient_form"] is True
    template_id = data["id"]
    
    # 2. Update Template to set is_patient_form=False
    update_data = {
        "version": 1,
        "is_patient_form": False
    }
    resp = client.put(f"/api/clinic/medical-record-templates/{template_id}", json=update_data, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["is_patient_form"] is False

def test_medical_record_patient_fields(client, test_clinic_setup, db_session):
    """
    Verifies that patient-related fields are present in the record response.
    """
    clinic, patient, headers = test_clinic_setup
    
    # 1. Create Template
    template_data = {
        "name": "Standard Record",
        "fields": []
    }
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=headers)
    template_id = resp.json()["id"]
    
    # 2. Create Record
    record_data = {
        "template_id": template_id,
        "values": {}
    }
    resp = client.post(f"/api/clinic/patients/{patient.id}/medical-records", json=record_data, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    
    # Check new fields are present
    assert "patient_last_edited_at" in data
    assert data["patient_last_edited_at"] is None
    assert "is_submitted" in data
    assert data["is_submitted"] is False
    assert "is_patient_form" in data
