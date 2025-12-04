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
from sqlalchemy import func, and_

from models import LineUser, Patient
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


def is_ai_disabled(
    db: Session,
    line_user_id: str,
    clinic_id: int
) -> bool:
    """
    Check if AI is permanently disabled for a LINE user.
    
    Returns False by default (if LineUser doesn't exist), meaning AI is enabled.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        
    Returns:
        bool: True if AI is permanently disabled, False otherwise
    """
    line_user = db.query(LineUser).filter(
        LineUser.line_user_id == line_user_id,
        LineUser.clinic_id == clinic_id
    ).first()
    
    if not line_user:
        return False
    
    return line_user.ai_disabled


def disable_ai_for_line_user(
    db: Session,
    line_user_id: str,
    clinic_id: int,
    disabled_by_user_id: Optional[int] = None,
    reason: Optional[str] = None
) -> LineUser:
    """
    Disable AI for a LINE user (update LineUser record).
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        disabled_by_user_id: Optional ID of the admin user who disabled it
        reason: Optional reason/notes for audit trail
        
    Returns:
        LineUser: The updated LineUser record
        
    Raises:
        ValueError: If LineUser doesn't exist for this clinic
    """
    # Use Taiwan timezone for consistency with other timestamps in the system
    now = taiwan_now()
    
    # Get or create LineUser for this clinic
    line_user = db.query(LineUser).filter(
        LineUser.line_user_id == line_user_id,
        LineUser.clinic_id == clinic_id
    ).first()
    
    if not line_user:
        raise ValueError(
            f"LineUser not found for line_user_id={line_user_id}, clinic_id={clinic_id}. "
            "LineUser must be created before disabling AI."
        )
    
    # Update LineUser fields
    line_user.ai_disabled = True
    line_user.ai_disabled_at = now
    line_user.ai_disabled_by_user_id = disabled_by_user_id
    line_user.ai_disabled_reason = reason
    
    logger.info(
        f"Disabled AI for line_user_id={line_user_id}, "
        f"clinic_id={clinic_id}, disabled_by_user_id={disabled_by_user_id}"
    )
    
    db.commit()
    db.refresh(line_user)
    
    return line_user


def enable_ai_for_line_user(
    db: Session,
    line_user_id: str,
    clinic_id: int
) -> Optional[LineUser]:
    """
    Enable AI for a LINE user (clear disable fields on LineUser).
    
    This is an idempotent operation - if AI is already enabled or LineUser doesn't exist,
    the function returns None or the LineUser respectively without error.
    
    Args:
        db: Database session
        line_user_id: LINE user ID string
        clinic_id: Clinic ID
        
    Returns:
        Optional[LineUser]: The updated LineUser if it existed, None if LineUser doesn't exist.
        Note: This is a behavior change from the old implementation which returned None
        when AI was not disabled. The new implementation returns LineUser even if AI
        was already enabled (idempotent behavior).
    """
    line_user = db.query(LineUser).filter(
        LineUser.line_user_id == line_user_id,
        LineUser.clinic_id == clinic_id
    ).first()
    
    if line_user:
        # Clear disable fields
        line_user.ai_disabled = False
        line_user.ai_disabled_at = None
        line_user.ai_disabled_by_user_id = None
        line_user.ai_disabled_reason = None
        
        db.commit()
        db.refresh(line_user)
        logger.info(
            f"Enabled AI for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}"
        )
        return line_user
    else:
        logger.debug(
            f"No LineUser found to enable AI for line_user_id={line_user_id}, "
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
    limit: Optional[int] = None,
    search: Optional[str] = None
) -> tuple[List[LineUserWithStatus], int]:
    """
    Get all LineUsers for a clinic with AI status and patient information.
    
    This function:
    1. Gets all LineUsers for this clinic (filtered by clinic_id)
    2. Left joins with Patient records to get patient count and names
    3. AI status is already a field on LineUser (no join needed)
    4. Aggregates patient names
    5. Supports pagination (page/page_size or offset/limit)
    6. Supports search by display_name or patient names
    
    Note: LineUsers are only created when users interact with the clinic (via webhook
    messages, follow events, or LIFF login), so all LineUsers in the database have
    already interacted with the clinic. We simply query all LineUsers for the clinic.
    
    Args:
        db: Database session
        clinic_id: Clinic ID
        page: Optional page number (1-indexed). Takes precedence over offset if both provided.
        page_size: Optional items per page. Takes precedence over limit if both provided.
        offset: Optional offset for pagination (deprecated, use page/page_size instead).
        limit: Optional limit for pagination (deprecated, use page/page_size instead).
        search: Optional search query to filter by LINE user display_name or patient names.
        
    Returns:
        Tuple of (List[LineUserWithStatus], total_count): List of LineUsers with AI status and patient information, and total count
    """
    from sqlalchemy import or_
    
    # Query: Get all LineUsers for this clinic with patient information
    # Use LEFT JOIN so users without patients still appear (with 0 patient_count)
    # Use COALESCE to get effective display name (clinic_display_name if set, else display_name)
    base_query = db.query(
        LineUser.line_user_id,
        func.coalesce(LineUser.clinic_display_name, LineUser.display_name).label('display_name'),
        func.coalesce(func.count(func.distinct(Patient.id)), 0).label('patient_count'),
        func.array_agg(Patient.full_name).label('patient_names'),
        LineUser.ai_disabled.label('ai_disabled'),
        LineUser.ai_disabled_at.label('disabled_at')
    ).filter(
        LineUser.clinic_id == clinic_id
    ).outerjoin(
        Patient,
        and_(
            LineUser.id == Patient.line_user_id,
            Patient.clinic_id == clinic_id,
            Patient.is_deleted == False
        )
    )
    
    # Apply search filter if provided
    # Extract search pattern once to avoid duplication
    search_pattern = None
    if search and search.strip():
        search_pattern = f"%{search.strip()}%"
        # Search in LINE user display names (both clinic_display_name and display_name) or patient names
        # This allows finding users by either their clinic display name or original display name
        base_query = base_query.filter(
            or_(
                LineUser.clinic_display_name.ilike(search_pattern),
                LineUser.display_name.ilike(search_pattern),
                Patient.full_name.ilike(search_pattern)
            )
        )
    
    base_query = base_query.group_by(
        LineUser.id,
        LineUser.line_user_id,
        LineUser.clinic_display_name,
        LineUser.display_name,
        LineUser.ai_disabled,
        LineUser.ai_disabled_at
    ).order_by(
        func.coalesce(LineUser.clinic_display_name, LineUser.display_name).nulls_last(),
        LineUser.line_user_id
    )
    
    # Get total count before pagination
    # Need to account for search filter if provided
    if search_pattern:
        # Count distinct LineUsers that match search criteria
        total_query = db.query(func.count(func.distinct(LineUser.id))).filter(
            LineUser.clinic_id == clinic_id
        ).outerjoin(
            Patient,
            and_(
                LineUser.id == Patient.line_user_id,
                Patient.clinic_id == clinic_id,
                Patient.is_deleted == False
            )
        ).filter(
            or_(
                LineUser.clinic_display_name.ilike(search_pattern),
                LineUser.display_name.ilike(search_pattern),
                Patient.full_name.ilike(search_pattern)
            )
        )
        total = total_query.scalar() or 0
    else:
        # Simply count all LineUsers for this clinic
        total = db.query(func.count(LineUser.id)).filter(
            LineUser.clinic_id == clinic_id
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
        # Note: Users with messages but no patients will have patient_count=0 and patient_names=None
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
                ai_disabled=bool(row.ai_disabled) if row.ai_disabled is not None else False,
                disabled_at=row.disabled_at
            )
        )
    
    return line_users_with_status, total

