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

logger = logging.getLogger(__name__)

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
        
        line_user_id, message_text = message_data
        
        logger.info(
            f"Processing message from clinic_id={clinic.id}, "
            f"line_user_id={line_user_id}, "
            f"message={message_text[:30]}..."
        )
        
        # Start loading animation to show user that response is being prepared
        # Animation will automatically stop when we send the response message
        line_service.start_loading_animation(line_user_id, loading_seconds=60)
        
        # Process message through AI agent
        response_text = await ClinicAgentService.process_message(
            line_user_id=line_user_id,
            message=message_text,
            clinic=clinic
        )
        
        # Send response back to patient via LINE
        # This will automatically stop the loading animation
        line_service.send_text_message(
            line_user_id=line_user_id,
            text=response_text
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
        logger.exception(f"Unexpected error processing LINE webhook: {e}")
        # Return 200 OK to LINE even on errors to prevent retries
        # LINE will retry if we return error status codes
        return {"status": "error", "message": "Internal server error"}

