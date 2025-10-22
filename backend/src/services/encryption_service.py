"""
Encryption service for sensitive data storage.

Provides secure encryption/decryption for Google Calendar credentials
and other sensitive data using Fernet symmetric encryption.
"""

import json
import base64
from typing import Any, Dict
from cryptography.fernet import Fernet, InvalidToken

from core.config import ENCRYPTION_KEY


class EncryptionService:
    """Service for encrypting and decrypting sensitive data."""

    def __init__(self, key: str = ENCRYPTION_KEY):
        """Initialize with encryption key from environment.

        Expects a base64-encoded Fernet key (44 characters, 32 bytes when decoded).
        Generate with: python -c "import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
        """
        if not key:
            raise ValueError("ENCRYPTION_KEY environment variable must be set")

        # Validate Fernet key format (32 bytes base64 encoded = 44 characters)
        try:
            # Fernet keys must be 32 bytes when decoded
            decoded_key = base64.urlsafe_b64decode(key)
            if len(decoded_key) != 32:
                raise ValueError(f"Fernet key must be 32 bytes when decoded (44 base64 characters), got {len(decoded_key)} bytes")

            self._key = key.encode('utf-8')
            self._fernet = Fernet(self._key)
        except Exception as e:
            raise ValueError(f"Invalid Fernet key format. Expected base64-encoded 32-byte key: {e}")

    def encrypt_data(self, data: Dict[str, Any]) -> str:
        """Encrypt a dictionary of data.

        Args:
            data: Dictionary to encrypt

        Returns:
            Base64-encoded encrypted string

        Raises:
            ValueError: If data cannot be serialized or encrypted
        """
        try:
            json_str = json.dumps(data, ensure_ascii=False)
            encrypted = self._fernet.encrypt(json_str.encode('utf-8'))
            return encrypted.decode('utf-8')
        except (TypeError, ValueError) as e:
            raise ValueError(f"Failed to encrypt data: {e}")

    def decrypt_data(self, encrypted_data: str) -> Dict[str, Any]:
        """Decrypt an encrypted string back to a dictionary.

        Args:
            encrypted_data: Base64-encoded encrypted string

        Returns:
            Decrypted dictionary

        Raises:
            ValueError: If data cannot be decrypted or deserialized
        """
        try:
            decrypted = self._fernet.decrypt(encrypted_data.encode('utf-8'))
            json_str = decrypted.decode('utf-8')
            return json.loads(json_str)
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError(f"Failed to decrypt data: {e}")

    def encrypt_text(self, text: str) -> str:
        """Encrypt a plain text string.

        Args:
            text: Text to encrypt

        Returns:
            Base64-encoded encrypted string
        """
        try:
            encrypted = self._fernet.encrypt(text.encode('utf-8'))
            return encrypted.decode('utf-8')
        except Exception as e:
            raise ValueError(f"Failed to encrypt text: {e}")

    def decrypt_text(self, encrypted_text: str) -> str:
        """Decrypt an encrypted string back to plain text.

        Args:
            encrypted_text: Base64-encoded encrypted string

        Returns:
            Decrypted plain text
        """
        try:
            decrypted = self._fernet.decrypt(encrypted_text.encode('utf-8'))
            return decrypted.decode('utf-8')
        except (InvalidToken, UnicodeDecodeError) as e:
            raise ValueError(f"Failed to decrypt text: {e}")

    def is_encrypted_data_valid(self, encrypted_data: str) -> bool:
        """Check if encrypted data can be successfully decrypted.

        Args:
            encrypted_data: Base64-encoded encrypted string

        Returns:
            True if data can be decrypted, False otherwise
        """
        try:
            self.decrypt_data(encrypted_data)
            return True
        except ValueError:
            return False


# Global instance
try:
    encryption_service = EncryptionService()
except ValueError:
    # During testing or setup, the key might not be available yet
    # Create a placeholder that will be replaced when the real service is needed
    encryption_service = None


def get_encryption_service() -> EncryptionService:
    """Get the encryption service, initializing it if necessary."""
    global encryption_service
    if encryption_service is None:
        encryption_service = EncryptionService()
    return encryption_service
