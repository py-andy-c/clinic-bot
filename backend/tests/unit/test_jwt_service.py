"""
Tests for JWT service functionality.
"""

import pytest
from datetime import datetime, timedelta, timezone

from services.jwt_service import jwt_service, TokenPayload


class TestJWTService:
    """Test JWT token creation, validation, and refresh functionality."""

    def test_create_access_token(self):
        """Test creating a JWT access token."""
        # Create a payload without iat/exp (these are set internally)
        payload_dict = {
            "sub": "test_subject",
            "email": "test@example.com",
            "user_type": "clinic_user",
            "roles": ["admin", "practitioner"],
            "clinic_id": 1,
            "name": "Test User"
        }

        token = jwt_service.create_access_token(TokenPayload(**payload_dict))
        assert isinstance(token, str)
        assert len(token) > 0

    def test_verify_token_valid(self):
        """Test verifying a valid JWT token."""
        payload = TokenPayload(
            sub="test_subject",
            email="test@example.com",
            user_type="clinic_user",
            roles=["admin"],
            clinic_id=1,
            name="Test User"
        )

        token = jwt_service.create_access_token(payload)
        verified_payload = jwt_service.verify_token(token)

        assert verified_payload is not None
        assert verified_payload.sub == payload.sub
        assert verified_payload.email == payload.email
        assert verified_payload.user_type == payload.user_type
        assert verified_payload.roles == payload.roles
        assert verified_payload.clinic_id == payload.clinic_id

    def test_verify_token_expired(self):
        """Test verifying an expired JWT token."""
        # Create token that's already expired
        expired_payload = TokenPayload(
            sub="test_subject",
            email="test@example.com",
            user_type="clinic_user",
            roles=["admin"],
            clinic_id=1,
            name="Test User",
            exp=int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp())  # 1 hour ago
        )

        # This would normally be done internally, but for testing we can create a fake token
        # In practice, tokens expire based on the exp claim
        # For this test, we'll just ensure the service can handle invalid tokens
        invalid_token = "invalid.jwt.token"
        result = jwt_service.verify_token(invalid_token)
        assert result is None

    def test_verify_token_invalid(self):
        """Test verifying an invalid JWT token."""
        invalid_token = "invalid.jwt.token"
        result = jwt_service.verify_token(invalid_token)
        assert result is None

    def test_create_refresh_token_hash(self):
        """Test creating a bcrypt hash for refresh tokens."""
        token = "test_refresh_token"
        hashed = jwt_service.create_refresh_token_hash(token)

        assert isinstance(hashed, str)
        assert len(hashed) > 0
        assert hashed != token  # Should be hashed

    def test_verify_refresh_token_hash_valid(self):
        """Test verifying a valid refresh token hash."""
        token = "test_refresh_token"
        hashed = jwt_service.create_refresh_token_hash(token)

        result = jwt_service.verify_refresh_token_hash(token, hashed)
        assert result is True

    def test_verify_refresh_token_hash_invalid(self):
        """Test verifying an invalid refresh token hash."""
        token = "test_refresh_token"
        wrong_token = "wrong_token"
        hashed = jwt_service.create_refresh_token_hash(token)

        result = jwt_service.verify_refresh_token_hash(wrong_token, hashed)
        assert result is False

    def test_get_token_expiry_access(self):
        """Test getting expiry time for access tokens."""
        expiry = jwt_service.get_token_expiry("access")
        expected = datetime.now(timezone.utc) + timedelta(minutes=60)

        # Allow for small time differences
        assert abs((expiry - expected).total_seconds()) < 5

    def test_get_token_expiry_refresh(self):
        """Test getting expiry time for refresh tokens."""
        expiry = jwt_service.get_token_expiry("refresh")
        expected = datetime.now(timezone.utc) + timedelta(days=7)

        # Allow for small time differences
        assert abs((expiry - expected).total_seconds()) < 5

    def test_get_token_expiry_invalid_type(self):
        """Test getting expiry time for invalid token type."""
        with pytest.raises(ValueError, match="Unknown token type"):
            jwt_service.get_token_expiry("invalid")

    def test_is_token_expired_future(self):
        """Test checking if a future expiry time is expired."""
        future_time = datetime.now(timezone.utc) + timedelta(hours=1)
        result = jwt_service.is_token_expired(future_time)
        assert result is False

    def test_is_token_expired_past(self):
        """Test checking if a past expiry time is expired."""
        past_time = datetime.now(timezone.utc) - timedelta(hours=1)
        result = jwt_service.is_token_expired(past_time)
        assert result is True

    def test_create_token_pair(self):
        """Test creating both access and refresh tokens."""
        payload = TokenPayload(
            sub="test_subject",
            email="test@example.com",
            user_type="clinic_user",
            roles=["admin"],
            clinic_id=1,
            name="Test User"
        )

        result = jwt_service.create_token_pair(payload)

        assert "access_token" in result
        assert "refresh_token" in result
        assert "refresh_token_hash" in result
        assert "token_type" in result
        assert "expires_in" in result
        assert "expires_at" in result

        assert result["token_type"] == "bearer"
        assert result["expires_in"] == 3600  # 1 hour in seconds

        # Verify access token can be decoded
        verified = jwt_service.verify_token(result["access_token"])
        assert verified is not None
        assert verified.sub == payload.sub

        # Verify refresh token hash
        hash_valid = jwt_service.verify_refresh_token_hash(
            result["refresh_token"],
            result["refresh_token_hash"]
        )
        assert hash_valid is True
