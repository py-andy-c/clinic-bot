"""
LINE user management utilities.

This module contains functions for managing LINE user accounts and their
relationships with patient records in the clinic system.
"""

from sqlalchemy.orm import Session

from models.line_user import LineUser
from models.patient import Patient


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
