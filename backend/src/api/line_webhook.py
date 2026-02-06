# pyright: reportMissingTypeStubs=false
"""
LINE webhook endpoint for receiving patient messages.

This endpoint receives webhook events from LINE when patients send messages
to the clinic's LINE Official Account. It processes messages through the
AI agent and sends responses back to patients.
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request, HTTPException, status, Header, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from core.database import get_db
from models import Clinic, PractitionerLinkCode, User, LineAiReply, LineMessage
from models.clinic import AIWeeklySchedule
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now
from services.line_user_service import LineUserService
from services.clinic_agent import ClinicAgentService
from services.line_message_service import LineMessageService, QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
from services.line_user_ai_disabled_service import is_ai_disabled
from core.constants import AI_FALLBACK_EXPIRY_MINUTES, AI_LABEL_LONG_THRESHOLD

logger = logging.getLogger(__name__)


router = APIRouter()


def is_ai_active_now(schedule: Optional[AIWeeklySchedule]) -> bool:
    """
    Check if AI should be active based on current time and weekly schedule.
    
    Args:
        schedule: AI weekly schedule configuration
        
    Returns:
        bool: True if AI should be active (or no schedule configured), False otherwise
    """
    if not schedule:
        return True
    
    now = taiwan_now()
    # 0 = Monday, 6 = Sunday
    weekday = now.weekday()
    current_time_str = now.strftime("%H:%M")
    
    # Map weekday number to field name
    day_map = {0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun'}
    day_key = day_map.get(weekday)
    
    if not day_key:
        return True # Should not happen
        
    periods = getattr(schedule, day_key, [])
    # If schedule exists but no periods for today, it means NO AI today.
    # Note: If ai_reply_schedule is not none, we respect it strictly.
    # Empty list for a day means CLOSED for AI on that day.
    if not periods:
        return False
        
    for period in periods:
        if period.start_time <= current_time_str < period.end_time:
            return True
            
    return False


async def _extract_webhook_data(
    request: Request,
    x_line_signature: str,
    db: Session
) -> tuple[Clinic, LINEService, str, Dict[str, Any]]:
    """
    Extract and validate webhook data, find clinic, and verify signature.

    Returns:
        Tuple of (clinic, line_service, body_str, payload)

    Raises:
        HTTPException: If validation fails or clinic not found
    """
    # Get raw request body for signature verification
    body_bytes = await request.body()
    body_str = body_bytes.decode('utf-8')

    # Parse JSON payload
    payload: Dict[str, Any] = json.loads(body_str)

    # Extract official account user ID from payload (destination field)
    if 'destination' not in payload:
        logger.warning("LINE webhook missing destination field")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LINE Webhook 資料中缺少 destination 欄位"
        )

    destination = payload['destination']

    # Look up clinic by official account user ID
    clinic = db.query(Clinic).filter(
        Clinic.line_official_account_user_id == destination
    ).first()

    if not clinic:
        logger.warning(f"Clinic not found for destination={destination}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"找不到目標診所: {destination}"
        )

    # Verify webhook signature
    line_service = LINEService(
        channel_secret=clinic.line_channel_secret,
        channel_access_token=clinic.line_channel_access_token
    )

    if not line_service.verify_signature(body_str, x_line_signature):
        logger.warning(f"Invalid webhook signature for clinic_id={clinic.id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的 LINE 簽章"
        )

    return clinic, line_service, body_str, payload




def _handle_follow_event(
    db: Session,
    line_service: LINEService,
    line_user_id: str,
    reply_token: Optional[str],
    clinic: Clinic
) -> Dict[str, str]:
    """
    Handle 'follow' event - user added the official account as a friend.
    
    Creates LineUser entry proactively so clinic can manage AI settings.
    """
    try:
        # Create or get LINE user (will fetch profile if needed)
        LineUserService.get_or_create_line_user(
            db=db,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=line_service,
            display_name=None  # Will be fetched from LINE API
        )
        
        logger.info(
            f"User followed official account: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id[:10]}..."
        )
        
        # Optionally send welcome message (if reply_token available)
        # Note: LINE doesn't always provide reply_token for follow events
        if reply_token:
            try:
                welcome_message = "歡迎加入！如有任何問題，歡迎隨時詢問。"
                line_service.send_text_message(
                    line_user_id=line_user_id,
                    text=welcome_message,
                    reply_token=reply_token
                )
            except Exception as e:
                # Don't fail if welcome message can't be sent
                logger.debug(f"Could not send welcome message: {e}")
        
        return {"status": "ok", "message": "Follow event processed"}
    except Exception as e:
        logger.exception(
            f"Error handling follow event: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id[:10]}...: {e}"
        )
        # Return OK to LINE even on errors
        return {"status": "ok", "message": "Follow event processed (with errors)"}


def _handle_unfollow_event(
    db: Session,
    line_user_id: str,
    clinic: Clinic
) -> Dict[str, str]:
    """
    Handle 'unfollow' event - user blocked or removed the official account.
    
    Currently just logs the event. Could mark user as inactive in the future.
    """
    try:
        logger.info(
            f"User unfollowed official account: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id[:10]}..."
        )
        
        # Note: We don't delete the LineUser entry because:
        # 1. User might follow again
        # 2. Historical data (patients, appointments) should be preserved
        # 3. Clinic might want to see who unfollowed
        
        # Future enhancement: Could add is_active flag to LineUser model
        # and set it to False here
        
        return {"status": "ok", "message": "Unfollow event processed"}
    except Exception as e:
        logger.exception(
            f"Error handling unfollow event: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id[:10]}...: {e}"
        )
        return {"status": "ok", "message": "Unfollow event processed (with errors)"}


def _handle_link_code_command(
    db: Session,
    line_service: LINEService,
    line_user_id: str,
    reply_token: str,
    message_text: str,
    clinic: Clinic
) -> Dict[str, str]:
    """Handle 'LINK-XXXXX' command to link practitioner LINE account."""
    try:
        # Extract code (should be 5 digits after LINK-)
        # This is already validated by the regex check in the caller
        code = message_text.upper().replace("LINK-", "").strip()
        now = datetime.now(timezone.utc)

        # Find link code (even if already used, for idempotency check)
        link_code = db.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.code == f"LINK-{code}",
            PractitionerLinkCode.clinic_id == clinic.id
        ).first()

        if not link_code:
            error_message = "連結代碼無效或已過期。請從個人資料頁面重新產生連結代碼。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.warning(
                f"Link code not found: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}"
            )
            return {"status": "ok", "message": "Link code not found"}

        # Check if code is expired (only if not already used)
        if link_code.used_at is None and link_code.expires_at <= now:
            error_message = "連結代碼無效或已過期。請從個人資料頁面重新產生連結代碼。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.warning(
                f"Expired link code: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}, expires_at={link_code.expires_at}"
            )
            return {"status": "ok", "message": "Expired link code"}

        # Get the user associated with this code
        user = db.query(User).filter(User.id == link_code.user_id).first()
        if not user:
            error_message = "找不到對應的使用者。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.error(
                f"User not found for link code: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}, user_id={link_code.user_id}"
            )
            return {"status": "ok", "message": "User not found"}

        # Get the user-clinic association for this clinic
        from models.user_clinic_association import UserClinicAssociation
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == link_code.user_id,
            UserClinicAssociation.clinic_id == clinic.id,
            UserClinicAssociation.is_active == True
        ).first()

        if not association:
            error_message = "找不到診所關聯。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.error(
                f"Association not found for link code: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}, user_id={link_code.user_id}"
            )
            return {"status": "ok", "message": "Association not found"}

        # Idempotency check: if code was already used to link this LINE account to this association, return success
        if link_code.used_at is not None and association.line_user_id == line_user_id:
            success_message = "✅ LINE 帳號連結成功！\n\n您現在將收到預約通知。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=success_message,
                reply_token=reply_token
            )
            logger.info(
                f"Practitioner LINE account already linked (idempotent): clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, user_id={user.id}, code=LINK-{code}"
            )
            return {"status": "ok", "message": "LINE account already linked (idempotent)"}

        # Check if this LINE account is already linked to a different user in the same clinic
        existing_association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic.id,
            UserClinicAssociation.line_user_id == line_user_id,
            UserClinicAssociation.user_id != link_code.user_id
        ).first()

        if existing_association:
            error_message = "此 LINE 帳號已連結至其他帳號。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.warning(
                f"LINE account already linked to different user in same clinic: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}, existing_user_id={existing_association.user_id}, code_user_id={link_code.user_id}"
            )
            return {"status": "ok", "message": "LINE account already linked to different user"}

        # Check if code was already used for a different LINE account
        if link_code.used_at is not None:
            error_message = "此連結代碼已被使用。請從個人資料頁面重新產生連結代碼。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.warning(
                f"Link code already used for different LINE account: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}, user_id={link_code.user_id}, association_line_user_id={association.line_user_id}"
            )
            return {"status": "ok", "message": "Link code already used"}

        # Link the LINE account (code is valid and unused)
        association.line_user_id = line_user_id
        association.updated_at = taiwan_now()
        link_code.mark_used()
        db.commit()

        # Send success message
        success_message = "✅ LINE 帳號連結成功！\n\n您現在將收到預約通知。"
        line_service.send_text_message(
            line_user_id=line_user_id,
            text=success_message,
            reply_token=reply_token
        )

        logger.info(
            f"Practitioner LINE account linked: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}, user_id={user.id}, code=LINK-{code}"
        )
        return {"status": "ok", "message": "LINE account linked successfully"}
    except Exception as e:
        logger.exception(
            f"Error linking LINE account: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}, message={message_text}: {e}"
        )
        # Try to send error message
        try:
            error_message = "連結過程中發生錯誤，請稍後再試。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
        except:
            pass  # Ignore if message send fails
        return {"status": "ok", "message": "Link processing error (message may have failed)"}


async def _process_regular_message(
    db: Session,
    line_service: LINEService,
    line_user_id: str,
    message_text: str,
    reply_token: str,
    message_id: str | None,
    quoted_message_id: str | None,
    clinic: Clinic,
    preferred_language: str | None = None
) -> Dict[str, str]:
    """Process regular message through AI agent and send response."""
    # Generate session ID
    session_id = f"{clinic.id}-{line_user_id}"

    # Store incoming message
    if message_id:
        try:
            LineMessageService.store_message(
                db=db,
                line_message_id=message_id,
                line_user_id=line_user_id,
                clinic_id=clinic.id,
                message_text=message_text,
                message_type="text",
                is_from_user=True,
                quoted_message_id=quoted_message_id,
                session_id=session_id
            )
        except Exception as e:
            logger.warning(f"Failed to store incoming message: {e}")

    # Retrieve quoted message content if present
    quoted_message_text = None
    quoted_is_from_user = None
    if quoted_message_id:
        try:
            quoted_result = LineMessageService.get_quoted_message(
                db=db,
                quoted_message_id=quoted_message_id,
                clinic_id=clinic.id,
                line_user_id=line_user_id
            )
            if quoted_result:
                quoted_message_text, quoted_is_from_user = quoted_result
            else:
                quoted_message_text = QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
                logger.info(
                    f"Quoted message not found or is non-text: "
                    f"quoted_message_id={quoted_message_id[:10]}..., "
                    f"clinic_id={clinic.id}, line_user_id={line_user_id[:10]}..."
                )
        except Exception as e:
            quoted_message_text = QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
            logger.warning(f"Failed to retrieve quoted message: {e}")

    # Process message through AI agent
    response_text = await ClinicAgentService.process_message(
        session_id=session_id,
        message=message_text,
        clinic=clinic,
        quoted_message_text=quoted_message_text,
        quoted_is_from_user=quoted_is_from_user,
        preferred_language=preferred_language
    )

    # Check for silence token
    if response_text.strip() == "[SILENCE]":
        # Check for recent AI interaction (last 20 mins) to determine if conversation is active
        # If active, send a polite fallback instead of truly staying silent
        threshold_time = taiwan_now() - timedelta(minutes=AI_FALLBACK_EXPIRY_MINUTES)
        
        last_ai_msg = db.query(LineMessage).filter(
            LineMessage.line_user_id == line_user_id,
            LineMessage.clinic_id == clinic.id,
            LineMessage.is_from_user == False,
            LineMessage.created_at >= threshold_time
        ).order_by(LineMessage.created_at.desc()).first()

        if last_ai_msg:
            # Send localized fallback message
            if preferred_language == 'en':
                response_text = "I'm sorry, I don't have this information. Our staff will get back to you later!"
            else:
                response_text = "抱歉，我沒有這方面資訊。稍後再由診所人員回覆您喔！"
            
            logger.info(
                f"AI decided [SILENCE] but conversation is active. Sending fallback: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}"
            )
            # Proceed to label and send logic below
        else:
            logger.info(
                f"AI decided to remain silent: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}"
            )
            return {"status": "ok", "message": "AI remained silent"}

    # Prepend AI label if enabled in clinic settings
    if clinic.get_validated_settings().chat_settings.label_ai_replies:
        is_long = len(response_text) > AI_LABEL_LONG_THRESHOLD or "\n" in response_text
        separator = "\n" if is_long else " "
        label = ("[AI reply]" if preferred_language == 'en' else "[AI回覆]") + separator
        response_text = f"{label}{response_text}"

    # Send response back to patient via LINE
    bot_message_id = line_service.send_text_message(
        line_user_id=line_user_id,
        text=response_text,
        reply_token=reply_token
    )

    # Store bot response message
    if bot_message_id:
        try:
            LineMessageService.store_message(
                db=db,
                line_message_id=bot_message_id,
                line_user_id=line_user_id,
                clinic_id=clinic.id,
                message_text=response_text,
                message_type="text",
                is_from_user=False,
                quoted_message_id=None,
                session_id=session_id
            )
        except Exception as e:
            logger.warning(f"Failed to store bot response message: {e}")
        
        # Track AI reply for dashboard metrics (persists beyond 10-day LineMessage cleanup)
        # Note: This uses a separate transaction from LineMessageService.store_message().
        # This is intentional - if AI reply tracking fails, we don't want to rollback the
        # LineMessage storage. Message storage is more critical than dashboard metrics tracking.
        # The LineMessage table is used for quoted message functionality, while LineAiReply
        # is only for dashboard statistics. If tracking fails, we log the error but continue.
        try:
            ai_reply = LineAiReply(
                line_user_id=line_user_id,
                clinic_id=clinic.id,
                line_message_id=bot_message_id
            )
            db.add(ai_reply)
            db.commit()
            db.refresh(ai_reply)
            logger.debug(
                f"Tracked AI reply: clinic_id={clinic.id}, line_user_id={line_user_id[:10]}..."
            )
        except Exception as e:
            db.rollback()
            logger.exception(f"Failed to track AI reply for {line_user_id}: {e}")
            # Do not re-raise, message sending is higher priority than tracking

    logger.info(
        f"Successfully processed and sent response for clinic_id={clinic.id}, "
        f"line_user_id={line_user_id}"
    )

    return {"status": "ok", "message": "Message processed successfully"}


@router.post(
    "/webhook",
    summary="LINE webhook endpoint",
    description="Receives webhook events from LINE when patients send messages",
    response_class=JSONResponse,
    status_code=status.HTTP_200_OK,
)
async def line_webhook(
    request: Request,
    x_line_signature: str = Header(..., alias="X-Line-Signature"),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Handle LINE webhook events.

    This endpoint:
    1. Verifies webhook signature for security
    2. Extracts message data and identifies clinic
    3. Processes message through AI agent
    4. Sends response back to patient via LINE

    Args:
        request: FastAPI request object
        x_line_signature: LINE webhook signature from X-Line-Signature header
        db: Database session

    Returns:
        Dict with status message

    Raises:
        HTTPException: If signature verification fails or clinic not found
    """
    # Initialize context variables for error logging
    clinic_id = None
    line_user_id = None
    line_user = None

    try:
        # Extract and validate webhook data
        clinic, line_service, _body_str, payload = await _extract_webhook_data(
            request, x_line_signature, db
        )
        clinic_id = clinic.id

        # Extract event data to determine event type
        event_data = line_service.extract_event_data(payload)
        
        if not event_data:
            # Invalid payload - return OK to LINE
            logger.debug("Event data extraction returned None - invalid payload structure")
            return {"status": "ok", "message": "Event ignored (invalid structure)"}
        
        event_type, line_user_id, reply_token = event_data
        logger.debug(
            f"Extracted event data: event_type={event_type}, "
            f"line_user_id={line_user_id[:10] if line_user_id else 'None'}..., "
            f"reply_token={'present' if reply_token else 'missing'}"
        )
        
        # Handle follow/unfollow events first (before message processing)
        if event_type == 'follow':
            return _handle_follow_event(
                db, line_service, line_user_id, reply_token, clinic
            )
        
        if event_type == 'unfollow':
            return _handle_unfollow_event(
                db, line_user_id, clinic
            )
        
        # For message events, extract message data
        if event_type != 'message':
            # Not a message or follow/unfollow event - return OK to LINE
            logger.debug(f"Webhook event type '{event_type}' not handled, ignoring")
            return {"status": "ok", "message": f"Event ignored (type: {event_type})"}
        
        message_data = line_service.extract_message_data(payload)
        
        if not message_data:
            # Not a text message - return OK to LINE
            logger.debug("Webhook event is not a text message, ignoring")
            return {"status": "ok", "message": "Event ignored (not a text message)"}

        line_user_id, message_text, reply_token, message_id, quoted_message_id = message_data

        # IMPORTANT: Create LineUser proactively before processing message
        # This ensures clinic can manage AI settings even if chat is disabled
        try:
            line_user = LineUserService.get_or_create_line_user(
                db=db,
                line_user_id=line_user_id,
                clinic_id=clinic.id,
                line_service=line_service,
                display_name=None  # Will be fetched from LINE API if needed
            )
            logger.debug(
                f"LineUser ready: id={line_user.id}, "
                f"line_user_id={line_user.line_user_id[:10]}..., "
                f"display_name={line_user.display_name}"
            )
        except Exception as e:
            # Log but don't fail - we can still process the message
            logger.warning(
                f"Failed to create/update LineUser for {line_user_id[:10]}...: {e}. "
                "Continuing with message processing."
            )

        logger.info(
            f"Processing message from clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}, "
            f"message={message_text[:30]}..."
        )


        # Command: "LINK-XXXXX" - Link practitioner LINE account
        # This command works even if user is opted out
        # Stricter check: must match exact format LINK-##### (5 digits)
        link_code_pattern = re.compile(r'^LINK-\d{5}$', re.IGNORECASE)
        if link_code_pattern.match(message_text.strip()):
            if not reply_token:
                logger.warning("Link code command received but no reply_token available")
                return {"status": "ok", "message": "Command received but cannot reply"}
            return _handle_link_code_command(
                db, line_service, line_user_id, reply_token, message_text, clinic
            )


        # Check if AI is permanently disabled for this user
        # This is admin-controlled and persists until manually changed
        if is_ai_disabled(db, line_user_id, clinic.id):
            logger.info(
                f"Message from permanently disabled user ignored: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, message={message_text[:30]}..."
            )
            # Return OK to LINE but don't process the message
            return {"status": "ok", "message": "AI disabled for this user"}

        # Check if chat feature is enabled for this clinic
        validated_settings = clinic.get_validated_settings()
        if not validated_settings.chat_settings.chat_enabled:
            logger.info(
                f"Chat feature is disabled for clinic_id={clinic.id}. "
                f"Ignoring message from line_user_id={line_user_id}"
            )
            # Return OK to LINE but don't process the message
            return {"status": "ok", "message": "Chat feature is disabled"}

        # Check AI schedule
        if not is_ai_active_now(validated_settings.chat_settings.ai_reply_schedule):
            logger.info(
                f"AI reply skipped due to schedule: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, time={taiwan_now()}"
            )
            # Return OK to LINE but don't process the message
            return {"status": "ok", "message": "AI skipped due to schedule"}

        # Process regular message through AI agent
        # Regular messages require a reply_token to send responses
        if not reply_token:
            logger.warning("Regular message received but no reply_token available")
            return {"status": "ok", "message": "Message received but cannot reply"}
        return await _process_regular_message(
            db, line_service, line_user_id, message_text, reply_token,
            message_id, quoted_message_id, clinic,
            preferred_language=line_user.preferred_language if line_user else None
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # clinic_id and line_user_id are initialized at function start
        # and set when available, so they're safe to use here
        logger.exception(
            f"Unexpected error processing LINE webhook: {e} "
            f"(clinic_id={clinic_id}, line_user_id={line_user_id})"
        )
        # Return 200 OK to LINE even on errors to prevent retries
        # LINE will retry if we return error status codes
        return {"status": "error", "message": "Internal server error"}

