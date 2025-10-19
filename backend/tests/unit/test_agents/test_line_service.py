"""
Unit tests for LINE service.
"""

import json
import pytest
from unittest.mock import Mock, patch, MagicMock

from services.line_service import LINEService
from linebot.exceptions import LineBotApiError


class TestLINEService:
    """Test LINE service functionality."""

    @pytest.fixture
    def line_service(self):
        """Create a LINE service instance for testing."""
        return LINEService(
            channel_secret="test_secret_123",
            channel_access_token="test_token_456"
        )

    def test_init_valid(self):
        """Test LINE service initialization with valid parameters."""
        service = LINEService("secret", "token")
        assert service.channel_secret == "secret"
        assert service.channel_access_token == "token"
        assert service.api is not None
        assert service.handler is not None

    def test_init_empty_parameters(self):
        """Test LINE service initialization with empty parameters."""
        with pytest.raises(ValueError, match="Both channel_secret and channel_access_token are required"):
            LINEService("", "token")

        with pytest.raises(ValueError, match="Both channel_secret and channel_access_token are required"):
            LINEService("secret", "")

    def test_verify_signature_valid(self, line_service):
        """Test signature verification with valid signature."""
        # Create a test message and signature
        body = '{"test": "data"}'
        # Compute the expected signature manually for testing
        import hmac
        import hashlib
        import base64
        hash_digest = hmac.new(
            line_service.channel_secret.encode('utf-8'),
            body.encode('utf-8'),
            hashlib.sha256
        ).digest()
        signature = base64.b64encode(hash_digest).decode('utf-8')

        result = line_service.verify_signature(body, signature)
        assert result is True

    def test_verify_signature_invalid(self, line_service):
        """Test signature verification with invalid signature."""
        body = '{"test": "data"}'
        signature = "invalid_signature"

        result = line_service.verify_signature(body, signature)
        assert result is False

    def test_verify_signature_error_handling(self, line_service):
        """Test signature verification error handling."""
        # Test with None inputs that would cause encoding errors
        result = line_service.verify_signature(None, "signature")
        assert result is False

    def test_extract_message_data_text_message(self, line_service):
        """Test extracting message data from text message webhook."""
        payload = {
            "events": [{
                "type": "message",
                "message": {
                    "type": "text",
                    "text": "Hello world"
                },
                "source": {
                    "userId": "user123"
                }
            }]
        }

        result = line_service.extract_message_data(payload)
        assert result == ("user123", "Hello world")

    def test_extract_message_data_non_text_message(self, line_service):
        """Test extracting message data from non-text message webhook."""
        payload = {
            "events": [{
                "type": "message",
                "message": {
                    "type": "image",
                    "id": "image123"
                },
                "source": {
                    "userId": "user123"
                }
            }]
        }

        result = line_service.extract_message_data(payload)
        assert result is None

    def test_extract_message_data_non_message_event(self, line_service):
        """Test extracting message data from non-message event."""
        payload = {
            "events": [{
                "type": "follow",
                "source": {
                    "userId": "user123"
                }
            }]
        }

        result = line_service.extract_message_data(payload)
        assert result is None

    def test_extract_message_data_empty_events(self, line_service):
        """Test extracting message data from payload with no events."""
        payload = {"events": []}
        result = line_service.extract_message_data(payload)
        assert result is None

    def test_extract_message_data_invalid_structure(self, line_service):
        """Test extracting message data from malformed payload."""
        # Missing events key
        payload = {}
        result = line_service.extract_message_data(payload)
        assert result is None

        # Missing message key
        payload = {
            "events": [{
                "type": "message",
                "source": {"userId": "user123"}
            }]
        }
        result = line_service.extract_message_data(payload)
        assert result is None

    @patch('services.line_service.LineBotApi')
    @pytest.mark.asyncio
    async def test_send_text_message_success(self, mock_line_api_class, line_service):
        """Test successful text message sending."""
        # Mock the LineBotApi instance
        mock_api = Mock()
        mock_line_api_class.return_value = mock_api

        # Create new service instance to use the mocked API
        service = LINEService("secret", "token")

        # Send message
        await service.send_text_message("user123", "Hello world")

        # Verify the API was called correctly
        mock_api.push_message.assert_called_once()
        call_args = mock_api.push_message.call_args
        assert call_args[0][0] == "user123"  # user_id
        # Check that the message is a TextSendMessage with the right text
        message = call_args[0][1]
        assert hasattr(message, 'text')
        assert message.text == "Hello world"

    @patch('services.line_service.LineBotApi')
    @pytest.mark.asyncio
    async def test_send_text_message_api_error(self, mock_line_api_class, line_service):
        """Test text message sending with API error."""
        from linebot.models.error import Error

        # Mock the LineBotApi to raise an error
        mock_api = Mock()
        error_obj = Error(message="Bad Request")
        mock_api.push_message.side_effect = LineBotApiError(400, {}, error=error_obj)
        mock_line_api_class.return_value = mock_api

        # Create new service instance to use the mocked API
        service = LINEService("secret", "token")

        # Send message and expect exception
        with pytest.raises(LineBotApiError):
            await service.send_text_message("user123", "Hello world")

    @patch('services.line_service.LineBotApi')
    @pytest.mark.asyncio
    async def test_send_text_message_unexpected_error(self, mock_line_api_class, line_service):
        """Test text message sending with unexpected error."""
        # Mock the LineBotApi to raise an unexpected error
        mock_api = Mock()
        mock_api.push_message.side_effect = Exception("Unexpected error")
        mock_line_api_class.return_value = mock_api

        # Create new service instance to use the mocked API
        service = LINEService("secret", "token")

        # Send message and expect exception
        with pytest.raises(Exception, match="Unexpected error"):
            await service.send_text_message("user123", "Hello world")

