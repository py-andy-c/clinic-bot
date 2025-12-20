"""
Utility functions for consistent appointment type queries with soft delete logic.

This module contains reusable query functions that ensure soft delete filtering
is applied consistently across all services and APIs.
"""

from typing import List, Optional
from sqlalchemy.orm import Session, Query

from models import AppointmentType
from utils.datetime_utils import taiwan_now


def filter_active_appointment_types(query: Query[AppointmentType]) -> Query[AppointmentType]:
    """
    Apply soft delete filter to appointment type queries.

    Args:
        query: Base query for AppointmentType

    Returns:
        Query filtered to exclude soft-deleted appointment types
    """
    return query.filter(AppointmentType.is_deleted == False)


def get_active_appointment_types_for_clinic(
    db: Session,
    clinic_id: int
) -> List[AppointmentType]:
    """
    Get all active (non-deleted) appointment types for a clinic, ordered by display_order.

    Args:
        db: Database session
        clinic_id: Clinic ID

    Returns:
        List of active AppointmentType objects ordered by display_order
    """
    query = db.query(AppointmentType).filter_by(clinic_id=clinic_id)
    query = filter_active_appointment_types(query)
    query = query.order_by(AppointmentType.display_order.asc(), AppointmentType.id.asc())
    return query.all()


def get_appointment_type_by_id_with_soft_delete_check(
    db: Session,
    appointment_type_id: int,
    clinic_id: Optional[int] = None,
    include_deleted: bool = False
) -> AppointmentType:
    """
    Get appointment type by ID with optional soft delete filtering.

    Args:
        db: Database session
        appointment_type_id: Appointment type ID
        clinic_id: Optional clinic ID to validate ownership
        include_deleted: If True, include soft-deleted types

    Returns:
        AppointmentType object

    Raises:
        ValueError: If appointment type not found
    """
    query = db.query(AppointmentType).filter(AppointmentType.id == appointment_type_id)

    if not include_deleted:
        query = filter_active_appointment_types(query)

    if clinic_id is not None:
        query = query.filter(AppointmentType.clinic_id == clinic_id)

    appointment_type = query.first()
    if not appointment_type:
        raise ValueError("Appointment type not found")

    return appointment_type


def soft_delete_appointment_type(
    db: Session,
    appointment_type_id: int,
    clinic_id: Optional[int] = None
) -> AppointmentType:
    """
    Soft delete an appointment type.

    Args:
        db: Database session
        appointment_type_id: Appointment type ID
        clinic_id: Optional clinic ID for validation

    Returns:
        The soft-deleted AppointmentType object

    Raises:
        ValueError: If appointment type not found or doesn't belong to clinic
    """
    appointment_type = get_appointment_type_by_id_with_soft_delete_check(
        db, appointment_type_id, clinic_id, include_deleted=False
    )

    appointment_type.is_deleted = True
    appointment_type.deleted_at = taiwan_now()

    return appointment_type


def get_active_appointment_types_for_practitioner(
    db: Session,
    practitioner_id: int,
    clinic_id: int
) -> List[AppointmentType]:
    """
    Get all active (non-deleted) appointment types offered by a practitioner for a specific clinic.

    Args:
        db: Database session
        practitioner_id: Practitioner user ID
        clinic_id: Clinic ID to filter by (required for clinic isolation).

    Returns:
        List of active AppointmentType objects offered by the practitioner in the specified clinic
    """
    from models import PractitionerAppointmentTypes

    query = db.query(AppointmentType).join(
        PractitionerAppointmentTypes,
        AppointmentType.id == PractitionerAppointmentTypes.appointment_type_id
    ).filter(
        PractitionerAppointmentTypes.user_id == practitioner_id,
        PractitionerAppointmentTypes.clinic_id == clinic_id
    )

    query = filter_active_appointment_types(query)
    query = query.order_by(AppointmentType.display_order.asc(), AppointmentType.id.asc())
    return query.all()


def count_active_appointment_types_for_practitioner(
    db: Session,
    practitioner_id: int,
    clinic_id: int
) -> int:
    """
    Count active (non-deleted) appointment types offered by a practitioner for a specific clinic.

    Args:
        db: Database session
        practitioner_id: Practitioner user ID
        clinic_id: Clinic ID to filter by (required for clinic isolation).

    Returns:
        Count of active appointment types offered by the practitioner in the specified clinic
    """
    from models import PractitionerAppointmentTypes

    query = db.query(PractitionerAppointmentTypes).join(
        AppointmentType,
        PractitionerAppointmentTypes.appointment_type_id == AppointmentType.id
    ).filter(
        PractitionerAppointmentTypes.user_id == practitioner_id,
        PractitionerAppointmentTypes.clinic_id == clinic_id,
        AppointmentType.is_deleted == False
    )
    
    return query.count()


def get_active_appointment_types_for_clinic_with_active_practitioners(
    db: Session,
    clinic_id: int
) -> List[AppointmentType]:
    """
    Get all active (non-deleted) appointment types for a clinic that have at least one active practitioner.

    This function filters appointment types to only include those that can actually be booked,
    i.e., those that have active practitioners who can perform them.

    Args:
        db: Database session
        clinic_id: Clinic ID

    Returns:
        List of active AppointmentType objects that have active practitioners
    """
    from models import PractitionerAppointmentTypes, User, UserClinicAssociation
    from utils.query_helpers import filter_by_role

    # Get appointment types that have active practitioners associated
    subquery = db.query(PractitionerAppointmentTypes.appointment_type_id).join(
        User,
        PractitionerAppointmentTypes.user_id == User.id
    ).join(
        UserClinicAssociation,
        UserClinicAssociation.user_id == User.id
    ).filter(
        PractitionerAppointmentTypes.clinic_id == clinic_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    )
    subquery = filter_by_role(subquery, 'practitioner').distinct()

    query = db.query(AppointmentType).filter(
        AppointmentType.clinic_id == clinic_id,
        AppointmentType.id.in_(subquery)
    )

    query = filter_active_appointment_types(query)
    query = query.order_by(AppointmentType.display_order.asc(), AppointmentType.id.asc())
    return query.all()
