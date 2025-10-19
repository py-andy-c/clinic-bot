"""
Unit tests for configuration constants.
"""

import pytest
import os
from src.core.config import (
    DATABASE_URL, API_BASE_URL, OPENAI_API_KEY, LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    JWT_SECRET_KEY, JWT_ALGORITHM, JWT_EXPIRATION_HOURS, ENVIRONMENT
)


class TestConfigConstants:
    """Test cases for configuration constants."""

    def test_default_values(self):
        """Test default configuration values."""
        # Test that constants have expected default values
        assert DATABASE_URL == "postgresql://user:password@localhost/clinic_bot"
        assert API_BASE_URL == "http://localhost:8000"
        assert OPENAI_API_KEY == ""
        assert LINE_CHANNEL_SECRET == ""
        assert LINE_CHANNEL_ACCESS_TOKEN == ""
        assert GOOGLE_CLIENT_ID == ""
        assert GOOGLE_CLIENT_SECRET == ""
        assert JWT_SECRET_KEY == "your-secret-key-here"
        assert JWT_ALGORITHM == "HS256"
        assert JWT_EXPIRATION_HOURS == 24
        assert ENVIRONMENT == "development"

    def test_environment_override(self):
        """Test that environment variables override defaults."""
        # Set environment variables
        os.environ["DATABASE_URL"] = "postgresql://test:test@localhost/test_db"
        os.environ["API_BASE_URL"] = "https://api.example.com"
        os.environ["ENVIRONMENT"] = "production"

        try:
            # Re-import to get updated values
            from importlib import reload
            import src.core.config
            reload(src.core.config)

            assert src.core.config.DATABASE_URL == "postgresql://test:test@localhost/test_db"
            assert src.core.config.API_BASE_URL == "https://api.example.com"
            assert src.core.config.ENVIRONMENT == "production"
        finally:
            # Clean up environment variables
            del os.environ["DATABASE_URL"]
            del os.environ["API_BASE_URL"]
            del os.environ["ENVIRONMENT"]

    def test_types_and_values(self):
        """Test that constants have correct types and sensible values."""
        # Test types
        assert isinstance(DATABASE_URL, str)
        assert isinstance(API_BASE_URL, str)
        assert isinstance(OPENAI_API_KEY, str)
        assert isinstance(ENVIRONMENT, str)
        assert isinstance(JWT_EXPIRATION_HOURS, int)

        # Test that required string fields are not None
        assert DATABASE_URL is not None
        assert API_BASE_URL is not None
        assert ENVIRONMENT is not None

        # JWT settings should have secure defaults
        assert len(JWT_SECRET_KEY) > 0
        assert JWT_ALGORITHM in ["HS256", "HS384", "HS512"]
        assert JWT_EXPIRATION_HOURS > 0
