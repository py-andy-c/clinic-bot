"""
Integration tests for availability notification feature.

Tests the complete flow including:
- API endpoints (create, list, delete)
- Authorization and clinic isolation
- Validation and error handling
"""

import pytest
from datetime import date, datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import (
    Clinic, LineUser, AvailabilityNotification, AppointmentType, User,
    UserClinicAssociation
)
from tests.conftest import create_user_with_clinic_association
from core.config import JWT_SECRET_KEY
from core.database import get_db
import jwt


@pytest.fixture
def client(db_session: Session):
    """Create test client with database override."""
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.pop(get_db, None)


def create_line_user_jwt(line_user_id: str, clinic_id: int) -> str:
    """Create a JWT token for LINE user authentication."""
    payload = {
        "line_user_id": line_user_id,
        "clinic_id": clinic_id,
        "exp": datetime.utcnow() + timedelta(hours=1),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")


@pytest.fixture
def test_clinic(db_session: Session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        subscription_status="trial"
    )
    # Set liff_id if the attribute exists (may not be in all Clinic models)
    if hasattr(clinic, 'liff_id'):
        setattr(clinic, 'liff_id', "1234567890")
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


@pytest.fixture
def test_line_user(db_session: Session, test_clinic: Clinic):
    """Create a test LINE user."""
    # Check if LineUser already exists
    existing = db_session.query(LineUser).filter(
        LineUser.line_user_id == "test_line_user_123"
    ).first()
    if existing:
        return existing
    
    # LineUser now requires clinic_id for per-clinic isolation
    line_user = LineUser(
        line_user_id="test_line_user_123",
        clinic_id=test_clinic.id
    )
    db_session.add(line_user)
    db_session.commit()
    db_session.refresh(line_user)
    return line_user


@pytest.fixture
def test_appointment_type(db_session: Session, test_clinic: Clinic):
    """Create a test appointment type."""
    appointment_type = AppointmentType(
        clinic_id=test_clinic.id,
        name="物理治療",
        duration_minutes=60
    )
    db_session.add(appointment_type)
    db_session.commit()
    db_session.refresh(appointment_type)
    return appointment_type


@pytest.fixture
def test_practitioner(db_session: Session, test_clinic: Clinic):
    """Create a test practitioner."""
    user, _ = create_user_with_clinic_association(
        db_session, test_clinic,
        full_name="王醫師",
        email="practitioner@test.com",
        google_subject_id="practitioner_subject_123",
        roles=["practitioner"],
        is_active=True
    )
    return user


class TestCreateNotification:
    """Test creating availability notifications."""
    
    def test_create_notification_success(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType
    ):
        """Test successful notification creation."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        today = date.today()
        tomorrow = today + timedelta(days=1)
        
        response = client.post(
            "/api/liff/availability-notifications",
            json={
                "appointment_type_id": test_appointment_type.id,
                "practitioner_id": None,
                "time_windows": [
                    {"date": tomorrow.strftime("%Y-%m-%d"), "time_window": "morning"},
                    {"date": tomorrow.strftime("%Y-%m-%d"), "time_window": "afternoon"},
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["appointment_type_id"] == test_appointment_type.id
        assert data["practitioner_id"] is None
        assert data["practitioner_name"] is None
        assert len(data["time_windows"]) == 2
        
        # Verify in database
        notification = db_session.query(AvailabilityNotification).filter(
            AvailabilityNotification.id == data["id"]
        ).first()
        assert notification is not None
        assert notification.line_user_id == test_line_user.id
        assert notification.clinic_id == test_clinic.id
    
    def test_create_notification_with_practitioner(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType,
        test_practitioner: User
    ):
        """Test creating notification with specific practitioner."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        response = client.post(
            "/api/liff/availability-notifications",
            json={
                "appointment_type_id": test_appointment_type.id,
                "practitioner_id": test_practitioner.id,
                "time_windows": [
                    {"date": tomorrow, "time_window": "morning"},
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["practitioner_id"] == test_practitioner.id
    
    def test_create_notification_validation_errors(
        self, client: TestClient, db_session: Session, test_clinic: Clinic, test_line_user: LineUser
    ):
        """Test validation errors."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        # Too many time windows
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        response = client.post(
            "/api/liff/availability-notifications",
            json={
                "appointment_type_id": 1,
                "time_windows": [
                    {"date": tomorrow, "time_window": "morning"}
                ] * 11  # Exceeds limit of 10
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 422
        
        # Past date
        yesterday = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
        response = client.post(
            "/api/liff/availability-notifications",
            json={
                "appointment_type_id": 1,
                "time_windows": [
                    {"date": yesterday, "time_window": "morning"}
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 422
        
        # Duplicate time windows
        response = client.post(
            "/api/liff/availability-notifications",
            json={
                "appointment_type_id": 1,
                "time_windows": [
                    {"date": tomorrow, "time_window": "morning"},
                    {"date": tomorrow, "time_window": "morning"},  # Duplicate
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 422
        error_detail = response.json()["detail"]
        # Check if error message contains duplicate validation
        assert any("重複的時段設定" in str(err.get("msg", "")) for err in error_detail)
    
    def test_create_notification_user_limit(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType
    ):
        """Test user notification limit."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Create max notifications
        from core.constants import MAX_NOTIFICATIONS_PER_USER
        for i in range(MAX_NOTIFICATIONS_PER_USER):
            notification = AvailabilityNotification(
                line_user_id=test_line_user.id,
                clinic_id=test_clinic.id,
                appointment_type_id=test_appointment_type.id,
                practitioner_id=None,
                time_windows=[{"date": tomorrow, "time_window": "morning"}],
                is_active=True
            )
            db_session.add(notification)
        db_session.commit()
        
        # Try to create one more
        response = client.post(
            "/api/liff/availability-notifications",
            json={
                "appointment_type_id": test_appointment_type.id,
                "time_windows": [
                    {"date": tomorrow, "time_window": "morning"}
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 403
        assert "提醒上限" in response.json()["detail"]


class TestListNotifications:
    """Test listing availability notifications."""
    
    def test_list_notifications_success(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType
    ):
        """Test successful notification listing."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Create notifications
        for i in range(3):
            notification = AvailabilityNotification(
                line_user_id=test_line_user.id,
                clinic_id=test_clinic.id,
                appointment_type_id=test_appointment_type.id,
                practitioner_id=None,
                time_windows=[{"date": tomorrow, "time_window": "morning"}],
                is_active=True
            )
            db_session.add(notification)
        db_session.commit()
        
        response = client.get(
            "/api/liff/availability-notifications",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        assert len(data["notifications"]) == 3
        assert data["page"] == 1
        assert data["page_size"] == 20
    
    def test_list_notifications_pagination(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType
    ):
        """Test pagination."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Create 5 notifications
        for i in range(5):
            notification = AvailabilityNotification(
                line_user_id=test_line_user.id,
                clinic_id=test_clinic.id,
                appointment_type_id=test_appointment_type.id,
                practitioner_id=None,
                time_windows=[{"date": tomorrow, "time_window": "morning"}],
                is_active=True
            )
            db_session.add(notification)
        db_session.commit()
        
        # Page 1
        response = client.get(
            "/api/liff/availability-notifications?page=1&page_size=2",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        assert len(data["notifications"]) == 2
        
        # Page 2
        response = client.get(
            "/api/liff/availability-notifications?page=2&page_size=2",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["notifications"]) == 2
    
    def test_list_notifications_clinic_isolation(
        self, client: TestClient, db_session: Session, test_clinic: Clinic, test_line_user: LineUser,
        test_appointment_type: AppointmentType
    ):
        """Test that users only see notifications from their clinic."""
        # Create another clinic
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="test_channel_2",
            line_channel_secret="test_secret_2",
            line_channel_access_token="test_token_2",
            subscription_status="trial"
        )
        db_session.add(clinic2)
        db_session.commit()
        db_session.refresh(clinic2)
        
        # Create notification in clinic2
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        notification2 = AvailabilityNotification(
            line_user_id=test_line_user.id,
            clinic_id=clinic2.id,
            appointment_type_id=test_appointment_type.id,
            practitioner_id=None,
            time_windows=[{"date": tomorrow, "time_window": "morning"}],
            is_active=True
        )
        db_session.add(notification2)
        db_session.commit()
        
        # List notifications for test_clinic (should not see clinic2's notification)
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        response = client.get(
            "/api/liff/availability-notifications",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0  # Should not see clinic2's notification


class TestDeleteNotification:
    """Test deleting availability notifications."""
    
    def test_delete_notification_success(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType
    ):
        """Test successful notification deletion."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Create notification
        notification = AvailabilityNotification(
            line_user_id=test_line_user.id,
            clinic_id=test_clinic.id,
            appointment_type_id=test_appointment_type.id,
            practitioner_id=None,
            time_windows=[{"date": tomorrow, "time_window": "morning"}],
            is_active=True
        )
        db_session.add(notification)
        db_session.commit()
        notification_id = notification.id
        
        # Delete notification
        response = client.delete(
            f"/api/liff/availability-notifications/{notification_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        
        # Verify soft deleted
        notification = db_session.query(AvailabilityNotification).filter(
            AvailabilityNotification.id == notification_id
        ).first()
        assert notification.is_active is False
    
    def test_delete_notification_not_found(
        self, client: TestClient, db_session: Session, test_clinic: Clinic, test_line_user: LineUser
    ):
        """Test deleting non-existent notification."""
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        
        response = client.delete(
            "/api/liff/availability-notifications/99999",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 404
    
    def test_delete_notification_unauthorized(
        self, client: TestClient, db_session: Session, test_clinic: Clinic,
        test_line_user: LineUser, test_appointment_type: AppointmentType
    ):
        """Test deleting notification owned by another user."""
        # Create another LINE user
        existing2 = db_session.query(LineUser).filter(
            LineUser.line_user_id == "test_line_user_456"
        ).first()
        if existing2:
            line_user2 = existing2
        else:
            line_user2 = LineUser(
                line_user_id="test_line_user_456",
                clinic_id=test_clinic.id
            )
            db_session.add(line_user2)
            db_session.flush()
        
        tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Create notification owned by line_user2
        notification = AvailabilityNotification(
            line_user_id=line_user2.id,
            clinic_id=test_clinic.id,
            appointment_type_id=test_appointment_type.id,
            practitioner_id=None,
            time_windows=[{"date": tomorrow, "time_window": "morning"}],
            is_active=True
        )
        db_session.add(notification)
        db_session.commit()
        
        # Try to delete with test_line_user's token
        token = create_line_user_jwt(test_line_user.line_user_id, test_clinic.id)
        response = client.delete(
            f"/api/liff/availability-notifications/{notification.id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 403

