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

import httpx
from linebot.v3.messaging import MessagingApi, PushMessageRequest, ReplyMessageRequest
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

    def extract_message_data(self, payload: dict[str, Any]) -> Optional[Tuple[str, str, Optional[str]]]:
        """
        Extract LINE user ID, message text, and reply token from webhook payload.

        Parses the LINE webhook payload to extract the sender's LINE user ID,
        the text content of their message, and the reply token (if available).
        Only processes text messages.

        Args:
            payload: Parsed JSON payload from LINE webhook

        Returns:
            Tuple of (line_user_id, message_text, reply_token) for text messages,
            None for non-text messages or invalid payloads.
            reply_token may be None if not available in the event.
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
            # Extract reply_token if available (may not be present in all events)
            reply_token = event.get('replyToken')

            if not line_user_id or not message_text:
                return None

            return (line_user_id, message_text, reply_token)

        except (KeyError, IndexError, TypeError) as e:
            # Invalid payload structure - could be external input issue or internal parsing bug
            logger.exception(f"Invalid LINE payload structure: {e}")
            return None

    def send_text_message(self, line_user_id: str, text: str, reply_token: Optional[str] = None) -> None:
        """
        Send text message to LINE user.

        Uses reply_message when reply_token is available (for responding to webhook events),
        otherwise falls back to push_message (for proactive messages like notifications).

        Args:
            line_user_id: LINE user ID to send message to
            text: Text content to send
            reply_token: Optional reply token from webhook event. If provided, uses reply_message.
                        If None, uses push_message as fallback.

        Raises:
            Exception: If LINE API call fails
        """
        try:
            messages = [TextMessage(text=text, quickReply=None, quoteToken=None)]
            
            if reply_token:
                # Use reply_message for responding to webhook events
                # This is more efficient and provides better UX for conversational responses
                request = ReplyMessageRequest(
                    replyToken=reply_token,
                    messages=messages,
                    notificationDisabled=False
                )
                self.api.reply_message(request)
                logger.debug(f"Sent reply message using reply_token for user {line_user_id[:10]}...")
            else:
                # Fall back to push_message for proactive messages (notifications, reminders, etc.)
                request = PushMessageRequest(
                    to=line_user_id,
                    messages=messages,
                    notificationDisabled=False,
                    customAggregationUnits=None
                )
                self.api.push_message(request)
                logger.debug(f"Sent push message for user {line_user_id[:10]}...")
        except Exception as e:
            # Log the error but let caller handle it
            logger.exception(f"Failed to send LINE message to {line_user_id}: {e}")
            raise

    def start_loading_animation(self, line_user_id: str, loading_seconds: int = 60) -> bool:
        """
        Display loading animation (typing indicator) to LINE user.

        Shows a loading animation in the chat to indicate that a response is being prepared.
        The animation automatically stops when a message is sent to the user.

        Args:
            line_user_id: LINE user ID (chatId) to show loading animation to
            loading_seconds: Duration in seconds (must be multiple of 5, max 60)

        Returns:
            True if successful, False otherwise

        Note:
            - Animation only shows in one-on-one chats
            - Animation only shows when user is viewing the chat screen
            - Animation automatically stops when a message is sent
            - If loading_seconds is not a multiple of 5, it will be rounded down
        """
        try:
            # Ensure loading_seconds is a multiple of 5 and within valid range
            loading_seconds = max(5, min(60, (loading_seconds // 5) * 5))
            
            response = httpx.post(
                "https://api.line.me/v2/bot/chat/loading/start",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.channel_access_token}"
                },
                json={
                    "chatId": line_user_id,
                    "loadingSeconds": loading_seconds
                },
                timeout=10.0
            )
            response.raise_for_status()
            logger.debug(f"Started loading animation for user {line_user_id[:10]}...")
            return True
        except httpx.HTTPStatusError as e:
            # Don't log as error - loading animation is optional and may fail silently
            # (e.g., if user is not viewing chat screen)
            logger.debug(
                f"Could not start loading animation for {line_user_id[:10]}...: "
                f"{e.response.status_code} - {e.response.text}"
            )
            return False
        except Exception as e:
            # Log but don't fail - loading animation is a nice-to-have feature
            logger.debug(f"Failed to start loading animation: {e}")
            return False

    def get_bot_info(self) -> Optional[str]:
        """
        Get bot information including user ID from LINE API.

        Calls LINE Messaging API to get bot information, including the bot's
        user ID (official account user ID) which appears in webhook payloads.

        Returns:
            Bot's user ID (official account user ID) if successful, None otherwise

        Raises:
            Exception: If LINE API call fails
        """
        try:
            response = httpx.get(
                "https://api.line.me/v2/bot/info",
                headers={"Authorization": f"Bearer {self.channel_access_token}"},
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
            bot_user_id = data.get("userId")
            
            if bot_user_id:
                logger.info(f"Successfully retrieved bot user ID: {bot_user_id[:10]}...")
            else:
                logger.warning("Bot info response missing userId field")
            
            return bot_user_id
        except httpx.HTTPStatusError as e:
            logger.error(
                f"LINE API error getting bot info: {e.response.status_code} - {e.response.text}"
            )
            return None
        except Exception as e:
            logger.exception(f"Failed to get bot info from LINE API: {e}")
            return None
