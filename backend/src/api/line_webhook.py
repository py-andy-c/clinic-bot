# pyright: reportMissingTypeStubs=false
"""
LINE webhook endpoint for receiving patient messages.

This endpoint receives webhook events from LINE when patients send messages
to the clinic's LINE Official Account. It processes messages through the
AI agent and sends responses back to patients.
"""

import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, Request, HTTPException, status, Header, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from core.database import get_db
from models import Clinic
from services.line_service import LINEService
from services.clinic_agent import ClinicAgentService
from services.line_opt_out_service import (
    normalize_message_text,
    set_ai_opt_out,
    clear_ai_opt_out,
    is_ai_opted_out
)
from core.constants import OPT_OUT_COMMAND, RE_ENABLE_COMMAND, AI_OPT_OUT_DURATION_HOURS

logger = logging.getLogger(__name__)

# Cache normalized commands for efficient comparison
_NORMALIZED_OPT_OUT_COMMAND = normalize_message_text(OPT_OUT_COMMAND)
_NORMALIZED_RE_ENABLE_COMMAND = normalize_message_text(RE_ENABLE_COMMAND)

router = APIRouter()


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
        # Get raw request body for signature verification
        # Note: We need to read body first before parsing JSON
        body_bytes = await request.body()
        body_str = body_bytes.decode('utf-8')
        
        # Parse JSON payload
        payload: Dict[str, Any] = json.loads(body_str)
        
        # Extract official account user ID from payload (destination field)
        # Note: 'destination' contains the bot's user ID (official account user ID),
        # not the channel ID. This is what LINE sends in webhook payloads.
        if 'destination' not in payload:
            logger.warning("LINE webhook missing destination field")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing destination field in webhook payload"
            )
        
        destination = payload['destination']
        
        # Look up clinic by official account user ID (primary method)
        clinic = db.query(Clinic).filter(
            Clinic.line_official_account_user_id == destination
        ).first()
        
        if not clinic:
            logger.warning(f"Clinic not found for destination={destination}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Clinic not found for destination: {destination}"
            )
        
        # Store clinic_id for error logging
        clinic_id = clinic.id
        
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
        
        # Extract message data
        message_data = line_service.extract_message_data(payload)
        
        if not message_data:
            # Not a text message or invalid payload - return OK to LINE
            logger.debug("Webhook event is not a text message, ignoring")
            return {"status": "ok", "message": "Event ignored (not a text message)"}
        
        line_user_id, message_text, reply_token = message_data
        
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
            try:
                set_ai_opt_out(db, line_user_id, clinic.id, hours=AI_OPT_OUT_DURATION_HOURS)
                
                # Send confirmation message with configurable duration
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
                # Opt-out may have been set but message send failed - return OK to prevent retry
                return {"status": "ok", "message": "Opt-out processed (message may have failed)"}
        
        # Command: "重啟AI" - Re-enable AI replies (case-insensitive)
        if normalized_message == _NORMALIZED_RE_ENABLE_COMMAND:
            try:
                cleared = clear_ai_opt_out(db, line_user_id, clinic.id)
                
                # Send confirmation message (even if already enabled)
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
                # Opt-out may have been cleared but message send failed - return OK to prevent retry
                return {"status": "ok", "message": "Re-enable processed (message may have failed)"}
        
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
        
        # Start loading animation to show user that response is being prepared
        # Animation will automatically stop when we send the response message
        line_service.start_loading_animation(line_user_id, loading_seconds=60)
        
        # Generate session ID: format is "{clinic_id}-{line_user_id}"
        # Note: We use the LINE user ID string directly - no need to create LineUser entity
        # LineUser records are created when users first use LIFF (appointment booking)
        session_id = f"{clinic.id}-{line_user_id}"
        
        # Process message through AI agent
        response_text = await ClinicAgentService.process_message(
            session_id=session_id,
            message=message_text,
            clinic=clinic
        )
        
        # Send response back to patient via LINE
        # This will automatically stop the loading animation
        # Use reply_message if reply_token is available, otherwise fall back to push_message
        line_service.send_text_message(
            line_user_id=line_user_id,
            text=response_text,
            reply_token=reply_token
        )
        
        logger.info(
            f"Successfully processed and sent response for clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}"
        )
        
        return {"status": "ok", "message": "Message processed successfully"}
        
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

