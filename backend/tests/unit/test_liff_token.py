"""
Unit tests for LIFF token generation and validation utilities.
"""

import pytest
from sqlalchemy.orm import Session
from unittest.mock import Mock, patch

from models.clinic import Clinic
from utils.liff_token import generate_liff_access_token, validate_token_format


class TestTokenGeneration:
    """Tests for token generation with collision handling."""
    
    def test_generate_unique_token(self, db_session: Session):
        """Test that a unique token is generated."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        token = generate_liff_access_token(db_session, clinic.id)
        
        assert token is not None
        assert len(token) >= 32  # URL-safe encoding produces ~43 chars
        assert token.replace('-', '').replace('_', '').isalnum() or '_' in token or '-' in token
    
    def test_token_collision_handling(self, db_session: Session):
        """Test that token collisions are handled with retry logic."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Mock secrets.token_urlsafe to return same token first, then unique
        with patch('utils.liff_token.secrets.token_urlsafe') as mock_token:
            mock_token.side_effect = ['collision_token', 'unique_token']
            
            # Create a clinic with the collision token
            existing_clinic = Clinic(
                name="Existing Clinic",
                line_channel_id="existing_channel",
                line_channel_secret="existing_secret",
                line_channel_access_token="existing_token",
                liff_access_token='collision_token'
            )
            db_session.add(existing_clinic)
            db_session.commit()
            
            token = generate_liff_access_token(db_session, clinic.id)
            
            assert token == 'unique_token'
            assert mock_token.call_count == 2
    
    def test_token_generation_fails_after_max_attempts(self, db_session: Session):
        """Test that token generation raises error after max attempts."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Mock secrets.token_urlsafe to always return same token
        with patch('utils.liff_token.secrets.token_urlsafe', return_value='same_token'):
            # Create a clinic with the same token
            existing_clinic = Clinic(
                name="Existing Clinic",
                line_channel_id="existing_channel",
                line_channel_secret="existing_secret",
                line_channel_access_token="existing_token",
                liff_access_token='same_token'
            )
            db_session.add(existing_clinic)
            db_session.commit()
            
            with pytest.raises(RuntimeError, match="Failed to generate unique token"):
                generate_liff_access_token(db_session, clinic.id)


class TestTokenValidation:
    """Tests for token format validation."""
    
    def test_validate_valid_token(self):
        """Test validation of valid token format."""
        valid_tokens = [
            "AbCdEf123456789012345678901234567890",  # 40 chars
            "a" * 32,  # Minimum length
            "A-Za-z0-9_-" * 5,  # All allowed characters
        ]
        
        for token in valid_tokens:
            assert validate_token_format(token) is True
    
    def test_validate_invalid_token(self):
        """Test validation rejects invalid token formats."""
        invalid_tokens = [
            "short",  # Too short
            "token with spaces",  # Contains spaces
            "token@with#special",  # Contains invalid special chars
            "",  # Empty
            "token.with.dots",  # Contains dots
        ]
        
        for token in invalid_tokens:
            assert validate_token_format(token) is False

