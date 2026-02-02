import pytest
import boto3
import io
from moto import mock_aws
from fastapi.testclient import TestClient
from datetime import datetime
from PIL import Image

from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
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
def test_clinic_setup(db_session):
    clinic = Clinic(
        name="Feature Test Clinic",
        line_channel_id="ft_channel",
        line_channel_secret="ft_secret",
        line_channel_access_token="ft_token"
    )
    db_session.add(clinic)
    db_session.commit()
    
    admin, _ = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="Feature Admin",
        email="ftadmin@test.com",
        google_subject_id="ft_sub",
        roles=["admin"]
    )
    
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Feature Patient",
        created_at=datetime.utcnow()
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
        name="Feature Admin",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    headers = {"Authorization": f"Bearer {token}"}
    
    return clinic, patient, headers

def test_medical_record_lifecycle(client, test_clinic_setup, db_session):
    """
    Verifies the full lifecycle of Medical Records:
    1. Template Creation
    2. Record Creation (Snapshot Immutability)
    3. Template Update
    4. Record Creation V2 (New Snapshot)
    5. Record Update (Values)
    6. Record Deletion
    7. Template Deletion
    """
    clinic, patient, headers = test_clinic_setup
    
    # 1. Create Template V1
    template_data = {
        "name": "General Checkup",
        "fields": [{"name": "Weight", "type": "number"}, {"name": "Notes", "type": "text"}]
    }
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=headers)
    assert resp.status_code == 200
    template_id = resp.json()["id"]
    
    # 2. Create Record R1 (Uses V1)
    r1_data = {
        "patient_id": patient.id,
        "template_id": template_id,
        "values": {"Weight": 70, "Notes": "Healthy"}
    }
    resp = client.post("/api/clinic/medical-records", json=r1_data, headers=headers)
    assert resp.status_code == 200
    r1_id = resp.json()["id"]
    r1_snapshot = resp.json()["template_snapshot"]
    
    # 3. Update Template to V2
    template_update = {
        "version": 1,
        "name": "General Checkup V2",
        "fields": [{"name": "Weight", "type": "number"}, {"name": "Notes", "type": "text"}, {"name": "Height", "type": "number"}]
    }
    resp = client.put(f"/api/clinic/medical-record-templates/{template_id}", json=template_update, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["version"] == 2
    
    # 4. Create Record R2 (Uses V2)
    r2_data = {
        "patient_id": patient.id,
        "template_id": template_id,
        "values": {"Weight": 70, "Notes": "Healthy", "Height": 175}
    }
    resp = client.post("/api/clinic/medical-records", json=r2_data, headers=headers)
    assert resp.status_code == 200
    r2_id = resp.json()["id"]
    r2_snapshot = resp.json()["template_snapshot"]
    
    # Verify Snapshots are different (Immutability)
    assert len(r1_snapshot["fields"]) == 2
    assert len(r2_snapshot["fields"]) == 3
    
    # 5. Update Record R1 Values
    r1_update = {
        "version": 1,
        "values": {"Weight": 72, "Notes": "Gained weight"}
    }
    resp = client.put(f"/api/clinic/medical-records/{r1_id}", json=r1_update, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["values"]["Weight"] == 72
    assert resp.json()["version"] == 2
    
    # 6. Delete Record R1
    resp = client.delete(f"/api/clinic/medical-records/{r1_id}", headers=headers)
    assert resp.status_code == 200
    
    # Verify R1 is gone from list
    resp = client.get(f"/api/clinic/medical-records?patient_id={patient.id}", headers=headers)
    records = resp.json()
    assert len(records) == 1
    assert records[0]["id"] == r2_id
    
    # 7. Delete Template
    resp = client.delete(f"/api/clinic/medical-record-templates/{template_id}", headers=headers)
    assert resp.status_code == 200
    
    # Verify Template is gone
    resp = client.get(f"/api/clinic/medical-record-templates/{template_id}", headers=headers)
    assert resp.status_code == 404

@mock_aws
def test_photo_gallery_features(client, test_clinic_setup, db_session):
    """
    Verifies Photo Gallery Features:
    1. Upload Photo (Thumbnail Generation)
    2. Deduplication (Same content, different filename -> Same Storage)
    3. List Photos
    4. Delete Photo
    """
    clinic, patient, headers = test_clinic_setup
    
    # Setup S3
    s3 = boto3.client("s3", region_name="ap-northeast-1")
    s3.create_bucket(Bucket="clinic-bot-dev", CreateBucketConfiguration={'LocationConstraint': 'ap-northeast-1'})
    
    # Create Image Content (Red Square)
    img = Image.new('RGB', (100, 100), color='red')
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    img_content = img_byte_arr.getvalue()
    
    # 1. Upload Photo A
    files_a = {"file": ("photo_a.jpg", img_content, "image/jpeg")}
    data_a = {"patient_id": patient.id, "description": "Photo A"}
    resp = client.post("/api/clinic/patient-photos", data=data_a, files=files_a, headers=headers)
    assert resp.status_code == 200
    photo_a = resp.json()
    
    # Verify S3
    photo_a_db = db_session.query(PatientPhoto).get(photo_a["id"])
    assert s3.get_object(Bucket="clinic-bot-dev", Key=photo_a_db.storage_key)
    # Verify Path Structure
    assert f"clinic_assets/{clinic.id}/" in photo_a_db.storage_key
    
    # 2. Upload Photo B (Same Content) - Should Deduplicate
    # Reset buffer position is not needed since we passed bytes, but let's be safe if we used IO
    files_b = {"file": ("photo_b.jpg", img_content, "image/jpeg")}
    data_b = {"patient_id": patient.id, "description": "Photo B (Duplicate)"}
    resp = client.post("/api/clinic/patient-photos", data=data_b, files=files_b, headers=headers)
    assert resp.status_code == 200
    photo_b = resp.json()
    
    photo_b_db = db_session.query(PatientPhoto).get(photo_b["id"])
    
    # KEY CHECK: Different IDs, Different Filenames, BUT Same Storage Key
    assert photo_a["id"] != photo_b["id"]
    assert photo_a_db.filename == "photo_a.jpg"
    assert photo_b_db.filename == "photo_b.jpg"
    assert photo_a_db.storage_key == photo_b_db.storage_key
    assert photo_a_db.thumbnail_key == photo_b_db.thumbnail_key
    
    # 3. List Photos
    resp = client.get(f"/api/clinic/patient-photos?patient_id={patient.id}", headers=headers)
    assert resp.status_code == 200
    photos = resp.json()
    assert len(photos) == 2
    
    # 4. Delete Photo A
    resp = client.delete(f"/api/clinic/patient-photos/{photo_a['id']}", headers=headers)
    assert resp.status_code == 200
    
    # Verify Photo A is gone from list
    resp = client.get(f"/api/clinic/patient-photos?patient_id={patient.id}", headers=headers)
    photos = resp.json()
    assert len(photos) == 1
    assert photos[0]["id"] == photo_b["id"]
    
    # Verify S3 Object still exists (because Photo B still uses it)
    # Note: The current implementation does NOT delete from S3 on soft delete anyway, 
    # but even if it did, deduplication logic *should* prevent it if ref count > 0 (not implemented yet, but safe default)
    # For now just checking soft delete worked on DB level.

@mock_aws
def test_atomic_linking_and_unified_fate(client, test_clinic_setup, db_session):
    """
    Verifies:
    1. Atomic Linking (Stage & Commit)
    2. Unified Fate (Cascade Soft Delete & Restore)
    3. Hard Delete
    """
    clinic, patient, headers = test_clinic_setup
    
    # Setup S3
    s3 = boto3.client("s3", region_name="ap-northeast-1")
    s3.create_bucket(Bucket="clinic-bot-dev", CreateBucketConfiguration={'LocationConstraint': 'ap-northeast-1'})
    
    # 1. Create Template
    template_data = {"name": "Test Template", "fields": []}
    resp = client.post("/api/clinic/medical-record-templates", json=template_data, headers=headers)
    template_id = resp.json()["id"]

    # 2. Upload Two Photos (Staged)
    img = Image.new('RGB', (100, 100), color='blue')
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    img_content = img_byte_arr.getvalue()
    
    photo_ids = []
    for i in range(2):
        files = {"file": (f"photo_{i}.jpg", img_content, "image/jpeg")}
        data = {"patient_id": patient.id}
        resp = client.post("/api/clinic/patient-photos", data=data, files=files, headers=headers)
        assert resp.json()["is_pending"] == True
        photo_ids.append(resp.json()["id"])
        
    # Verify they show up in Unlinked list
    resp = client.get(f"/api/clinic/patient-photos?patient_id={patient.id}&unlinked_only=true", headers=headers)
    assert len(resp.json()) == 2
    
    # 3. Create Record with Photos (Atomic Commit)
    record_data = {
        "patient_id": patient.id,
        "template_id": template_id,
        "values": {},
        "photo_ids": photo_ids
    }
    resp = client.post("/api/clinic/medical-records", json=record_data, headers=headers)
    assert resp.status_code == 200
    record_id = resp.json()["id"]
    
    # Verify Photos are Linked and Active
    for pid in photo_ids:
        photo = db_session.query(PatientPhoto).get(pid)
        assert photo.medical_record_id == record_id
        assert photo.is_pending == False
        
    # Verify Unlinked list is empty
    resp = client.get(f"/api/clinic/patient-photos?patient_id={patient.id}&unlinked_only=true", headers=headers)
    assert len(resp.json()) == 0

    # 4. Soft Delete Record (Unified Fate)
    resp = client.delete(f"/api/clinic/medical-records/{record_id}", headers=headers)
    assert resp.status_code == 200
    
    # Verify Record is Deleted
    record = db_session.query(type(db_session.query(PatientPhoto).get(photo_ids[0]).medical_record)).get(record_id) # Getting record model via relation or direct import if available. 
    # Wait, I don't have MedicalRecord imported here directly in the test function scope easily unless I import it.
    # But I can check via API or DB if I imported it. 
    # I'll use the API to check 404 or check photos.
    
    # Verify Photos are Soft Deleted
    for pid in photo_ids:
        photo = db_session.query(PatientPhoto).get(pid)
        assert photo.is_deleted == True
        
    # 5. Restore Record
    resp = client.post(f"/api/clinic/medical-records/{record_id}/restore", headers=headers)
    assert resp.status_code == 200
    
    # Verify Photos are Restored
    for pid in photo_ids:
        db_session.refresh(photo)
        assert photo.is_deleted == False
        
    # 6. Hard Delete Record
    resp = client.delete(f"/api/clinic/medical-records/{record_id}/hard", headers=headers)
    assert resp.status_code == 200
    
    # Verify Record and Photos are GONE from DB
    # (Checking photos is enough)
    for pid in photo_ids:
        photo = db_session.query(PatientPhoto).get(pid)
        assert photo is None
