"""
Practitioner service for shared practitioner business logic.

This module contains all practitioner-related business logic that is shared
between different API endpoints (LIFF, clinic admin, practitioner calendar).
"""

import logging
from typing import List, Dict, Any, Optional

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from models import User, AppointmentType, PractitionerAppointmentTypes, UserClinicAssociation
from utils.query_helpers import filter_by_role
from utils.appointment_type_queries import get_active_appointment_types_for_practitioner

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
        appointment_type_id: Optional[int] = None,
        for_patient_booking: bool = False
    ) -> List[Dict[str, Any]]:
        """
        List all practitioners for a clinic, optionally filtered by appointment type.

        Args:
            db: Database session
            clinic_id: Clinic ID
            appointment_type_id: Optional appointment type filter
            for_patient_booking: If True, filter out practitioners who don't allow patient bookings

        Returns:
            List of practitioner dictionaries
        """
        # Base query for practitioners via UserClinicAssociation
        # Optimized: Eagerly load practitioner_appointment_types to avoid N+1 queries
        from sqlalchemy.orm import joinedload
        query = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        )

        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')

        if appointment_type_id:
            # Filter by practitioners who offer this appointment type
            query = query.join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
                PractitionerAppointmentTypes.is_deleted == False
            )

        # Eagerly load practitioner_appointment_types to avoid N+1 queries when accessing offered_types
        practitioners = query.options(joinedload(User.practitioner_appointment_types)).all()

        # Get associations for all practitioners in one query
        practitioner_ids = [p.id for p in practitioners]

        associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id.in_(practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()

        association_lookup = {a.user_id: a for a in associations}

        # Format response
        result: List[Dict[str, Any]] = []
        for practitioner in practitioners:
            # Get association for this clinic
            association = association_lookup.get(practitioner.id)
            
            # Filter out practitioners who don't allow patient bookings if for_patient_booking is True
            if for_patient_booking and association:
                try:
                    settings = association.get_validated_settings()
                    if not settings.patient_booking_allowed:
                        continue  # Skip this practitioner
                except (ValidationError, ValueError) as e:
                    # If settings validation fails, log and default to allowing booking (backward compatibility)
                    logger.warning(
                        f"Settings validation failed for practitioner {practitioner.id} "
                        f"in clinic {clinic_id}: {e}. Defaulting to allowing patient booking."
                    )
            
            offered_types = [
                pat.appointment_type_id
                for pat in practitioner.practitioner_appointment_types
                if not pat.is_deleted
            ]

            # Get practitioner display name
            # For patient-facing displays (LIFF), include title; for internal displays, just name
            if for_patient_booking and association:
                # Patient-facing: include title for external display
                from utils.practitioner_helpers import get_practitioner_display_name_with_title
                display_name = get_practitioner_display_name_with_title(
                    db, practitioner.id, clinic_id
                )
            else:
                # Internal display: just name without title
                display_name = association.full_name if association else practitioner.email

            result.append({
                'id': practitioner.id,
                'full_name': display_name,
                'offered_types': offered_types
            })

        return result

    @staticmethod
    def filter_practitioners_by_assigned(
        db: Session,
        all_practitioners_data: List[Dict[str, Any]],
        patient_id: int,
        clinic_id: int,
        appointment_type_id: Optional[int] = None,
        restrict_to_assigned: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Filter practitioners by assigned practitioners for a patient.
        
        Implements the filtering logic per design doc:
        - When restrict_to_assigned is True and patient has assigned practitioners:
          - Filter to show only assigned practitioners
          - If appointment type is not offered by any assigned practitioner, show all practitioners
          - If all assigned practitioners are inactive, treat as "no assigned practitioners" and show all
        - If no assigned practitioners, show all practitioners
        
        Args:
            db: Database session
            all_practitioners_data: List of all practitioner dictionaries (from list_practitioners_for_clinic)
            patient_id: Patient ID to check assignments for
            clinic_id: Clinic ID
            appointment_type_id: Optional appointment type ID to check if assigned practitioners offer it
            restrict_to_assigned: Whether to apply assignment filtering (from clinic setting)
            
        Returns:
            Filtered list of practitioner dictionaries
        """
        if not restrict_to_assigned:
            return all_practitioners_data
        
        from services import PatientPractitionerAssignmentService
        from models import AppointmentType, Patient, UserClinicAssociation, PractitionerAppointmentTypes
        from utils.query_helpers import filter_by_role
        
        # Validate patient belongs to clinic
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == clinic_id
        ).first()
        
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="病患不存在"
            )
        
        # Get assigned practitioner IDs
        assigned_practitioner_ids = PatientPractitionerAssignmentService.get_assigned_practitioner_ids(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )
        
        # Filter out inactive practitioners from assigned list
        # Per design doc: "All assigned practitioners inactive: Treat as 'no assigned practitioners' - show all practitioners"
        if assigned_practitioner_ids:
            query = db.query(User).join(UserClinicAssociation).filter(
                User.id.in_(assigned_practitioner_ids),
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            )
            query = filter_by_role(query, 'practitioner')
            active_practitioners = query.all()
            active_assigned_ids = [p.id for p in active_practitioners]
            
            # If all assigned practitioners are inactive, treat as no assigned practitioners
            if not active_assigned_ids:
                assigned_practitioner_ids = []
            else:
                assigned_practitioner_ids = active_assigned_ids
        
        # If there are assigned practitioners, filter to them
        if assigned_practitioner_ids:
            # Check if appointment type is offered by any assigned practitioner
            if appointment_type_id:
                # Get appointment type to verify it exists
                appointment_type = db.query(AppointmentType).filter(
                    AppointmentType.id == appointment_type_id,
                    AppointmentType.clinic_id == clinic_id
                ).first()
                
                if appointment_type:
                    # Check if any assigned practitioner offers this appointment type
                    assigned_offering_type = db.query(PractitionerAppointmentTypes).filter(
                        PractitionerAppointmentTypes.user_id.in_(assigned_practitioner_ids),
                        PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
                        PractitionerAppointmentTypes.clinic_id == clinic_id,
                        PractitionerAppointmentTypes.is_deleted == False
                    ).first()
                    
                    # If no assigned practitioner offers this type, show all practitioners
                    if not assigned_offering_type:
                        return all_practitioners_data
                
                # Filter to assigned practitioners
                return [
                    p for p in all_practitioners_data
                    if p['id'] in assigned_practitioner_ids
                ]
            else:
                # No appointment type filter, filter to assigned practitioners
                return [
                    p for p in all_practitioners_data
                    if p['id'] in assigned_practitioner_ids
                ]
        else:
            # No assigned practitioners, show all practitioners
            return all_practitioners_data

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
            clinic_id: Optional clinic ID filter (required for clinic isolation)

        Returns:
            List of User objects (practitioners)
        """
        if not clinic_id:
            raise ValueError("clinic_id is required for clinic isolation")
        
        query = db.query(User)
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')
        query = query.join(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id,  # Filter by clinic_id in PractitionerAppointmentTypes
            PractitionerAppointmentTypes.is_deleted == False
        )
        # Also verify practitioner is in the clinic via UserClinicAssociation
        query = query.join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        )

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
            clinic_id: Optional clinic ID for validation (required for clinic isolation)

        Returns:
            User object if found and valid, None otherwise
        """
        query = db.query(User).filter(
            User.id == practitioner_id
        )
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')

        if clinic_id:
            # Verify practitioner is in the clinic via UserClinicAssociation
            query = query.join(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            )

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
            User.id == practitioner_id
        )
        # Filter by practitioner role using JSON array check
        query = filter_by_role(query, 'practitioner')
        practitioner = query.join(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
            PractitionerAppointmentTypes.is_deleted == False
        ).first()

        if not practitioner:
            return None

        if clinic_id:
            # Verify practitioner is in the specified clinic
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == practitioner.id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            ).first()
            if not association:
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
            from utils.datetime_utils import parse_date_string
            target_date = parse_date_string(date)
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
            List of active AppointmentType objects for the specified clinic
        """
        return get_active_appointment_types_for_practitioner(db, practitioner_id, clinic_id)

    @staticmethod
    def update_practitioner_appointment_types(
        db: Session,
        practitioner_id: int,
        appointment_type_ids: List[int],
        clinic_id: int
    ) -> bool:
        """
        Update the appointment types offered by a practitioner.
        
        IMPORTANT: This method uses soft-delete to preserve billing scenarios.
        When a practitioner is unassigned from a service item, the PAT is soft-deleted
        instead of hard-deleted. This ensures billing scenarios persist and can be
        restored when the practitioner is re-assigned.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            appointment_type_ids: List of appointment type IDs to offer
            clinic_id: Clinic ID for clinic isolation

        Returns:
            True if successful, False otherwise
        """
        from datetime import datetime, timezone
        
        try:
            # Get all existing associations (including soft-deleted)
            # Order by deleted_at DESC so we reactivate the most recent soft-deleted PAT if multiple exist
            existing_associations: List[PractitionerAppointmentTypes] = db.query(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.user_id == practitioner_id,
                PractitionerAppointmentTypes.clinic_id == clinic_id
            ).order_by(PractitionerAppointmentTypes.deleted_at.desc().nulls_last()).all()
            
            existing_type_ids = {assoc.appointment_type_id for assoc in existing_associations}
            new_type_ids = set(appointment_type_ids)
            
            # Create lookup maps for efficient access
            # If multiple associations exist for same type_id, use the first one (most recent deleted_at)
            association_by_type_id: Dict[int, PractitionerAppointmentTypes] = {}
            for assoc in existing_associations:
                if assoc.appointment_type_id not in association_by_type_id:
                    association_by_type_id[assoc.appointment_type_id] = assoc
            
            # Process each type_id that should be active
            for type_id in new_type_ids:
                if type_id in association_by_type_id:
                    # Association exists - reactivate if soft-deleted
                    association: PractitionerAppointmentTypes = association_by_type_id[type_id]
                    if association.is_deleted:
                        association.is_deleted = False
                        association.deleted_at = None
                    # If already active, no change needed
                else:
                    # Association doesn't exist - create new one
                    association = PractitionerAppointmentTypes(
                        user_id=practitioner_id,
                        clinic_id=clinic_id,
                        appointment_type_id=type_id
                    )
                    db.add(association)
            
            # Soft-delete associations that are not in the new list
            type_ids_to_remove = existing_type_ids - new_type_ids
            for type_id in type_ids_to_remove:
                association: PractitionerAppointmentTypes = association_by_type_id[type_id]
                if not association.is_deleted:
                    # Soft-delete the association
                    association.is_deleted = True
                    association.deleted_at = datetime.now(timezone.utc)

            db.commit()
            return True

        except Exception as e:
            logger.exception(f"Failed to update practitioner appointment types: {e}")
            db.rollback()
            return False
