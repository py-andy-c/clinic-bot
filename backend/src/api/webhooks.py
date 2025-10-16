"""
Webhook endpoints for external service integrations.

This module handles incoming webhooks from LINE messaging platform
and Google Calendar push notifications.
"""

import logging
from typing import Any

from fastapi import APIRouter, Request, HTTPException, status
from fastapi.responses import PlainTextResponse

router = APIRouter()
logger = logging.getLogger(__name__)


def verify_line_signature(request: Request, body: bytes) -> bool:
    """
    Verify LINE webhook signature for security.

    Args:
        request: The incoming HTTP request
        body: Raw request body bytes

    Returns:
        bool: True if signature is valid, False otherwise

    Note:
        This is a placeholder implementation. In production, this should
        use HMAC-SHA256 to verify the X-Line-Signature header.
    """
    # TODO: Implement proper LINE signature verification using channel secret
    # The signature is computed as: BASE64(HMAC-SHA256(channel_secret, body))
    # and compared against the X-Line-Signature header
    return True


@router.post(
    "/line",
    summary="LINE Webhook",
    description="Receive messages and events from LINE messaging platform",
    responses={
        200: {"description": "Webhook processed successfully"},
        400: {"description": "Invalid request format"},
        401: {"description": "Invalid signature"},
        500: {"description": "Internal server error"},
    },
)
async def line_webhook(request: Request) -> PlainTextResponse:
    """
    Process incoming LINE webhook events.

    Handles message events, follows/unfollows, and other LINE platform events.
    Currently logs events for debugging purposes.

    Args:
        request: The incoming webhook request from LINE

    Returns:
        PlainTextResponse: "OK" to acknowledge receipt

    Raises:
        HTTPException: If processing fails or signature is invalid
    """
    try:
        # Get raw body for signature verification (placeholder for future implementation)
        body = await request.body()  # type: ignore[unused-variable]

        # TODO: Implement signature verification in production
        # if not verify_line_signature(request, body):
        #     logger.warning("Invalid LINE signature received")
        #     raise HTTPException(
        #         status_code=status.HTTP_401_UNAUTHORIZED,
        #         detail="Invalid signature"
        #     )

        # Parse the webhook payload
        try:
            payload: dict[str, Any] = await request.json()
        except Exception as e:
            logger.error(f"Failed to parse LINE webhook JSON: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON payload"
            )

        logger.info(f"Received LINE webhook with {len(payload.get('events', []))} events")

        # Process each event in the webhook
        for event in payload.get("events", []):
            event_type = event.get("type")
            logger.info(f"Processing LINE event: {event_type}")

            if event_type == "message":
                message = event.get("message", {})
                message_type = message.get("type")
                text = message.get("text", "")

                logger.info(f"Message type: {message_type}, Text: {text}")

                # TODO: Implement message processing logic
                # This will route messages to the LLM service for conversation handling

            elif event_type == "follow":
                logger.info("User followed the LINE OA")
                # TODO: Handle new user onboarding

            elif event_type == "unfollow":
                logger.info("User unfollowed the LINE OA")
                # TODO: Handle user deactivation

        # Return success response to LINE platform
        return PlainTextResponse("OK")

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error processing LINE webhook: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post(
    "/gcal",
    summary="Google Calendar Webhook",
    description="Receive push notifications for Google Calendar changes",
    responses={
        200: {"description": "Webhook processed successfully"},
        400: {"description": "Invalid request"},
        500: {"description": "Internal server error"},
    },
)
async def google_calendar_webhook(request: Request) -> PlainTextResponse:
    """
    Process Google Calendar push notification webhooks.

    Handles calendar event changes (create, update, delete) for therapist
    calendars to keep appointment data synchronized.

    Args:
        request: The incoming webhook request from Google Calendar

    Returns:
        PlainTextResponse: "OK" to acknowledge receipt

    Raises:
        HTTPException: If processing fails
    """
    try:
        # Extract Google Calendar webhook headers
        resource_state = request.headers.get("X-Goog-Resource-State")
        resource_id = request.headers.get("X-Goog-Resource-ID")
        channel_id = request.headers.get("X-Goog-Channel-ID")
        message_number = request.headers.get("X-Goog-Message-Number")

        logger.info(f"Received Google Calendar webhook - State: {resource_state}, Resource ID: {resource_id}, Channel ID: {channel_id}, Message: {message_number}")

        # Get the body (if any) - Google Calendar webhooks typically have empty bodies
        body = await request.body()
        if body:
            logger.info(f"Webhook body: {body.decode()}")

        # TODO: Implement calendar change processing
        # This will be implemented in Milestone 3 to handle:
        # - Appointment cancellations by therapists
        # - Calendar event updates
        # - Conflict detection and resolution

        # For now, just acknowledge receipt
        return PlainTextResponse("OK")

    except Exception as e:
        logger.error(f"Unexpected error processing Google Calendar webhook: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )
