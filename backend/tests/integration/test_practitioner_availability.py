"""
Integration tests for practitioner availability management.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import time

from models.user import User
from models.clinic import Clinic
from models.practitioner_availability import PractitionerAvailability
from main import app


@pytest.fixture
def client(db_session):
    """Create test client with database dependency override."""
    from core.database import get_db
    
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def test_clinic(db_session: Session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()
    return clinic


@pytest.fixture
def test_admin(db_session: Session, test_clinic):
    """Create a test admin user."""
    admin = User(
        clinic_id=test_clinic.id,
        full_name="Test Admin",
        email="admin@testclinic.com",
        google_subject_id="admin_sub_123",
        roles=["admin"],
        is_active=True
    )
    db_session.add(admin)
    db_session.commit()
    return admin


@pytest.fixture
def test_practitioner(db_session: Session, test_clinic):
    """Create a test practitioner."""
    practitioner = User(
        clinic_id=test_clinic.id,
        full_name="Test Practitioner",
        email="practitioner@testclinic.com",
        google_subject_id="practitioner_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    db_session.add(practitioner)
    db_session.commit()
    return practitioner


@pytest.fixture
def test_practitioner2(db_session: Session, test_clinic):
    """Create a second test practitioner."""
    practitioner = User(
        clinic_id=test_clinic.id,
        full_name="Test Practitioner 2",
        email="practitioner2@testclinic.com",
        google_subject_id="practitioner2_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    db_session.add(practitioner)
    db_session.commit()
    return practitioner


class TestPractitionerAvailability:
    """Test practitioner availability management endpoints."""

    def test_get_practitioner_availability_as_practitioner(self, client: TestClient, db_session: Session, test_clinic, test_practitioner):
        """Test that a practitioner can view their own availability."""
        # Create some availability data
        availability = PractitionerAvailability(
            user_id=test_practitioner.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True
        )
        db_session.add(availability)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test getting availability
        response = client.get(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        availability = data["availability"]
        assert len(availability) == 1
        assert availability[0]["day_of_week"] == 1
        assert availability[0]["start_time"] == "09:00"
        assert availability[0]["end_time"] == "17:00"
        assert availability[0]["is_available"] is True

    def test_get_practitioner_availability_as_admin(self, client: TestClient, db_session: Session, test_clinic, test_admin, test_practitioner):
        """Test that an admin can view practitioner availability."""
        # Create some availability data
        availability = PractitionerAvailability(
            user_id=test_practitioner.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True
        )
        db_session.add(availability)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_admin.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test getting availability
        response = client.get(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        availability = data["availability"]
        assert len(availability) == 1
        assert availability[0]["day_of_week"] == 1

    def test_practitioner_cannot_view_other_practitioner_availability(self, client: TestClient, db_session: Session, test_clinic, test_practitioner, test_practitioner2):
        """Test that a practitioner cannot view another practitioner's availability."""
        # Create availability for practitioner2
        availability = PractitionerAvailability(
            user_id=test_practitioner2.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True
        )
        db_session.add(availability)
        db_session.commit()

        # Use dev login endpoint to get authentication as practitioner1
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test getting availability for practitioner2 (should fail)
        response = client.get(
            f"/api/clinic/practitioners/{test_practitioner2.id}/availability",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 403

    def test_create_practitioner_availability_as_practitioner(self, client: TestClient, db_session: Session, test_clinic, test_practitioner):
        """Test that a practitioner can create their own availability."""
        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test creating availability
        availability_data = {
            "day_of_week": 1,  # Tuesday
            "start_time": "09:00:00",
            "end_time": "17:00:00",
            "is_available": True
        }
        response = client.post(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            json=availability_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 201
        data = response.json()
        assert data["day_of_week"] == 1
        assert data["start_time"] == "09:00"
        assert data["end_time"] == "17:00"
        assert data["is_available"] is True

    def test_create_practitioner_availability_as_admin(self, client: TestClient, db_session: Session, test_clinic, test_admin, test_practitioner):
        """Test that an admin can create availability for a practitioner."""
        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_admin.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test creating availability
        availability_data = {
            "day_of_week": 1,  # Tuesday
            "start_time": "09:00:00",
            "end_time": "17:00:00",
            "is_available": True
        }
        response = client.post(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            json=availability_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 201
        data = response.json()
        assert data["day_of_week"] == 1

    def test_practitioner_cannot_create_availability_for_other(self, client: TestClient, db_session: Session, test_clinic, test_practitioner, test_practitioner2):
        """Test that a practitioner cannot create availability for another practitioner."""
        # Use dev login endpoint to get authentication as practitioner1
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test creating availability for practitioner2 (should fail)
        availability_data = {
            "day_of_week": 1,  # Tuesday
            "start_time": "09:00:00",
            "end_time": "17:00:00",
            "is_available": True
        }
        response = client.post(
            f"/api/clinic/practitioners/{test_practitioner2.id}/availability",
            json=availability_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 403

    def test_create_duplicate_availability_fails(self, client: TestClient, db_session: Session, test_clinic, test_practitioner):
        """Test that creating duplicate availability for the same day fails."""
        # Create initial availability
        availability = PractitionerAvailability(
            user_id=test_practitioner.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True
        )
        db_session.add(availability)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Try to create duplicate availability
        availability_data = {
            "day_of_week": 1,  # Tuesday (same day)
            "start_time": "10:00:00",
            "end_time": "18:00:00",
            "is_available": True
        }
        response = client.post(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            json=availability_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 400

    def test_create_availability_invalid_time_range(self, client: TestClient, db_session: Session, test_clinic, test_practitioner):
        """Test that creating availability with invalid time range fails."""
        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Try to create availability with end time before start time
        availability_data = {
            "day_of_week": 1,  # Tuesday
            "start_time": "17:00:00",
            "end_time": "09:00:00",  # Invalid: end before start
            "is_available": True
        }
        response = client.post(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            json=availability_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 400

    def test_update_practitioner_availability(self, client: TestClient, db_session: Session, test_clinic, test_practitioner):
        """Test updating practitioner availability."""
        # Create initial availability
        availability = PractitionerAvailability(
            user_id=test_practitioner.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True
        )
        db_session.add(availability)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Update availability
        update_data = {
            "day_of_week": 1,  # Tuesday
            "start_time": "10:00:00",
            "end_time": "18:00:00",
            "is_available": False
        }
        response = client.put(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability/{availability.id}",
            json=update_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        if response.status_code != 200:
            print(f"Response status: {response.status_code}")
            print(f"Response body: {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data["start_time"] == "10:00"
        assert data["end_time"] == "18:00"
        assert data["is_available"] is False

    def test_delete_practitioner_availability(self, client: TestClient, db_session: Session, test_clinic, test_practitioner):
        """Test deleting practitioner availability."""
        # Create availability
        availability = PractitionerAvailability(
            user_id=test_practitioner.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True
        )
        db_session.add(availability)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Delete availability
        response = client.delete(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability/{availability.id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 204

        # Verify it's deleted
        response = client.get(
            f"/api/clinic/practitioners/{test_practitioner.id}/availability",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["availability"]) == 0

    def test_get_calendar_embed_info(self, client: TestClient, db_session: Session, test_clinic, test_admin, test_practitioner):
        """Test getting calendar embed information."""
        # Set up practitioner with Google Calendar credentials
        test_practitioner.gcal_credentials = '{"access_token": "test_token", "user_email": "practitioner@testclinic.com"}'
        test_practitioner.gcal_sync_enabled = True
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={test_admin.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        # Test getting calendar embed info
        response = client.get(
            "/api/clinic/calendar/embed",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"Calendar embed response: {data}")  # Debug output
        assert "embed_url" in data
        assert "practitioners" in data
        assert len(data["practitioners"]) == 1
        assert data["practitioners"][0]["name"] == "Test Practitioner"
