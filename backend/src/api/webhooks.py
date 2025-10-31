"""
Webhook endpoints for external service integrations.

This module handles incoming webhooks from Google Calendar push notifications.
When therapists cancel appointments in Google Calendar, patients receive LINE notifications.
LINE messaging webhooks are no longer supported (AI agents removed).
"""

import logging
from typing import Any, List

from fastapi import APIRouter, Request, HTTPException, status, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from services.google_calendar_service import GoogleCalendarService, GoogleCalendarError
from core.database import get_db
from models import User, Appointment, CalendarEvent, Clinic

router = APIRouter()
logger = logging.getLogger(__name__)


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
        logger.exception(f"Unexpected error processing Google Calendar webhook: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="內部伺服器錯誤"
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
        # Note: Filter roles in Python because SQLite JSON operations don't work reliably
        user = db.query(User).filter(
            User.gcal_watch_resource_id == resource_id
        ).first()
        
        # Verify practitioner role
        if user and 'practitioner' not in user.roles:
            user = None
        if not user:
            logger.warning(f"No practitioner found for resource ID: {resource_id}")
            return

        logger.info(f"Processing calendar changes for practitioner: {user.full_name} (ID: {user.id})")

        # Get all confirmed appointments for this user that have Google Calendar events
        appointments = db.query(Appointment).join(CalendarEvent).filter(
            CalendarEvent.user_id == user.id,
            Appointment.status == "confirmed",
            CalendarEvent.gcal_event_id.isnot(None)
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
            logger.exception(f"Failed to initialize Google Calendar service for user {user.id}: {e}")
            return

        # Get current events from Google Calendar
        current_event_ids: set[str] = set()
        try:
            # Get events for the next 90 days (reasonable timeframe for appointments)
            from datetime import datetime, timedelta, timezone
            time_min = datetime.now(timezone.utc)
            time_max = time_min + timedelta(days=90)

            # Handle pagination via nextPageToken
            next_page_token: Any = None
            while True:
                request = gcal_service.service.events().list(  # type: ignore
                    calendarId='primary',
                    timeMin=time_min.isoformat(),
                    timeMax=time_max.isoformat(),
                    singleEvents=True,
                    pageToken=next_page_token
                )
                events_result = request.execute()  # type: ignore
                # Explicit typing/casting for static analysis
                from typing import Dict as _Dict, Any as _Any, List as _List, cast
                events_result = cast(_Dict[str, _Any], events_result)
                items = cast(_List[_Dict[str, _Any]], events_result.get('items', []))
                for event in items:
                    eid_val = event.get('id')
                    if eid_val:
                        current_event_ids.add(str(eid_val))
                next_page_token = events_result.get('nextPageToken')
                if not next_page_token:
                    break

        except Exception as e:
            logger.exception(f"Failed to fetch Google Calendar events for user {user.id}: {e}")
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
            logger.info(f"Appointment {appointment.calendar_event_id} was cancelled by therapist via Google Calendar")

            # Update appointment status
            appointment.status = "canceled_by_clinic"
            db.commit()

            # Send LINE notification to patient
            try:
                _send_gcal_cancellation_notification(db, appointment, user)
            except Exception as e:
                logger.exception(f"Failed to send LINE notification for Google Calendar cancellation of appointment {appointment.calendar_event_id}: {e}")
                # Continue processing other deletions

    except Exception as e:
        logger.exception(f"Error handling calendar changes for resource ID {resource_id}: {e}")
        raise


def _send_gcal_cancellation_notification(db: Session, appointment: Appointment, practitioner: User) -> None:
    """
    Send LINE notification to patient about therapist-initiated cancellation via Google Calendar.
    """
    try:
        # Get patient and check if they have LINE user
        patient = appointment.patient
        if not patient.line_user:
            logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
            return

        # Get clinic's LINE credentials
        clinic = patient.clinic

        # Format date/time for notification
        # Convert to local timezone (assuming UTC+8 for Taiwan)
        from datetime import timezone, timedelta
        local_tz = timezone(timedelta(hours=8))
        local_datetime = appointment.calendar_event.start_datetime.astimezone(local_tz)
        formatted_datetime = local_datetime.strftime("%m/%d (%a) %H:%M")

        # Send LINE message using clinic's LINE service
        from services.line_service import LINEService
        line_service = LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )

        message = f"您的預約已被取消：{formatted_datetime} - {practitioner.full_name}治療師。如需重新預約，請點選「線上約診」"

        line_service.send_text_message(patient.line_user.line_user_id, message)

        logger.info(f"Sent Google Calendar cancellation LINE notification to patient {patient.id} for appointment {appointment.calendar_event_id}")

    except Exception as e:
        logger.exception(f"Failed to send Google Calendar cancellation notification: {e}")
        raise
