"""
Practitioner helper utilities for consistent practitioner validation and name lookup.

This module consolidates practitioner-related helper functions that were duplicated
across multiple files, providing a single source of truth for practitioner operations.
"""

import logging
from typing import Optional, Dict, List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from models import User, UserClinicAssociation
from models.appointment import Appointment
from utils.query_helpers import filter_by_role

logger = logging.getLogger(__name__)


def get_practitioner_display_name(
    db: Session,
    user_id: int,
    clinic_id: int
) -> Optional[str]:
    """
    Get practitioner display name from UserClinicAssociation.
    
    Returns full_name from association if available, otherwise falls back to email.
    Returns None if practitioner not found.
    
    Example:
        >>> name = get_practitioner_display_name(db, user_id=1, clinic_id=1)
        >>> # Returns "Dr. Smith" if full_name is set, or "doctor@example.com" if not
    
    Args:
        db: Database session
        user_id: Practitioner user ID
        clinic_id: Clinic ID
        
    Returns:
        Practitioner display name (full_name or email), or None if not found
    """
    # Eagerly load user to avoid N+1 query when falling back to email
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).options(joinedload(UserClinicAssociation.user)).first()
    
    if not association:
        return None
    
    # Return full_name if available, otherwise fall back to email
    if association.full_name:
        return association.full_name
    
    # Fallback to email if full_name is empty or None
    user = association.user
    return user.email if user else None


def verify_practitioner_in_clinic(
    db: Session,
    user_id: int,
    clinic_id: int
) -> tuple[User, UserClinicAssociation]:
    """
    Verify that a user exists, is active, is in the clinic, and has practitioner role.
    
    This function efficiently queries UserClinicAssociation directly and eagerly loads
    the User relationship to avoid N+1 queries.
    
    Args:
        db: Database session
        user_id: User ID to verify
        clinic_id: Clinic ID to verify membership in
        
    Returns:
        Tuple of (User, UserClinicAssociation) if valid
        
    Raises:
        HTTPException(404) if user not found, inactive, or not a practitioner
    """
    # Query association directly (more efficient than joining User first)
    # Use joinedload to eagerly load user relationship to avoid additional query
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).options(joinedload(UserClinicAssociation.user)).first()
    
    if not association:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師或治療師已停用"
        )
    
    user = association.user
    
    if 'practitioner' not in (association.roles or []):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師或治療師已停用"
        )
    
    return user, association


def validate_practitioner_for_clinic(
    db: Session,
    practitioner_id: int,
    clinic_id: int
) -> User:
    """
    Validate that a practitioner exists, is active, and belongs to the clinic.
    
    This is a simplified version that returns only the User object.
    Use verify_practitioner_in_clinic() if you also need the association.
    
    Args:
        db: Database session
        practitioner_id: Practitioner user ID
        clinic_id: Clinic ID
        
    Returns:
        User object (practitioner)
        
    Raises:
        HTTPException: If practitioner not found, inactive, or doesn't belong to clinic
    """
    # Single query to get practitioner with association and verify role
    query = db.query(User).join(UserClinicAssociation).filter(
        User.id == practitioner_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    )
    query = filter_by_role(query, 'practitioner')
    practitioner = query.first()
    
    if not practitioner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="治療師不存在"
        )
    
    return practitioner


def get_practitioner_display_names_batch(
    db: Session,
    user_ids: List[int],
    clinic_id: int
) -> Dict[int, str]:
    """
    Get practitioner display names for multiple users in a single query.
    
    This function efficiently batches the lookup to avoid N+1 queries when
    displaying multiple practitioner names.
    
    Args:
        db: Database session
        user_ids: List of practitioner user IDs
        clinic_id: Clinic ID
        
    Returns:
        Dictionary mapping user_id to display name (full_name or email)
        Only includes users that have active associations in the clinic
    """
    if not user_ids:
        return {}
    
    # Batch query associations with eagerly loaded users
    associations = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id.in_(user_ids),
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).options(joinedload(UserClinicAssociation.user)).all()
    
    result: Dict[int, str] = {}
    for association in associations:
        # Use full_name if available, otherwise fall back to email
        display_name = association.full_name if association.full_name else (
            association.user.email if association.user else None
        )
        if display_name:
            result[association.user_id] = display_name
    
    return result


# Constant for auto-assigned practitioner display name
AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME = '不指定'


def get_practitioner_display_name_for_appointment(
    db: Session,
    appointment: Appointment,
    clinic_id: int
) -> str:
    """
    Get practitioner display name for patient-facing appointment display.
    
    Returns "不指定" for auto-assigned appointments, otherwise returns the actual
    practitioner display name (full_name or email).
    
    This function consolidates the logic for returning practitioner names in
    appointment responses, ensuring consistency across all endpoints.
    
    Args:
        db: Database session
        appointment: Appointment object with is_auto_assigned attribute
        clinic_id: Clinic ID for association lookup
        
    Returns:
        Practitioner display name ("不指定" for auto-assigned, or actual name)
    """
    if appointment.is_auto_assigned:
        return AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
    
    # Get actual practitioner name
    if appointment.calendar_event and appointment.calendar_event.user_id:
        name = get_practitioner_display_name(
            db, appointment.calendar_event.user_id, clinic_id
        )
        if name:
            return name
    
    # Fallback (shouldn't happen for valid appointments)
    return AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME

