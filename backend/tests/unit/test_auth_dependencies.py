"""
Tests for authentication dependencies and middleware.
"""

import pytest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from auth.dependencies import (
    UserContext, get_token_payload, get_current_user,
    require_system_admin, require_admin_role, require_practitioner_role,
    require_clinic_user, require_clinic_access
)
from services.jwt_service import TokenPayload


class TestUserContext:
    """Test UserContext class functionality."""

    def test_system_admin_properties(self):
        """Test system admin user context."""
        context = UserContext(
            user_type="system_admin",
            email="admin@example.com",
            roles=[],
            clinic_id=None,
            google_subject_id="sub123",
            name="Admin User"
        )

        assert context.is_system_admin() is True
        assert context.is_clinic_user() is False
        assert context.has_role("admin") is True  # System admin has all roles
        assert context.has_role("any_role") is True  # System admin has all roles

    def test_clinic_user_properties(self):
        """Test clinic user context."""
        context = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin", "practitioner"],
            clinic_id=1,
            google_subject_id="sub456",
            name="Clinic User"
        )

        assert context.is_system_admin() is False
        assert context.is_clinic_user() is True
        assert context.has_role("admin") is True
        assert context.has_role("practitioner") is True
        assert context.has_role("nonexistent") is False


class TestGetTokenPayload:
    """Test get_token_payload dependency."""

    @patch('auth.dependencies.jwt_service')
    def test_valid_token(self, mock_jwt_service):
        """Test extracting payload from valid token."""
        mock_payload = TokenPayload(
            sub="test_sub",
            email="test@example.com",
            user_type="clinic_user",
            roles=["admin"],
            clinic_id=1,
            name="Test User"
        )
        mock_jwt_service.verify_token.return_value = mock_payload

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="valid.jwt.token"
        )

        result = get_token_payload(credentials)

        assert result == mock_payload
        mock_jwt_service.verify_token.assert_called_once_with("valid.jwt.token")

    @patch('auth.dependencies.jwt_service')
    def test_invalid_token(self, mock_jwt_service):
        """Test handling invalid token."""
        mock_jwt_service.verify_token.return_value = None

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="invalid.jwt.token"
        )

        result = get_token_payload(credentials)

        assert result is None
        mock_jwt_service.verify_token.assert_called_once_with("invalid.jwt.token")

    def test_no_credentials(self):
        """Test handling missing credentials."""
        result = get_token_payload(None)
        assert result is None


class TestGetCurrentUser:
    """Test get_current_user dependency."""

    @patch('auth.dependencies.get_db')
    def test_system_admin_user(self, mock_get_db):
        """Test authenticating system admin user."""
        payload = TokenPayload(
            sub="admin_sub",
            email="admin@example.com",
            user_type="system_admin",
            roles=[],
            clinic_id=None,
            name="System Admin"
        )

        with patch('auth.dependencies.SYSTEM_ADMIN_EMAILS', ['admin@example.com']):
            result = get_current_user(payload, mock_get_db)

        assert isinstance(result, UserContext)
        assert result.user_type == "system_admin"
        assert result.email == "admin@example.com"
        assert result.is_system_admin() is True

    @patch('auth.dependencies.get_db')
    def test_clinic_user_valid(self, mock_get_db):
        """Test authenticating valid clinic user."""
        from models import User

        payload = TokenPayload(
            sub="user_sub",
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin", "practitioner"],
            clinic_id=1,
            name="Clinic User"
        )

        # Create a simple mock user object
        class MockUser:
            def __init__(self):
                self.id = 1
                self.email = "user@example.com"
                self.google_subject_id = "user_sub"
                self.roles = ["admin", "practitioner"]
                self.clinic_id = 1
                self.full_name = "Clinic User"
                self.is_active = True

        mock_user = MockUser()

        mock_db = Mock()
        # Mock the query chain: db.query(User).filter(...).first()
        mock_query = Mock()
        mock_query.filter.return_value.first.return_value = mock_user
        mock_db.query.return_value = mock_query
        mock_get_db.return_value = mock_db

        result = get_current_user(payload, mock_db)

        assert isinstance(result, UserContext)
        assert result.user_type == "clinic_user"
        assert result.email == "user@example.com"
        assert result.roles == ["admin", "practitioner"]
        assert result.clinic_id == 1
        assert result.user_id == 1

    @patch('auth.dependencies.get_db')
    def test_clinic_user_not_found(self, mock_get_db):
        """Test handling clinic user not found in database."""
        payload = TokenPayload(
            sub="user_sub",
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin"],
            clinic_id=1,
            name="Clinic User"
        )

        mock_db = Mock()
        # Mock the query chain: db.query(User).filter(...).first()
        mock_query = Mock()
        mock_query.filter.return_value.first.return_value = None  # User not found
        mock_db.query.return_value = mock_query
        mock_get_db.return_value = mock_db

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(payload, mock_db)

        assert exc_info.value.status_code == 401
        assert "User not found" in exc_info.value.detail

    @patch('auth.dependencies.get_db')
    def test_clinic_user_wrong_clinic(self, mock_get_db):
        """Test handling clinic user with wrong clinic ID."""
        from models import User

        payload = TokenPayload(
            sub="user_sub",
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin"],
            clinic_id=1,  # Payload says clinic 1
            name="Clinic User"
        )

        mock_user = Mock(spec=User)
        mock_user.clinic_id = 2  # But user is in clinic 2
        mock_user.is_active = True

        mock_db = Mock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_user
        mock_get_db.return_value = mock_db

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(payload, mock_get_db)

        assert exc_info.value.status_code == 403
        assert "Clinic access denied" in exc_info.value.detail

    def test_invalid_user_type(self):
        """Test handling invalid user type."""
        payload = TokenPayload(
            sub="user_sub",
            email="user@example.com",
            user_type="invalid_type",
            roles=[],
            clinic_id=None,
            name="Invalid User"
        )

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(payload, None)

        assert exc_info.value.status_code == 401
        assert "Invalid user type" in exc_info.value.detail

    def test_no_payload(self):
        """Test handling missing payload."""
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(None, None)

        assert exc_info.value.status_code == 401
        assert "Authentication credentials not provided" in exc_info.value.detail


class TestRoleRequirements:
    """Test role-based authorization dependencies."""

    def test_require_system_admin_valid(self):
        """Test requiring system admin with valid system admin."""
        system_admin = UserContext(
            user_type="system_admin",
            email="admin@example.com",
            roles=[],
            clinic_id=None,
            google_subject_id="sub123",
            name="System Admin"
        )

        result = require_system_admin(system_admin)
        assert result == system_admin

    def test_require_system_admin_invalid(self):
        """Test requiring system admin with clinic user."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin"],
            clinic_id=1,
            google_subject_id="sub456",
            name="Clinic User"
        )

        with pytest.raises(HTTPException) as exc_info:
            require_system_admin(clinic_user)

        assert exc_info.value.status_code == 403
        assert "System admin access required" in exc_info.value.detail

    def test_require_admin_role_valid(self):
        """Test requiring admin role with admin user."""
        admin_user = UserContext(
            user_type="clinic_user",
            email="admin@example.com",
            roles=["admin", "practitioner"],
            clinic_id=1,
            google_subject_id="sub123",
            name="Admin User"
        )

        result = require_admin_role(admin_user)
        assert result == admin_user

    def test_require_admin_role_invalid(self):
        """Test requiring admin role with non-admin user."""
        regular_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["practitioner"],
            clinic_id=1,
            google_subject_id="sub456",
            name="Regular User"
        )

        with pytest.raises(HTTPException) as exc_info:
            require_admin_role(regular_user)

        assert exc_info.value.status_code == 403
        assert "Admin access required" in exc_info.value.detail

    def test_require_practitioner_role_valid(self):
        """Test requiring practitioner role with practitioner user."""
        practitioner = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["practitioner"],
            clinic_id=1,
            google_subject_id="sub123",
            name="Practitioner"
        )

        result = require_practitioner_role(practitioner)
        assert result == practitioner

    def test_require_practitioner_role_invalid(self):
        """Test requiring practitioner role with non-practitioner user."""
        read_only_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=[],
            clinic_id=1,
            google_subject_id="sub456",
            name="Read Only User"
        )

        with pytest.raises(HTTPException) as exc_info:
            require_practitioner_role(read_only_user)

        assert exc_info.value.status_code == 403
        assert "Practitioner access required" in exc_info.value.detail

    def test_require_clinic_user_valid(self):
        """Test requiring clinic user with clinic user."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin"],
            clinic_id=1,
            google_subject_id="sub123",
            name="Clinic User"
        )

        result = require_clinic_user(clinic_user)
        assert result == clinic_user

    def test_require_clinic_user_invalid(self):
        """Test requiring clinic user with system admin."""
        system_admin = UserContext(
            user_type="system_admin",
            email="admin@example.com",
            roles=[],
            clinic_id=None,
            google_subject_id="sub456",
            name="System Admin"
        )

        with pytest.raises(HTTPException) as exc_info:
            require_clinic_user(system_admin)

        assert exc_info.value.status_code == 403
        assert "Clinic user access required" in exc_info.value.detail


class TestClinicAccess:
    """Test clinic isolation enforcement."""

    def test_require_clinic_access_valid_same_clinic(self):
        """Test clinic access with user in same clinic."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin"],
            clinic_id=1,
            google_subject_id="sub123",
            name="Clinic User",
            user_id=1
        )

        result = require_clinic_access(clinic_user, 1)
        assert result == clinic_user

    def test_require_clinic_access_invalid_different_clinic(self):
        """Test clinic access with user in different clinic."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin"],
            clinic_id=1,
            google_subject_id="sub123",
            name="Clinic User",
            user_id=1
        )

        with pytest.raises(HTTPException) as exc_info:
            require_clinic_access(clinic_user, 2)

        assert exc_info.value.status_code == 403
        assert "Access denied to this clinic" in exc_info.value.detail

    def test_require_clinic_access_no_clinic_id(self):
        """Test clinic access without specific clinic ID (should pass)."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin"],
            clinic_id=1,
            google_subject_id="sub123",
            name="Clinic User",
            user_id=1
        )

        result = require_clinic_access(clinic_user, None)
        assert result == clinic_user
