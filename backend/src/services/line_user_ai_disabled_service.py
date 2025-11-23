"""
LINE user AI disabled service for managing permanent AI disable status.

This service handles checking, setting, and clearing permanent AI disable status
for LINE users per clinic. Unlike the temporary opt-out system, this setting
is admin-controlled and persists until manually changed.
"""

import logging
from typing import Optional, List, cast
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy import func, and_, distinct, or_, select

from models import LineUserAiDisabled, LineUser, Patient, LineMessage
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


def is_ai_disabled(
    db: Session,
    line_user_id: str,
    clinic_id: int
) -> bool:
    """
    Check if AI is permanently disabled for a LINE user.
    
    Returns False by default (if no record exists), meaning AI is enabled.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        
    Returns:
        bool: True if AI is permanently disabled, False otherwise
    """
    disabled = db.query(LineUserAiDisabled).filter(
        LineUserAiDisabled.line_user_id == line_user_id,
        LineUserAiDisabled.clinic_id == clinic_id
    ).first()
    
    return disabled is not None


def disable_ai_for_line_user(
    db: Session,
    line_user_id: str,
    clinic_id: int,
    disabled_by_user_id: Optional[int] = None,
    reason: Optional[str] = None
) -> LineUserAiDisabled:
    """
    Disable AI for a LINE user (create or update disable record).
    
    If a disable record already exists, updates it with new timestamp and reason.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        disabled_by_user_id: Optional ID of the admin user who disabled it
        reason: Optional reason/notes for audit trail
        
    Returns:
        LineUserAiDisabled: The created or updated disable record
    """
    # Use Taiwan timezone for consistency with other timestamps in the system
    now = taiwan_now()
    
    # Check if disable record already exists
    disabled = db.query(LineUserAiDisabled).filter(
        LineUserAiDisabled.line_user_id == line_user_id,
        LineUserAiDisabled.clinic_id == clinic_id
    ).first()
    
    if disabled:
        # Update existing record
        disabled.disabled_at = now
        disabled.disabled_by_user_id = disabled_by_user_id
        disabled.reason = reason
        disabled.updated_at = now
        logger.info(
            f"Updated AI disable for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}, disabled_by_user_id={disabled_by_user_id}"
        )
    else:
        # Create new record
        disabled = LineUserAiDisabled(
            line_user_id=line_user_id,
            clinic_id=clinic_id,
            disabled_at=now,
            disabled_by_user_id=disabled_by_user_id,
            reason=reason,
            created_at=now,
            updated_at=now
        )
        db.add(disabled)
        logger.info(
            f"Disabled AI for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}, disabled_by_user_id={disabled_by_user_id}"
        )
    
    db.commit()
    db.refresh(disabled)
    
    return disabled


def enable_ai_for_line_user(
    db: Session,
    line_user_id: str,
    clinic_id: int
) -> Optional[LineUserAiDisabled]:
    """
    Enable AI for a LINE user (delete disable record if it exists).
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        
    Returns:
        Optional[LineUserAiDisabled]: The deleted record if it existed, None otherwise
    """
    disabled = db.query(LineUserAiDisabled).filter(
        LineUserAiDisabled.line_user_id == line_user_id,
        LineUserAiDisabled.clinic_id == clinic_id
    ).first()
    
    if disabled:
        db.delete(disabled)
        db.commit()
        logger.info(
            f"Enabled AI for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}"
        )
        return disabled
    else:
        logger.debug(
            f"No disable record found to enable for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}"
        )
        return None


class LineUserWithStatus:
    """Data class for LineUser with AI status and patient information."""
    def __init__(
        self,
        line_user_id: str,
        display_name: Optional[str],
        patient_count: int,
        patient_names: List[str],
        ai_disabled: bool,
        disabled_at: Optional[datetime]
    ):
        self.line_user_id = line_user_id
        self.display_name = display_name
        self.patient_count = patient_count
        self.patient_names = patient_names
        self.ai_disabled = ai_disabled
        self.disabled_at = disabled_at


def get_line_users_for_clinic(
    db: Session,
    clinic_id: int,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    offset: Optional[int] = None,
    limit: Optional[int] = None
) -> tuple[List[LineUserWithStatus], int]:
    """
    Get all LineUsers who have interacted with this clinic (patients or messages), with AI status.
    
    This function:
    1. Gets distinct LineUsers who have either:
       - At least one active (non-deleted) patient in this clinic, OR
       - At least one message sent to this clinic
    2. Joins with Patient records to get patient count and names (if they have patients)
    3. Left joins with LineUserAiDisabled to check AI status
    4. Aggregates patient names (empty list if no patients)
    5. Supports pagination (page/page_size or offset/limit)
    
    This ensures that LINE users who have sent messages but haven't created patients yet
    are still visible in the admin UI, allowing clinics to manage AI settings for all users.
    
    Args:
        db: Database session
        clinic_id: Clinic ID
        page: Optional page number (1-indexed). Takes precedence over offset if both provided.
        page_size: Optional items per page. Takes precedence over limit if both provided.
        offset: Optional offset for pagination (deprecated, use page/page_size instead).
        limit: Optional limit for pagination (deprecated, use page/page_size instead).
        
    Returns:
        Tuple of (List[LineUserWithStatus], total_count): List of LineUsers with AI status and patient information, and total count
    """
    # Get distinct line_user_ids from both Patient and LineMessage tables
    # This ensures we include users who have interacted even without patients
    
    # Get all line_user_ids who have patients in this clinic
    patients_line_user_ids_subq = db.query(
        LineUser.line_user_id.label('line_user_id')
    ).join(
        Patient,
        and_(
            LineUser.id == Patient.line_user_id,
            Patient.clinic_id == clinic_id,
            Patient.is_deleted == False
        )
    ).distinct().subquery()
    
    # Get all line_user_ids who have sent messages to this clinic
    messages_line_user_ids_subq = db.query(
        LineMessage.line_user_id.label('line_user_id')
    ).filter(
        LineMessage.clinic_id == clinic_id
    ).distinct().subquery()
    
    # Combine both sources - users who have patients OR messages
    # Use a filter with OR condition to get LineUsers who match either condition
    base_query = db.query(
        LineUser.line_user_id,
        LineUser.display_name,
        func.coalesce(func.count(Patient.id), 0).label('patient_count'),
        func.array_agg(Patient.full_name).label('patient_names'),
        func.bool_or(LineUserAiDisabled.id.isnot(None)).label('ai_disabled'),
        func.max(LineUserAiDisabled.disabled_at).label('disabled_at')
    ).filter(
        or_(
            LineUser.line_user_id.in_(
                select(patients_line_user_ids_subq.c.line_user_id)
            ),
            LineUser.line_user_id.in_(
                select(messages_line_user_ids_subq.c.line_user_id)
            )
        )
    ).outerjoin(
        Patient,
        and_(
            LineUser.id == Patient.line_user_id,
            Patient.clinic_id == clinic_id,
            Patient.is_deleted == False
        )
    ).outerjoin(
        LineUserAiDisabled,
        and_(
            LineUserAiDisabled.line_user_id == LineUser.line_user_id,
            LineUserAiDisabled.clinic_id == clinic_id
        )
    ).group_by(
        LineUser.id,
        LineUser.line_user_id,
        LineUser.display_name
    ).order_by(
        LineUser.display_name.nulls_last(),
        LineUser.line_user_id
    )
    
    # Get total count before pagination
    # Count distinct LineUsers who have interacted (patients or messages)
    total = db.query(func.count(distinct(LineUser.id))).filter(
        or_(
            LineUser.line_user_id.in_(
                select(patients_line_user_ids_subq.c.line_user_id)
            ),
            LineUser.line_user_id.in_(
                select(messages_line_user_ids_subq.c.line_user_id)
            )
        )
    ).scalar() or 0
    
    # Convert page/page_size to offset/limit if provided
    if page is not None and page_size is not None:
        offset = (page - 1) * page_size
        limit = page_size
    
    # Apply pagination if provided
    query = base_query
    if offset is not None:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    
    # Execute query and format results
    results = query.all()
    
    line_users_with_status: List[LineUserWithStatus] = []
    for row in results:
        # Convert array_agg result (which may be None or a list) to a list
        # array_agg may return None if no patients, or a list that may contain None
        # values if some patients have NULL full_name
        patient_names_raw = row.patient_names
        if patient_names_raw is None:
            patient_names: List[str] = []
        else:
            # Cast to List[Optional[str]] first since array_agg may contain None values
            # Filter out None values in case some patients have NULL full_name
            patient_names_list = cast(List[Optional[str]], list(patient_names_raw))
            patient_names = [name for name in patient_names_list if name is not None]
        # Remove duplicates and sort
        patient_names = sorted(list(set(patient_names)))
        
        line_users_with_status.append(
            LineUserWithStatus(
                line_user_id=row.line_user_id,
                display_name=row.display_name,
                patient_count=row.patient_count,
                patient_names=patient_names,
                ai_disabled=bool(row.ai_disabled),
                disabled_at=row.disabled_at
            )
        )
    
    return line_users_with_status, total

