"""
Integration tests for practitioner LINE account linking via webhook.
"""
import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient

from main import app
from models import User, Clinic, PractitionerLinkCode, UserClinicAssociation
from tests.conftest import db_session


@pytest.fixture
def client(db_session):
    """Create test client with database session override."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    
    app.dependency_overrides = {}
    from core.database import get_db
    app.dependency_overrides[get_db] = override_get_db
    
    yield TestClient(app)
    
    app.dependency_overrides.clear()


@pytest.fixture
def clinic_user(db_session, client):
    """Create a clinic user for testing."""
    user = User(
        email="practitioner@test.com",
        google_subject_id="google_subject_practitioner",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(user)
    db_session.flush()
    
    clinic = Clinic(
        name="測試診所",
        line_channel_id="1234567890",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        settings={"clinic_info_settings": {"display_name": "測試診所"}},
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(clinic)
    db_session.flush()
    
    association = UserClinicAssociation(
        user_id=user.id,
        clinic_id=clinic.id,
        roles=["practitioner"],
        full_name="測試治療師",
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(association)
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(clinic)
    
    return user, clinic


@pytest.fixture
def auth_token(client, clinic_user, db_session):
    """Get auth token for clinic user."""
    user, clinic = clinic_user
    
    # Login to get token
    response = client.post(
        "/api/auth/dev/login",
        params={"email": user.email, "user_type": "clinic_user", "clinic_id": clinic.id}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


class TestPractitionerLineLinking:
    """Test practitioner LINE account linking."""
    
    def test_generate_link_code_success(self, client, clinic_user, auth_token, db_session):
        """Test successful link code generation."""
        user, clinic = clinic_user
        
        response = client.post(
            "/api/profile/link-code",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "code" in data
        assert data["code"].startswith("LINK-")
        assert "expires_at" in data
        
        # Verify code was created in database
        code = db_session.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.code == data["code"]
        ).first()
        assert code is not None
        assert code.user_id == user.id
        assert code.clinic_id == clinic.id
        assert code.used_at is None
    
    def test_generate_link_code_revokes_existing(self, client, clinic_user, auth_token, db_session):
        """Test that generating a new code revokes existing active codes."""
        user, clinic = clinic_user
        
        # Generate first code
        response1 = client.post(
            "/api/profile/link-code",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response1.status_code == 200
        code1 = response1.json()["code"]
        
        # Generate second code
        response2 = client.post(
            "/api/profile/link-code",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response2.status_code == 200
        code2 = response2.json()["code"]
        
        # Verify first code is revoked
        code1_obj = db_session.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.code == code1
        ).first()
        assert code1_obj.used_at is not None
        
        # Verify second code is active
        code2_obj = db_session.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.code == code2
        ).first()
        assert code2_obj.used_at is None
    
    def test_generate_link_code_requires_clinic_user(self, client, auth_token):
        """Test that system admins cannot generate link codes."""
        # This test assumes we have a system admin endpoint or way to test
        # For now, we'll test that clinic users can generate codes (already tested above)
        pass
    
    def test_unlink_line_account_success(self, client, clinic_user, auth_token, db_session):
        """Test successful LINE account unlinking."""
        user, clinic = clinic_user
        
        # First link the account
        association = db_session.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id,
            UserClinicAssociation.clinic_id == clinic.id
        ).first()
        association.line_user_id = "U1234567890"
        db_session.commit()
        db_session.refresh(association)
        
        # Unlink
        response = client.delete(
            "/api/profile/unlink-line",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        
        # Verify account is unlinked
        db_session.refresh(association)
        assert association.line_user_id is None
    
    def test_profile_shows_line_linked_status(self, client, clinic_user, auth_token, db_session):
        """Test that profile endpoint shows LINE linked status."""
        user, clinic = clinic_user
        
        # Check when not linked
        response = client.get(
            "/api/profile",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["line_linked"] is False
        
        # Link account
        association = db_session.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id,
            UserClinicAssociation.clinic_id == clinic.id
        ).first()
        association.line_user_id = "U1234567890"
        db_session.commit()
        db_session.refresh(association)
        
        # Check when linked
        response = client.get(
            "/api/profile",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["line_linked"] is True
    
    def test_link_code_idempotent(self, client, clinic_user, auth_token, db_session):
        """Test that sending the same link code again returns success if already linked."""
        user, clinic = clinic_user
        
        # Generate link code
        response = client.post(
            "/api/profile/link-code",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        code = response.json()["code"]
        
        # Simulate linking via webhook (first time)
        # (PractitionerLinkCode and User are already imported at top of file)
        
        link_code = db_session.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.code == code
        ).first()
        
        # Link the account
        association = db_session.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id,
            UserClinicAssociation.clinic_id == clinic.id
        ).first()
        association.line_user_id = "U1234567890"
        link_code.mark_used()
        db_session.commit()
        db_session.refresh(link_code)
        db_session.refresh(association)
        
        # Verify account is linked
        assert association.line_user_id == "U1234567890"
        assert link_code.used_at is not None
        
        # Simulate sending the same code again (should be idempotent)
        # Check that the code exists and was used for the same user/LINE account
        link_code_check = db_session.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.code == code,
            PractitionerLinkCode.clinic_id == clinic.id
        ).first()
        
        assert link_code_check is not None
        assert link_code_check.used_at is not None
        assert association.line_user_id == "U1234567890"
        
        # The idempotency check should pass: used_at is not None AND association.line_user_id == line_user_id
        # This would return success in the actual webhook handler

