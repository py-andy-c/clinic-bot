# pyright: reportUnknownMemberType=false, reportMissingTypeStubs=false
"""
LINE Messaging API service.

This module encapsulates all LINE Messaging API interactions including:
- Webhook signature verification for security
- Message parsing and extraction
- Text message sending to LINE users
"""

import hashlib
import hmac
import base64
import logging
from typing import Any, Optional, Tuple

from linebot.v3.messaging import MessagingApi, PushMessageRequest
from linebot.v3.messaging.models import TextMessage
from linebot.v3.messaging.api_client import ApiClient
from linebot.v3.messaging.configuration import Configuration
from linebot.v3.webhook import WebhookHandler


logger = logging.getLogger(__name__)


class LINEService:
    """
    Service for LINE Messaging API operations.

    This service handles all interactions with the LINE Messaging API,
    including webhook signature verification, message parsing, and sending responses.

    Attributes:
        channel_secret: LINE channel secret for signature verification
        channel_access_token: LINE channel access token for API calls
        api: LINE Bot API client instance
        handler: LINE webhook handler for signature verification
    """

    def __init__(self, channel_secret: str, channel_access_token: str) -> None:
        """
        Initialize LINE API clients.

        Args:
            channel_secret: LINE channel secret for signature verification
            channel_access_token: LINE channel access token for API calls

        Raises:
            ValueError: If either secret or token is empty
        """
        if not channel_secret or not channel_access_token:
            raise ValueError("Both channel_secret and channel_access_token are required")

        self.channel_secret = channel_secret
        self.channel_access_token = channel_access_token

        # Initialize LINE API clients
        config = Configuration(access_token=channel_access_token)
        api_client = ApiClient(configuration=config)
        self.api = MessagingApi(api_client=api_client)
        self.handler = WebhookHandler(channel_secret)

    def verify_signature(self, body: str, signature: str) -> bool:
        """
        Verify LINE webhook signature for security.

        LINE sends a signature in the X-Line-Signature header that must be verified
        to ensure the request is authentic and not tampered with.

        Args:
            body: Raw request body as UTF-8 string
            signature: X-Line-Signature header value

        Returns:
            True if signature is valid, False otherwise
        """
        try:
            # Create HMAC-SHA256 hash of the request body
            hash_digest = hmac.new(
                self.channel_secret.encode('utf-8'),
                body.encode('utf-8'),
                hashlib.sha256
            ).digest()

            # Base64 encode the hash
            expected_signature = base64.b64encode(hash_digest).decode('utf-8')

            # Compare with provided signature using constant-time comparison
            return hmac.compare_digest(signature, expected_signature)

        except Exception as e:
            # Log the error for debugging but don't expose details
            # This is an internal error (unexpected exception during verification)
            logger.exception(f"Signature verification error: {e}")
            return False

    def extract_message_data(self, payload: dict[str, Any]) -> Optional[Tuple[str, str]]:
        """
        Extract LINE user ID and message text from webhook payload.

        Parses the LINE webhook payload to extract the sender's LINE user ID
        and the text content of their message. Only processes text messages.

        Args:
            payload: Parsed JSON payload from LINE webhook

        Returns:
            Tuple of (line_user_id, message_text) for text messages,
            None for non-text messages or invalid payloads
        """
        try:
            # Check for events array
            if 'events' not in payload or not payload['events']:
                return None

            event = payload['events'][0]

            # Only handle text messages
            if (event.get('type') != 'message' or
                event.get('message', {}).get('type') != 'text'):
                return None

            line_user_id = event['source']['userId']
            message_text = event['message']['text']

            if not line_user_id or not message_text:
                return None

            return (line_user_id, message_text)

        except (KeyError, IndexError, TypeError) as e:
            # Invalid payload structure - could be external input issue or internal parsing bug
            logger.exception(f"Invalid LINE payload structure: {e}")
            return None

    def send_text_message(self, line_user_id: str, text: str) -> None:
        """
        Send text message to LINE user.

        Args:
            line_user_id: LINE user ID to send message to
            text: Text content to send

        Raises:
            Exception: If LINE API call fails
        """
        try:
            # Send push message to specific user
            request = PushMessageRequest(
                to=line_user_id,
                messages=[TextMessage(text=text, quickReply=None, quoteToken=None)],
                notificationDisabled=False,
                customAggregationUnits=None
            )
            self.api.push_message(request)
        except Exception as e:
            # Log the error but let caller handle it
            logger.exception(f"Failed to send LINE message to {line_user_id}: {e}")
            raise
