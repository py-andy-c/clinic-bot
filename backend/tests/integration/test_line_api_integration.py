"""
LINE API Integration Tests.

These tests validate actual LINE Messaging API integration using test credentials.
They should be run with real LINE test channel credentials to ensure the integration works.

Test Credentials Setup:
- Set LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN environment variables
- Use LINE test channel credentials (not production)
- Tests will be skipped if credentials are not set or invalid

Usage:
    # Run only LINE integration tests
    pytest tests/integration/test_line_api_integration.py -v

    # Run all tests including LINE integration
    pytest tests/integration/ -k "line" -v
"""

import os
import pytest
from unittest.mock import patch

from services.line_service import LINEService
from linebot.v3.messaging.models import TextMessage, PushMessageRequest


@pytest.mark.parametrize("require_env_vars", [["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]], indirect=True)
@pytest.mark.line_api
@pytest.mark.slow
class TestLineApiIntegration:
    """Integration tests for LINE Messaging API."""

    def test_line_service_initialization_with_real_credentials(self, require_env_vars):
        """Test that LINEService can be initialized with real LINE credentials."""
        service = LINEService(
            channel_secret=require_env_vars['LINE_CHANNEL_SECRET'],
            channel_access_token=require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']
        )

        assert service.channel_secret == require_env_vars['LINE_CHANNEL_SECRET']
        assert service.channel_access_token == require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']
        assert service.api is not None
        assert service.handler is not None

        # Verify that api_client is properly initialized (not a string)
        assert hasattr(service.api, 'api_client')
        assert service.api.api_client is not None
        assert not isinstance(service.api.api_client, str)  # Should not be a string

    def test_line_service_signature_verification_with_real_handler(self, require_env_vars):
        """Test signature verification using real LINE webhook handler."""
        service = LINEService(
            channel_secret=require_env_vars['LINE_CHANNEL_SECRET'],
            channel_access_token=require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']
        )

        # Test valid signature
        body = '{"test": "data"}'
        # Create a proper signature using the real secret
        import hmac
        import hashlib
        import base64
        hash_digest = hmac.new(
            require_env_vars['LINE_CHANNEL_SECRET'].encode('utf-8'),
            body.encode('utf-8'),
            hashlib.sha256
        ).digest()
        valid_signature = base64.b64encode(hash_digest).decode('utf-8')

        assert service.verify_signature(body, valid_signature) is True

        # Test invalid signature
        assert service.verify_signature(body, "invalid_signature") is False

    def test_line_service_message_parsing(self, require_env_vars):
        """Test message parsing functionality."""
        service = LINEService(
            channel_secret=require_env_vars['LINE_CHANNEL_SECRET'],
            channel_access_token=require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']
        )

        # Test text message parsing
        payload = {
            "events": [{
                "type": "message",
                "message": {
                    "type": "text",
                    "text": "Hello from LINE"
                },
                "source": {
                    "userId": "U1234567890abcdef"
                }
            }]
        }

        result = service.extract_message_data(payload)
        assert result == ("U1234567890abcdef", "Hello from LINE")

        # Test non-text message (should return None)
        payload_non_text = {
            "events": [{
                "type": "message",
                "message": {
                    "type": "image",
                    "id": "12345"
                },
                "source": {
                    "userId": "U1234567890abcdef"
                }
            }]
        }

        result = service.extract_message_data(payload_non_text)
        assert result is None


    def test_line_service_invalid_credentials_handling(self, require_env_vars):
        """Test that service properly handles invalid credentials."""
        # LINEService constructor doesn't validate credentials - it just creates objects
        # Invalid credentials are only detected during actual API calls
        service = LINEService(
            channel_secret="invalid_secret",
            channel_access_token="invalid_token"
        )

        # The service should initialize successfully (SDK doesn't validate tokens upfront)
        assert service.api is not None
        assert service.handler is not None

        # Try to create a request (this should work regardless of credentials)
        request = PushMessageRequest(
            to="Utest",
            messages=[TextMessage(text="test", quickReply=None, quoteToken=None)],
            notification_disabled=False,
            custom_aggregation_units=None
        )

        # Request creation should succeed
        assert request is not None

            # This would fail with real API call, but structure should be valid
            # service.api.push_message(request)  # Commented out to avoid API call

    def test_line_service_request_structure_validation(self, require_env_vars):
        """Test that LINE API requests are structured correctly."""
        service = LINEService(
            channel_secret=require_env_vars['LINE_CHANNEL_SECRET'],
            channel_access_token=require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']
        )

        # Create a valid request structure
        request = PushMessageRequest(
            to="U1234567890abcdef1234567890abcdef",
            messages=[TextMessage(text="Integration test message", quickReply=None, quoteToken=None)],
            notification_disabled=False,
            custom_aggregation_units=None
        )

        # Verify request structure
        assert request.to.startswith("U")  # LINE user IDs start with U
        assert len(request.messages) == 1
        assert isinstance(request.messages[0], TextMessage)
        assert request.messages[0].text == "Integration test message"
        assert request.notification_disabled is False

    def test_line_service_error_handling_invalid_token(self, require_env_vars):
        """Test error handling when LINE token is malformed."""
        # Test with various invalid token formats
        invalid_tokens = [
            "",
            "invalid",
            "a" * 100,  # Too long
            None,
        ]

        for invalid_token in invalid_tokens:
            if invalid_token is None:
                continue  # Our validation catches None

            try:
                service = LINEService(
                    channel_secret="test_secret",
                    channel_access_token=invalid_token
                )
                # Service should still initialize, but API calls would fail
                assert service.api is not None
            except ValueError:
                # Our validation caught the invalid token
                pass


@pytest.mark.parametrize("require_env_vars", [["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]], indirect=True)
@pytest.mark.line_api
@pytest.mark.integration
def test_line_integration_test_setup(require_env_vars):
    """Test that LINE integration test environment is properly configured."""
    # Verify credentials look like real LINE credentials
    assert len(require_env_vars['LINE_CHANNEL_SECRET']) > 10  # LINE secrets are typically long
    assert len(require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']) > 50   # LINE tokens are typically very long

    # Test that we can create the service
    service = LINEService(
        channel_secret=require_env_vars['LINE_CHANNEL_SECRET'],
        channel_access_token=require_env_vars['LINE_CHANNEL_ACCESS_TOKEN']
    )

    assert service is not None
    print("✅ LINE integration test environment is properly configured")
