"""
Webhook endpoints for external service integrations.

This module handles incoming webhooks from LINE messaging platform
and Google Calendar push notifications for the chatbot system.
"""

import logging
from typing import Any, List

from fastapi import APIRouter, Request, HTTPException, status, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from clinic_agents.orchestrator import handle_line_message
from services.line_service import LINEService
from services.google_calendar_service import GoogleCalendarService, GoogleCalendarError
from clinic_agents.helpers import get_clinic_from_request
from core.database import get_db
from models import User, Appointment

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
        if not line_service.verify_signature(body.decode('utf-8'), signature):
            logger.warning("Invalid LINE signature received")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid LINE signature"
            )

        # 5. Update clinic webhook tracking
        from utils.datetime_utils import utc_now, safe_datetime_diff
        from datetime import timedelta
        
        now = utc_now()

        # Update 24h webhook count (reset if more than 24h since last webhook)
        if clinic.last_webhook_received_at:
            # Safely compare datetimes with timezone handling
            if safe_datetime_diff(now, clinic.last_webhook_received_at) > timedelta(hours=24):
                clinic.webhook_count_24h = 0
        clinic.webhook_count_24h += 1

        # Update last webhook timestamp (ensure it's timezone-aware)
        clinic.last_webhook_received_at = now

        db.commit()

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
async def google_calendar_webhook(request: Request, db: Session = Depends(get_db)) -> PlainTextResponse:
    """
    Process Google Calendar push notification webhooks.

    Handles calendar event changes (create, update, delete) for therapist
    calendars to keep appointment data synchronized. Specifically handles
    therapist-initiated cancellations by detecting deleted events.

    Args:
        request: The incoming webhook request from Google Calendar
        db: Database session

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

        # Process calendar changes based on resource state
        if resource_state == "sync":
            # Initial sync or periodic sync - we don't need to do anything special
            logger.info("Received sync notification, no action needed")
        elif resource_state == "exists":
            # Calendar exists but no specific change - check for deletions
            if resource_id:
                await _handle_calendar_changes(db, resource_id)
        elif resource_state == "not_exists":
            # Calendar was deleted - this is unusual but should be handled
            logger.warning(f"Calendar no longer exists for resource ID: {resource_id}")
        else:
            logger.warning(f"Unknown resource state: {resource_state}")

        return PlainTextResponse("OK")

    except Exception as e:
        logger.error(f"Unexpected error processing Google Calendar webhook: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


async def _handle_calendar_changes(db: Session, resource_id: str) -> None:
    """
    Handle calendar changes by checking for deleted events and updating appointments.

    This function is called when Google Calendar sends a webhook notification.
    It identifies which therapist's calendar changed, checks for deleted events,
    and updates appointment statuses accordingly.

    Args:
        db: Database session
        resource_id: Google Calendar watch resource ID

    Raises:
        Exception: If calendar processing fails
    """
    try:
        # Find the user associated with this resource ID
        user = db.query(User).filter(
            User.gcal_watch_resource_id == resource_id,
            User.roles.contains(['practitioner'])
        ).first()
        if not user:
            logger.warning(f"No practitioner found for resource ID: {resource_id}")
            return

        logger.info(f"Processing calendar changes for practitioner: {user.full_name} (ID: {user.id})")

        # Get all confirmed appointments for this user that have Google Calendar events
        appointments = db.query(Appointment).filter(
            Appointment.user_id == user.id,
            Appointment.status == "confirmed",
            Appointment.gcal_event_id.isnot(None)
        ).all()

        if not appointments:
            logger.info(f"No appointments with Google Calendar events found for user {user.id}")
            return

        # If user doesn't have Google Calendar credentials, we can't check
        if not user.gcal_credentials:
            logger.warning(f"User {user.id} has no Google Calendar credentials")
            return

        # Initialize Google Calendar service with decrypted credentials
        try:
            from services.encryption_service import get_encryption_service
            import json
            decrypted_credentials = get_encryption_service().decrypt_data(user.gcal_credentials)
            gcal_service = GoogleCalendarService(json.dumps(decrypted_credentials))
        except GoogleCalendarError as e:
            logger.error(f"Failed to initialize Google Calendar service for user {user.id}: {e}")
            return

        # Get current events from Google Calendar
        current_event_ids: set[str] = set()
        try:
            # Get events for the next 90 days (reasonable timeframe for appointments)
            from datetime import datetime, timedelta, timezone
            time_min = datetime.now(timezone.utc)
            time_max = time_min + timedelta(days=90)

            events_result: Any = gcal_service.service.events().list(  # type: ignore
                calendarId='primary',
                timeMin=time_min.isoformat(),
                timeMax=time_max.isoformat(),
                singleEvents=True
            ).execute()  # type: ignore

            items: List[Any] = events_result.get('items', [])  # type: ignore
            current_event_ids = {str(event.get('id', '')) for event in items if event.get('id')}  # type: ignore

        except Exception as e:
            logger.error(f"Failed to fetch Google Calendar events for user {user.id}: {e}")
            return

        # Check for deleted events (appointments that have gcal_event_id but event no longer exists)
        deleted_appointments: List[Appointment] = []
        for appointment in appointments:
            if appointment.gcal_event_id and appointment.gcal_event_id not in current_event_ids:
                deleted_appointments.append(appointment)

        if not deleted_appointments:
            logger.info(f"No deleted appointments found for user {user.id}")
            return

        # Process deleted appointments
        for appointment in deleted_appointments:
            logger.info(f"Appointment {appointment.id} was cancelled by therapist via Google Calendar")

            # Update appointment status
            appointment.status = "canceled_by_clinic"
            db.commit()

            # Send LINE notification to patient
            await _send_cancellation_notification(db, appointment)

    except Exception as e:
        logger.error(f"Error handling calendar changes for resource ID {resource_id}: {e}")
        raise


async def _send_cancellation_notification(db: Session, appointment: Appointment) -> None:
    """
    Send a LINE notification to the patient about a cancelled appointment.

    Args:
        db: Database session
        appointment: The cancelled appointment
    """
    try:
        # Get the clinic for LINE service initialization
        clinic = appointment.patient.clinic

        # Initialize LINE service
        line_service = LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )

        # Get patient's LINE user ID
        from models.line_user import LineUser
        line_user = db.query(LineUser).filter_by(patient_id=appointment.patient_id).first()
        if not line_user:
            logger.warning(f"No LINE user found for patient {appointment.patient_id}")
            return

        # Format cancellation message (as specified in PRD)
        therapist_name = appointment.user.full_name
        appointment_time = appointment.start_time.strftime("%m/%d (%a) %H:%M")
        message = (
            f"提醒您，您原訂於【{appointment_time}】與【{therapist_name}治療師】的預約已被診所取消。"
            f"很抱歉造成您的不便，請問需要為您重新安排預約嗎？"
        )

        # Send message via LINE
        line_service.send_text_message(line_user.line_user_id, message)
        logger.info(f"Sent cancellation notification to patient {appointment.patient_id} via LINE")

    except Exception as e:
        logger.error(f"Failed to send cancellation notification for appointment {appointment.id}: {e}")
        # Don't raise exception - we don't want to fail the webhook processing
