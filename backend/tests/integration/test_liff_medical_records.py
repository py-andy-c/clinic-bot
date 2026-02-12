import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.medical_record import MedicalRecord
from models.medical_record_template import MedicalRecordTemplate
from models.line_user import LineUser
from models.patient_photo import PatientPhoto
from api.liff import get_current_line_user_with_clinic

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def override_dependencies(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_line_user_with_clinic, None)

@pytest.fixture
def liff_test_setup(db_session):
    # Create Clinic
    clinic = Clinic(
        name="LIFF Test Clinic",
        liff_id="liff-123",
        line_channel_id="test_channel_id",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(clinic)
    db_session.commit()
    
    # Create Line User 1 (Owner)
    line_user1 = LineUser(
        line_user_id="U111",
        display_name="User 1",
        clinic_id=clinic.id
    )
    db_session.add(line_user1)
    
    # Create Line User 2 (Attacker)
    line_user2 = LineUser(
        line_user_id="U222",
        display_name="User 2",
        clinic_id=clinic.id
    )
    db_session.add(line_user2)
    db_session.commit()
    
    # Create Patient for User 1
    patient1 = Patient(
        clinic_id=clinic.id,
        full_name="Patient 1",
        line_user_id=line_user1.id,
        created_at=datetime.now(timezone.utc)
    )
    db_session.add(patient1)
    db_session.commit()
    
    # Create Patient for User 2
    patient2 = Patient(
        clinic_id=clinic.id,
        full_name="Patient 2",
        line_user_id=line_user2.id,
        created_at=datetime.now(timezone.utc)
    )
    db_session.add(patient2)
    db_session.commit()
    
    # Create Template
    template = MedicalRecordTemplate(
        clinic_id=clinic.id,
        name="LIFF Form",
        fields=[{"id": "q1", "label": "How are you?", "type": "text"}],
        is_patient_form=True
    )
    db_session.add(template)
    db_session.commit()
    
    # Create Medical Record for Patient 1
    record = MedicalRecord(
        clinic_id=clinic.id,
        patient_id=patient1.id,
        template_id=template.id,
        template_name=template.name,
        template_snapshot={"fields": template.fields},
        values={},
        version=1,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(record)
    db_session.commit()
    
    return clinic, line_user1, line_user2, patient1, patient2, record

def test_get_medical_record_success(client, liff_test_setup, db_session):
    clinic, line_user1, _, _, _, record = liff_test_setup
    
    # Auth as User 1
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    resp = client.get(f"/api/liff/medical-records/{record.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == record.id
    assert data["patient_id"] == record.patient_id
    assert data["template_name"] == "LIFF Form"

def test_get_medical_record_forbidden(client, liff_test_setup, db_session):
    clinic, _, line_user2, _, _, record = liff_test_setup
    
    # Auth as User 2 (who doesn't own record for Patient 1)
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user2, clinic)
    
    resp = client.get(f"/api/liff/medical-records/{record.id}")
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "ACCESS_DENIED"
    assert "沒有權限" in resp.json()["detail"]["message"]

def test_update_medical_record_success(client, liff_test_setup, db_session):
    clinic, line_user1, _, _, _, record = liff_test_setup
    
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    payload = {
        "values": {"q1": "I am feeling great"},
        "is_submitted": True,
        "version": record.version,
        "photo_ids": []
    }
    
    resp = client.put(f"/api/liff/medical-records/{record.id}", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["values"]["q1"] == "I am feeling great"
    assert data["is_submitted"] is True
    assert data["patient_last_edited_at"] is not None
    assert data["version"] == 2  # 1 -> 2

def test_update_medical_record_conflict(client, liff_test_setup, db_session):
    clinic, line_user1, _, _, _, record = liff_test_setup
    
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    payload = {
        "values": {"q1": "Conflict!"},
        "is_submitted": False,
        "version": 99,  # Wrong version
        "photo_ids": []
    }
    
    resp = client.put(f"/api/liff/medical-records/{record.id}", json=payload)
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "RECORD_MODIFIED"

@patch("services.patient_photo_service.PatientPhotoService.upload_photo")
def test_upload_patient_photo_success(mock_upload, client, liff_test_setup, db_session):
    clinic, line_user1, _, patient1, _, record = liff_test_setup
    
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    expected_photo = PatientPhoto(
        id=101,
        clinic_id=clinic.id,
        patient_id=patient1.id,
        medical_record_id=record.id,
        filename="test.jpg",
        storage_key="photos/test.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
        description="Test description",
        created_at=datetime.now(timezone.utc)
    )
    mock_upload.return_value = expected_photo
    
    resp = client.post(
        "/api/liff/patient-photos",
        data={
            "patient_id": patient1.id,
            "medical_record_id": record.id,
            "description": "Test description"
        },
        files={"file": ("test.jpg", b"fake-content", "image/jpeg")}
    )
    
    assert resp.status_code == 200
    assert resp.json()["id"] == 101
    assert resp.json()["description"] == "Test description"

def test_delete_patient_photo_success(client, liff_test_setup, db_session):
    clinic, line_user1, _, patient1, _, record = liff_test_setup
    
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    # Create a photo
    photo = PatientPhoto(
        clinic_id=clinic.id,
        patient_id=patient1.id,
        medical_record_id=record.id,
        filename="to_delete.jpg",
        storage_key="photos/to_delete.jpg",
        content_type="image/jpeg",
        size_bytes=500,
        is_pending=True
    )
    db_session.add(photo)
    db_session.commit()
    
    with patch("services.patient_photo_service.PatientPhotoService.delete_photo") as mock_delete:
        resp = client.delete(f"/api/liff/patient-photos/{photo.id}")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_delete.assert_called_once()

def test_delete_patient_photo_forbidden(client, liff_test_setup, db_session):
    clinic, _, line_user2, patient1, _, record = liff_test_setup
    
    # Auth as User 2
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user2, clinic)
    
    # Create a photo belonging to Patient 1 (User 1)
    photo = PatientPhoto(
        clinic_id=clinic.id,
        patient_id=patient1.id,
        medical_record_id=record.id,
        filename="protected.jpg",
        storage_key="photos/protected.jpg",
        content_type="image/jpeg",
        size_bytes=500
    )
    db_session.add(photo)
    db_session.commit()
    
    resp = client.delete(f"/api/liff/patient-photos/{photo.id}")
    assert resp.status_code == 403
    assert "沒有權限" in resp.json()["detail"]["message"]

def test_upload_photo_staging_lifecycle(client, liff_test_setup, db_session):
    clinic, line_user1, _, patient1, _, record = liff_test_setup
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    # 1. Upload a photo for a record
    photo_id = 999
    with patch("services.patient_photo_service.PatientPhotoService.upload_photo") as mock_upload:
        mock_upload.return_value = PatientPhoto(
            id=photo_id, clinic_id=clinic.id, patient_id=patient1.id, 
            medical_record_id=record.id, filename="pending.jpg", storage_key="k", 
            content_type="image/jpeg", size_bytes=100,
            is_pending=True, 
            description="Pending photo",
            created_at=datetime.now(timezone.utc)
        )
        resp = client.post(
            "/api/liff/patient-photos",
            data={"patient_id": patient1.id, "medical_record_id": record.id, "description": "Pending photo"},
            files={"file": ("pending.jpg", b"...", "image/jpeg")}
        )
        if resp.status_code != 200:
            print(resp.json())
        assert resp.status_code == 200
        assert resp.json()["description"] == "Pending photo"
        
    # Check it's pending in DB (simulate DB commit by service)
    photo = PatientPhoto(
        id=photo_id, clinic_id=clinic.id, patient_id=patient1.id,
        medical_record_id=record.id, filename="pending.jpg", storage_key="k",
        content_type="image/jpeg", size_bytes=10, is_pending=True
    )
    db_session.add(photo)
    db_session.commit()
    
    # 2. Update the medical record including this photo
    payload = {
        "values": {"q1": "updated"},
        "version": record.version,
        "photo_ids": [photo_id],
        "is_submitted": True
    }
    resp = client.put(f"/api/liff/medical-records/{record.id}", json=payload)
    assert resp.status_code == 200
    
    # 3. Verify photo is no longer pending
    db_session.refresh(photo)
    assert photo.is_pending is False
    
    # 4. Verify patient_last_edited_at is set
    db_session.refresh(record)
    assert record.patient_last_edited_at is not None

def test_photo_unlinking_behavior(client, liff_test_setup, db_session):
    clinic, line_user1, _, patient1, _, record = liff_test_setup
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic)
    
    # Create active photo linked to record
    photo = PatientPhoto(
        clinic_id=clinic.id, 
        patient_id=patient1.id, 
        medical_record_id=record.id,
        filename="linked.jpg", 
        storage_key="k2", 
        content_type="image/jpeg",
        size_bytes=100,
        is_pending=False
    )
    db_session.add(photo)
    db_session.commit()
    
    # Update record with empty photo_ids
    payload = {
        "values": record.values,
        "version": record.version,
        "photo_ids": [],
        "is_submitted": False
    }
    resp = client.put(f"/api/liff/medical-records/{record.id}", json=payload)
    if resp.status_code != 200:
        print(resp.json())
    assert resp.status_code == 200
    
    # Verify photo is unlinked but still exists (is_pending becomes False just in case, though it was already)
    db_session.refresh(photo)
    assert photo.medical_record_id is None
    assert photo.is_pending is False

def test_upload_photo_to_unowned_record_security(client, liff_test_setup, db_session):
    clinic, _, line_user2, patient1, patient2, record = liff_test_setup
    
    # Auth as User 2 (who owns Patient 2)
    app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user2, clinic)
    
    # Attempt to upload to User 1's record using User 2's patient_id
    # The record query (record.id == record.id, record.patient_id == patient_id) will fail
    resp = client.post(
        "/api/liff/patient-photos",
        data={
            "patient_id": patient2.id,
            "medical_record_id": record.id # Belongs to patient 1
        },
        files={"file": ("attack.jpg", b"...", "image/jpeg")}
    )
    
    # Should fail as record is not found for this patient
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "RECORD_NOT_FOUND"
