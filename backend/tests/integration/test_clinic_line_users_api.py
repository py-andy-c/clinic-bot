"""
Integration tests for clinic LINE users API endpoints.

Tests the API endpoints for managing LINE users and their AI disable status,
including authorization, input validation, and edge cases.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from core.database import get_db
from models import Clinic, User, UserClinicAssociation, LineUser, Patient
from services.line_user_ai_disabled_service import disable_ai_for_line_user
from services.jwt_service import jwt_service, TokenPayload


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def test_clinic(db_session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        settings={}
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


@pytest.fixture
def admin_user(db_session, test_clinic):
    """Create an admin user for the test clinic."""
    from tests.conftest import create_user_with_clinic_association
    user, _ = create_user_with_clinic_association(
        db_session,
        test_clinic,
        full_name="Admin User",
        email="admin@test.com",
        google_subject_id="admin_sub_123",
        roles=["admin"],
        is_active=True
    )
    return user


@pytest.fixture
def practitioner_user(db_session, test_clinic):
    """Create a practitioner user (non-admin) for the test clinic."""
    from tests.conftest import create_user_with_clinic_association
    user, _ = create_user_with_clinic_association(
        db_session,
        test_clinic,
        full_name="Practitioner User",
        email="practitioner@test.com",
        google_subject_id="practitioner_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    return user


@pytest.fixture
def line_user_with_patient(db_session, test_clinic):
    """Create a LINE user with a patient."""
    line_user = LineUser(
        line_user_id="U_test_user_123",
        clinic_id=test_clinic.id,
        display_name="Test LINE User"
    )
    db_session.add(line_user)
    db_session.flush()
    
    patient = Patient(
        clinic_id=test_clinic.id,
        full_name="Test Patient",
        phone_number="0912345678",
        line_user_id=line_user.id,
        is_deleted=False
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(line_user)
    return line_user


def get_auth_headers(user: User, clinic_id: int):
    """Get authorization headers for a user."""
    # Get roles and name from association
    roles = []
    name = "Test User"
    if user.clinic_associations:
        assoc = user.clinic_associations[0]
        roles = assoc.roles
        name = assoc.full_name or "Test User"
    
    payload = TokenPayload(
        sub=user.google_subject_id or f"test_sub_{user.id}",
        user_id=user.id,
        email=user.email,
        user_type="clinic_user",
        roles=roles,
        active_clinic_id=clinic_id,
        name=name
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


class TestGetLineUsers:
    """Test GET /clinic/line-users endpoint."""
    
    def test_get_line_users_allows_practitioners(self, client, test_clinic, practitioner_user, line_user_with_patient):
        """Test that practitioners can access the endpoint."""
        headers = get_auth_headers(practitioner_user, test_clinic.id)
        
        response = client.get("/api/clinic/line-users", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "line_users" in data
        assert len(data["line_users"]) == 1
    
    def test_get_line_users_returns_line_users(self, client, test_clinic, admin_user, line_user_with_patient):
        """Test that endpoint returns LINE users with AI status."""
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.get("/api/clinic/line-users", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "line_users" in data
        assert len(data["line_users"]) == 1
        assert data["line_users"][0]["line_user_id"] == "U_test_user_123"
        assert data["line_users"][0]["display_name"] == "Test LINE User"
        assert data["line_users"][0]["patient_count"] == 1
        assert data["line_users"][0]["ai_disabled"] is False
    
    def test_get_line_users_includes_users_with_only_soft_deleted_patients(self, client, db_session, test_clinic, admin_user):
        """Test that endpoint includes LINE users even if they only have soft-deleted patients.
        
        Since LineUsers are only created when users interact with the clinic, we should
        include all LineUsers regardless of patient status. This allows admins to manage
        AI settings for all users who have interacted with the clinic.
        """
        # Create LINE user with only soft-deleted patient
        line_user = LineUser(
            line_user_id="U_deleted_patient_user",
            clinic_id=test_clinic.id,
            display_name="Deleted Patient User"
        )
        db_session.add(line_user)
        db_session.flush()
        
        patient = Patient(
            clinic_id=test_clinic.id,
            full_name="Deleted Patient",
            phone_number="0912345678",
            line_user_id=line_user.id,
            is_deleted=True
        )
        db_session.add(patient)
        db_session.commit()
        
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.get("/api/clinic/line-users", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["line_users"]) == 1
        assert data["line_users"][0]["line_user_id"] == "U_deleted_patient_user"
        assert data["line_users"][0]["patient_count"] == 0  # No active patients
        assert data["line_users"][0]["patient_names"] == []  # No active patient names
    
    def test_get_line_users_pagination(self, client, db_session, test_clinic, admin_user):
        """Test that endpoint supports pagination."""
        # Create multiple LINE users
        for i in range(5):
            line_user = LineUser(
                line_user_id=f"U_user_{i}",
                clinic_id=test_clinic.id,
                display_name=f"User {i}"
            )
            db_session.add(line_user)
            db_session.flush()
            
            patient = Patient(
                clinic_id=test_clinic.id,
                full_name=f"Patient {i}",
                phone_number=f"091234567{i}",
                line_user_id=line_user.id,
                is_deleted=False
            )
            db_session.add(patient)
        
        db_session.commit()
        
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        # Get first 2
        response = client.get("/api/clinic/line-users?offset=0&limit=2", headers=headers)
        assert response.status_code == 200
        assert len(response.json()["line_users"]) == 2
        
        # Get next 2
        response = client.get("/api/clinic/line-users?offset=2&limit=2", headers=headers)
        assert response.status_code == 200
        assert len(response.json()["line_users"]) == 2


class TestDisableAiForLineUser:
    """Test POST /clinic/line-users/{line_user_id}/disable-ai endpoint."""
    
    def test_disable_ai_allows_practitioners(self, client, db_session, test_clinic, practitioner_user, line_user_with_patient):
        """Test that practitioners can disable AI."""
        headers = get_auth_headers(practitioner_user, test_clinic.id)
        
        response = client.post(
            f"/api/clinic/line-users/{line_user_with_patient.line_user_id}/disable-ai",
            headers=headers,
            json={"reason": "Test reason"}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify record was created (check LineUser.ai_disabled)
        db_session.refresh(line_user_with_patient)
        assert line_user_with_patient.ai_disabled is True
        assert line_user_with_patient.ai_disabled_by_user_id == practitioner_user.id
    
    def test_disable_ai_creates_record(self, client, db_session, test_clinic, admin_user, line_user_with_patient):
        """Test that disabling AI creates a disable record."""
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.post(
            f"/api/clinic/line-users/{line_user_with_patient.line_user_id}/disable-ai",
            headers=headers,
            json={"reason": "Test reason"}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify record was created (check LineUser.ai_disabled)
        db_session.refresh(line_user_with_patient)
        assert line_user_with_patient.ai_disabled is True
        assert line_user_with_patient.ai_disabled_reason == "Test reason"
        assert line_user_with_patient.ai_disabled_by_user_id == admin_user.id
    
    def test_disable_ai_returns_404_for_nonexistent_user(self, client, test_clinic, admin_user):
        """Test that disabling AI for non-existent user returns 404."""
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.post(
            "/api/clinic/line-users/U_nonexistent_user/disable-ai",
            headers=headers
        )
        
        assert response.status_code == 404
    
    def test_disable_ai_validates_line_user_id_format(self, client, test_clinic, admin_user):
        """Test that endpoint validates line_user_id format."""
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.post(
            "/api/clinic/line-users/  /disable-ai",
            headers=headers
        )
        
        assert response.status_code == 400


class TestEnableAiForLineUser:
    """Test POST /clinic/line-users/{line_user_id}/enable-ai endpoint."""
    
    def test_enable_ai_allows_practitioners(self, client, db_session, test_clinic, practitioner_user, line_user_with_patient):
        """Test that practitioners can enable AI."""
        # Disable first
        disable_ai_for_line_user(db_session, line_user_with_patient.line_user_id, test_clinic.id)
        
        headers = get_auth_headers(practitioner_user, test_clinic.id)
        
        response = client.post(
            f"/api/clinic/line-users/{line_user_with_patient.line_user_id}/enable-ai",
            headers=headers
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify record was removed
        # Verify AI is not disabled (check LineUser.ai_disabled)
        db_session.refresh(line_user_with_patient)
        assert line_user_with_patient.ai_disabled is False
    
    def test_enable_ai_removes_record(self, client, db_session, test_clinic, admin_user, line_user_with_patient):
        """Test that enabling AI removes the disable record."""
        # Disable first
        disable_ai_for_line_user(db_session, line_user_with_patient.line_user_id, test_clinic.id)
        
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.post(
            f"/api/clinic/line-users/{line_user_with_patient.line_user_id}/enable-ai",
            headers=headers
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify record was removed
        # Verify AI is not disabled (check LineUser.ai_disabled)
        db_session.refresh(line_user_with_patient)
        assert line_user_with_patient.ai_disabled is False
    
    def test_enable_ai_returns_404_for_nonexistent_user(self, client, test_clinic, admin_user):
        """Test that enabling AI for non-existent user returns 404."""
        headers = get_auth_headers(admin_user, test_clinic.id)
        
        response = client.post(
            "/api/clinic/line-users/U_nonexistent_user/enable-ai",
            headers=headers
        )
        
        assert response.status_code == 404

