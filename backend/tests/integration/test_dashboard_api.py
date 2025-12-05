"""
Integration tests for dashboard API endpoint.

Tests the GET /clinic/dashboard/metrics endpoint.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models.clinic import Clinic
from models.user import User
from tests.conftest import create_user_with_clinic_association
from services.jwt_service import jwt_service, TokenPayload


@pytest.fixture
def client(db_session):
    """Create test client with database session override."""
    from core.database import get_db
    
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    
    yield TestClient(app)
    
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def clinic_with_user(db_session):
    """Create a clinic and user for testing."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.commit()
    
    user, association = create_user_with_clinic_association(
        db_session, clinic,
        full_name="Test User",
        email="test@example.com",
        google_subject_id="test_sub",
        roles=["admin"]
    )
    
    return clinic, user


def create_jwt_token(user: User, clinic_id: int) -> str:
    """Create a JWT token for the user."""
    payload = TokenPayload(
        user_id=user.id,
        email=user.email,
        active_clinic_id=clinic_id,  # Use active_clinic_id instead of clinic_id
        roles=["admin"],
        is_system_admin=False,
        sub=user.google_subject_id,
        user_type="clinic_user",
        name="Test User"
    )
    return jwt_service.create_access_token(payload)


class TestDashboardAPI:
    """Test dashboard API endpoint."""
    
    def test_get_dashboard_metrics_success(self, client: TestClient, clinic_with_user):
        """Test successful retrieval of dashboard metrics."""
        clinic, user = clinic_with_user
        
        token = create_jwt_token(user, clinic.id)
        headers = {"Authorization": f"Bearer {token}"}
        
        response = client.get("/api/clinic/dashboard/metrics", headers=headers)
        
        if response.status_code != 200:
            print(f"Response status: {response.status_code}")
            print(f"Response text: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}. Response: {response.text}"
        data = response.json()
        
        # Check response structure
        assert "months" in data
        assert "active_patients_by_month" in data
        assert "new_patients_by_month" in data
        assert "appointments_by_month" in data
        assert "cancellation_rate_by_month" in data
        assert "appointment_type_stats_by_month" in data
        assert "practitioner_stats_by_month" in data
        assert "paid_messages_by_month" in data
        assert "ai_reply_messages_by_month" in data
        
        # Check months structure
        assert len(data["months"]) == 4  # Past 3 months + current month
        for month in data["months"]:
            assert "year" in month
            assert "month" in month
            assert "display_name" in month
            assert "is_current" in month
            assert isinstance(month["year"], int)
            assert isinstance(month["month"], int)
            assert isinstance(month["display_name"], str)
            assert isinstance(month["is_current"], bool)
        
        # Check that current month is marked
        current_months = [m for m in data["months"] if m["is_current"]]
        assert len(current_months) == 1
        
        # Check that all metric lists are present (may be empty)
        assert isinstance(data["active_patients_by_month"], list)
        assert isinstance(data["new_patients_by_month"], list)
        assert isinstance(data["appointments_by_month"], list)
        assert isinstance(data["cancellation_rate_by_month"], list)
        assert isinstance(data["appointment_type_stats_by_month"], list)
        assert isinstance(data["practitioner_stats_by_month"], list)
        assert isinstance(data["paid_messages_by_month"], list)
        assert isinstance(data["ai_reply_messages_by_month"], list)
    
    def test_get_dashboard_metrics_requires_authentication(self, client: TestClient):
        """Test that dashboard metrics endpoint requires authentication."""
        response = client.get("/api/clinic/dashboard/metrics")
        
        assert response.status_code == 401  # Unauthorized
    
    def test_get_dashboard_metrics_requires_clinic_access(self, client: TestClient, db_session: Session):
        """Test that dashboard metrics endpoint requires clinic access."""
        # Create a user without clinic association
        user = User(
            email="no_clinic@example.com",
            google_subject_id="no_clinic_sub"
        )
        db_session.add(user)
        db_session.commit()
        
        # Create token without clinic_id
        from services.jwt_service import TokenPayload
        payload = TokenPayload(
            user_id=user.id,
            email=user.email,
            clinic_id=None,
            roles=[],
            is_system_admin=False,
            sub=user.google_subject_id,
            user_type="clinic_user",
            name="No Clinic User"
        )
        token = jwt_service.create_access_token(payload)
        headers = {"Authorization": f"Bearer {token}"}
        
        response = client.get("/api/clinic/dashboard/metrics", headers=headers)
        
        # Should fail because user doesn't have clinic access
        assert response.status_code in [403, 400]  # Forbidden or Bad Request
    
    def test_get_dashboard_metrics_empty_data(self, client: TestClient, clinic_with_user):
        """Test dashboard metrics with empty data (new clinic)."""
        clinic, user = clinic_with_user
        
        token = create_jwt_token(user, clinic.id)
        headers = {"Authorization": f"Bearer {token}"}
        
        response = client.get("/api/clinic/dashboard/metrics", headers=headers)
        
        if response.status_code != 200:
            print(f"Response status: {response.status_code}")
            print(f"Response text: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}. Response: {response.text}"
        data = response.json()
        
        # All metric lists should be empty or have zero counts
        assert len(data["active_patients_by_month"]) == 0 or all(
            stat["count"] == 0 for stat in data["active_patients_by_month"]
        )
        assert len(data["new_patients_by_month"]) == 0 or all(
            stat["count"] == 0 for stat in data["new_patients_by_month"]
        )
        assert len(data["appointments_by_month"]) == 0 or all(
            stat["count"] == 0 for stat in data["appointments_by_month"]
        )
        
        # AI reply messages should have entries for each month (even if count is 0)
        assert len(data["ai_reply_messages_by_month"]) == 4  # One per month
        for ai_stat in data["ai_reply_messages_by_month"]:
            assert ai_stat["count"] == 0
            assert ai_stat["event_display_name"] == "AI 回覆訊息"
            assert ai_stat["recipient_type"] is None
            assert ai_stat["event_type"] is None
            assert ai_stat["trigger_source"] is None

