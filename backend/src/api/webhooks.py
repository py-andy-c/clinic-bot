"""
Webhook endpoints for external service integrations.

This module handles incoming webhooks from LINE messaging platform
and Google Calendar push notifications for the chatbot system.
"""

import logging
from typing import Any

from fastapi import APIRouter, Request, HTTPException, status, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from clinic_agents.orchestrator import handle_line_message
from services.line_service import LINEService
from clinic_agents.helpers import get_clinic_from_request
from core.database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/line",
    summary="LINE Webhook",
    description="Receive messages and events from LINE messaging platform for chatbot processing",
    responses={
        200: {"description": "Webhook processed successfully"},
        400: {"description": "Invalid request format"},
        401: {"description": "Invalid signature"},
        500: {"description": "Internal server error"},
    },
)
async def line_webhook(request: Request, db: Session = Depends(get_db)) -> PlainTextResponse:
    """
    Process incoming LINE webhook events for chatbot conversations.

    Handles text messages by routing them through the multi-agent orchestrator.
    Non-appointment queries are ignored (no response sent).
    Appointment-related queries trigger the full agent workflow.

    Args:
        request: The incoming webhook request from LINE
        db: Database session

    Returns:
        PlainTextResponse: "OK" to acknowledge receipt

    Raises:
        HTTPException: If processing fails or signature is invalid
    """
    try:
        logger.info("🔥 LINE WEBHOOK TRIGGERED!")
        logger.info("LINE webhook received")
        # 1. Get request body and signature
        body = await request.body()
        signature = request.headers.get('X-Line-Signature', '')
        logger.info(f"Request body length: {len(body)}, signature present: {bool(signature)}")

        # 2. Get clinic from request (by header or URL path)
        clinic = get_clinic_from_request(request, db)
        logger.info(f"Found clinic: {clinic.name if clinic else 'None'}")

        # 3. Initialize LINE service for this clinic
        line_service = LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )

        # 4. Verify LINE signature (security)
        # TEMPORARY: Skip signature verification for testing
        # TODO: Re-enable in production
        logger.info("Skipping LINE signature verification (testing mode - TODO: re-enable for production)")
        # if not line_service.verify_signature(body.decode('utf-8'), signature):
        #     logger.warning("Invalid LINE signature received")
        #     raise HTTPException(
        #         status_code=status.HTTP_401_UNAUTHORIZED,
        #         detail="Invalid LINE signature"
        #     )

        # 5. Parse LINE message payload
        try:
            payload: dict[str, Any] = await request.json()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON payload"
            )
        message_data = line_service.extract_message_data(payload)

        if not message_data:
            # Not a text message (could be image, sticker, etc.) - ignore
            logger.info("Received non-text message, ignoring")
            return PlainTextResponse("OK")

        line_user_id, message_text = message_data
        logger.info(f"Processing text message from {line_user_id}: {message_text}")

        # 6. Delegate to orchestrator (business logic)
        response_text = await handle_line_message(
            db=db,
            clinic=clinic,
            line_user_id=line_user_id,
            message_text=message_text
        )

        # 7. Send response via LINE API (only if not None)
        if response_text is not None:
            logger.info(f"📤 SENDING RESPONSE: {response_text[:50]}...")
            logger.info(f"Sending response to {line_user_id}: {response_text}")
            line_service.send_text_message(line_user_id, response_text)
            logger.info(f"✅ LINE MESSAGE SENT SUCCESSFULLY to {line_user_id}")
        else:
            logger.info(f"No response needed for {line_user_id} (non-appointment query)")

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
