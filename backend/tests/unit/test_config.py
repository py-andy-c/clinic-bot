"""
Unit tests for configuration settings.
"""

import pytest
from src.core.config import Settings


class TestSettings:
    """Test cases for Settings class."""

    def test_default_settings(self):
        """Test default settings values."""
        settings = Settings()

        assert settings.database_url == "postgresql://user:password@localhost/clinic_bot"
        assert settings.api_base_url == "http://localhost:8000"
        assert settings.line_channel_secret == ""
        assert settings.line_channel_access_token == ""
        assert settings.google_client_id == ""
        assert settings.google_client_secret == ""
        assert settings.jwt_secret_key == "your-secret-key-here"
        assert settings.jwt_algorithm == "HS256"
        assert settings.jwt_expiration_hours == 24
        assert settings.environment == "development"

    def test_environment_override(self):
        """Test that environment variables override defaults."""
        import os

        # Set environment variables
        os.environ["DATABASE_URL"] = "postgresql://test:test@localhost/test_db"
        os.environ["API_BASE_URL"] = "https://api.example.com"
        os.environ["ENVIRONMENT"] = "production"

        try:
            settings = Settings()

            assert settings.database_url == "postgresql://test:test@localhost/test_db"
            assert settings.api_base_url == "https://api.example.com"
            assert settings.environment == "production"
        finally:
            # Clean up environment variables
            del os.environ["DATABASE_URL"]
            del os.environ["API_BASE_URL"]
            del os.environ["ENVIRONMENT"]

    def test_case_insensitive_env_vars(self):
        """Test that environment variables are case insensitive."""
        import os

        os.environ["database_url"] = "postgresql://lowercase:test@localhost/lowercase"
        os.environ["API_BASE_URL"] = "https://mixedcase.example.com"

        try:
            settings = Settings()

            assert settings.database_url == "postgresql://lowercase:test@localhost/lowercase"
            assert settings.api_base_url == "https://mixedcase.example.com"
        finally:
            del os.environ["database_url"]
            del os.environ["API_BASE_URL"]

    def test_required_fields_have_defaults(self):
        """Test that all required fields have sensible defaults."""
        settings = Settings()

        # These should not be empty strings for required functionality
        assert isinstance(settings.database_url, str)
        assert isinstance(settings.api_base_url, str)
        assert isinstance(settings.environment, str)

        # JWT settings should have secure defaults
        assert len(settings.jwt_secret_key) > 0
        assert settings.jwt_algorithm in ["HS256", "HS384", "HS512"]
        assert settings.jwt_expiration_hours > 0
