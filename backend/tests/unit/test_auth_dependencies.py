"""
Tests for authentication dependencies and middleware.
"""

import pytest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from auth.dependencies import (
    UserContext, get_token_payload, get_current_user,
    require_system_admin, require_admin_role,
    require_clinic_user, require_authenticated, require_clinic_access
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
            google_subject_id="sub123",
            name="Admin User",
            active_clinic_id=None
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
            google_subject_id="sub456",
            name="Clinic User",
            active_clinic_id=1
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
            user_id=1,
            email="test@example.com",
            user_type="clinic_user",
            roles=["admin"],
            active_clinic_id=1,
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
        from models import User
        
        payload = TokenPayload(
            sub="admin_sub",
            user_id=1,
            email="admin@example.com",
            user_type="system_admin",
            roles=[],
            active_clinic_id=None,
            name="System Admin"
        )

        # Create a mock system admin user
        class MockSystemAdminUser:
            def __init__(self):
                self.id = 1
                self.email = "admin@example.com"
                self.google_subject_id = "admin_sub"
                self.full_name = "System Admin"
                self.is_active = True

        mock_user = MockSystemAdminUser()

        mock_db = Mock()
        from models import User, UserClinicAssociation
        
        # Mock the query chain: db.query(User).filter(...).first()
        mock_user_query = Mock()
        mock_user_query.filter.return_value.first.return_value = mock_user
        
        # Mock the UserClinicAssociation query to return None (no associations for system admin)
        mock_assoc_query = Mock()
        mock_assoc_query.filter.return_value.first.return_value = None
        
        # Configure db.query to return different mocks based on the model
        def query_side_effect(model):
            if model is User:
                return mock_user_query
            elif model is UserClinicAssociation:
                return mock_assoc_query
            return Mock()
        
        mock_db.query.side_effect = query_side_effect
        mock_get_db.return_value = mock_db

        with patch('auth.dependencies.SYSTEM_ADMIN_EMAILS', ['admin@example.com']):
            result = get_current_user(payload, mock_db)

        assert isinstance(result, UserContext)
        assert result.user_type == "system_admin"
        assert result.email == "admin@example.com"
        assert result.is_system_admin() is True
        assert result.user_id == 1  # System admins now have user_id
        assert result.active_clinic_id is None

    @patch('auth.dependencies.get_db')
    def test_clinic_user_valid(self, mock_get_db):
        """Test authenticating valid clinic user with association."""
        from models import User, UserClinicAssociation, Clinic

        payload = TokenPayload(
            sub="user_sub",
            user_id=1,
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin", "practitioner"],
            active_clinic_id=1,
            name="Clinic User"
        )

        # Create mock user
        mock_user = Mock(spec=User)
        mock_user.id = 1
        mock_user.email = "user@example.com"
        mock_user.google_subject_id = "user_sub"
        mock_user.is_active = True

        # Create mock association
        mock_association = Mock(spec=UserClinicAssociation)
        mock_association.clinic_id = 1
        mock_association.roles = ["admin", "practitioner"]
        mock_association.full_name = "Clinic User"
        mock_association.last_accessed_at = None  # Will be updated

        # Create mock clinic
        mock_clinic = Mock(spec=Clinic)
        mock_clinic.id = 1
        mock_clinic.is_active = True

        mock_db = Mock()
        
        # Configure db.query to return different queries based on model
        def query_side_effect(model):
            mock_query = Mock()
            if model == User:
                mock_query.filter.return_value.first.return_value = mock_user
            elif model == UserClinicAssociation:
                mock_query.filter.return_value.first.return_value = mock_association
            elif model == Clinic:
                mock_query.filter.return_value.first.return_value = mock_clinic
            return mock_query
        
        mock_db.query.side_effect = query_side_effect
        mock_get_db.return_value = mock_db

        result = get_current_user(payload, mock_db)

        assert isinstance(result, UserContext)
        assert result.user_type == "clinic_user"
        assert result.email == "user@example.com"
        assert result.roles == ["admin", "practitioner"]  # From association
        assert result.active_clinic_id == 1
        assert result.user_id == 1
        assert result.name == "Clinic User"  # From association

    @patch('auth.dependencies.get_db')
    def test_clinic_user_not_found(self, mock_get_db):
        """Test handling clinic user not found in database."""
        payload = TokenPayload(
            sub="user_sub",
            user_id=1,
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin"],
            active_clinic_id=1,
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
        """Test handling clinic user with wrong clinic ID (no association)."""
        from models import User, UserClinicAssociation

        payload = TokenPayload(
            sub="user_sub",
            user_id=1,
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin"],
            active_clinic_id=1,  # Payload says clinic 1
            name="Clinic User"
        )

        mock_user = Mock(spec=User)
        mock_user.id = 1
        mock_user.google_subject_id = "user_sub"
        mock_user.email = "user@example.com"
        mock_user.is_active = True

        mock_db = Mock()
        # Mock User query - returns user
        mock_user_query = Mock()
        mock_user_query.filter.return_value.first.return_value = mock_user
        
        # Mock UserClinicAssociation query - returns None (no association for clinic 1)
        mock_assoc_query = Mock()
        mock_assoc_query.filter.return_value.first.return_value = None
        
        # Mock Clinic query - not reached, but set up anyway
        mock_clinic_query = Mock()
        mock_clinic_query.filter.return_value.first.return_value = None
        
        # Configure db.query to return different queries based on model
        def query_side_effect(model):
            if model == User:
                return mock_user_query
            elif model == UserClinicAssociation:
                return mock_assoc_query
            else:  # Clinic
                return mock_clinic_query
        
        mock_db.query.side_effect = query_side_effect
        mock_get_db.return_value = mock_db

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(payload, mock_db)

        assert exc_info.value.status_code == 403
        assert "Clinic access denied" in exc_info.value.detail

    @patch('auth.dependencies.get_db')
    def test_clinic_user_inactive_clinic(self, mock_get_db):
        """Test handling clinic user with inactive clinic."""
        from models import User, UserClinicAssociation, Clinic

        payload = TokenPayload(
            sub="user_sub",
            user_id=1,
            email="user@example.com",
            user_type="clinic_user",
            roles=["admin"],
            active_clinic_id=1,
            name="Clinic User"
        )

        mock_user = Mock(spec=User)
        mock_user.id = 1
        mock_user.google_subject_id = "user_sub"
        mock_user.email = "user@example.com"
        mock_user.is_active = True

        # Create mock association (exists and is active)
        mock_association = Mock(spec=UserClinicAssociation)
        mock_association.clinic_id = 1
        mock_association.roles = ["admin"]
        mock_association.full_name = "Clinic User"
        mock_association.last_accessed_at = None

        # Create mock clinic that is INACTIVE
        # When query filters by is_active == True, it should return None for inactive clinic
        mock_clinic = None  # Query will return None because clinic.is_active == False

        mock_db = Mock()
        
        # Configure db.query to return different queries based on model
        def query_side_effect(model):
            mock_query = Mock()
            if model == User:
                mock_query.filter.return_value.first.return_value = mock_user
            elif model == UserClinicAssociation:
                mock_query.filter.return_value.first.return_value = mock_association
            elif model == Clinic:
                # Return None because clinic is inactive (filter excludes it)
                mock_query.filter.return_value.first.return_value = None
            return mock_query
        
        mock_db.query.side_effect = query_side_effect
        mock_get_db.return_value = mock_db

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(payload, mock_db)

        assert exc_info.value.status_code == 403
        assert "Clinic is inactive" in exc_info.value.detail

    def test_invalid_user_type(self):
        """Test handling invalid user type."""
        payload = TokenPayload(
            sub="user_sub",
            user_id=1,
            email="user@example.com",
            user_type="invalid_type",
            roles=[],
            active_clinic_id=None,
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
            active_clinic_id=None,
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
            active_clinic_id=1,
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
            active_clinic_id=1,
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
            active_clinic_id=1,
            google_subject_id="sub456",
            name="Regular User"
        )

        with pytest.raises(HTTPException) as exc_info:
            require_admin_role(regular_user)

        assert exc_info.value.status_code == 403
        assert "Admin access required" in exc_info.value.detail

    def test_require_authenticated_valid(self):
        """Test requiring authenticated user with clinic user."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=[],
            active_clinic_id=1,
            google_subject_id="sub123",
            name="Clinic User"
        )

        result = require_authenticated(clinic_user)
        assert result == clinic_user

    def test_require_authenticated_system_admin(self):
        """Test requiring authenticated user with system admin."""
        system_admin = UserContext(
            user_type="system_admin",
            email="admin@example.com",
            roles=[],
            active_clinic_id=None,
            google_subject_id="sub456",
            name="System Admin"
        )

        result = require_authenticated(system_admin)
        assert result == system_admin

    def test_require_clinic_user_valid(self):
        """Test requiring clinic user with clinic user."""
        clinic_user = UserContext(
            user_type="clinic_user",
            email="user@example.com",
            roles=["admin"],
            active_clinic_id=1,
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
            active_clinic_id=None,
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
            active_clinic_id=1,
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
            active_clinic_id=1,
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
            active_clinic_id=1,
            google_subject_id="sub123",
            name="Clinic User",
            user_id=1
        )

        result = require_clinic_access(clinic_user, None)
        assert result == clinic_user
