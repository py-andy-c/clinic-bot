"""
Integration tests for LIFF token functionality.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models.clinic import Clinic
from models.line_user import LineUser
from utils.liff_token import generate_liff_access_token
from core.database import get_db


class TestLiffLoginWithToken:
    """Tests for LIFF login with clinic_token."""
    
    def test_liff_login_with_clinic_token(self, db_session: Session):
        """Test LIFF login using clinic_token."""
        # Create clinic with token
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            is_active=True
        )
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        # Generate token after clinic is committed (needs clinic.id)
        clinic.liff_access_token = generate_liff_access_token(db_session, clinic.id)
        db_session.commit()
        
        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()
        
        # Login with token
        # Override database dependency to use test session
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        
        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user",
                    "display_name": "Test User",
                    "liff_access_token": "line_access_token",
                    "clinic_token": clinic.liff_access_token
                }
            )
            
            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert data["clinic_id"] == clinic.id
            assert data["is_first_time"] is True
        finally:
            client.app.dependency_overrides.pop(get_db, None)
    
    def test_liff_login_with_deprecated_clinic_id(self, db_session: Session):
        """Test LIFF login using deprecated clinic_id (backward compatibility)."""
        # Create clinic without token initially
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            is_active=True
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()
        
        # Login with clinic_id (should auto-generate token)
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        
        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user",
                    "display_name": "Test User",
                    "liff_access_token": "line_access_token",
                    "clinic_id": clinic.id
                }
            )
            
            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert data["clinic_id"] == clinic.id
            
            # Verify token was auto-generated
            db_session.refresh(clinic)
            assert clinic.liff_access_token is not None
        finally:
            client.app.dependency_overrides.pop(get_db, None)
    
    def test_liff_login_invalid_token_format(self, db_session: Session):
        """Test LIFF login rejects invalid token format."""
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        
        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user",
                    "display_name": "Test User",
                    "liff_access_token": "line_access_token",
                    "clinic_token": "invalid!token@format"
                }
            )
            
            assert response.status_code == 400
        finally:
            client.app.dependency_overrides.pop(get_db, None)
    
    def test_liff_login_missing_clinic_identifier(self, db_session: Session):
        """Test LIFF login requires either clinic_token or clinic_id."""
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        
        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user",
                    "display_name": "Test User",
                    "liff_access_token": "line_access_token"
                }
            )
            
            assert response.status_code == 422  # Validation error
        finally:
            client.app.dependency_overrides.pop(get_db, None)
    
    def test_liff_login_both_token_and_id_provided(self, db_session: Session):
        """Test LIFF login rejects when both clinic_token and clinic_id are provided."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel2",
            line_channel_secret="test_secret2",
            line_channel_access_token="test_token2",
            is_active=True
        )
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        clinic.liff_access_token = generate_liff_access_token(db_session, clinic.id)
        db_session.commit()
        
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        
        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user2",
                    "display_name": "Test User",
                    "liff_access_token": "line_access_token",
                    "clinic_token": clinic.liff_access_token,
                    "clinic_id": clinic.id
                }
            )
            
            assert response.status_code == 422  # Validation error
        finally:
            client.app.dependency_overrides.pop(get_db, None)


class TestTokenRegeneration:
    """Tests for token regeneration endpoint."""
    
    def test_regenerate_liff_token(self, db_session: Session):
        """Test regenerating LIFF token as clinic admin."""
        from tests.conftest import create_user_with_clinic_association
        from auth.dependencies import require_admin_role, UserContext
        import jwt
        from datetime import datetime, timedelta
        from core.config import JWT_SECRET_KEY
        
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel3",
            line_channel_secret="test_secret3",
            line_channel_access_token="test_token3",
            is_active=True
        )
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        clinic.liff_access_token = generate_liff_access_token(db_session, clinic.id)
        old_token = clinic.liff_access_token
        db_session.commit()
        
        # Create admin user
        admin, admin_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="admin@test.com",
            google_subject_id="admin_google_123",
            full_name="Admin User",
            roles=["admin"]
        )
        
        # Create JWT token for admin
        payload = {
            "sub": str(admin.google_subject_id),
            "user_id": admin.id,
            "email": admin.email,
            "user_type": "clinic_user",
            "roles": ["admin"],
            "active_clinic_id": clinic.id,
            "name": admin_assoc.full_name,
            "exp": datetime.utcnow() + timedelta(hours=1),
            "iat": datetime.utcnow()
        }
        admin_token = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")
        
        # Mock authentication - need to override require_admin_role
        from auth.dependencies import require_admin_role, UserContext
        
        def require_admin_role_override():
            return UserContext(
                user_type="clinic_user",
                user_id=admin.id,
                email=admin.email,
                google_subject_id=admin.google_subject_id,
                roles=["admin"],
                active_clinic_id=clinic.id,
                name=admin_assoc.full_name
            )
        
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        client.app.dependency_overrides[require_admin_role] = require_admin_role_override
        
        try:
            # Regenerate token
            response = client.post(
                "/api/clinic/regenerate-liff-token",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["message"] == "Token regenerated successfully"
            # Security: Token should NOT be in response to prevent exposure
            assert "new_token" not in data
            
            # Verify token was updated in database (but not exposed in API response)
            db_session.refresh(clinic)
            assert clinic.liff_access_token is not None
            assert clinic.liff_access_token != old_token
            # Verify new token is different format (should be URL-safe base64)
            assert len(clinic.liff_access_token) >= 32
        finally:
            client.app.dependency_overrides.clear()

