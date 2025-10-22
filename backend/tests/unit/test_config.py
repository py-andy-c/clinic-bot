"""
Unit tests for configuration constants.
"""

import pytest
import os
from core.config import (
    DATABASE_URL, API_BASE_URL, OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
)


class TestConfigConstants:
    """Test cases for configuration constants."""

    def test_default_values(self):
        """Test default configuration values."""
        # Test that constants have expected default values (may be overridden in test env)
        assert API_BASE_URL == "http://localhost:8000"
        assert OPENAI_API_KEY == ""
        assert GOOGLE_CLIENT_ID == ""
        assert GOOGLE_CLIENT_SECRET == ""
        # DATABASE_URL may be overridden in test environment
        assert DATABASE_URL is not None and DATABASE_URL.startswith(("postgresql://", "sqlite://"))

    def test_environment_override(self):
        """Test that environment variables override defaults."""
        # Set environment variables
        os.environ["DATABASE_URL"] = "postgresql://test:test@localhost/test_db"
        os.environ["API_BASE_URL"] = "https://api.example.com"

        try:
            # Re-import to get updated values
            from importlib import reload
            import core.config
            reload(core.config)

            assert core.config.DATABASE_URL == "postgresql://test:test@localhost/test_db"
            assert core.config.API_BASE_URL == "https://api.example.com"
        finally:
            # Clean up environment variables
            del os.environ["DATABASE_URL"]
            del os.environ["API_BASE_URL"]

    def test_types_and_values(self):
        """Test that constants have correct types and sensible values."""
        # Test types
        assert isinstance(DATABASE_URL, str)
        assert isinstance(API_BASE_URL, str)
        assert isinstance(OPENAI_API_KEY, str)

        # Test that required string fields are not None
        assert DATABASE_URL is not None
        assert API_BASE_URL is not None
