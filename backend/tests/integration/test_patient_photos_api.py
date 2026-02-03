"""
Integration tests for patient photos API endpoints.
"""
import pytest
from typing import Optional
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.patient_photo import PatientPhoto
from models.medical_record_template import MedicalRecordTemplate
from models.medical_record import MedicalRecord
from tests.conftest import create_user_with_clinic_association


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def override_get_db(db_session):
    """Override the get_db dependency to use the test session."""
    app.dependency_overrides[get_db] = lambda: db_session
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def clinic_with_user(db_session: Session):
    """Create clinic and user, properly committed."""
    # Create clinic
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)

    # Create user with clinic association
    user, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="Test User",
        email="test@example.com",
        google_subject_id="test_google_id",
        roles=["admin"]
    )
    db_session.commit()
    db_session.refresh(user)

    return clinic, user, assoc


@pytest.fixture
def auth_headers(clinic_with_user, db_session: Session):
    """Generate auth headers using the committed user."""
    clinic, user, assoc = clinic_with_user
    
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=user.google_subject_id or f"test_sub_{user.id}",
        user_id=user.id,
        email=user.email,
        user_type="clinic_user",
        roles=assoc.roles,
        name=assoc.full_name,
        active_clinic_id=assoc.clinic_id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def setup_data(clinic_with_user, db_session: Session):
    """Setup test data using the committed clinic and user."""
    clinic, user, assoc = clinic_with_user

    # Create patient
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="0912345678"
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)

    # Create template
    template = MedicalRecordTemplate(
        clinic_id=clinic.id,
        name="Test Template",
        fields=[],
        version=1
    )
    db_session.add(template)
    db_session.commit()
    db_session.refresh(template)

    # Create medical record
    record = MedicalRecord(
        clinic_id=clinic.id,
        patient_id=patient.id,
        template_id=template.id,
        template_name=template.name,
        template_snapshot={"name": template.name, "fields": []},
        values={},
        version=1
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    return {
        "clinic": clinic,
        "user": user,
        "patient": patient,
        "template": template,
        "record": record
    }


def create_photo(
    db_session: Session,
    clinic: Clinic,
    patient: Patient,
    medical_record_id: Optional[int] = None,
    is_pending: bool = False
) -> PatientPhoto:
    """Helper to create a photo."""
    photo = PatientPhoto(
        clinic_id=clinic.id,
        patient_id=patient.id,
        medical_record_id=medical_record_id,
        filename="test.jpg",
        storage_key=f"test/{clinic.id}/test.jpg",
        thumbnail_key=f"test/{clinic.id}/thumbnails/test.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
        is_pending=is_pending
    )
    db_session.add(photo)
    db_session.commit()
    db_session.refresh(photo)
    return photo


class TestListPhotosAPI:
    """Test GET /clinic/patient-photos endpoint."""

    def test_returns_paginated_response(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify API returns paginated response structure."""
        clinic = setup_data["clinic"]
        patient = setup_data["patient"]

        # Create 5 photos
        for _ in range(5):
            create_photo(db_session, clinic, patient)

        response = client.get(
            "/api/clinic/patient-photos",
            params={"patient_id": patient.id},
            headers=auth_headers
        )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()

        # Verify response structure
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["total"], int)
        assert len(data["items"]) == 5
        assert data["total"] == 5

    def test_pagination_with_skip_and_limit(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify skip and limit parameters work."""
        clinic = setup_data["clinic"]
        patient = setup_data["patient"]

        # Create 10 photos
        for _ in range(10):
            create_photo(db_session, clinic, patient)

        # Get first page
        response1 = client.get(
            "/api/clinic/patient-photos",
            params={"patient_id": patient.id, "skip": 0, "limit": 5},
            headers=auth_headers
        )
        assert response1.status_code == 200
        data1 = response1.json()
        assert len(data1["items"]) == 5
        assert data1["total"] == 10

        # Get second page
        response2 = client.get(
            "/api/clinic/patient-photos",
            params={"patient_id": patient.id, "skip": 5, "limit": 5},
            headers=auth_headers
        )
        assert response2.status_code == 200
        data2 = response2.json()
        assert len(data2["items"]) == 5
        assert data2["total"] == 10

        # Verify no overlap
        ids1 = {item["id"] for item in data1["items"]}
        ids2 = {item["id"] for item in data2["items"]}
        assert len(ids1 & ids2) == 0

    def test_filters_by_medical_record_id(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify medical_record_id filter works."""
        clinic = setup_data["clinic"]
        patient = setup_data["patient"]
        record = setup_data["record"]

        # Create photos for record
        photo1 = create_photo(db_session, clinic, patient, medical_record_id=record.id)
        photo2 = create_photo(db_session, clinic, patient, medical_record_id=record.id)

        # Create unlinked photo
        create_photo(db_session, clinic, patient)

        response = client.get(
            "/api/clinic/patient-photos",
            params={"patient_id": patient.id, "medical_record_id": record.id},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        ids = {item["id"] for item in data["items"]}
        assert photo1.id in ids
        assert photo2.id in ids

    def test_stable_ordering(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify photos are ordered by created_at DESC, id DESC."""
        clinic = setup_data["clinic"]
        patient = setup_data["patient"]

        # Create photos (will have sequential IDs)
        photo1 = create_photo(db_session, clinic, patient)
        photo2 = create_photo(db_session, clinic, patient)
        photo3 = create_photo(db_session, clinic, patient)

        response = client.get(
            "/api/clinic/patient-photos",
            params={"patient_id": patient.id},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        
        # Should be ordered newest first (highest ID first)
        assert data["items"][0]["id"] == photo3.id
        assert data["items"][1]["id"] == photo2.id
        assert data["items"][2]["id"] == photo1.id


class TestCountRecordPhotosAPI:
    """Test GET /clinic/patient-photos/count endpoint."""

    def test_returns_count_for_record(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify count endpoint returns correct count."""
        clinic = setup_data["clinic"]
        patient = setup_data["patient"]
        record = setup_data["record"]

        # Create 3 photos for record
        for _ in range(3):
            create_photo(db_session, clinic, patient, medical_record_id=record.id)

        response = client.get(
            "/api/clinic/patient-photos/count",
            params={"medical_record_id": record.id},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert "count" in data
        assert data["count"] == 3

    def test_excludes_deleted_photos(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify count excludes deleted photos."""
        clinic = setup_data["clinic"]
        patient = setup_data["patient"]
        record = setup_data["record"]

        # Create 5 photos, delete 2
        photos = [
            create_photo(db_session, clinic, patient, medical_record_id=record.id)
            for _ in range(5)
        ]
        photos[0].is_deleted = True
        photos[1].is_deleted = True
        db_session.commit()

        response = client.get(
            "/api/clinic/patient-photos/count",
            params={"medical_record_id": record.id},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 3

    def test_returns_zero_for_record_with_no_photos(
        self,
        client: TestClient,
        db_session: Session,
        setup_data: dict,
        auth_headers: dict
    ):
        """Verify count returns 0 for record with no photos."""
        response = client.get(
            "/api/clinic/patient-photos/count",
            params={"medical_record_id": 999},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
