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
from typing import Any, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

import httpx
from linebot.v3.messaging import MessagingApi, PushMessageRequest, ReplyMessageRequest
from linebot.v3.messaging.models import (
    TextMessage,
    TemplateMessage,
    ButtonsTemplate,
    URIAction,
)
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

    def extract_event_data(self, payload: dict[str, Any]) -> Optional[Tuple[str, str, Optional[str]]]:
        """
        Extract event type, LINE user ID, and reply token from webhook payload.

        Parses the LINE webhook payload to extract event information for any event type
        (follow, unfollow, message, postback, etc.).

        Args:
            payload: Parsed JSON payload from LINE webhook

        Returns:
            Tuple of (event_type, line_user_id, reply_token) if valid event,
            None for invalid payloads.
            reply_token may be None if not available in the event.
        """
        try:
            # Check for events array
            if 'events' not in payload or not payload['events']:
                return None

            event = payload['events'][0]
            event_type = event.get('type')
            
            # Extract user ID from source
            source = event.get('source', {})
            line_user_id = source.get('userId')
            
            if not event_type or not line_user_id:
                return None
            
            # Extract reply_token if available (may not be present in all events)
            reply_token = event.get('replyToken')
            
            return (event_type, line_user_id, reply_token)

        except (KeyError, IndexError, TypeError) as e:
            # Invalid payload structure - could be external input issue or internal parsing bug
            logger.exception(f"Invalid LINE payload structure: {e}")
            return None

    def extract_message_data(self, payload: dict[str, Any]) -> Optional[Tuple[str, str, Optional[str], Optional[str], Optional[str]]]:
        """
        Extract LINE user ID, message text, reply token, message ID, and quoted message ID from webhook payload.

        Parses the LINE webhook payload to extract the sender's LINE user ID,
        the text content of their message, the reply token (if available),
        the message ID, and the quoted message ID (if the message quotes another).
        Only processes text messages.

        Args:
            payload: Parsed JSON payload from LINE webhook

        Returns:
            Tuple of (line_user_id, message_text, reply_token, message_id, quoted_message_id) for text messages,
            None for non-text messages or invalid payloads.
            reply_token, message_id, and quoted_message_id may be None if not available in the event.
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
            # Extract message ID (LINE's unique identifier for this message)
            message_id = event.get('message', {}).get('id')
            # Extract quoted message ID (if this message quotes another)
            quoted_message_id = event.get('message', {}).get('quotedMessageId')

            if not line_user_id or not message_text:
                return None

            return (line_user_id, message_text, reply_token, message_id, quoted_message_id)

        except (KeyError, IndexError, TypeError) as e:
            # Invalid payload structure - could be external input issue or internal parsing bug
            logger.exception(f"Invalid LINE payload structure: {e}")
            return None

    def get_user_profile(self, line_user_id: str) -> Optional[dict[str, Any]]:
        """
        Get user profile information from LINE API.

        Retrieves the user's display name and profile picture URL.
        Can only be called for users who have added the official account as a friend.

        Args:
            line_user_id: LINE user ID to get profile for

        Returns:
            Dict with user profile information (displayName, userId, pictureUrl, statusMessage),
            None if API call fails or user not found.
        """
        try:
            response = httpx.get(
                f"https://api.line.me/v2/bot/profile/{line_user_id}",
                headers={"Authorization": f"Bearer {self.channel_access_token}"},
                timeout=10.0
            )
            response.raise_for_status()
            profile = response.json()
            logger.debug(f"Successfully retrieved profile for user {line_user_id[:10]}...")
            return profile
        except httpx.HTTPStatusError as e:
            # Don't log as error - user might not have added account or profile might be private
            logger.debug(
                f"Could not get profile for {line_user_id[:10]}...: "
                f"{e.response.status_code} - {e.response.text}"
            )
            return None
        except Exception as e:
            logger.warning(f"Failed to get user profile for {line_user_id[:10]}...: {e}")
            return None

    def send_text_message(
        self, 
        line_user_id: str, 
        text: str, 
        reply_token: Optional[str] = None,
        db: Optional["Session"] = None,
        clinic_id: Optional[int] = None,
        labels: Optional[dict[str, str]] = None
    ) -> Optional[str]:
        """
        Send text message to LINE user.

        Uses reply_message when reply_token is available (for responding to webhook events),
        otherwise falls back to push_message (for proactive messages like notifications).

        Args:
            line_user_id: LINE user ID to send message to
            text: Text content to send
            reply_token: Optional reply token from webhook event. If provided, uses reply_message.
                        If None, uses push_message as fallback.
            db: Optional database session for tracking push messages. Required if labels provided.
            clinic_id: Optional clinic ID for tracking push messages. Required if labels provided.
            labels: Optional labels dictionary for tracking push messages. Should contain:
                    - 'recipient_type': 'patient', 'practitioner', or 'admin'
                    - 'event_type': Event type code (e.g., 'appointment_confirmation')
                    - 'trigger_source': 'clinic_triggered', 'patient_triggered', or 'system_triggered'
                    - Additional flexible labels can be included

        Returns:
            LINE message ID if successful, None otherwise. The message ID can be used
            to track the message for quoted message functionality.

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
                response = self.api.reply_message(request)
                logger.debug(f"Sent reply message using reply_token for user {line_user_id[:10]}...")
            else:
                # Fall back to push_message for proactive messages (notifications, reminders, etc.)
                request = PushMessageRequest(
                    to=line_user_id,
                    messages=messages,
                    notificationDisabled=False,
                    customAggregationUnits=None
                )
                response = self.api.push_message(request)
                logger.debug(f"Sent push message for user {line_user_id[:10]}...")
            
            # Extract message ID from response
            # LINE API returns message IDs in the response
            # Both ReplyMessageResponse and PushMessageResponse use sent_messages (snake_case)
            # which contains SentMessage objects with 'id' field
            message_id: Optional[str] = None
            try:
                if hasattr(response, 'sent_messages') and response.sent_messages:
                    # Both reply_message and push_message use sent_messages
                    # Type ignore: LINE SDK response types don't expose sent_messages in type hints
                    sent_messages_list = response.sent_messages  # type: ignore
                    if sent_messages_list and len(sent_messages_list) > 0:  # type: ignore
                        sent_msg = sent_messages_list[0]  # type: ignore
                        message_id = getattr(sent_msg, 'id', None)  # type: ignore
            except (AttributeError, IndexError, TypeError) as e:
                # If we can't extract message ID, log but don't fail
                logger.debug(f"Could not extract message ID from LINE API response: {e}")
                message_id = None
            
            # Track push message only if:
            # 1. This is a push message (reply_token is None)
            # 2. LINE API call succeeded (we got here without exception)
            # 3. Labels are provided (indicating we should track this message)
            # 4. Database session and clinic_id are provided
            if reply_token is None and labels and db is not None and clinic_id is not None:
                try:
                    from models.line_push_message import LinePushMessage
                    
                    push_message = LinePushMessage(
                        line_user_id=line_user_id,
                        clinic_id=clinic_id,
                        line_message_id=message_id,
                        recipient_type=labels.get('recipient_type', ''),
                        event_type=labels.get('event_type', ''),
                        trigger_source=labels.get('trigger_source', ''),
                        labels=labels  # Store all labels including flexible ones
                    )
                    db.add(push_message)
                    db.commit()
                    logger.debug(
                        f"Tracked push message: line_user_id={line_user_id[:10]}..., "
                        f"event_type={labels.get('event_type')}, clinic_id={clinic_id}"
                    )
                except Exception as e:
                    # Log but don't fail - tracking is best effort
                    # If tracking fails, the message was still sent successfully
                    db.rollback()
                    logger.warning(
                        f"Failed to track push message for {line_user_id[:10]}...: {e}. "
                        f"Message was sent successfully but not tracked."
                    )
            
            return message_id
        except Exception as e:
            # Log the error but let caller handle it
            logger.exception(f"Failed to send LINE message to {line_user_id}: {e}")
            raise

    def send_template_message_with_button(
        self,
        line_user_id: str,
        text: str,
        button_label: str,
        button_uri: str,
        reply_token: Optional[str] = None
    ) -> Optional[str]:
        """
        Send template message with a button action to LINE user.
        
        This allows hiding URLs behind buttons instead of showing them in the message text.
        
        Args:
            line_user_id: LINE user ID to send message to
            text: Text content to send
            button_label: Label for the action button
            button_uri: URI to open when button is clicked
            reply_token: Optional reply token from webhook event. If provided, uses reply_message.
                        If None, uses push_message as fallback.
        
        Returns:
            LINE message ID if successful, None otherwise.
        
        Raises:
            Exception: If LINE API call fails
        """
        try:
            # Create URI action for the button
            # Type ignore: altUri is optional parameter
            uri_action = URIAction(label=button_label, uri=button_uri)  # type: ignore[call-arg]
            
            # Create buttons template
            # Type ignore: thumbnailImageUrl, imageAspectRatio, imageSize, imageBackgroundColor, defaultAction are optional
            buttons_template = ButtonsTemplate(
                text=text,
                actions=[uri_action]
            )  # type: ignore[call-arg]
            
            # Create template message
            # Alt text for accessibility (max 400 chars)
            # If text is minimal (like a space), use button label as alt text
            alt_text = text.strip() if text.strip() else button_label
            alt_text = alt_text[:400]  # Ensure within limit
            
            # Type ignore: quickReply is optional parameter
            template_message = TemplateMessage(
                altText=alt_text,
                template=buttons_template
            )  # type: ignore[call-arg]
            
            messages = [template_message]
            
            if reply_token:
                request = ReplyMessageRequest(
                    replyToken=reply_token,
                    messages=messages,
                    notificationDisabled=False
                )
                response = self.api.reply_message(request)
                logger.debug(f"Sent template reply message for user {line_user_id[:10]}...")
            else:
                request = PushMessageRequest(
                    to=line_user_id,
                    messages=messages,
                    notificationDisabled=False,
                    customAggregationUnits=None
                )
                response = self.api.push_message(request)
                logger.debug(f"Sent template push message for user {line_user_id[:10]}...")
            
            # Extract message ID from response
            message_id: Optional[str] = None
            try:
                if hasattr(response, 'sent_messages') and response.sent_messages:
                    sent_messages_list = response.sent_messages  # type: ignore
                    if sent_messages_list and len(sent_messages_list) > 0:  # type: ignore
                        sent_msg = sent_messages_list[0]  # type: ignore
                        message_id = getattr(sent_msg, 'id', None)  # type: ignore
            except (AttributeError, IndexError, TypeError) as e:
                logger.debug(f"Could not extract message ID from LINE API response: {e}")
                message_id = None
            
            return message_id
        except Exception as e:
            logger.exception(f"Failed to send template message to {line_user_id}: {e}")
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
