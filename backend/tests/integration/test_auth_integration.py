"""
Integration tests for authentication system.

Tests the complete authentication flow from signup to API access.
"""

import asyncio

import pytest
import httpx
from unittest.mock import Mock, patch, AsyncMock
from fastapi import Request, Response
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import User, SignupToken, RefreshToken, Clinic
from datetime import datetime, timezone, timedelta
from core.database import get_db
from auth.dependencies import get_current_user


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


# Using db_session fixture from conftest.py


class TestAuthenticationFlow:
    """Test complete authentication flow."""

    def test_clinic_signup_flow(self, client, db_session):
        """Test clinic admin signup flow."""
        from auth.dependencies import get_current_user
        from core.database import get_db

        # Clean up any leftover dependency overrides from previous tests
        client.app.dependency_overrides.pop(get_current_user, None)
        client.app.dependency_overrides.pop(get_db, None)

        # Override get_db dependency to use our test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Create test clinic
            clinic = Clinic(
                name="Test Clinic",
                line_channel_id="test_channel_signup",
                line_channel_secret="test_secret",
                line_channel_access_token="test_token"
            )
            db_session.add(clinic)
            db_session.commit()

            # Create signup token
            import secrets
            from datetime import datetime, timedelta, timezone

            token = secrets.token_urlsafe(32)
            signup_token = SignupToken(
                token=token,
                clinic_id=clinic.id,
                default_roles=["admin", "practitioner"],
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
            )
            db_session.add(signup_token)
            db_session.commit()

            # Test signup token validation
            response = client.get(f"/api/signup/clinic?token={token}")
            assert response.status_code == 200
            data = response.json()
            assert "auth_url" in data

            # Test invalid token
            response = client.get("/api/signup/clinic?token=invalid_token")
            assert response.status_code == 400
            assert "註冊連結已失效" in response.json()["detail"]
        finally:
            # Clean up override
            client.app.dependency_overrides.pop(get_db, None)

    def test_member_invitation_flow(self, client, db_session):
        """Test team member invitation flow."""
        from auth.dependencies import get_current_user
        from core.database import get_db

        # Clean up any leftover dependency overrides from previous tests
        client.app.dependency_overrides.pop(get_current_user, None)
        client.app.dependency_overrides.pop(get_db, None)

        # Override get_db dependency to use our test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Create test clinic and admin user
            clinic = Clinic(
                name="Test Clinic",
                line_channel_id="test_channel_invite",
                line_channel_secret="test_secret",
                line_channel_access_token="test_token"
            )
            db_session.add(clinic)
            db_session.commit()

            admin_user = User(
                clinic_id=clinic.id,
                email="admin@test.com",
                google_subject_id="admin_sub",
                full_name="Test Admin",
                roles=["admin", "practitioner"]
            )
            db_session.add(admin_user)
            db_session.commit()

            # Mock authenticated admin using dependency override
            from auth.dependencies import UserContext, get_current_user

            mock_user = UserContext(
                user_type="clinic_user",
                email="admin@test.com",
                roles=["admin", "practitioner"],
                clinic_id=clinic.id,
                google_subject_id="admin_sub",
                name="Test Admin",
                user_id=admin_user.id
            )

            # Override the get_current_user dependency
            original_override = client.app.dependency_overrides.get(get_current_user)
            client.app.dependency_overrides[get_current_user] = lambda: mock_user

            try:
                # Test member invitation
                response = client.post(
                    "/api/clinic/members/invite",
                    json={"default_roles": ["practitioner"]},
                    headers={"Authorization": "Bearer test_token"}
                )

                assert response.status_code == 200
                data = response.json()
                assert "signup_url" in data
                assert "expires_at" in data
                assert "token_id" in data
            finally:
                # Restore original override or remove if it was None
                if original_override is not None:
                    client.app.dependency_overrides[get_current_user] = original_override
                else:
                    client.app.dependency_overrides.pop(get_current_user, None)
        finally:
            # Clean up override
            client.app.dependency_overrides.pop(get_db, None)

    def test_clinic_api_access_control(self, client, db_session):
        """Test clinic API access control."""
        from auth.dependencies import get_current_user
        from core.database import get_db

        # Clean up any leftover dependency overrides from previous tests
        client.app.dependency_overrides.pop(get_current_user, None)
        client.app.dependency_overrides.pop(get_db, None)

        # Override get_db dependency to use our test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Create test clinics and users
            clinic1 = Clinic(
                name="Clinic 1",
                line_channel_id="channel1",
                line_channel_secret="secret1",
                line_channel_access_token="token1"
            )
            clinic2 = Clinic(
                name="Clinic 2",
                line_channel_id="channel2",
                line_channel_secret="secret2",
                line_channel_access_token="token2"
            )
            db_session.add_all([clinic1, clinic2])
            db_session.commit()

            user1 = User(
                clinic_id=clinic1.id,
                email="user1@test.com",
                google_subject_id="sub1",
                full_name="User 1",
                roles=["admin", "practitioner"]
            )
            user2 = User(
                clinic_id=clinic2.id,
                email="user2@test.com",
                google_subject_id="sub2",
                full_name="User 2",
                roles=["admin", "practitioner"]
            )
            db_session.add_all([user1, user2])
            db_session.commit()

            # Mock user from clinic 1 using dependency override
            from auth.dependencies import UserContext, get_current_user

            mock_user = UserContext(
                user_type="clinic_user",
                email="user1@test.com",
                roles=["admin", "practitioner"],
                clinic_id=clinic1.id,
                google_subject_id="sub1",
                name="User 1",
                user_id=user1.id
            )

            # Override the get_current_user dependency
            original_override = client.app.dependency_overrides.get(get_current_user)
            client.app.dependency_overrides[get_current_user] = lambda: mock_user

            try:
                # Test accessing own clinic data (should work)
                response = client.get(
                    "/api/clinic/members",
                    headers={"Authorization": "Bearer test_token"}
                )
                assert response.status_code == 200
            finally:
                # Restore original override or remove if it was None
                if original_override is not None:
                    client.app.dependency_overrides[get_current_user] = original_override
                else:
                    client.app.dependency_overrides.pop(get_current_user, None)
        finally:
            # Clean up override
            client.app.dependency_overrides.pop(get_db, None)

    def test_role_based_access(self, client, db_session):
        """Test role-based API access control."""
        from auth.dependencies import get_current_user
        from core.database import get_db

        # Clean up any leftover dependency overrides from previous tests
        client.app.dependency_overrides.pop(get_current_user, None)
        client.app.dependency_overrides.pop(get_db, None)

        # Override get_db dependency to use our test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Create test clinic and users with different roles
            clinic = Clinic(
                name="Test Clinic",
                line_channel_id="test_channel_roles",
                line_channel_secret="test_secret",
                line_channel_access_token="test_token"
            )
            db_session.add(clinic)
            db_session.commit()

            admin_user = User(
                clinic_id=clinic.id,
                email="admin@test.com",
                google_subject_id="admin_sub",
                full_name="Admin User",
                roles=["admin", "practitioner"]
            )

            practitioner_user = User(
                clinic_id=clinic.id,
                email="practitioner@test.com",
                google_subject_id="pract_sub",
                full_name="Practitioner User",
                roles=["practitioner"]
            )

            read_only_user = User(
                clinic_id=clinic.id,
                email="readonly@test.com",
                google_subject_id="readonly_sub",
                full_name="Read Only User",
                roles=[]
            )

            db_session.add_all([admin_user, practitioner_user, read_only_user])
            db_session.commit()

            # Test admin-only endpoint with admin user
            from auth.dependencies import UserContext, get_current_user

            mock_admin_user = UserContext(
                user_type="clinic_user",
                email="admin@test.com",
                roles=["admin", "practitioner"],
                clinic_id=clinic.id,
                google_subject_id="admin_sub",
                name="Admin User",
                user_id=admin_user.id
            )

            # Override the get_current_user dependency for admin user
            original_override = client.app.dependency_overrides.get(get_current_user)
            client.app.dependency_overrides[get_current_user] = lambda: mock_admin_user

            try:
                response = client.post(
                    "/api/clinic/members/invite",
                    json={"default_roles": ["practitioner"]},
                    headers={"Authorization": "Bearer test_token"}
                )
                assert response.status_code == 200

                # Test admin-only endpoint with practitioner user (should fail)
                mock_practitioner_user = UserContext(
                    user_type="clinic_user",
                    email="practitioner@test.com",
                    roles=["practitioner"],
                    clinic_id=clinic.id,
                    google_subject_id="pract_sub",
                    name="Practitioner User",
                    user_id=practitioner_user.id
                )

                # Override for practitioner user
                client.app.dependency_overrides[get_current_user] = lambda: mock_practitioner_user

                response = client.post(
                    "/api/clinic/members/invite",
                    json={"default_roles": ["practitioner"]},
                    headers={"Authorization": "Bearer test_token"}
                )
                assert response.status_code == 403
            finally:
                # Restore original override or remove if it was None
                if original_override is not None:
                    client.app.dependency_overrides[get_current_user] = original_override
                else:
                    client.app.dependency_overrides.pop(get_current_user, None)
        finally:
            # Clean up override
            client.app.dependency_overrides.pop(get_db, None)

    def test_system_admin_api_access(self, client, db_session):
        """Test system admin API access."""
        from auth.dependencies import UserContext, get_current_user
        from core.database import get_db

        # Override dependencies to use test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        # Mock system admin user
        mock_sysadmin_user = UserContext(
            user_type="system_admin",
            email="sysadmin@test.com",
            roles=[],
            clinic_id=None,
            google_subject_id="sysadmin_sub",
            name="System Admin"
        )

        # Override the get_current_user dependency
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_sysadmin_user

        try:
            # Test system admin endpoint (dashboard removed, test clinics endpoint instead)
            response = client.get("/api/system/clinics")
            # Should work now with proper database isolation
            assert response.status_code == 200

            # Test system admin trying clinic endpoint (should work due to system admin override)
            response = client.get("/api/clinic/members")
            # System admins should have access to clinic endpoints despite no clinic_id
            assert response.status_code == 200
        finally:
            # Restore original override or remove if it was None
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)

            # Clean up database override
            client.app.dependency_overrides.pop(get_db, None)


class TestSignupCallbackFlow:
    """Test complete signup callback flow."""

    def test_signup_callback_clinic_admin_success(self, client, db_session):
        """Test successful clinic admin signup callback."""
        # Create test clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_signup",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create signup token
        import secrets
        from datetime import datetime, timedelta, timezone

        token = secrets.token_urlsafe(32)
        signup_token = SignupToken(
            token=token,
            clinic_id=clinic.id,
            default_roles=["admin", "practitioner"],
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
        )
        db_session.add(signup_token)
        db_session.commit()

        # Override dependencies to use test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Mock Google OAuth response
            mock_token_response = {
                "access_token": "mock_access_token",
                "refresh_token": "mock_refresh_token",
                "expires_in": 3600,
                "token_type": "Bearer"
            }

            mock_user_info = {
                "email": "newadmin@example.com",
                "name": "New Admin",
                "sub": "google_sub_123"
            }

            from unittest.mock import AsyncMock

            with patch("httpx.AsyncClient", autospec=True) as mock_client_class:
                instance = AsyncMock()

                mock_response = Mock(spec=httpx.Response)
                mock_response.json.return_value = mock_token_response
                mock_response.raise_for_status = Mock()
                instance.post = AsyncMock(return_value=mock_response)

                mock_user_response = Mock(spec=httpx.Response)
                mock_user_response.json.return_value = mock_user_info
                mock_user_response.raise_for_status = Mock()
                instance.get = AsyncMock(return_value=mock_user_response)

                mock_client_class.return_value.__aenter__.return_value = instance

                # Sign the state parameter as required by the updated implementation
                from services.jwt_service import jwt_service
                state_data = {"type": "clinic", "token": token}
                signed_state = jwt_service.sign_oauth_state(state_data)

                # Call signup callback
                response = client.get(f"/api/signup/callback?code=mock_code&state={signed_state}", follow_redirects=False)

            assert response.status_code == 302  # Redirect response
            assert "location" in response.headers
            assert "confirm-name?token=" in response.headers["location"]  # Should redirect to name confirmation

            # Extract temp token from redirect URL
            redirect_url = response.headers["location"]
            temp_token = redirect_url.split("token=")[1]

            # Call name confirmation endpoint
            name_confirmation_data = {"full_name": "New Admin"}
            confirm_response = client.post(f"/api/signup/confirm-name?token={temp_token}", json=name_confirmation_data)

            assert confirm_response.status_code == 200
            confirm_result = confirm_response.json()
            assert "redirect_url" in confirm_result
            assert "token=" in confirm_result["redirect_url"]

            # Verify user was created in database
            user = db_session.query(User).filter(User.email == "newadmin@example.com").first()
            assert user is not None
            assert user.roles == ["admin", "practitioner"]
            assert user.clinic_id == clinic.id

            # Verify signup token was marked as used
            db_session.refresh(signup_token)
            assert signup_token.used_at is not None
            assert signup_token.used_by_email == "newadmin@example.com"

        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_db, None)

    def test_signup_callback_member_success(self, client, db_session):
        """Test successful team member signup callback."""
        # Create test clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_member",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create member signup token
        import secrets
        from datetime import datetime, timedelta, timezone

        token = secrets.token_urlsafe(32)
        signup_token = SignupToken(
            token=token,
            clinic_id=clinic.id,
            default_roles=["practitioner"],
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
        )
        db_session.add(signup_token)
        db_session.commit()

        # Override dependencies to use test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Mock Google OAuth response
            mock_token_response = {
                "access_token": "mock_access_token",
                "refresh_token": "mock_refresh_token",
                "expires_in": 3600,
                "token_type": "Bearer"
            }

            mock_user_info = {
                "email": "newmember@example.com",
                "name": "New Member",
                "sub": "google_sub_456"
            }

            from unittest.mock import AsyncMock

            with patch("httpx.AsyncClient", autospec=True) as mock_client_class:
                instance = AsyncMock()

                mock_response = Mock(spec=httpx.Response)
                mock_response.json.return_value = mock_token_response
                mock_response.raise_for_status = Mock()
                instance.post = AsyncMock(return_value=mock_response)

                mock_user_response = Mock(spec=httpx.Response)
                mock_user_response.json.return_value = mock_user_info
                mock_user_response.raise_for_status = Mock()
                instance.get = AsyncMock(return_value=mock_user_response)

                mock_client_class.return_value.__aenter__.return_value = instance

                # Sign the state parameter as required by the updated implementation
                from services.jwt_service import jwt_service
                state_data = {"type": "member", "token": token}
                signed_state = jwt_service.sign_oauth_state(state_data)

                # Call signup callback
                response = client.get(f"/api/signup/callback?code=mock_code&state={signed_state}", follow_redirects=False)

                assert response.status_code == 302  # Redirect response
                assert "location" in response.headers
                assert "confirm-name?token=" in response.headers["location"]  # Should redirect to name confirmation

                # Extract temp token from redirect URL
                redirect_url = response.headers["location"]
                temp_token = redirect_url.split("token=")[1]

                # Call name confirmation endpoint
                name_confirmation_data = {"full_name": "New Member"}
                confirm_response = client.post(f"/api/signup/confirm-name?token={temp_token}", json=name_confirmation_data)

                assert confirm_response.status_code == 200
                confirm_result = confirm_response.json()
                assert "redirect_url" in confirm_result
                assert "token=" in confirm_result["redirect_url"]

                # Verify user was created with correct roles
                user = db_session.query(User).filter(User.email == "newmember@example.com").first()
                assert user is not None
                assert user.roles == ["practitioner"]

        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_db, None)

    def test_signup_flow_invalid_token(self, client, db_session):
        """Test signup flow with invalid/expired token."""
        # Override dependencies to use test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Test with non-existent token
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client_class.return_value = mock_client
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=None)

                response = client.get("/api/signup/callback?code=mock_code&state=clinic:nonexistent_token")
                assert response.status_code == 400
                assert "驗證狀態" in response.json()["detail"]

        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_db, None)

    def test_signup_callback_google_userinfo_sub_field(self, client, db_session):
        """Test signup callback handles Google userinfo with 'sub' field."""
        from unittest.mock import AsyncMock, patch

        # Create test clinic and signup token
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_userinfo_sub",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        signup_token = SignupToken(
            token="test_userinfo_token_sub",
            clinic_id=clinic.id,
            default_roles=["admin"],
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
        )
        db_session.add(signup_token)
        db_session.commit()

        mock_token_response = {
            "access_token": "mock_access_token_sub",
            "refresh_token": "mock_refresh_token",
            "expires_in": 3600,
            "token_type": "Bearer"
        }

        mock_user_info = {
            "sub": "google_sub_123",
            "email": "test_sub@example.com",
            "name": "Test User Sub",
            "email_verified": True
        }

        # Override dependencies to use test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            with patch("httpx.AsyncClient", autospec=True) as mock_client_class, \
                 patch("services.google_oauth.GoogleOAuthService.get_user_info", autospec=True, return_value=mock_user_info):
                instance = AsyncMock()

                from unittest.mock import Mock
                mock_token_resp = Mock(spec=httpx.Response)
                mock_token_resp.json.return_value = mock_token_response
                mock_token_resp.raise_for_status = Mock()
                instance.post = AsyncMock(return_value=mock_token_resp)

                mock_client_class.return_value.__aenter__.return_value = instance

                # Sign the state parameter
                from services.jwt_service import jwt_service
                state_data = {"type": "clinic", "token": "test_userinfo_token_sub"}
                signed_state = jwt_service.sign_oauth_state(state_data)

                # Call signup callback
                response = client.get(f"/api/signup/callback?code=mock_code&state={signed_state}", follow_redirects=False)

                assert response.status_code == 302  # Redirect response
                assert "location" in response.headers
                assert "confirm-name?token=" in response.headers["location"]  # Should redirect to name confirmation

                # Extract temp token from redirect URL
                redirect_url = response.headers["location"]
                temp_token = redirect_url.split("token=")[1]

                # Call name confirmation endpoint
                name_confirmation_data = {"full_name": "Test User Sub"}
                confirm_response = client.post(f"/api/signup/confirm-name?token={temp_token}", json=name_confirmation_data)

                assert confirm_response.status_code == 200
                confirm_result = confirm_response.json()
                assert "redirect_url" in confirm_result
                assert "token=" in confirm_result["redirect_url"]

                # Verify user was created with 'sub' field
                user = db_session.query(User).filter(User.email == "test_sub@example.com").first()
                assert user is not None
                assert user.google_subject_id == "google_sub_123"

        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_signup_callback_google_userinfo_id_field_fallback(self, client, db_session):
        """Test signup callback handles Google userinfo with 'id' field fallback."""
        from unittest.mock import AsyncMock, patch

        # Create test clinic and signup token
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_userinfo_id",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        signup_token = SignupToken(
            token="test_userinfo_token_id",
            clinic_id=clinic.id,
            default_roles=["admin"],
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
        )
        db_session.add(signup_token)
        db_session.commit()

        mock_token_response = {
            "access_token": "mock_access_token_id",
            "refresh_token": "mock_refresh_token",
            "expires_in": 3600,
            "token_type": "Bearer"
        }

        mock_user_info = {
            "id": "google_id_456",  # Note: 'id' instead of 'sub'
            "email": "test_id@example.com",
            "name": "Test User ID",
            "email_verified": True
        }

        # Override dependencies to use test session
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            with patch("httpx.AsyncClient", autospec=True) as mock_client_class, \
                 patch("services.google_oauth.GoogleOAuthService.get_user_info", autospec=True, return_value=mock_user_info):
                instance = AsyncMock()

                from unittest.mock import Mock
                mock_token_resp = Mock(spec=httpx.Response)
                mock_token_resp.json.return_value = mock_token_response
                mock_token_resp.raise_for_status = Mock()
                instance.post = AsyncMock(return_value=mock_token_resp)

                mock_client_class.return_value.__aenter__.return_value = instance

                # Sign the state parameter
                from services.jwt_service import jwt_service
                state_data = {"type": "clinic", "token": "test_userinfo_token_id"}
                signed_state = jwt_service.sign_oauth_state(state_data)

                # Call signup callback
                response = client.get(f"/api/signup/callback?code=mock_code&state={signed_state}", follow_redirects=False)

                assert response.status_code == 302  # Redirect response
                assert "location" in response.headers
                assert "confirm-name?token=" in response.headers["location"]  # Should redirect to name confirmation

                # Extract temp token from redirect URL
                redirect_url = response.headers["location"]
                temp_token = redirect_url.split("token=")[1]

                # Call name confirmation endpoint
                name_confirmation_data = {"full_name": "Test User ID"}
                confirm_response = client.post(f"/api/signup/confirm-name?token={temp_token}", json=name_confirmation_data)

                assert confirm_response.status_code == 200
                confirm_result = confirm_response.json()
                assert "redirect_url" in confirm_result
                assert "token=" in confirm_result["redirect_url"]

                # Verify user was created with 'id' field fallback
                user = db_session.query(User).filter(User.email == "test_id@example.com").first()
                assert user is not None
                assert user.google_subject_id == "google_id_456"

        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_signup_page_no_authentication_checks(self, client, db_session):
        """Test that signup pages don't attempt authentication."""
        # Override database dependency to avoid database errors
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        try:
            # Test clinic signup page loads without auth errors
            response = client.get("/api/signup/clinic?token=some_token")
            # Should return 400 (bad token) but not 401 (auth error)
            assert response.status_code == 400

            # Test member signup page loads without auth errors
            response = client.get("/api/signup/member?token=some_token")
            # Should return 400 (bad token) but not 401 (auth error)
            assert response.status_code == 400

        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_google_calendar_oauth_fixed_redirect_uri(self, client, db_session):
        """Test Google Calendar OAuth uses fixed redirect URI without user_id."""
        from unittest.mock import AsyncMock, patch

        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_gcal",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            clinic_id=clinic.id,
            email="gcal@example.com",
            google_subject_id="gcal_sub",
            full_name="GCal User",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(user)
        db_session.commit()

        # Mock Google Calendar OAuth
        mock_token_response = {
            "access_token": "gcal_access_token",
            "refresh_token": "gcal_refresh_token",
            "expires_in": 3600,
            "token_type": "Bearer"
        }

        mock_user_info = {
            "sub": "gcal_user_sub",
            "email": "gcal@example.com",
            "name": "GCal User"
        }

        mock_client = AsyncMock()

        mock_token_resp = Mock(spec=httpx.Response)
        mock_token_resp.json.return_value = mock_token_response
        mock_token_resp.raise_for_status = Mock(spec_set=True)
        mock_client.post = AsyncMock(return_value=mock_token_resp)

        with patch("httpx.AsyncClient", autospec=True, return_value=mock_client), \
             patch("services.google_oauth.GoogleOAuthService.get_user_info", autospec=True, return_value=mock_user_info):

            # Mock authentication
            from auth.dependencies import UserContext, get_current_user
            admin_user = UserContext(
                user_type="clinic_user",
                email="admin@test.com",
                roles=["admin"],
                clinic_id=clinic.id,
                google_subject_id="admin_sub",
                name="Test Admin"
            )

            def override_get_db():
                yield db_session

            client.app.dependency_overrides[get_db] = override_get_db
            client.app.dependency_overrides[get_current_user] = lambda: admin_user

            try:
                # Call Google Calendar auth endpoint
                response = client.get(f"/api/clinic/members/{user.id}/gcal/auth")
                assert response.status_code == 200
                data = response.json()
                assert "auth_url" in data

                # Verify the auth URL uses the fixed redirect URI (not dynamic with user_id)
                auth_url = data["auth_url"]
                assert "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fclinic%2Fmembers%2Fgcal%2Fcallback" in auth_url
                # Should NOT contain the user_id in the redirect URI
                assert f"members%2F{user.id}%2Fgcal%2Fcallback" not in auth_url

            finally:
                client.app.dependency_overrides.pop(get_db, None)
                client.app.dependency_overrides.pop(get_current_user, None)

    def test_role_based_access_control(self, client, db_session):
        """Test role-based access control across different endpoints."""
        from auth.dependencies import UserContext, get_current_user

        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_role",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Mock practitioner user
        practitioner_user = UserContext(
            user_type="clinic_user",
            email="practitioner@test.com",
            roles=["practitioner"],
            clinic_id=clinic.id,
            google_subject_id="pract_sub",
            name="Test Practitioner"
        )

        # Override dependencies
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db

        # Store original override
        original_override = client.app.dependency_overrides.get(get_current_user)

        try:
            # Test practitioner can access their own clinic endpoints
            client.app.dependency_overrides[get_current_user] = lambda: practitioner_user

            # Should be able to access clinic members endpoint
            response = client.get("/api/clinic/members")
            assert response.status_code == 200

            # Should be able to access clinic settings
            response = client.get("/api/clinic/settings")
            assert response.status_code == 200

            # Should NOT be able to access system admin endpoints
            response = client.get("/api/system/clinics")
            assert response.status_code == 403

        finally:
            # Restore original overrides
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_member_google_oauth_callback(self, client, db_session):
        """Test member Google OAuth callback with signed state."""
        from auth.dependencies import UserContext, get_current_user

        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_member_oauth",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            clinic_id=clinic.id,
            email="member@test.com",
            google_subject_id="member_sub",
            full_name="Test Member",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.commit()

        # Mock admin user (required for member OAuth callback)
        admin_user = UserContext(
            user_type="clinic_user",
            email="admin@test.com",
            roles=["admin"],
            clinic_id=clinic.id,
            google_subject_id="admin_sub",
            name="Clinic Admin",
            user_id=999  # Different user ID for admin
        )

        # Override dependencies
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db
        client.app.dependency_overrides[get_current_user] = lambda: admin_user

        try:
            # Mock Google OAuth response
            with patch("httpx.AsyncClient", autospec=True) as mock_client_class:
                instance = AsyncMock()
                mock_client_class.return_value.__aenter__.return_value = instance

                mock_response = Mock(spec=httpx.Response)
                mock_response.raise_for_status.return_value = None
                mock_response.json.return_value = {
                    "access_token": "google_access_token",
                    "refresh_token": "google_refresh_token"
                }
                instance.post.return_value = mock_response

                mock_user_response = Mock(spec=httpx.Response)
                mock_user_response.raise_for_status.return_value = None
                mock_user_response.json.return_value = {
                    "id": "google_subject_123",
                    "email": "member@test.com",
                    "name": "Test Member"
                }
                instance.get.return_value = mock_user_response

                # Sign the state like the member OAuth flow does
                from services.jwt_service import jwt_service
                state_data = {"user_id": user.id, "clinic_id": clinic.id}
                signed_state = jwt_service.sign_oauth_state(state_data)

                response = client.get(
                    "/api/clinic/members/gcal/callback",
                    params={
                        "code": "test_auth_code",
                        "state": signed_state
                    }
                )

                assert response.status_code == 200
                data = response.json()
                assert "message" in data
                assert "Google 日曆整合啟用成功" in data["message"]

                # Verify user was updated with Google Calendar credentials
                db_session.refresh(user)
                # Calendar sync is disabled - scopes removed to avoid Google App verification
                assert user.gcal_sync_enabled is False
                assert user.gcal_credentials is not None

        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_db, None)
            client.app.dependency_overrides.pop(get_current_user, None)

    def test_clinic_health_check(self, client, db_session):
        """Test clinic LINE integration health check endpoint."""
        from auth.dependencies import UserContext, get_current_user

        # Create test clinic with some webhook activity
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_health",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            last_webhook_received_at=datetime.now(timezone.utc) - timedelta(hours=2),
            webhook_count_24h=5
        )
        db_session.add(clinic)
        db_session.commit()

        # Mock system admin user
        admin_user = UserContext(
            user_type="system_admin",
            email="admin@test.com",
            roles=[],
            clinic_id=None,
            google_subject_id="admin_sub",
            name="System Admin"
        )

        # Override dependencies
        def override_get_db():
            yield db_session

        client.app.dependency_overrides[get_db] = override_get_db
        client.app.dependency_overrides[get_current_user] = lambda: admin_user

        try:
            response = client.get(f"/api/system/clinics/{clinic.id}/health")
            assert response.status_code == 200

            data = response.json()
            assert data["clinic_id"] == clinic.id
            assert data["line_integration_status"] == "healthy"  # Has recent webhooks
            assert data["webhook_status"] == "active"  # Received webhooks in last 6 hours
            assert data["webhook_count_24h"] == 5
            assert "signature_verification_capable" in data
            assert "api_connectivity" in data
            assert "error_messages" in data
            assert "health_check_performed_at" in data

        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_db, None)
            client.app.dependency_overrides.pop(get_current_user, None)


def test_async_sqlite_import_available():
    """Test that aiosqlite can be imported (dependency is installed)."""
    try:
        import aiosqlite
        assert aiosqlite is not None
    except ImportError:
        pytest.fail("aiosqlite is not installed - async SQLite operations will fail")
