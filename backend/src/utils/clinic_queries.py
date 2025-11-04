"""
Utility functions for consistent clinic queries with active status filtering.

This module contains reusable query functions that ensure active clinic filtering
is applied consistently across all services and APIs.
"""

from typing import List
from sqlalchemy.orm import Session, Query

from models import Clinic


def filter_active_clinics(query: Query[Clinic]) -> Query[Clinic]:
    """
    Apply active status filter to clinic queries.

    Args:
        query: Base query for Clinic

    Returns:
        Query filtered to include only active clinics
    """
    return query.filter(Clinic.is_active == True)


def get_clinic_by_id_with_active_check(
    db: Session,
    clinic_id: int,
    require_active: bool = True
) -> Clinic:
    """
    Get clinic by ID with optional active status filtering.

    Args:
        db: Database session
        clinic_id: Clinic ID
        require_active: If True, only return active clinics

    Returns:
        Clinic object

    Raises:
        ValueError: If clinic not found or not active (when required)
    """
    query = db.query(Clinic).filter(Clinic.id == clinic_id)

    if require_active:
        query = filter_active_clinics(query)

    clinic = query.first()
    if not clinic:
        if require_active:
            raise ValueError("Clinic not found or not active")
        else:
            raise ValueError("Clinic not found")

    return clinic


def get_all_active_clinics(db: Session) -> List[Clinic]:
    """
    Get all active clinics.

    Args:
        db: Database session

    Returns:
        List of active Clinic objects
    """
    query = db.query(Clinic)
    return filter_active_clinics(query).all()
