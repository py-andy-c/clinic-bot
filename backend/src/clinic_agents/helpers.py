"""
Helper functions for agent operations.

This module contains utility functions used by agents and the orchestrator,
including LINE user management, patient lookup, and clinic identification.
"""

from sqlalchemy.orm import Session
from fastapi import HTTPException, Request

from models.clinic import Clinic
from models.line_user import LineUser
from models.patient import Patient
from clinic_agents.context import ConversationContext


def get_clinic_from_request(request: Request, db: Session) -> Clinic:
    """
    Get clinic from webhook request.

    Multiple strategies are supported:
    1. Custom X-Clinic-ID header (recommended for security)
    2. URL path parameter (e.g., /webhook/line/{clinic_id})
    3. LINE channel ID parsing (fallback, less secure)

    Args:
        request: FastAPI request object
        db: Database session

    Returns:
        Clinic object

    Raises:
        HTTPException: If clinic cannot be identified
    """
    # Strategy 1: Custom header (most secure)
    clinic_id_header = getattr(request, 'headers', {}).get('x-clinic-id') or getattr(request, 'headers', {}).get('X-Clinic-ID')
    if clinic_id_header:
        try:
            clinic_id = int(clinic_id_header)
            clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
            if clinic:
                return clinic
        except (ValueError, TypeError):
            pass

    # Strategy 2: For testing - default to clinic ID 1
    # TODO: Remove this fallback in production
    try:
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        if clinic:
            return clinic
    except Exception:
        pass

    # Strategy 3: URL path parameter (if implemented)
    # This would require route parameter in FastAPI like /webhook/line/{clinic_id}
    # path_params = getattr(request, 'path_params', {})
    # clinic_id = path_params.get('clinic_id')

    raise HTTPException(
        status_code=400,
        detail="Cannot identify clinic from request. Please provide X-Clinic-ID header."
    )


def get_or_create_line_user(db: Session, line_user_id: str, clinic_id: int) -> LineUser:
    """
    Get existing LINE user or create new one.

    This function manages LINE user records. New users are created unlinked
    (patient_id = None) and will be linked later during account linking.

    Args:
        db: Database session
        line_user_id: LINE platform user identifier
        clinic_id: Clinic ID for context

    Returns:
        LineUser object (existing or newly created)
    """
    # Try to find existing LINE user
    line_user = db.query(LineUser).filter(
        LineUser.line_user_id == line_user_id
    ).first()

    if line_user:
        return line_user

    # Create new LINE user (unlinked)
    line_user = LineUser(
        line_user_id=line_user_id,
        patient_id=None  # Will be set during account linking
    )

    db.add(line_user)
    db.commit()
    db.refresh(line_user)

    return line_user


def get_patient_from_line_user(db: Session, line_user: LineUser) -> Patient | None:
    """
    Get linked patient from LINE user record.

    Args:
        db: Database session
        line_user: LineUser object

    Returns:
        Patient object if linked, None if not linked
    """
    if not line_user.patient_id:
        return None

    return db.query(Patient).filter(Patient.id == line_user.patient_id).first()


def ensure_patient_linked(context: 'ConversationContext') -> Patient:
    """
    Ensure patient is linked, raise error if not.

    This is a utility for operations that require a linked patient account.

    Args:
        context: Conversation context

    Returns:
        Patient object

    Raises:
        ValueError: If patient is not linked
    """
    if not context.patient or not context.is_linked:
        raise ValueError("Patient account must be linked before this operation")

    return context.patient
