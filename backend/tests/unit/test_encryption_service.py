"""
Tests for encryption service functionality.
"""

import pytest
from unittest.mock import patch

from services.encryption_service import EncryptionService

# Use a valid Fernet key for testing
VALID_FERNET_KEY = "YyD8O45QlfRZUXT9kzjW3xEf6iNqz5EtF_OB8WEOBqw="  # 32 bytes base64 encoded


class TestEncryptionService:
    """Test encryption/decryption functionality."""

    @pytest.fixture
    def encryption_service(self):
        """Create encryption service with valid test key."""
        return EncryptionService(VALID_FERNET_KEY)

    def test_encrypt_data_dict(self, encryption_service):
        """Test encrypting a dictionary."""
        data = {
            "access_token": "test_token",
            "refresh_token": "refresh_token",
            "expires_in": 3600
        }

        encrypted = encryption_service.encrypt_data(data)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0
        assert encrypted != str(data)

    def test_decrypt_data_dict(self, encryption_service):
        """Test decrypting a dictionary."""
        original_data = {
            "access_token": "test_token",
            "refresh_token": "refresh_token",
            "expires_in": 3600,
            "user_email": "test@example.com"
        }

        encrypted = encryption_service.encrypt_data(original_data)
        decrypted = encryption_service.decrypt_data(encrypted)

        assert decrypted == original_data

    def test_encrypt_text(self, encryption_service):
        """Test encrypting plain text."""
        text = "sensitive information"
        encrypted = encryption_service.encrypt_text(text)

        assert isinstance(encrypted, str)
        assert len(encrypted) > 0
        assert encrypted != text

    def test_decrypt_text(self, encryption_service):
        """Test decrypting plain text."""
        original_text = "sensitive information"
        encrypted = encryption_service.encrypt_text(original_text)
        decrypted = encryption_service.decrypt_text(encrypted)

        assert decrypted == original_text

    def test_encrypt_decrypt_complex_data(self, encryption_service):
        """Test encrypting/decrypting complex nested data."""
        complex_data = {
            "tokens": {
                "access": "access_token_here",
                "refresh": "refresh_token_here"
            },
            "metadata": {
                "email": "user@example.com",
                "scopes": ["calendar", "profile"],
                "expiry": 1640995200
            },
            "flags": [True, False, None]
        }

        encrypted = encryption_service.encrypt_data(complex_data)
        decrypted = encryption_service.decrypt_data(encrypted)

        assert decrypted == complex_data

    def test_decrypt_invalid_data(self, encryption_service):
        """Test decrypting invalid encrypted data."""
        with pytest.raises(ValueError):
            encryption_service.decrypt_data("invalid_encrypted_data")

    def test_decrypt_invalid_text(self, encryption_service):
        """Test decrypting invalid encrypted text."""
        with pytest.raises(ValueError):
            encryption_service.decrypt_text("invalid_encrypted_text")

    def test_encrypt_invalid_data_type(self, encryption_service):
        """Test encrypting invalid data types."""
        with pytest.raises(ValueError):
            # Try to encrypt something that can't be JSON serialized
            encryption_service.encrypt_data(set([1, 2, 3]))

    def test_is_encrypted_data_valid_true(self, encryption_service):
        """Test checking if valid encrypted data is valid."""
        data = {"test": "data"}
        encrypted = encryption_service.encrypt_data(data)
        result = encryption_service.is_encrypted_data_valid(encrypted)
        assert result is True

    def test_is_encrypted_data_valid_false(self, encryption_service):
        """Test checking if invalid encrypted data is valid."""
        result = encryption_service.is_encrypted_data_valid("invalid_data")
        assert result is False

    def test_initialization_without_key(self):
        """Test that service raises error when encryption key is not set."""
        with pytest.raises(ValueError, match="ENCRYPTION_KEY environment variable must be set"):
            from services.encryption_service import EncryptionService
            EncryptionService('')

    def test_initialization_with_invalid_key(self):
        """Test that service rejects invalid Fernet keys."""
        from services.encryption_service import EncryptionService
        with pytest.raises(ValueError, match="Invalid Fernet key format"):
            EncryptionService('short')
