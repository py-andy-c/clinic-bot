"""
Clinic readiness utilities for appointment booking.

This module provides utilities to check if a clinic is ready to handle appointment
bookings, including checking for appointment types and practitioner availability.
"""

from typing import List, Dict, Any
from dataclasses import dataclass
from sqlalchemy.orm import Session

from models.clinic import Clinic
from models.appointment_type import AppointmentType
from models.user import User
from models.practitioner_availability import PractitionerAvailability


@dataclass
class ClinicReadinessStatus:
    """Detailed clinic readiness status for appointments."""
    is_ready: bool
    missing_appointment_types: bool
    appointment_types_count: int
    practitioners_without_availability: List[Dict[str, Any]]  # [{"id": int, "name": str}, ...]
    practitioners_with_availability_count: int


def check_clinic_readiness_for_appointments(db: Session, clinic: Clinic) -> ClinicReadinessStatus:
    """
    Check clinic readiness for appointment booking with detailed status.

    Returns structured information about what's missing and who needs to configure availability.

    Args:
        db: Database session
        clinic: Clinic entity

    Returns:
        ClinicReadinessStatus: Detailed readiness information
    """
    # Check appointment types
    appointment_types_count = db.query(AppointmentType).filter(
        AppointmentType.clinic_id == clinic.id
    ).count()

    missing_appointment_types = appointment_types_count == 0

    # Get all practitioners
    # Note: roles.contains(['practitioner']) may not work correctly with JSON columns in SQLite
    # Use Python filtering instead
    all_users_in_clinic = db.query(User).filter(User.clinic_id == clinic.id).all()
    all_practitioners = [u for u in all_users_in_clinic if 'practitioner' in u.roles]

    # Get practitioners with availability configured
    # Note: roles.contains(['practitioner']) doesn't work reliably with SQLite JSON columns
    # So we get all users with availability and filter by role in Python
    users_with_availability = db.query(User).join(
        PractitionerAvailability,
        User.id == PractitionerAvailability.user_id
    ).filter(
        User.clinic_id == clinic.id
    ).distinct().all()

    # Filter to only practitioners in Python
    practitioners_with_availability = [
        u for u in users_with_availability
        if 'practitioner' in u.roles
    ]

    practitioners_with_availability_ids = {p.id for p in practitioners_with_availability}

    # Find practitioners without availability
    practitioners_without_availability = [
        {"id": p.id, "name": p.full_name}
        for p in all_practitioners
        if p.id not in practitioners_with_availability_ids
    ]

    is_ready = not missing_appointment_types and len(practitioners_with_availability) > 0

    return ClinicReadinessStatus(
        is_ready=is_ready,
        missing_appointment_types=missing_appointment_types,
        appointment_types_count=appointment_types_count,
        practitioners_without_availability=practitioners_without_availability,
        practitioners_with_availability_count=len(practitioners_with_availability)
    )
