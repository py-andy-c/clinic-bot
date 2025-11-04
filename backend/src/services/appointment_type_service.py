"""
Appointment type service for appointment type management and validation.

This module contains all appointment type-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import AppointmentType
from utils.appointment_type_queries import (
    get_active_appointment_types_for_clinic,
    get_active_appointment_types_for_clinic_with_active_practitioners,
    get_appointment_type_by_id_with_soft_delete_check,
    soft_delete_appointment_type
)

logger = logging.getLogger(__name__)


class AppointmentTypeService:
    """
    Service class for appointment type operations.

    Contains business logic for appointment type management and validation that is shared
    across different API endpoints.
    """

    @staticmethod
    def get_appointment_type_by_id(
        db: Session,
        appointment_type_id: int,
        clinic_id: Optional[int] = None
    ) -> AppointmentType:
        """
        Get and validate appointment type by ID.

        Note: This method only returns active (non-deleted) appointment types.
        For admin operations that need to access deleted types, use the utility functions directly.
        
        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Optional clinic ID to validate ownership
            
        Returns:
            AppointmentType object
            
        Raises:
            HTTPException: If appointment type not found or doesn't belong to clinic
        """
        try:
            return get_appointment_type_by_id_with_soft_delete_check(
                db, appointment_type_id, clinic_id, include_deleted=False
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(e)
            )

    @staticmethod
    def list_appointment_types_for_clinic(
        db: Session,
        clinic_id: int
    ) -> List[AppointmentType]:
        """
        List all active (non-deleted) appointment types for a clinic.

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            List of active AppointmentType objects
        """
        return get_active_appointment_types_for_clinic(db, clinic_id)

    @staticmethod
    def list_appointment_types_for_booking(
        db: Session,
        clinic_id: int
    ) -> List[AppointmentType]:
        """
        List appointment types available for booking at a clinic.

        Only includes appointment types that have at least one active practitioner
        who can perform them. Used for LIFF appointment booking flow.

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            List of active AppointmentType objects available for booking
        """
        return get_active_appointment_types_for_clinic_with_active_practitioners(db, clinic_id)

    @staticmethod
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
            clinic_id: Clinic ID for validation

        Returns:
            The soft-deleted AppointmentType object

        Raises:
            HTTPException: If appointment type not found or doesn't belong to clinic
        """
        try:
            return soft_delete_appointment_type(db, appointment_type_id, clinic_id)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(e)
            )

