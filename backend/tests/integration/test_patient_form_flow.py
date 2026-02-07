import pytest
import boto3
import io
from moto import mock_aws
from fastapi.testclient import TestClient
from datetime import datetime, timedelta, timezone
from PIL import Image
from unittest.mock import patch, MagicMock

from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.line_user import LineUser
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.appointment_type import AppointmentType
from models.medical_record_template import MedicalRecordTemplate
from models.patient_form_request import PatientFormRequest
from models.patient_photo import PatientPhoto
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
def test_setup(db_session):
    # 1. Create Clinic
    clinic = Clinic(
        name="Patient Form Clinic",
        line_channel_id="pf_channel",
        line_channel_secret="pf_secret",
        line_channel_access_token="pf_token",
        liff_id="pf_liff_id"
    )
    db_session.add(clinic)
    db_session.flush()
    
    # 2. Create Admin User
    admin, _ = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="PF Admin",
        email="pfadmin@test.com",
        google_subject_id="pf_admin_sub",
        roles=["admin"]
    )
    
    # 3. Create LINE User and Patient
    line_user = LineUser(
        line_user_id="pf_line_id",
        clinic_id=clinic.id,
        display_name="PF User"
    )
    db_session.add(line_user)
    db_session.flush()
    
    patient = Patient(
        clinic_id=clinic.id,
        full_name="PF Patient",
        line_user_id=line_user.id
    )
    db_session.add(patient)
    db_session.flush()
    
    # 4. Create Practitioner
    practitioner, _ = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="PF Practitioner",
        email="pfpractitioner@test.com",
        google_subject_id="pf_practitioner_sub",
        roles=["practitioner"]
    )
    
    # 5. Generate Auth Headers
    from services.jwt_service import jwt_service, TokenPayload
    
    # Admin Headers
    admin_payload = TokenPayload(
        sub=admin.google_subject_id,
        user_id=admin.id,
        email=admin.email,
        user_type="clinic_user",
        roles=["admin"],
        name="PF Admin",
        active_clinic_id=clinic.id
    )
    admin_token = jwt_service.create_access_token(admin_payload)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    
    # LIFF Headers
    import jwt
    from core.config import JWT_SECRET_KEY
    liff_payload = {
        "line_user_id": line_user.line_user_id,
        "clinic_id": clinic.id,
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
        "iat": datetime.now(timezone.utc)
    }
    liff_token = jwt.encode(liff_payload, JWT_SECRET_KEY, algorithm="HS256")
    liff_headers = {"Authorization": f"Bearer {liff_token}"}
    
    db_session.commit()
    
    return {
        "clinic": clinic,
        "admin": admin,
        "line_user": line_user,
        "patient": patient,
        "practitioner": practitioner,
        "admin_headers": admin_headers,
        "liff_headers": liff_headers
    }

@mock_aws
@patch('services.line_service.LINEService')
def test_patient_form_full_flow(mock_line_service, client, test_setup, db_session):
    """
    Verifies the full flow of Patient Forms:
    1. Admin creates a Patient Form Template
    2. Admin manually sends a form request to a patient
    3. Patient lists their forms via LIFF
    4. Patient uploads photos via LIFF
    5. Patient submits the form
    6. Admin views the submitted form (medical record)
    """
    setup = test_setup
    clinic = setup["clinic"]
    patient = setup["patient"]
    admin_headers = setup["admin_headers"]
    liff_headers = setup["liff_headers"]
    
    # Setup S3 for photos
    s3 = boto3.client("s3", region_name="ap-northeast-1")
    s3.create_bucket(Bucket="clinic-bot-dev", CreateBucketConfiguration={'LocationConstraint': 'ap-northeast-1'})

    # 1. Admin creates a Patient Form Template
    template_data = {
        "name": "Intake Form",
        "template_type": "patient_form",
        "max_photos": 3,
        "fields": [
            {"id": "f1", "name": "Symptoms", "type": "text"},
            {"id": "f2", "name": "Pain Level", "type": "number"}
        ]
    }
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=admin_headers)
    assert resp.status_code == 200
    template_id = resp.json()["id"]
    
    # 2. Admin manually sends a form request
    request_data = {
        "template_id": template_id,
        "message_template": "Please fill this: {表單連結}",
        "flex_button_text": "Fill Now",
        "notify_admin": True
    }
    resp = client.post(f"/api/clinic/{patient.id}/patient-form-requests", json=request_data, headers=admin_headers)
    assert resp.status_code == 200
    access_token = db_session.query(PatientFormRequest).filter_by(patient_id=patient.id).first().access_token
    
    # 3. Patient lists their forms via LIFF
    resp = client.get("/api/liff/patient-forms", headers=liff_headers)
    assert resp.status_code == 200
    forms = resp.json()["forms"]
    assert len(forms) == 1
    assert forms[0]["access_token"] == access_token
    
    # 4. Patient gets form details
    resp = client.get(f"/api/liff/patient-forms/{access_token}", headers=liff_headers)
    assert resp.status_code == 200
    assert resp.json()["template"]["name"] == "Intake Form"
    
    # 5. Patient uploads photos via LIFF
    img = Image.new('RGB', (100, 100), color='red')
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    img_content = img_byte_arr.getvalue()
    
    photo_ids = []
    for i in range(2):
        files = {"file": (f"symptom_{i}.jpg", img_content, "image/jpeg")}
        resp = client.post(f"/api/liff/patient-forms/{access_token}/photos", files=files, headers=liff_headers)
        assert resp.status_code == 200
        photo_ids.append(resp.json()["id"])
        
    # Verify photo limit (try uploading 4th photo, limit is 3)
    # Upload 3rd photo (at limit)
    files = {"file": ("symptom_2.jpg", img_content, "image/jpeg")}
    resp = client.post(f"/api/liff/patient-forms/{access_token}/photos", files=files, headers=liff_headers)
    assert resp.status_code == 200
    
    # Try 4th photo (over limit)
    files = {"file": ("symptom_3.jpg", img_content, "image/jpeg")}
    resp = client.post(f"/api/liff/patient-forms/{access_token}/photos", files=files, headers=liff_headers)
    assert resp.status_code == 400
    assert "上限" in resp.json()["detail"]
    
    # 6. Patient submits the form
    submit_data = {
        "values": {"f1": "Back pain", "f2": 8},
        "photo_ids": photo_ids
    }
    resp = client.post(f"/api/liff/patient-forms/{access_token}/submit", json=submit_data, headers=liff_headers)
    assert resp.status_code == 200
    medical_record_id = resp.json()["medical_record_id"]
    
    # 7. Admin views the submitted form (medical record)
    resp = client.get(f"/api/clinic/medical-records/{medical_record_id}", headers=admin_headers)
    assert resp.status_code == 200
    record = resp.json()
    assert record["values"]["f1"] == "Back pain"
    assert record["source_type"] == "patient"
    assert len(record["photos"]) == 2
    
    # 8. Patient updates the form
    update_data = {
        "values": {"f1": "Back pain improved", "f2": 4},
        "photo_ids": photo_ids
    }
    # Need to pass version
    resp = client.put(f"/api/liff/patient-forms/{access_token}?version=1", json=update_data, headers=liff_headers)
    assert resp.status_code == 200
    
    # Verify update
    resp = client.get(f"/api/clinic/medical-records/{medical_record_id}", headers=admin_headers)
    assert resp.json()["values"]["f1"] == "Back pain improved"
    assert resp.json()["version"] == 2

@patch('services.line_service.LINEService')
def test_patient_form_scheduling(mock_line_service, client, test_setup, db_session):
    """
    Verifies that patient forms are scheduled when an appointment is confirmed.
    """
    setup = test_setup
    clinic = setup["clinic"]
    patient = setup["patient"]
    admin_headers = setup["admin_headers"]
    
    # 1. Create Patient Form Template
    template_data = {"name": "Pre-visit", "template_type": "patient_form", "fields": []}
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=admin_headers)
    template_id = resp.json()["id"]
    
    # 2. Create Appointment Type with Patient Form Setting
    # We'll use the bundle API
    bundle_data = {
        "item": {
            "name": "Initial Consultation",
            "duration_minutes": 60,
            "allow_patient_booking": True
        },
        "associations": {
            "patient_form_settings": [
                {
                    "template_id": template_id,
                    "timing_mode": "immediate",
                    "message_template": "Please fill: {表單連結}",
                    "is_enabled": True
                }
            ]
        }
    }
    resp = client.post("/api/clinic/service-items/bundle", json=bundle_data, headers=admin_headers)
    assert resp.status_code == 200
    appointment_type_id = resp.json()["item"]["id"]
    
    # 3. Create Appointment (Confirmed)
    # We need a calendar event first
    from datetime import time
    event = CalendarEvent(
        clinic_id=clinic.id,
        user_id=setup["practitioner"].id,
        date=datetime.now(timezone.utc).date() + timedelta(days=1),
        start_time=time(14, 0),
        end_time=time(15, 0),
        event_type="appointment"
    )
    db_session.add(event)
    db_session.flush()
    
    appointment = Appointment(
        calendar_event_id=event.id,
        patient_id=patient.id,
        appointment_type_id=appointment_type_id,
        status="confirmed"
    )
    db_session.add(appointment)
    db_session.commit()
    
    # 4. Trigger scheduling (usually happens in AppointmentService, but we'll call it directly or check if triggered)
    from services.patient_form_scheduling_service import PatientFormSchedulingService
    PatientFormSchedulingService.schedule_patient_forms(db_session, appointment)
    
    # 5. Verify ScheduledLineMessage exists
    from models.scheduled_line_message import ScheduledLineMessage
    scheduled = db_session.query(ScheduledLineMessage).filter_by(
        clinic_id=clinic.id,
        message_type="patient_form"
    ).first()
    assert scheduled is not None
    assert scheduled.message_context["template_id"] == template_id
    assert "{表單連結}" in scheduled.message_template

@patch('services.line_service.LINEService')
def test_manual_request_validation(mock_line_service, client, test_setup, db_session):
    """
    Verifies validation in manual form request creation.
    """
    setup = test_setup
    clinic = setup["clinic"]
    patient = setup["patient"]
    admin_headers = setup["admin_headers"]
    
    # Create another patient in same clinic
    other_patient = Patient(clinic_id=clinic.id, full_name="Other")
    db_session.add(other_patient)
    db_session.flush()
    
    # Create appointment type
    at = AppointmentType(clinic_id=clinic.id, name="Test Type", duration_minutes=30)
    db_session.add(at)
    db_session.flush()
    
    # Create appointment for other patient
    from datetime import time
    event = CalendarEvent(
        clinic_id=clinic.id, 
        user_id=setup["practitioner"].id, 
        date=datetime.now(timezone.utc).date(), 
        start_time=time(10, 0), 
        end_time=time(11, 0), 
        event_type="appointment"
    )
    db_session.add(event)
    db_session.flush()
    other_appt = Appointment(calendar_event_id=event.id, patient_id=other_patient.id, appointment_type_id=at.id, status="confirmed")
    db_session.add(other_appt)
    db_session.commit()
    
    # Create template
    template_data = {"name": "Test", "template_type": "patient_form", "fields": []}
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=admin_headers)
    template_id = resp.json()["id"]
    
    # Try to create request for patient 1 with appointment of patient 2
    request_data = {
        "template_id": template_id,
        "appointment_id": other_appt.calendar_event_id,
        "message_template": "Test {表單連結}"
    }
    resp = client.post(f"/api/clinic/{patient.id}/patient-form-requests", json=request_data, headers=admin_headers)
    assert resp.status_code == 400
    assert "不屬於此病患" in resp.json()["detail"]
