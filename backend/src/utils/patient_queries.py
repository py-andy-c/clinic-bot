"""
Utility functions for consistent patient queries with soft delete logic.

This module contains reusable query functions that ensure soft delete filtering
is applied consistently across all services and APIs.
"""

import re
from typing import List, Optional
from sqlalchemy.orm import Session, Query
from sqlalchemy import func

from models import Patient, LineUser


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
    clinic_id: int,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    search: Optional[str] = None,
    include_deleted: bool = False,
    practitioner_id: Optional[int] = None
) -> tuple[List[Patient], int]:
    """
    Get patients for a clinic, optionally including deleted patients.

    Uses eager loading for line_user relationship to avoid N+1 queries
    when accessing patient.line_user in the API response.

    Args:
        db: Database session
        clinic_id: Clinic ID
        page: Optional page number (1-indexed). If None, returns all patients.
        page_size: Optional items per page. If None, returns all patients.
        search: Optional search query to filter patients by name, phone, or LINE user display name.
        include_deleted: If True, include soft-deleted patients. Defaults to False.
        practitioner_id: Optional practitioner (user) ID to filter by assigned practitioners.

    Returns:
        Tuple of (List of Patient objects with line_user relationship eagerly loaded, total count)
    """
    from sqlalchemy.orm import joinedload
    from sqlalchemy import or_

    # Eagerly load line_user relationship to avoid N+1 queries
    # This is critical for the clinic patients endpoint which accesses
    # patient.line_user.line_user_id and patient.line_user.display_name
    base_query = db.query(Patient).options(
        joinedload(Patient.line_user)
    ).filter(
        Patient.clinic_id == clinic_id
    )
    
    # Apply soft delete filter unless including deleted patients
    if not include_deleted:
        query = filter_active_patients(base_query)
    else:
        query = base_query
    
    # Apply search filter if provided
    if search and search.strip():
        search_pattern = f"%{search.strip()}%"
        
        # Normalize phone number search: strip non-digits from search query
        # This allows searching for "0912-345-678" to match "0912345678" in database
        # Use regexp_replace to normalize database phone numbers for comparison
        normalized_search = re.sub(r'\D', '', search.strip())
        phone_search_pattern = f"%{normalized_search}%" if normalized_search else None
        
        # Build search conditions
        # Search both clinic_display_name and display_name to allow finding by either
        search_conditions = [
            Patient.full_name.ilike(search_pattern),
            LineUser.clinic_display_name.ilike(search_pattern),
            LineUser.display_name.ilike(search_pattern)
        ]
        
        # Add phone number search with normalization
        # Use PostgreSQL's regexp_replace to strip non-digits from phone_number for comparison
        if phone_search_pattern:
            # Normalize database phone_number by removing non-digits, then search
            normalized_phone = func.regexp_replace(Patient.phone_number, r'[^\d]', '', 'g')
            search_conditions.append(normalized_phone.ilike(phone_search_pattern))
        else:
            # If search doesn't contain digits, still search raw phone_number (might match formatting)
            search_conditions.append(Patient.phone_number.ilike(search_pattern))
        
        # Search in patient name, phone number, or LINE user display name
        # Use outerjoin to include LINE user in search
        query = query.outerjoin(LineUser, Patient.line_user_id == LineUser.id).filter(
            or_(*search_conditions)
        ).distinct()
    
    # Filter by practitioner if provided
    if practitioner_id is not None:
        from models import PatientPractitionerAssignment
        query = query.join(
            PatientPractitionerAssignment,
            Patient.id == PatientPractitionerAssignment.patient_id
        ).filter(
            PatientPractitionerAssignment.user_id == practitioner_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).distinct()
    
    # Get total count before pagination
    total = query.count()
    
    # Apply pagination if provided
    if page is not None and page_size is not None:
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)
    
    patients = query.all()
    return patients, total


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
