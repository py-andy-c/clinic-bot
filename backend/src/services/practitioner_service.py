"""
Practitioner service for shared practitioner business logic.

This module contains all practitioner-related business logic that is shared
between different API endpoints (LIFF, clinic admin, practitioner calendar).
"""

import logging
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session

from models import User, AppointmentType, PractitionerAppointmentTypes
from utils.query_helpers import filter_by_role

logger = logging.getLogger(__name__)


class PractitionerService:
    """
    Service class for practitioner operations.

    Contains business logic for practitioner management that is shared
    across different API endpoints.
    """

    @staticmethod
    def list_practitioners_for_clinic(
        db: Session,
        clinic_id: int,
        appointment_type_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        List all practitioners for a clinic, optionally filtered by appointment type.

        Args:
            db: Database session
            clinic_id: Clinic ID
            appointment_type_id: Optional appointment type filter

        Returns:
            List of practitioner dictionaries
        """
        # Base query for practitioners
        query = db.query(User).filter(
            User.clinic_id == clinic_id,
            User.is_active == True
        )
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')

        if appointment_type_id:
            # Filter by practitioners who offer this appointment type
            query = query.join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
            )

        practitioners = query.all()

        # Format response
        result: List[Dict[str, Any]] = []
        for practitioner in practitioners:
            offered_types = [
                pat.appointment_type_id
                for pat in practitioner.practitioner_appointment_types
            ]

            result.append({
                'id': practitioner.id,
                'full_name': practitioner.full_name,
                'offered_types': offered_types
            })

        return result

    @staticmethod
    def list_practitioners_for_appointment_type(
        db: Session,
        appointment_type_id: int,
        clinic_id: Optional[int] = None
    ) -> List[User]:
        """
        Get all practitioners who offer a specific appointment type.

        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Optional clinic ID filter

        Returns:
            List of User objects (practitioners)
        """
        query = db.query(User).filter(
            User.is_active == True
        )
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')
        query = query.join(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
        )

        if clinic_id:
            query = query.filter(User.clinic_id == clinic_id)

        return query.all()

    @staticmethod
    def get_practitioner_by_id(
        db: Session,
        practitioner_id: int,
        clinic_id: Optional[int] = None
    ) -> Optional[User]:
        """
        Get a practitioner by ID with optional clinic validation.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            clinic_id: Optional clinic ID for validation

        Returns:
            User object if found and valid, None otherwise
        """
        query = db.query(User).filter(
            User.id == practitioner_id,
            User.is_active == True
        )
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')

        if clinic_id:
            query = query.filter(User.clinic_id == clinic_id)

        return query.first()

    @staticmethod
    def validate_practitioner_for_appointment_type(
        db: Session,
        practitioner_id: int,
        appointment_type_id: int,
        clinic_id: Optional[int] = None
    ) -> Optional[User]:
        """
        Validate that a practitioner exists, is active, and offers the appointment type.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            appointment_type_id: Appointment type ID
            clinic_id: Optional clinic ID for validation

        Returns:
            User object if valid, None otherwise
        """
        query = db.query(User).filter(
            User.id == practitioner_id,
            User.is_active == True
        )
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')
        practitioner = query.join(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
        ).first()

        if not practitioner:
            return None

        if clinic_id and practitioner.clinic_id != clinic_id:
            return None

        return practitioner

    @staticmethod
    def assign_least_loaded_practitioner(
        db: Session,
        candidates: List[User],
        date: str
    ) -> Optional[User]:
        """
        Assign the practitioner with the least appointments on a given date.

        Args:
            db: Database session
            candidates: List of candidate practitioners
            date: Date string in YYYY-MM-DD format

        Returns:
            User object of the selected practitioner, or None if no candidates
        """
        if not candidates:
            return None

        try:
            from datetime import datetime
            target_date = datetime.strptime(date, '%Y-%m-%d').date()
        except ValueError:
            return None

        # Find practitioner with least appointments on this date
        selected_practitioner = min(
            candidates,
            key=lambda p: db.query(User).join(
                User.calendar_events
            ).filter(
                User.id == p.id,
                User.calendar_events.date == target_date,
                User.calendar_events.event_type == 'appointment'
            ).count()
        )

        return selected_practitioner

    @staticmethod
    def get_practitioner_appointment_types(
        db: Session,
        practitioner_id: int
    ) -> List[AppointmentType]:
        """
        Get all appointment types offered by a practitioner.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID

        Returns:
            List of AppointmentType objects
        """
        appointment_types = db.query(AppointmentType).join(
            PractitionerAppointmentTypes
        ).filter(
            PractitionerAppointmentTypes.user_id == practitioner_id
        ).all()

        return appointment_types

    @staticmethod
    def update_practitioner_appointment_types(
        db: Session,
        practitioner_id: int,
        appointment_type_ids: List[int]
    ) -> bool:
        """
        Update the appointment types offered by a practitioner.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            appointment_type_ids: List of appointment type IDs to offer

        Returns:
            True if successful, False otherwise
        """
        try:
            # Remove existing associations
            db.query(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.user_id == practitioner_id
            ).delete()

            # Add new associations
            for type_id in appointment_type_ids:
                association = PractitionerAppointmentTypes(
                    user_id=practitioner_id,
                    appointment_type_id=type_id
                )
                db.add(association)

            db.commit()
            return True

        except Exception as e:
            logger.error(f"Failed to update practitioner appointment types: {e}")
            db.rollback()
            return False
