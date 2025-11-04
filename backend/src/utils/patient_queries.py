"""
Utility functions for consistent patient queries with soft delete logic.

This module contains reusable query functions that ensure soft delete filtering
is applied consistently across all services and APIs.
"""

from typing import List, Optional
from sqlalchemy.orm import Session, Query

from models import Patient


def filter_active_patients(query: Query[Patient]) -> Query[Patient]:
    """
    Apply soft delete filter to patient queries.

    Args:
        query: Base query for Patient

    Returns:
        Query filtered to exclude soft-deleted patients
    """
    return query.filter(Patient.is_deleted == False)


def get_active_patients_for_line_user(
    db: Session,
    line_user_id: int,
    clinic_id: int
) -> List[Patient]:
    """
    Get all active (non-deleted) patients for a LINE user at a clinic.

    Args:
        db: Database session
        line_user_id: LINE user ID
        clinic_id: Clinic ID

    Returns:
        List of active Patient objects
    """
    query = db.query(Patient).filter_by(
        line_user_id=line_user_id,
        clinic_id=clinic_id
    )
    return filter_active_patients(query).order_by(Patient.created_at).all()


def get_active_patients_for_clinic(
    db: Session,
    clinic_id: int
) -> List[Patient]:
    """
    Get all active (non-deleted) patients for a clinic.

    Args:
        db: Database session
        clinic_id: Clinic ID

    Returns:
        List of active Patient objects
    """
    from sqlalchemy.orm import joinedload

    query = db.query(Patient).options(
        joinedload(Patient.line_user)
    ).filter(
        Patient.clinic_id == clinic_id
    )
    return filter_active_patients(query).all()


def get_all_patients_for_clinic(
    db: Session,
    clinic_id: int,
    include_deleted: bool = False
) -> List[Patient]:
    """
    Get all patients for a clinic (admin view with optional deleted patients).

    Args:
        db: Database session
        clinic_id: Clinic ID
        include_deleted: If True, include soft-deleted patients

    Returns:
        List of Patient objects (filtered by include_deleted)
    """
    from sqlalchemy.orm import joinedload

    query = db.query(Patient).options(
        joinedload(Patient.line_user)
    ).filter(
        Patient.clinic_id == clinic_id
    )

    if not include_deleted:
        query = filter_active_patients(query)

    return query.all()


def get_patient_by_id_with_soft_delete_check(
    db: Session,
    patient_id: int,
    clinic_id: Optional[int] = None,
    include_deleted: bool = False
) -> Patient:
    """
    Get patient by ID with optional soft delete filtering.

    Args:
        db: Database session
        patient_id: Patient ID
        clinic_id: Optional clinic ID to validate ownership
        include_deleted: If True, include soft-deleted patients

    Returns:
        Patient object

    Raises:
        ValueError: If patient not found
    """
    query = db.query(Patient).filter(Patient.id == patient_id)

    if not include_deleted:
        query = filter_active_patients(query)

    if clinic_id is not None:
        query = query.filter(Patient.clinic_id == clinic_id)

    patient = query.first()
    if not patient:
        raise ValueError("Patient not found")

    return patient


def soft_delete_patient(
    db: Session,
    patient_id: int,
    clinic_id: Optional[int] = None
) -> Patient:
    """
    Soft delete a patient.

    Args:
        db: Database session
        patient_id: Patient ID
        clinic_id: Optional clinic ID for validation

    Returns:
        The soft-deleted Patient object

    Raises:
        ValueError: If patient not found or doesn't belong to clinic
    """
    from datetime import datetime, timezone

    patient = get_patient_by_id_with_soft_delete_check(
        db, patient_id, clinic_id, include_deleted=False
    )

    patient.is_deleted = True
    patient.deleted_at = datetime.now(timezone.utc)

    return patient
