"""
Webhook endpoints for external service integrations.

This module handles incoming webhooks from LINE messaging platform
and Google Calendar push notifications.
"""

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Request, HTTPException, status, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.line_user import LineUser
from ..models.patient import Patient
from ..models.clinic import Clinic

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


def find_patient_by_phone(db: Session, clinic_id: int, phone_number: str) -> Optional[Patient]:
    """
    Find a patient by phone number in the specified clinic.

    Args:
        db: Database session
        clinic_id: ID of the clinic
        phone_number: Phone number to search for

    Returns:
        Patient object if found, None otherwise
    """
    # Clean phone number (remove spaces, dashes, etc.)
    clean_phone = re.sub(r'[^\d]', '', phone_number)

    # Try exact match first
    patient = db.query(Patient).filter(
        Patient.clinic_id == clinic_id,
        Patient.phone_number == clean_phone
    ).first()

    if patient:
        return patient

    # Try with common prefixes (+886, 886, 0)
    variations = [
        clean_phone,
        f"+886{clean_phone[1:]}" if clean_phone.startswith('0') else f"886{clean_phone[1:]}",
        f"0{clean_phone[3:]}" if clean_phone.startswith('886') else clean_phone,
        f"0{clean_phone[4:]}" if clean_phone.startswith('+886') else clean_phone
    ]

    for variation in variations:
        patient = db.query(Patient).filter(
            Patient.clinic_id == clinic_id,
            Patient.phone_number == variation
        ).first()
        if patient:
            return patient

    return None


def link_line_user_to_patient(db: Session, line_user_id: str, patient: Patient) -> LineUser:
    """
    Link a LINE user to a patient record.

    Args:
        db: Database session
        line_user_id: LINE user ID
        patient: Patient object to link

    Returns:
        LineUser object representing the link
    """
    # Check if already linked
    existing_link = db.query(LineUser).filter(LineUser.line_user_id == line_user_id).first()
    if existing_link:
        # Update the link if it's different
        if str(existing_link.patient_id) != str(patient.id):
            existing_link.patient_id = patient.id
            db.commit()
        return existing_link

    # Create new link
    line_user = LineUser(line_user_id=line_user_id, patient_id=patient.id)
    db.add(line_user)
    db.commit()
    db.refresh(line_user)
    return line_user


def get_line_user_patient(db: Session, line_user_id: str) -> Optional[Patient]:
    """
    Get the patient linked to a LINE user ID.

    Args:
        db: Database session
        line_user_id: LINE user ID

    Returns:
        Patient object if linked, None otherwise
    """
    line_user = db.query(LineUser).filter(LineUser.line_user_id == line_user_id).first()
    if line_user:
        return db.query(Patient).filter(Patient.id == line_user.patient_id).first()
    return None


def get_clinic_by_line_channel_id(db: Session, channel_id: str) -> Optional[Clinic]:
    """
    Get clinic by LINE channel ID.

    Args:
        db: Database session
        channel_id: LINE channel ID

    Returns:
        Clinic object if found, None otherwise
    """
    return db.query(Clinic).filter(Clinic.line_channel_id == channel_id).first()


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
async def line_webhook(request: Request, db: Session = Depends(get_db)) -> PlainTextResponse:
    """
    Process incoming LINE webhook events.

    Handles message events, follows/unfollows, and other LINE platform events.
    Routes messages to LLM service for conversational appointment booking.

    Args:
        request: The incoming webhook request from LINE
        db: Database session dependency

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
                await _process_message_event(event, db)

            elif event_type == "follow":
                await _process_follow_event(event, db)

            elif event_type == "unfollow":
                await _process_unfollow_event(event, db)

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


async def _process_message_event(event: dict[str, Any], db: Session) -> None:
    """Process a message event from LINE."""
    source = event.get("source", {})
    line_user_id = source.get("userId")

    if not line_user_id:
        logger.warning("Message event without userId")
        return

    message = event.get("message", {})
    text = message.get("text", "")

    logger.info(f"Processing message from user {line_user_id}: {text}")

    # Get clinic information (from webhook payload or configuration)
    # For now, we'll assume a single clinic - in production this would be
    # determined by the LINE channel ID
    clinic = db.query(Clinic).first()  # Get first clinic for now
    if not clinic:
        logger.error("No clinic found in database")
        return

    clinic_id = int(clinic.id)  # type: ignore

    # Check if user is linked to a patient
    patient = get_line_user_patient(db, line_user_id)

    # Handle patient linking if needed
    if not patient and _should_attempt_patient_linking(text):
        phone_number = _extract_phone_number(text)
        if phone_number:
            patient = find_patient_by_phone(db, clinic_id, phone_number)
            if patient:
                link_line_user_to_patient(db, line_user_id, patient)
                # Send success message (would be sent via LINE API in production)
                logger.info(f"Successfully linked user {line_user_id} to patient {patient.id}")
            else:
                # Send failure message (would be sent via LINE API in production)
                logger.info(f"Failed to link user {line_user_id} - phone number not found: {phone_number}")

    # Process message with LLM
    try:
        # Import here to avoid circular import
        from ..services.llm_service import llm_service  # type: ignore

        response = llm_service.process_message(
            message=text,
            clinic_id=clinic_id,
            patient_id=patient.id if patient else None,
            db=db
        )

        # Check for non-appointment message protocol
        if response.get("response") == "NON_APPOINTMENT_MESSAGE":
            logger.info(f"Non-appointment message detected (intent: {response.get('intent', 'unknown')}) - allowing manual reply")
            # Return early without sending any response to LINE
            # This allows LINE's auto-reply or manual staff response to handle it
            return

        logger.info(f"LLM response: {response.get('response', '')}")

        # In production, send response back via LINE Messaging API
        # For now, just log the response

    except Exception as e:
        logger.error(f"Error processing message with LLM: {e}")


async def _process_follow_event(event: dict[str, Any], db: Session) -> None:
    """Process a follow event (user added the LINE OA)."""
    source = event.get("source", {})
    line_user_id = source.get("userId")

    if line_user_id:
        logger.info(f"User {line_user_id} followed the LINE OA")
        # Could send welcome message here


async def _process_unfollow_event(event: dict[str, Any], db: Session) -> None:
    """Process an unfollow event (user blocked the LINE OA)."""
    source = event.get("source", {})
    line_user_id = source.get("userId")

    if line_user_id:
        logger.info(f"User {line_user_id} unfollowed the LINE OA")
        # Could clean up user data here if needed


def _should_attempt_patient_linking(text: str) -> bool:
    """Check if the message contains a phone number for patient linking."""
    # Look for phone number patterns
    phone_patterns = [
        r'\b\d{4}-\d{3}-\d{3}\b',  # 0912-345-678
        r'\b\d{4}\d{3}\d{3}\b',    # 0912345678
        r'\b0\d{2,3}-\d{3,4}-\d{4}\b',  # 02-1234-5678
        r'\b0\d{8,9}\b',           # 0212345678
        r'\+\d{10,12}\b',          # +886912345678
    ]

    for pattern in phone_patterns:
        if re.search(pattern, text):
            return True
    return False


def _extract_phone_number(text: str) -> Optional[str]:
    """Extract phone number from text."""
    # Try different patterns to extract phone number
    patterns = [
        r'\b(\d{4}-\d{3}-\d{3})\b',      # 0912-345-678
        r'\b(\d{4}\d{3}\d{3})\b',        # 0912345678
        r'\b(0\d{2,3}-\d{3,4}-\d{4})\b', # 02-1234-5678
        r'\b(0\d{8,9})\b',               # 0212345678
        r'\b(\+\d{10,12})\b',            # +886912345678
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


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
