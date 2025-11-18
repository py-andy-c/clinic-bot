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
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Request, HTTPException, status, Header, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from core.database import get_db
from models import Clinic, PractitionerLinkCode, User
from services.line_service import LINEService
from services.clinic_agent import ClinicAgentService
from services.line_message_service import LineMessageService, QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
from services.line_opt_out_service import (
    normalize_message_text,
    set_ai_opt_out,
    clear_ai_opt_out,
    is_ai_opted_out
)
from core.constants import (
    OPT_OUT_COMMAND,
    RE_ENABLE_COMMAND,
    AI_OPT_OUT_DURATION_HOURS
)

logger = logging.getLogger(__name__)

# Cache normalized commands for efficient comparison
_NORMALIZED_OPT_OUT_COMMAND = normalize_message_text(OPT_OUT_COMMAND)
_NORMALIZED_RE_ENABLE_COMMAND = normalize_message_text(RE_ENABLE_COMMAND)

router = APIRouter()


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
            detail="Missing destination field in webhook payload"
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
            detail=f"Clinic not found for destination: {destination}"
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
            detail="Invalid webhook signature"
        )

    return clinic, line_service, body_str, payload


def _handle_opt_out_command(
    db: Session,
    line_service: LINEService,
    line_user_id: str,
    reply_token: str,
    clinic: Clinic
) -> Dict[str, str]:
    """Handle '人工回覆' command to opt out of AI replies."""
    try:
        set_ai_opt_out(db, line_user_id, clinic.id, hours=AI_OPT_OUT_DURATION_HOURS)

        # Send confirmation message
        opt_out_message = (
            "好的，診所人員會盡快回覆您！\n\n"
            f"AI回覆功能將在接下來{AI_OPT_OUT_DURATION_HOURS}小時關閉。如果要重新啟用AI回覆功能，請在聊天室說「重啟AI」。"
        )
        line_service.send_text_message(
            line_user_id=line_user_id,
            text=opt_out_message,
            reply_token=reply_token
        )

        logger.info(
            f"User opted out of AI replies: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}"
        )
        return {"status": "ok", "message": "User opted out of AI replies"}
    except Exception as e:
        logger.exception(
            f"Error setting opt-out for clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}: {e}"
        )
        return {"status": "ok", "message": "Opt-out processed (message may have failed)"}


def _handle_re_enable_command(
    db: Session,
    line_service: LINEService,
    line_user_id: str,
    reply_token: str,
    clinic: Clinic
) -> Dict[str, str]:
    """Handle '重啟AI' command to re-enable AI replies."""
    try:
        cleared = clear_ai_opt_out(db, line_user_id, clinic.id)

        # Send confirmation message
        re_enable_message = "AI回覆功能已重新啟用。"
        line_service.send_text_message(
            line_user_id=line_user_id,
            text=re_enable_message,
            reply_token=reply_token
        )

        logger.info(
            f"User re-enabled AI replies: clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}, was_opted_out={cleared}"
        )
        return {"status": "ok", "message": "User re-enabled AI replies"}
    except Exception as e:
        logger.exception(
            f"Error clearing opt-out for clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}: {e}"
        )
        return {"status": "ok", "message": "Re-enable processed (message may have failed)"}


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

        # Idempotency check: if code was already used to link this LINE account to this user, return success
        if link_code.used_at is not None and user.line_user_id == line_user_id:
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

        # Check if this LINE account is already linked to a different user
        existing_user = db.query(User).filter(
            User.line_user_id == line_user_id,
            User.id != link_code.user_id
        ).first()

        if existing_user:
            error_message = "此 LINE 帳號已連結至其他帳號。"
            line_service.send_text_message(
                line_user_id=line_user_id,
                text=error_message,
                reply_token=reply_token
            )
            logger.warning(
                f"LINE account already linked to different user: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, code=LINK-{code}, existing_user_id={existing_user.id}, code_user_id={link_code.user_id}"
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
                f"line_user_id={line_user_id}, code=LINK-{code}, user_id={link_code.user_id}, user_line_user_id={user.line_user_id}"
            )
            return {"status": "ok", "message": "Link code already used"}

        # Link the LINE account (code is valid and unused)
        user.line_user_id = line_user_id
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
    clinic: Clinic
) -> Dict[str, str]:
    """Process regular message through AI agent and send response."""
    # Start loading animation
    line_service.start_loading_animation(line_user_id, loading_seconds=60)

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
        quoted_is_from_user=quoted_is_from_user
    )

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

    try:
        # Extract and validate webhook data
        clinic, line_service, body_str, payload = await _extract_webhook_data(
            request, x_line_signature, db
        )
        clinic_id = clinic.id

        # Extract message data
        message_data = line_service.extract_message_data(payload)

        if not message_data:
            # Not a text message or invalid payload - return OK to LINE
            logger.debug("Webhook event is not a text message, ignoring")
            return {"status": "ok", "message": "Event ignored (not a text message)"}

        line_user_id, message_text, reply_token, message_id, quoted_message_id = message_data

        logger.info(
            f"Processing message from clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}, "
            f"message={message_text[:30]}..."
        )

        # Normalize message text for command matching
        # Removes whitespace and common quote/parenthesis characters
        normalized_message = normalize_message_text(message_text)

        # Handle special commands FIRST (before any other processing)
        # These commands work even if chat is disabled or user is opted out

        # Command: "人工回覆" - Opt out of AI replies (case-insensitive)
        if normalized_message == _NORMALIZED_OPT_OUT_COMMAND:
            return _handle_opt_out_command(
                db, line_service, line_user_id, reply_token, clinic
            )

        # Command: "重啟AI" - Re-enable AI replies (case-insensitive)
        if normalized_message == _NORMALIZED_RE_ENABLE_COMMAND:
            return _handle_re_enable_command(
                db, line_service, line_user_id, reply_token, clinic
            )

        # Command: "LINK-XXXXX" - Link practitioner LINE account
        # This command works even if user is opted out
        # Stricter check: must match exact format LINK-##### (5 digits)
        link_code_pattern = re.compile(r'^LINK-\d{5}$', re.IGNORECASE)
        if link_code_pattern.match(message_text.strip()):
            return _handle_link_code_command(
                db, line_service, line_user_id, reply_token, message_text, clinic
            )

        # Check if user is opted out (and not expired)
        # If opted out, ignore the message - don't process, don't store
        if is_ai_opted_out(db, line_user_id, clinic.id):
            logger.info(
                f"Message from opted-out user ignored: clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, message={message_text[:30]}..."
            )
            # Return OK to LINE but don't process the message
            # Messages during opt-out period are not stored in conversation history
            return {"status": "ok", "message": "User opted out, message ignored"}

        # Check if chat feature is enabled for this clinic
        validated_settings = clinic.get_validated_settings()
        if not validated_settings.chat_settings.chat_enabled:
            logger.info(
                f"Chat feature is disabled for clinic_id={clinic.id}. "
                f"Ignoring message from line_user_id={line_user_id}"
            )
            # Return OK to LINE but don't process the message
            return {"status": "ok", "message": "Chat feature is disabled"}

        # Process regular message through AI agent
        return await _process_regular_message(
            db, line_service, line_user_id, message_text, reply_token,
            message_id, quoted_message_id, clinic
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

