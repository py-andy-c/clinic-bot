"""
LINE AI opt-out service for managing user opt-out status.

This service handles setting, clearing, and checking AI opt-out status
for LINE users per clinic. Opt-out expires after 24 hours.
"""

import logging
from datetime import timedelta

from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from models import LineUserAiOptOut
from utils.datetime_utils import taiwan_now
from core.constants import AI_OPT_OUT_DURATION_HOURS

logger = logging.getLogger(__name__)


def normalize_message_text(text: str) -> str:
    """
    Normalize message text by removing whitespace and common quote/parenthesis characters.
    
    Removes:
    - Leading/trailing whitespace
    - Common quote characters: "", '', 「」, 『』, 《》, 【】
    - Common parenthesis: (), （）, [], 【】
    
    Also converts to lowercase for case-insensitive matching (e.g., "重啟ai" matches "重啟AI").
    
    Note: This normalization is used for exact command matching only. It does not
    affect regular messages - commands must match exactly after normalization.
    For example, "人工回覆" (with quotes) matches the command, but "我想人工回覆一下"
    (which contains the command text) does not match because it's not an exact match.
    
    Args:
        text: Raw message text
        
    Returns:
        Normalized text with quotes and whitespace removed, converted to lowercase
    """
    # Remove whitespace
    normalized = text.strip()
    
    # Remove common quote and parenthesis characters
    # These are common in Traditional Chinese text input
    quote_chars = ['"', '"', "'", "'", '「', '」', '『', '』', '《', '》', '【', '】', 
                   '(', ')', '（', '）', '[', ']']
    
    for char in quote_chars:
        normalized = normalized.replace(char, '')
    
    # Remove any remaining whitespace after quote removal
    normalized = normalized.strip()
    
    # Convert to lowercase for case-insensitive matching
    normalized = normalized.lower()
    
    return normalized


def set_ai_opt_out(
    db: Session,
    line_user_id: str,
    clinic_id: int,
    hours: int = AI_OPT_OUT_DURATION_HOURS
) -> LineUserAiOptOut:
    """
    Set AI opt-out for a LINE user for the specified number of hours.
    
    If the user is already opted out, extends the opt-out period from now.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        hours: Number of hours to opt out (default: 24)
        
    Returns:
        LineUserAiOptOut: The opt-out record (created or updated)
    """
    now = taiwan_now()
    opted_out_until = now + timedelta(hours=hours)
    
    # Check if opt-out already exists
    opt_out = db.query(LineUserAiOptOut).filter(
        LineUserAiOptOut.line_user_id == line_user_id,
        LineUserAiOptOut.clinic_id == clinic_id
    ).first()
    
    if opt_out:
        # Update existing opt-out (extend from now)
        opt_out.opted_out_until = opted_out_until
        opt_out.updated_at = now
        logger.info(
            f"Extended AI opt-out for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id} until {opted_out_until}"
        )
    else:
        # Create new opt-out
        opt_out = LineUserAiOptOut(
            line_user_id=line_user_id,
            clinic_id=clinic_id,
            opted_out_until=opted_out_until
        )
        db.add(opt_out)
        logger.info(
            f"Set AI opt-out for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id} until {opted_out_until}"
        )
    
    db.commit()
    db.refresh(opt_out)
    
    return opt_out


def clear_ai_opt_out(
    db: Session,
    line_user_id: str,
    clinic_id: int
) -> bool:
    """
    Clear AI opt-out for a LINE user.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        
    Returns:
        bool: True if opt-out was cleared, False if no opt-out existed
    """
    opt_out = db.query(LineUserAiOptOut).filter(
        LineUserAiOptOut.line_user_id == line_user_id,
        LineUserAiOptOut.clinic_id == clinic_id
    ).first()
    
    if opt_out:
        db.delete(opt_out)
        db.commit()
        logger.info(
            f"Cleared AI opt-out for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}"
        )
        return True
    else:
        logger.debug(
            f"No opt-out found to clear for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}"
        )
        return False


def is_ai_opted_out(
    db: Session,
    line_user_id: str,
    clinic_id: int
) -> bool:
    """
    Check if a LINE user is currently opted out of AI replies.
    
    Automatically treats expired opt-outs as not opted out.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        
    Returns:
        bool: True if user is opted out and opt-out hasn't expired, False otherwise
    """
    opt_out = db.query(LineUserAiOptOut).filter(
        LineUserAiOptOut.line_user_id == line_user_id,
        LineUserAiOptOut.clinic_id == clinic_id
    ).first()
    
    if not opt_out:
        return False
    
    # Check if opt-out has expired
    now = taiwan_now()
    if opt_out.opted_out_until < now:
        # Opt-out expired - clean it up
        # Handle race condition: if another request already deleted it, catch any SQLAlchemy error
        try:
            db.delete(opt_out)
            db.commit()
            logger.debug(
                f"Expired opt-out cleaned up for line_user_id={line_user_id}, "
                f"clinic_id={clinic_id}"
            )
        except SQLAlchemyError:
            # Another request may have already deleted this record, or other DB error occurred
            # This is fine - the record is gone either way
            db.rollback()
            logger.debug(
                f"Expired opt-out cleanup handled (may have been deleted by another request): "
                f"line_user_id={line_user_id}, clinic_id={clinic_id}"
            )
        return False
    
    return True

