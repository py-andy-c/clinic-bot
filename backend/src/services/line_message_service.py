# pyright: reportMissingTypeStubs=false
"""
LINE message service for storing and retrieving LINE message metadata.

This service handles storing LINE messages and retrieving quoted messages
for the AI agent. LINE's API only allows retrieving media content but not
text messages, so we need to store text messages ourselves.
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

from models import LineMessage

logger = logging.getLogger(__name__)

# Internal protocol: Sentinel value to indicate that a user attempted to quote a message
# but the content couldn't be retrieved (e.g., message not found, non-text message, or error)
# This is used as a protocol between line_webhook and clinic_agent services
QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE = "__QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE__"


class LineMessageService:
    """
    Service for storing and retrieving LINE message metadata.
    
    Handles storage of LINE messages and retrieval of quoted messages
    for the AI agent to understand context when users quote previous messages.
    """
    
    @staticmethod
    def store_message(
        db: Session,
        line_message_id: str,
        line_user_id: str,
        clinic_id: int,
        message_text: Optional[str],
        message_type: str = "text",
        is_from_user: bool = True,
        quoted_message_id: Optional[str] = None,
        session_id: str = ""
    ) -> LineMessage:
        """
        Store a LINE message in the database.
        
        Args:
            db: Database session
            line_message_id: LINE's message ID (unique identifier)
            line_user_id: LINE user ID
            clinic_id: Clinic ID
            message_text: Text content (None for non-text messages)
            message_type: Type of message (default: "text")
            is_from_user: True if from user, False if from bot
            quoted_message_id: LINE message ID of quoted message (if any)
            session_id: Session ID for correlation with SDK conversation history
            
        Returns:
            Created LineMessage entity
            
        Raises:
            Exception: If storage fails
        """
        try:
            line_message = LineMessage(
                line_message_id=line_message_id,
                line_user_id=line_user_id,
                clinic_id=clinic_id,
                message_text=message_text,
                message_type=message_type,
                is_from_user=is_from_user,
                quoted_message_id=quoted_message_id,
                session_id=session_id
            )
            db.add(line_message)
            db.commit()
            db.refresh(line_message)
            
            logger.debug(
                f"Stored LINE message: line_message_id={line_message_id[:10]}..., "
                f"clinic_id={clinic_id}, is_from_user={is_from_user}"
            )
            
            return line_message
        except Exception as e:
            db.rollback()
            logger.exception(f"Failed to store LINE message: {e}")
            raise
    
    @staticmethod
    def get_quoted_message(
        db: Session,
        quoted_message_id: str,
        clinic_id: int,
        line_user_id: str
    ) -> Optional[tuple[str, bool]]:
        """
        Retrieve the text content and sender information of a quoted message.
        
        Args:
            db: Database session
            quoted_message_id: LINE message ID of the quoted message
            clinic_id: Clinic ID (for validation)
            line_user_id: LINE user ID (for validation)
            
        Returns:
            Tuple of (message_text, is_from_user) if found and is text, None otherwise.
            Returns None if:
            - Message not found
            - Message is not a text message
            - Message belongs to different clinic/user (security check)
        """
        try:
            # Query for the quoted message with security checks in the query
            quoted_message = db.query(LineMessage).filter(
                LineMessage.line_message_id == quoted_message_id,
                LineMessage.clinic_id == clinic_id,
                LineMessage.line_user_id == line_user_id,
                LineMessage.message_type == "text",
                LineMessage.message_text.isnot(None)
            ).first()
            
            if not quoted_message:
                logger.debug(
                    f"Quoted message not found or invalid: quoted_message_id={quoted_message_id[:10]}..."
                )
                return None
            
            # Return text content and sender information
            # message_text is guaranteed to be non-None due to query filter (message_text.isnot(None))
            if quoted_message.message_text is None:
                return None
            return (quoted_message.message_text, quoted_message.is_from_user)
            
        except Exception as e:
            logger.exception(f"Error retrieving quoted message: {e}")
            return None
    
