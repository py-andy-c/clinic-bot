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
        
        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Optional clinic ID to validate ownership
            
        Returns:
            AppointmentType object
            
        Raises:
            HTTPException: If appointment type not found or doesn't belong to clinic
        """
        # Query by primary key (id) only - more efficient than composite filter
        appointment_type = db.query(AppointmentType).filter_by(
            id=appointment_type_id
        ).first()

        if not appointment_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment type not found"
            )
        
        # Validate clinic ownership if clinic_id provided
        if clinic_id is not None and appointment_type.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment type not found"
            )

        return appointment_type

    @staticmethod
    def list_appointment_types_for_clinic(
        db: Session,
        clinic_id: int
    ) -> List[AppointmentType]:
        """
        List all appointment types for a clinic.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            
        Returns:
            List of AppointmentType objects
        """
        return db.query(AppointmentType).filter_by(
            clinic_id=clinic_id
        ).all()

