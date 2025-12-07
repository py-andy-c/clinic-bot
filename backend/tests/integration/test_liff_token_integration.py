"""
Integration tests for LIFF token functionality.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models.clinic import Clinic
from models.line_user import LineUser
from models.user import User
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
            clinic_id=clinic.id,
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

    def test_liff_login_rejects_clinic_id(self, db_session: Session):
        """Test LIFF login rejects clinic_id (no longer supported)."""
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

        clinic.liff_access_token = generate_liff_access_token(db_session, clinic.id)
        db_session.commit()

        # Login with clinic_id should be rejected
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

            # Should reject clinic_id (validation error)
            assert response.status_code == 422
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
        """Test LIFF login requires either liff_id or clinic_token."""
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

    def test_liff_login_with_liff_id(self, db_session: Session):
        """Test LIFF login using liff_id (clinic-specific LIFF app)."""
        # Create clinic with liff_id
        clinic = Clinic(
            name="Test Clinic LIFF",
            line_channel_id="test_channel_liff",
            line_channel_secret="test_secret_liff",
            line_channel_access_token="test_token_liff",
            is_active=True,
            liff_id="1234567890-abcdefgh"
        )
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user_liff",
            clinic_id=clinic.id,
            display_name="Test User LIFF"
        )
        db_session.add(line_user)
        db_session.commit()

        # Login with liff_id
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user_liff",
                    "display_name": "Test User LIFF",
                    "liff_access_token": "line_access_token",
                    "liff_id": clinic.liff_id
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert data["clinic_id"] == clinic.id
            assert data["is_first_time"] is True

            # Verify JWT contains liff_id
            import jwt
            from core.config import JWT_SECRET_KEY
            token = data["access_token"]
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            assert "liff_id" in payload
            assert payload["liff_id"] == clinic.liff_id
            assert "clinic_token" not in payload or payload["clinic_token"] is None
        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_liff_login_invalid_liff_id_format(self, db_session: Session):
        """Test LIFF login rejects invalid liff_id format."""
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user",
                    "display_name": "Test User",
                    "liff_access_token": "line_access_token",
                    "liff_id": "invalid-format!"
                }
            )

            assert response.status_code == 422  # Validation error
        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_liff_login_prefers_liff_id_over_clinic_token(self, db_session: Session):
        """Test that liff_id takes priority over clinic_token when both are provided."""
        # Create clinic with both liff_id and clinic_token
        clinic = Clinic(
            name="Test Clinic Both",
            line_channel_id="test_channel_both",
            line_channel_secret="test_secret_both",
            line_channel_access_token="test_token_both",
            is_active=True,
            liff_id="1234567890-xyzabc"
        )
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        clinic.liff_access_token = generate_liff_access_token(db_session, clinic.id)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user_both",
            clinic_id=clinic.id,
            display_name="Test User Both"
        )
        db_session.add(line_user)
        db_session.commit()

        # Login with both identifiers - should use liff_id
        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.post(
                "/api/liff/auth/liff-login",
                json={
                    "line_user_id": "test_line_user_both",
                    "display_name": "Test User Both",
                    "liff_access_token": "line_access_token",
                    "liff_id": clinic.liff_id,
                    "clinic_token": clinic.liff_access_token
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert data["clinic_id"] == clinic.id

            # Verify JWT contains liff_id (not clinic_token)
            import jwt
            from core.config import JWT_SECRET_KEY
            token = data["access_token"]
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            assert "liff_id" in payload
            assert payload["liff_id"] == clinic.liff_id
            assert "clinic_token" not in payload or payload["clinic_token"] is None
        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_liff_login_jwt_contains_clinic_token(self, db_session: Session):
        """Test that JWT token includes clinic_token in payload."""
        import jwt
        from core.config import JWT_SECRET_KEY

        # Create clinic with token
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
                    "clinic_token": clinic.liff_access_token
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data

            # Decode JWT to verify clinic_token is included
            token = data["access_token"]
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            assert "clinic_token" in payload
            assert payload["clinic_token"] == clinic.liff_access_token
            assert payload["clinic_id"] == clinic.id
        finally:
            client.app.dependency_overrides.pop(get_db, None)


class TestClinicCreationWithLiffId:
    """Tests for clinic creation with liff_id."""

    def test_create_clinic_with_liff_id(self, db_session: Session):
        """Test creating a clinic with liff_id during onboarding."""
        from auth.dependencies import require_system_admin, UserContext
        import jwt
        from datetime import datetime, timedelta, timezone
        from core.config import JWT_SECRET_KEY

        # Create system admin user (no clinic association)
        now = datetime.now(timezone.utc)
        admin = User(
            email="admin@system.com",
            google_subject_id="system_admin_123",
            created_at=now,
            updated_at=now
        )
        db_session.add(admin)
        db_session.commit()
        db_session.refresh(admin)

        # Create JWT token for system admin
        payload = {
            "sub": str(admin.google_subject_id),
            "user_id": admin.id,
            "email": admin.email,
            "user_type": "system_admin",
            "exp": datetime.utcnow() + timedelta(hours=1),
            "iat": datetime.utcnow()
        }
        admin_token = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")

        # Mock authentication
        def require_system_admin_override():
            return UserContext(
                user_type="system_admin",
                user_id=admin.id,
                email=admin.email,
                google_subject_id=admin.google_subject_id,
                roles=[],
                active_clinic_id=None,
                name="System Admin"
            )

        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        client.app.dependency_overrides[require_system_admin] = require_system_admin_override

        try:
            # Mock LINE service to avoid actual API calls
            from unittest.mock import patch, Mock
            from services.line_service import LINEService

            with patch.object(LINEService, 'get_bot_info', return_value='mock_bot_user_id'):
                # Create clinic with liff_id
                response = client.post(
                    "/api/system/clinics",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={
                        "name": "Clinic with LIFF",
                        "line_channel_id": "test_channel_liff_create",
                        "line_channel_secret": "test_secret_liff_create",
                        "line_channel_access_token": "test_token_liff_create",
                        "liff_id": "1234567890-createtest"
                    }
                )

                if response.status_code != 200:
                    print(f"Response status: {response.status_code}")
                    print(f"Response body: {response.text}")

                assert response.status_code == 200
                data = response.json()
                assert data["name"] == "Clinic with LIFF"

                # Verify clinic was created with liff_id
                clinic = db_session.query(Clinic).filter(Clinic.id == data["id"]).first()
                assert clinic is not None
                assert clinic.liff_id == "1234567890-createtest"
                # Should still have liff_access_token (generated for backward compatibility)
                assert clinic.liff_access_token is not None
        finally:
            client.app.dependency_overrides.clear()

    def test_create_clinic_with_invalid_liff_id_format(self, db_session: Session):
        """Test creating a clinic with invalid liff_id format is rejected."""
        from auth.dependencies import require_system_admin, UserContext
        import jwt
        from datetime import datetime, timedelta, timezone
        from core.config import JWT_SECRET_KEY

        # Create system admin user (no clinic association)
        now = datetime.now(timezone.utc)
        admin = User(
            email="admin2@system.com",
            google_subject_id="system_admin_456",
            created_at=now,
            updated_at=now
        )
        db_session.add(admin)
        db_session.commit()
        db_session.refresh(admin)

        # Create JWT token for system admin
        payload = {
            "sub": str(admin.google_subject_id),
            "user_id": admin.id,
            "email": admin.email,
            "user_type": "system_admin",
            "exp": datetime.utcnow() + timedelta(hours=1),
            "iat": datetime.utcnow()
        }
        admin_token = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")

        # Mock authentication
        def require_system_admin_override():
            return UserContext(
                user_type="system_admin",
                user_id=admin.id,
                email=admin.email,
                google_subject_id=admin.google_subject_id,
                roles=[],
                active_clinic_id=None,
                name="System Admin 2"
            )

        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        client.app.dependency_overrides[require_system_admin] = require_system_admin_override

        try:
            # Try to create clinic with invalid liff_id format
            response = client.post(
                "/api/system/clinics",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={
                    "name": "Clinic Invalid LIFF",
                    "line_channel_id": "test_channel_invalid",
                    "line_channel_secret": "test_secret_invalid",
                    "line_channel_access_token": "test_token_invalid",
                    "liff_id": "invalid-format!"  # Invalid format
                }
            )

            assert response.status_code == 422  # Validation error
        finally:
            client.app.dependency_overrides.clear()

    def test_create_clinic_with_duplicate_liff_id(self, db_session: Session):
        """Test creating a clinic with duplicate liff_id is rejected."""
        from auth.dependencies import require_system_admin, UserContext
        import jwt
        from datetime import datetime, timedelta, timezone
        from core.config import JWT_SECRET_KEY

        # Create first clinic with liff_id
        existing_clinic = Clinic(
            name="Existing Clinic",
            line_channel_id="existing_channel",
            line_channel_secret="existing_secret",
            line_channel_access_token="existing_token",
            liff_id="1234567890-duplicate"
        )
        db_session.add(existing_clinic)
        db_session.commit()

        # Create system admin user (no clinic association)
        now = datetime.now(timezone.utc)
        admin = User(
            email="admin3@system.com",
            google_subject_id="system_admin_789",
            created_at=now,
            updated_at=now
        )
        db_session.add(admin)
        db_session.commit()
        db_session.refresh(admin)

        # Create JWT token for system admin
        payload = {
            "sub": str(admin.google_subject_id),
            "user_id": admin.id,
            "email": admin.email,
            "user_type": "system_admin",
            "exp": datetime.utcnow() + timedelta(hours=1),
            "iat": datetime.utcnow()
        }
        admin_token = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")

        # Mock authentication
        def require_system_admin_override():
            return UserContext(
                user_type="system_admin",
                user_id=admin.id,
                email=admin.email,
                google_subject_id=admin.google_subject_id,
                roles=[],
                active_clinic_id=None,
                name="System Admin 3"
            )

        client = TestClient(app)
        client.app.dependency_overrides[get_db] = lambda: db_session
        client.app.dependency_overrides[require_system_admin] = require_system_admin_override

        try:
            # Try to create clinic with duplicate liff_id
            response = client.post(
                "/api/system/clinics",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={
                    "name": "Duplicate LIFF Clinic",
                    "line_channel_id": "duplicate_channel",
                    "line_channel_secret": "duplicate_secret",
                    "line_channel_access_token": "duplicate_token",
                    "liff_id": "1234567890-duplicate"  # Same as existing
                }
            )

            assert response.status_code == 400
            assert "LIFF ID 已被其他診所使用" in response.text
        finally:
            client.app.dependency_overrides.clear()


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

