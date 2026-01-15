"""
Availability service for shared scheduling and availability logic.

This module contains all availability-related business logic that is shared
between different API endpoints (LIFF, clinic admin, practitioner calendar).
"""

import logging
from datetime import datetime, date as date_type, time, timedelta
from typing import List, Dict, Any, cast, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from models import (
    User, PractitionerAvailability, CalendarEvent,
    PractitionerAppointmentTypes, Appointment, Clinic, UserClinicAssociation
)
from services.appointment_type_service import AppointmentTypeService
from services.settings_service import SettingsService
from utils.query_helpers import filter_by_role
from utils.datetime_utils import taiwan_now, parse_date_string

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service class for availability operations.

    Contains business logic for availability checking and scheduling that is shared
    across different API endpoints.
    """

    @staticmethod
    def _validate_date(date: str, clinic_id: int, db: Session) -> date_type:
        """
        Validate date format and range using clinic-specific booking window.

        Args:
            date: Date string in YYYY-MM-DD format
            clinic_id: Clinic ID to get booking window setting
            db: Database session

        Returns:
            Parsed date object

        Raises:
            HTTPException: If validation fails
        """
        # Validate date format
        try:
            requested_date = parse_date_string(date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式（請使用 YYYY-MM-DD）"
            )

        # Get clinic to verify it exists
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Only validate that date is not in the past
        # NOTE: max_booking_window_days is enforced in _filter_slots_by_booking_restrictions
        # when apply_booking_restrictions=True (for patient-facing endpoints)
        today = taiwan_now().date()

        if requested_date < today:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法預約過去的時間"
            )

        return requested_date

    @staticmethod
    def _get_practitioner_by_id(
        db: Session,
        practitioner_id: int
    ) -> User:
        """
        Get a practitioner by ID.
        
        Private helper method for fetching and validating a practitioner.
        
        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            
        Returns:
            User object (practitioner)
            
        Raises:
            HTTPException: If practitioner not found
        """
        # Note: This function doesn't filter by clinic_id because it's used
        # in contexts where clinic_id is already validated elsewhere.
        # The caller should ensure the practitioner belongs to the correct clinic.
        # Join with UserClinicAssociation to check roles
        query = db.query(User).join(UserClinicAssociation).filter(
            User.id == practitioner_id,
            UserClinicAssociation.is_active == True
        )
        query = filter_by_role(query, 'practitioner')
        practitioner = query.first()
        
        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到治療師"
            )
        
        return practitioner

    @staticmethod
    def validate_practitioner_for_clinic(
        db: Session,
        practitioner_id: int,
        clinic_id: int
    ) -> User:
        """
        Validate that a practitioner exists, is active, and belongs to the clinic.

        Shared validation function used by both AppointmentService and AvailabilityService.
        This now delegates to the centralized practitioner_helpers module.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            clinic_id: Clinic ID

        Returns:
            User object (practitioner)

        Raises:
            HTTPException: If practitioner not found, inactive, or doesn't belong to clinic
        """
        from utils.practitioner_helpers import validate_practitioner_for_clinic as validate_practitioner
        return validate_practitioner(db, practitioner_id, clinic_id)

    @staticmethod
    def validate_practitioner_offers_appointment_type(
        db: Session,
        practitioner_id: int,
        appointment_type_id: int,
        clinic_id: int
    ) -> bool:
        """
        Check if a practitioner offers a specific appointment type at a clinic.

        Shared validation function used by both AppointmentService and AvailabilityService.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID

        Returns:
            True if practitioner offers the appointment type, False otherwise
        """
        practitioner_appointment_type = db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.user_id == practitioner_id,
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id,
            PractitionerAppointmentTypes.is_deleted == False
        ).first()

        return practitioner_appointment_type is not None

    @staticmethod
    def get_practitioner_associations_batch(
        db: Session,
        practitioner_ids: List[int],
        clinic_id: int
    ) -> Dict[int, UserClinicAssociation]:
        """
        Batch fetch practitioner associations for multiple practitioners.

        Shared utility function to avoid N+1 queries when fetching practitioner names.

        Args:
            db: Database session
            practitioner_ids: List of practitioner user IDs
            clinic_id: Clinic ID

        Returns:
            Dict mapping practitioner_id to UserClinicAssociation
        """
        if not practitioner_ids:
            return {}

        associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id.in_(practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()

        return {a.user_id: a for a in associations}


    @staticmethod
    def get_available_slots_for_practitioner(
        db: Session,
        practitioner_id: int,
        date: str,
        appointment_type_id: int,
        clinic_id: int,
        exclude_calendar_event_id: int | None = None,
        apply_booking_restrictions: bool = True,
        for_patient_display: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get available time slots for a specific practitioner.

        Validates that:
        - Practitioner exists and is active
        - Practitioner offers the appointment type
        - Appointment type belongs to the same clinic as the practitioner

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            date: Date in YYYY-MM-DD format
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID (for booking restriction validation)
            exclude_calendar_event_id: Optional calendar event ID to exclude from conflict checking
            apply_booking_restrictions: Whether to filter slots by booking restrictions (default: True)
                                      Set to False for clinic admin endpoints (admins bypass restrictions)

        Returns:
            List of available slot dictionaries with:
            - start_time: str (HH:MM)
            - end_time: str (HH:MM)
            - practitioner_id: int
            - practitioner_name: str

        Raises:
            HTTPException: If validation fails
        """
        try:
            # Validate date and get appointment type
            requested_date = AvailabilityService._validate_date(date, clinic_id, db)
            appointment_type = AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)

            # Verify appointment type belongs to the requested clinic
            if appointment_type.clinic_id != clinic_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到預約類型"
                )

            # Verify practitioner exists, is active, belongs to clinic, and offers appointment type
            practitioner = AvailabilityService.validate_practitioner_for_clinic(
                db, practitioner_id, clinic_id
            )
            
            if not AvailabilityService.validate_practitioner_offers_appointment_type(
                db, practitioner_id, appointment_type_id, clinic_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到治療師"
                )

            # Get clinic for booking restrictions
            clinic = db.query(Clinic).filter(
                Clinic.id == clinic_id,
                Clinic.is_active == True
            ).first()
            if not clinic:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="診所不存在或已停用"
                )

            # Fetch schedule data once and reuse it
            practitioner_ids = [practitioner.id]
            schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
                db, practitioner_ids, requested_date, clinic_id, exclude_calendar_event_id
            )
            
            # Calculate available slots for this practitioner (reusing schedule_data)
            # Include scheduling buffer in duration calculation to prevent conflicts
            total_duration = appointment_type.duration_minutes + (appointment_type.scheduling_buffer_minutes or 0)
            slots = AvailabilityService._calculate_available_slots(
                db, requested_date, [practitioner], total_duration, 
                clinic, clinic_id, exclude_calendar_event_id, schedule_data=schedule_data,
                apply_booking_restrictions=apply_booking_restrictions,
                for_patient_display=for_patient_display,
                appointment_type_id=appointment_type_id
            )
            
            # Apply compact schedule recommendations if enabled
            # Only apply for LIFF flow (when practitioner_id is specified)
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == practitioner_id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            ).first()
            
            if association:
                try:
                    # Get practitioner settings, fallback to clinic settings if not available
                    practitioner_settings = SettingsService.get_practitioner_settings(db, practitioner_id, clinic_id)
                    if practitioner_settings and practitioner_settings.compact_schedule_enabled:
                        # Extract confirmed appointments from already-fetched schedule data
                        # (reusing data fetched by _calculate_available_slots via fetch_practitioner_schedule_data)
                        practitioner_data = schedule_data.get(practitioner_id, {})
                        events = practitioner_data.get('events', [])
                        confirmed_appointments = [
                            event for event in events 
                            if event.event_type == 'appointment' and 
                            event.appointment and 
                            event.appointment.status == 'confirmed'
                        ]
                        
                        recommended_slots = AvailabilityService._calculate_compact_schedule_recommendations(
                            confirmed_appointments, 
                            slots,
                            practitioner_data.get('default_intervals', []),
                            events
                        )
                        # Mark recommended slots
                        for slot in slots:
                            slot['is_recommended'] = slot['start_time'] in recommended_slots
                except (ValueError, AttributeError, KeyError) as e:
                    # If settings validation fails, continue without recommendations
                    logger.warning(f"Failed to get practitioner settings for compact schedule: {e}")
            
            return slots
            
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Availability query error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="無法取得可用時間"
            )

    @staticmethod
    def get_available_slots_for_clinic(
        db: Session,
        clinic_id: int,
        date: str,
        appointment_type_id: int,
        exclude_calendar_event_id: int | None = None,
        apply_booking_restrictions: bool = True,
        for_patient_display: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get available time slots for all practitioners in a clinic.
        
        Returns unique time slots from all active practitioners in the clinic who offer
        the specified appointment type. When multiple practitioners have the same time
        slot available, returns only one slot per unique start_time. The actual practitioner
        assignment with load balancing happens in AppointmentService._assign_practitioner
        when the appointment is created.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            date: Date in YYYY-MM-DD format
            appointment_type_id: Appointment type ID
            exclude_calendar_event_id: Optional calendar event ID to exclude from conflict checking (for appointment editing)
            
        Returns:
            List of available slot dictionaries (deduplicated by start_time) with:
            - start_time: str (HH:MM)
            - end_time: str (HH:MM)
            - practitioner_id: int (arbitrary - frontend ignores this when practitioner_id is null)
            - practitioner_name: str
            
        Raises:
            HTTPException: If validation fails
        """
        try:
            # Validate date and get appointment type
            requested_date = AvailabilityService._validate_date(date, clinic_id, db)
            appointment_type = AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)
            
            # Verify appointment type belongs to clinic
            if appointment_type.clinic_id != clinic_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到預約類型"
                )

            # Get all active practitioners in clinic who offer this type
            # clinic_id already validated to match appointment_type.clinic_id above
            practitioners = AvailabilityService.get_practitioners_for_appointment_type(
                db, appointment_type_id, clinic_id
            )

            if not practitioners:
                return []

            # Get clinic for booking restrictions
            clinic = db.query(Clinic).filter(
                Clinic.id == clinic_id,
                Clinic.is_active == True
            ).first()
            if not clinic:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="診所不存在或已停用"
                )

            # Calculate available slots for all practitioners
            # Include scheduling buffer in duration calculation to prevent conflicts
            total_duration = appointment_type.duration_minutes + (appointment_type.scheduling_buffer_minutes or 0)
            all_slots = AvailabilityService._calculate_available_slots(
                db, requested_date, practitioners, total_duration, clinic, clinic_id,
                exclude_calendar_event_id=exclude_calendar_event_id,
                apply_booking_restrictions=apply_booking_restrictions,
                for_patient_display=for_patient_display,
                appointment_type_id=appointment_type_id
            )
            
            # Deduplicate slots by start_time (practitioner assignment happens in _assign_practitioner)
            deduplicated_slots = AvailabilityService._deduplicate_slots_by_time(all_slots)
            
            # Sort by start_time to ensure chronological order (with safety check for None)
            deduplicated_slots.sort(key=lambda s: s.get('start_time', ''))
            
            return deduplicated_slots

        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Availability query error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="無法取得可用時間"
            )

    @staticmethod
    def _calculate_available_slots(
        db: Session,
        requested_date: date_type,
        practitioners: List[User],
        duration_minutes: int,
        clinic: Clinic,
        clinic_id: int,
        exclude_calendar_event_id: int | None = None,
        schedule_data: Dict[int, Dict[str, Any]] | None = None,
        apply_booking_restrictions: bool = True,
        for_patient_display: bool = False,
        appointment_type_id: int | None = None
    ) -> List[Dict[str, Any]]:
        """
        Calculate available time slots for the given date and practitioners.

        Considers each practitioner's:
        - Default availability schedule (PractitionerAvailability)
        - Availability exceptions (CalendarEvent with event_type='availability_exception')
        - Existing appointments (CalendarEvent with event_type='appointment')
        - Resource availability (if appointment_type_id is provided)
        - Clinic booking restrictions (if apply_booking_restrictions=True)

        Args:
            db: Database session
            requested_date: Date to check availability for
            practitioners: List of practitioners to check
            duration_minutes: Duration of appointment type
            clinic: Clinic object with booking restriction settings
            exclude_calendar_event_id: Optional calendar event ID to exclude from conflict checking
            schedule_data: Pre-fetched schedule data (optional, for performance)
            apply_booking_restrictions: Whether to filter slots by booking restrictions (default: True)
                                      Set to False for clinic admin endpoints (admins bypass restrictions)
            appointment_type_id: Optional appointment type ID for resource availability checking

        Returns:
            List of available slot dictionaries with practitioner_id and practitioner_name
        """
        if not practitioners:
            return []
        
        # Batch fetch schedule data for all practitioners (2 queries total instead of N×2)
        # Use provided schedule_data if available, otherwise fetch it
        practitioner_ids = [p.id for p in practitioners]
        if schedule_data is None:
            schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
                db, practitioner_ids, requested_date, clinic_id, exclude_calendar_event_id
            )
        
        available_slots: List[Dict[str, Any]] = []
        
        # Create a lookup dict for practitioner info
        practitioner_lookup = {p.id: p for p in practitioners}
        
        # Get associations for all practitioners in one query
        association_lookup = AvailabilityService.get_practitioner_associations_batch(
            db, practitioner_ids, clinic_id
        )
        
        # If we're excluding an event (editing), fetch its start time and user_id to ensure it's included in candidates
        excluded_event_start_time = None
        excluded_event_user_id = None
        if exclude_calendar_event_id:
            excluded_event = db.query(CalendarEvent).filter(CalendarEvent.id == exclude_calendar_event_id).first()
            if excluded_event:
                excluded_event_start_time = excluded_event.start_time
                excluded_event_user_id = excluded_event.user_id

        # Generate all candidate slots from default intervals
        # and filter out slots that overlap with exceptions or appointments
        # Use practitioner-specific step_size_minutes if set, otherwise fall back to clinic settings
        validated_settings = clinic.get_validated_settings()
        clinic_step = validated_settings.booking_restriction_settings.step_size_minutes

        for practitioner_id, data in schedule_data.items():
            practitioner = practitioner_lookup.get(practitioner_id)
            if not practitioner:
                continue
            
            # Get association for this practitioner
            association = association_lookup.get(practitioner_id)
            # For patient-facing displays, include title; for internal displays, just name
            if for_patient_display and association:
                from utils.practitioner_helpers import get_practitioner_display_name_with_title
                practitioner_name = get_practitioner_display_name_with_title(
                    db, practitioner_id, clinic_id
                )
            else:
                practitioner_name = association.full_name if association else practitioner.email
            
            default_intervals = data['default_intervals']
            if not default_intervals:
                # Practitioner has no availability for this day of week
                continue

            events = data['events']
            
            # Get practitioner-specific step if available
            practitioner_step = None
            if association:
                try:
                    p_settings = association.get_validated_settings()
                    if hasattr(p_settings, 'step_size_minutes'):
                        practitioner_step = p_settings.step_size_minutes
                except Exception:
                    pass
            
            step_size_minutes = practitioner_step if practitioner_step is not None else clinic_step
            
            candidate_slots = AvailabilityService._generate_candidate_slots(
                default_intervals, duration_minutes, step_size_minutes=step_size_minutes
            )
            
            # If we have an excluded event, explicitly add its start time as a candidate slot
            # with the CURRENT duration (in case duration changed for the appointment type)
            if excluded_event_start_time:
                # Calculate end time based on current duration_minutes
                end_minutes = (excluded_event_start_time.hour * 60 + excluded_event_start_time.minute + duration_minutes)
                # Handle overflow past midnight
                if end_minutes < 1440:
                    inj_end_time = time(end_minutes // 60, end_minutes % 60)
                    
                    # Logically:
                    # 1. If this is the practitioner who owns the event, always allow keeping the original time
                    # 2. If this is a different practitioner, only allow it if it fits their schedule
                    is_original_practitioner = (excluded_event_user_id == practitioner_id)
                    is_within_hours = AvailabilityService.is_slot_within_default_intervals(default_intervals, excluded_event_start_time, inj_end_time)
                    
                    if is_original_practitioner or is_within_hours:
                        if (excluded_event_start_time, inj_end_time) not in candidate_slots:
                            candidate_slots.append((excluded_event_start_time, inj_end_time))
            
            # Filter out slots that overlap with exceptions or appointments
            # Note: candidate_slots are already guaranteed to be within default_intervals,
            # so we only need to check for conflicts (exceptions and appointments)
            for slot_start, slot_end in candidate_slots:
                # Check practitioner availability (conflicts with exceptions/appointments)
                if AvailabilityService.has_slot_conflicts(events, slot_start, slot_end):
                    continue
                
                # Check resource availability if appointment_type_id is provided
                if appointment_type_id:
                    slot_availability = AvailabilityService.check_slot_availability(
                        db=db,
                        practitioner_id=practitioner.id,
                        date=requested_date,
                        start_time=slot_start,
                        end_time=slot_end,
                        appointment_type_id=appointment_type_id,
                        clinic_id=clinic_id,
                        schedule_data=schedule_data,
                        exclude_calendar_event_id=exclude_calendar_event_id,
                        check_resources=True
                    )
                    if not slot_availability['is_available']:
                        continue  # Skip slot if resources are not available
                
                available_slots.append({
                    'start_time': AvailabilityService._format_time(slot_start),
                    'end_time': AvailabilityService._format_time(slot_end),
                    'practitioner_id': practitioner.id,
                    'practitioner_name': practitioner_name
                })

        # Sort by start_time to ensure chronological order (with safety check for None)
        available_slots.sort(key=lambda s: s.get('start_time', ''))

        # Apply booking restrictions if requested (for patient-facing endpoints)
        # Clinic admin endpoints should pass apply_booking_restrictions=False to bypass restrictions
        if apply_booking_restrictions:
            filtered_slots = AvailabilityService._filter_slots_by_booking_restrictions(
                available_slots, requested_date, clinic
            )
            return filtered_slots

        # For clinic users (apply_booking_restrictions=False), we still filter out past slots 
        # by default to keep the UI clean, while bypassing other restrictions like minimum 
        # booking hours or max booking window.
        now = taiwan_now()
        
        # If requested_date is in the past, return empty list
        if requested_date < now.date():
            return []
            
        # If requested_date is today, filter slots by time
        if requested_date == now.date():
            from utils.datetime_utils import ensure_taiwan
            filtered_slots: List[Dict[str, Any]] = []
            for slot in available_slots:
                h, m = map(int, slot['start_time'].split(':'))
                slot_dt = datetime.combine(requested_date, time(h, m))
                slot_dt_tz = ensure_taiwan(slot_dt)
                if slot_dt_tz and slot_dt_tz >= now:
                    filtered_slots.append(slot)
            return filtered_slots

        return available_slots

    @staticmethod
    def _deduplicate_slots_by_time(
        slots: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Deduplicate slots by start_time.
        
        When multiple practitioners have the same time slot available, this method
        returns only one slot per unique start_time. The practitioner_id in the returned
        slot is arbitrary since the frontend ignores it when practitioner_id is null.
        The actual practitioner assignment with load balancing happens in
        AppointmentService._assign_practitioner when the appointment is created.
        
        Args:
            slots: List of slot dictionaries with start_time, end_time, practitioner_id, practitioner_name
            
        Returns:
            Deduplicated list of slots, one per unique start_time
        """
        if not slots:
            return []
        
        seen_times: set[str] = set()
        deduplicated_slots: List[Dict[str, Any]] = []
        
        for slot in slots:
            start_time = slot['start_time']
            if start_time not in seen_times:
                seen_times.add(start_time)
                deduplicated_slots.append(slot)
        
        return deduplicated_slots

    @staticmethod
    def _generate_candidate_slots(
        default_intervals: List[PractitionerAvailability],
        duration_minutes: int,
        step_size_minutes: int = 30
    ) -> List[tuple[time, time]]:
        """
        Generate candidate time slots from default availability intervals.
        
        Generates slots at regular intervals (step_size_minutes) within each
        default availability interval, with each slot having the specified duration.

        Args:
            default_intervals: List of practitioner's default availability intervals
            duration_minutes: Duration of each slot in minutes
            step_size_minutes: Step size between slots in minutes (default: 30)

        Returns:
            List of (start_time, end_time) tuples for candidate slots
        """
        candidate_slots: List[tuple[time, time]] = []

        for interval in default_intervals:
            # Round up interval start to next step_size_minutes boundary
            # For step_size_minutes=30, this rounds to half hours (00, 30)
            # For step_size_minutes=15, this rounds to quarter hours (00, 15, 30, 45)
            current_time = AvailabilityService._round_up_to_interval(
                interval.start_time, step_size_minutes
            )
            
            # Generate slots at step_size_minutes intervals within this interval
            while current_time < interval.end_time:
                # Calculate slot end time
                slot_end_minutes = (current_time.hour * 60 + current_time.minute + duration_minutes)
                slot_end_hour = slot_end_minutes // 60
                slot_end_minute = slot_end_minutes % 60
                slot_end_time = time(slot_end_hour, slot_end_minute)

                # Check if slot fits within the interval
                if slot_end_time > interval.end_time:
                    break

                # Add candidate slot
                candidate_slots.append((current_time, slot_end_time))
                
                # Move to next step_size_minutes boundary
                current_minutes = current_time.hour * 60 + current_time.minute + step_size_minutes
                current_time = time(current_minutes // 60, current_minutes % 60)
        
        return candidate_slots

    @staticmethod
    def _round_up_to_interval(time_obj: time, interval_minutes: int) -> time:
        """
        Round up time to the next interval boundary.
        
        For interval_minutes=15, rounds to quarter hours (00, 15, 30, 45).
        For interval_minutes=30, rounds to half hours (00, 30).
        
        Args:
            time_obj: Time object to round up
            interval_minutes: Interval size in minutes (e.g., 15, 30, 60)
            
        Returns:
            Time object rounded up to the next interval boundary
        """
        total_minutes = time_obj.hour * 60 + time_obj.minute
        
        # Calculate minutes to add to reach next interval boundary
        remainder = total_minutes % interval_minutes
        if remainder == 0:
            # Already on an interval boundary
            return time_obj
        
        # Round up to next interval boundary
        minutes_to_add = interval_minutes - remainder
        rounded_minutes = total_minutes + minutes_to_add
        
        hour = rounded_minutes // 60
        minute = rounded_minutes % 60
        
        # Handle overflow past 23:59 (shouldn't happen in practice, but be defensive)
        if hour >= 24:
            return time(23, 59)

        return time(hour, minute)

    @staticmethod
    def get_practitioners_for_appointment_type(
        db: Session,
        appointment_type_id: int,
        clinic_id: int
    ) -> List[User]:
        """
        Get all practitioners who offer a specific appointment type.
        
        Public method used by AppointmentService for practitioner assignment.
        
        Note: Caller must validate that clinic_id matches appointment_type.clinic_id
        before calling this method. This method trusts the clinic_id parameter.

        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID (must match appointment_type.clinic_id, validated by caller)

        Returns:
            List of User objects (practitioners)
        """
        # Query PractitionerAppointmentTypes directly (indexed on appointment_type_id)
        # Then join with User and UserClinicAssociation to filter by active status and clinic
        query = db.query(User).join(
            PractitionerAppointmentTypes, User.id == PractitionerAppointmentTypes.user_id
        ).join(
            UserClinicAssociation, User.id == UserClinicAssociation.user_id
        ).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id,
            PractitionerAppointmentTypes.is_deleted == False,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        )
        query = filter_by_role(query, 'practitioner')

        return query.all()

    @staticmethod
    def is_slot_within_default_intervals(
        default_intervals: List[PractitionerAvailability],
        start_time: time,
        end_time: time
    ) -> bool:
        """
        Check if a time slot is within at least one default availability interval.
        
        Pure function - no database queries. Uses pre-fetched data.

        Args:
            default_intervals: Practitioner's default availability for the day
            start_time: Slot start time
            end_time: Slot end time

        Returns:
            True if slot is within at least one default interval, False otherwise
        """
        for interval in default_intervals:
            if interval.start_time <= start_time and end_time <= interval.end_time:
                return True
        return False

    @staticmethod
    def has_slot_conflicts(
        events: List[CalendarEvent],
        start_time: time,
        end_time: time
    ) -> bool:
        """
        Check if a time slot conflicts with calendar events (exceptions or appointments).
        
        Pure function - no database queries. Uses pre-fetched data.
        
        Args:
            events: Calendar events (availability exceptions and confirmed appointments) for the date
            start_time: Slot start time
            end_time: Slot end time
            
        Returns:
            True if slot has conflicts, False otherwise
        """
        # Check if slot overlaps with any event (exception or appointment)
        for event in events:
            if (event.start_time and event.end_time and
                AvailabilityService._check_time_overlap(
                    start_time, end_time,
                    event.start_time, event.end_time
                )):
                return True
        
        return False

    @staticmethod
    def check_slot_availability(
        db: Session,
        practitioner_id: int,
        date: date_type,
        start_time: time,
        end_time: time,
        appointment_type_id: int,
        clinic_id: int,
        schedule_data: Dict[int, Dict[str, Any]] | None = None,
        exclude_calendar_event_id: int | None = None,
        check_resources: bool = True
    ) -> Dict[str, Any]:
        """
        Core function to check if a time slot is available.
        
        Checks both practitioner availability and resource availability.
        Used by: slot calculation, conflict checking, availability notifications.
        
        Args:
            db: Database session
            practitioner_id: Practitioner ID
            date: Date to check
            start_time: Slot start time
            end_time: Slot end time
            appointment_type_id: Appointment type ID (for resource requirements)
            clinic_id: Clinic ID
            schedule_data: Pre-fetched schedule data (optional)
            exclude_calendar_event_id: Exclude this appointment from checks (for editing)
            check_resources: Whether to check resource availability (default: True)
        
        Returns:
            Dict with availability status:
            {
                'is_available': bool,
                'practitioner_available': bool,
                'resources_available': bool,
                'resource_conflicts': List[Dict]  # List of resource conflict details
            }
        """
        # 1. Check practitioner availability (existing logic)
        if schedule_data is None:
            schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
                db, [practitioner_id], date, clinic_id, exclude_calendar_event_id
            )
        
        practitioner_data = schedule_data.get(practitioner_id, {
            'default_intervals': [],
            'events': []
        })
        
        default_intervals = practitioner_data['default_intervals']
        events = practitioner_data['events']
        
        practitioner_available = (
            AvailabilityService.is_slot_within_default_intervals(default_intervals, start_time, end_time)
            and not AvailabilityService.has_slot_conflicts(events, start_time, end_time)
        )
        
        # 2. Check resource availability (NEW)
        resources_available = True
        resource_conflicts = []
        
        if check_resources:
            from services.resource_service import ResourceService
            start_datetime = datetime.combine(date, start_time)
            end_datetime = datetime.combine(date, end_time)
            resource_result = ResourceService.check_resource_availability(
                db=db,
                appointment_type_id=appointment_type_id,
                clinic_id=clinic_id,
                start_time=start_datetime,
                end_time=end_datetime,
                exclude_calendar_event_id=exclude_calendar_event_id
            )
            resources_available = resource_result['is_available']
            resource_conflicts = resource_result['conflicts']
        
        is_available = practitioner_available and resources_available
        
        return {
            'is_available': is_available,
            'practitioner_available': practitioner_available,
            'resources_available': resources_available,
            'resource_conflicts': resource_conflicts
        }

    @staticmethod
    def fetch_practitioner_schedule_data(
        db: Session,
        practitioner_ids: List[int],
        date: date_type,
        clinic_id: int,
        exclude_calendar_event_id: int | None = None
    ) -> Dict[int, Dict[str, Any]]:
        """
        Fetch schedule data for one or more practitioners.
        
        Fetches default intervals and calendar events (exceptions and confirmed appointments)
        for the specified practitioners and date. Can be used for single or multiple practitioners.

        Args:
            db: Database session
            practitioner_ids: List of practitioner user IDs (can be a single-item list)
            date: Date to check
            clinic_id: Clinic ID for filtering schedule data

        Returns:
            Dict mapping practitioner_id to their schedule data:
            {
                practitioner_id: {
                    'default_intervals': List[PractitionerAvailability],
                    'events': List[CalendarEvent]  # Both exceptions and confirmed appointments
                }
            }
        """
        if not practitioner_ids:
            return {}
        
        day_of_week = date.weekday()
        
        # Batch fetch default intervals (1 query)
        default_intervals_map: Dict[int, List[PractitionerAvailability]] = {}
        default_intervals = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id.in_(practitioner_ids),
            PractitionerAvailability.clinic_id == clinic_id,
            PractitionerAvailability.day_of_week == day_of_week
        ).order_by(PractitionerAvailability.user_id, PractitionerAvailability.start_time).all()
        
        for interval in default_intervals:
            if interval.user_id not in default_intervals_map:
                default_intervals_map[interval.user_id] = []
            default_intervals_map[interval.user_id].append(interval)

        # Batch fetch all calendar events (exceptions and confirmed appointments) in a single query
        # Exclude the specified calendar_event_id if provided (for appointment editing)
        event_filter = and_(
            CalendarEvent.user_id.in_(practitioner_ids),
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == date,
            or_(
                CalendarEvent.event_type == 'availability_exception',
                and_(
                    CalendarEvent.event_type == 'appointment',
                    Appointment.status == 'confirmed'
                )
            )
        )
        
        if exclude_calendar_event_id is not None:
            event_filter = and_(event_filter, CalendarEvent.id != exclude_calendar_event_id)
        
        events = db.query(CalendarEvent).outerjoin(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(event_filter).all()
        
        # Group events by practitioner_id
        events_map: Dict[int, List[CalendarEvent]] = {}
        for event in events:
            if event.user_id not in events_map:
                events_map[event.user_id] = []
            events_map[event.user_id].append(event)
        
        # Combine into result dict
        result: Dict[int, Dict[str, Any]] = {}
        for practitioner_id in practitioner_ids:
            result[practitioner_id] = {
                'default_intervals': default_intervals_map.get(practitioner_id, []),
                'events': events_map.get(practitioner_id, [])
            }
        
        return result

    @staticmethod
    def _check_time_overlap(
        start1: time,
        end1: time,
        start2: time,
        end2: time
    ) -> bool:
        """Check if two time intervals overlap."""
        return start1 < end2 and start2 < end1

    @staticmethod
    def _filter_slots_by_booking_restrictions(
        slots: List[Dict[str, Any]],
        requested_date: date_type,
        clinic: Clinic
    ) -> List[Dict[str, Any]]:
        """
        Filter available slots based on clinic booking restrictions.

        This method filters slots based on:
        - minimum_booking_hours_ahead: Slots must be at least X hours from now
        - max_booking_window_days: Slots must be within X days from now

        Args:
            slots: List of available slot dictionaries
            requested_date: Date for which slots are requested
            clinic: Clinic object with booking restriction settings

        Returns:
            Filtered list of slots that meet booking restrictions
        """
        if not slots:
            return []

        # Get current Taiwan time for comparison
        now: datetime = taiwan_now()
        today = now.date()

        # Get clinic settings
        settings = clinic.get_validated_settings()
        booking_settings = settings.booking_restriction_settings
        max_booking_window_days = booking_settings.max_booking_window_days
        max_booking_date = today + timedelta(days=max_booking_window_days)

        # Filter by max_booking_window_days first (date-level check)
        if requested_date > max_booking_date:
            return []  # Date is beyond max booking window

        filtered_slots: List[Dict[str, Any]] = []

        for slot in slots:
            # Parse slot time
            slot_time_str = slot['start_time']
            hour, minute = map(int, slot_time_str.split(':'))
            slot_time = time(hour, minute)

            # Create datetime for the slot
            slot_datetime = datetime.combine(requested_date, slot_time)
            # Ensure it's in Taiwan timezone
            from utils.datetime_utils import ensure_taiwan
            slot_datetime_tz = ensure_taiwan(slot_datetime)
            # Explicit type checking instead of assert (asserts can be disabled)
            if slot_datetime_tz is None:
                continue  # Skip invalid slot
            slot_datetime: datetime = slot_datetime_tz

            # Apply booking restrictions
            # Note: same_day_disallowed is deprecated, all clinics now use minimum_hours_required
            # Use booking_settings for consistency (already extracted above)
            if booking_settings.booking_restriction_type == 'deadline_time_day_before':
                # Deadline time mode: appointment on day X must be booked by deadline
                # deadline_on_same_day=False: deadline on day X-1
                # deadline_on_same_day=True: deadline on day X (same day)
                deadline_time_str = booking_settings.deadline_time_day_before or "08:00"
                deadline_on_same_day = booking_settings.deadline_on_same_day
                
                from utils.datetime_utils import parse_deadline_time_string
                deadline_time_obj = parse_deadline_time_string(deadline_time_str, default_hour=8, default_minute=0)
                
                # Get slot date (day X)
                slot_date = slot_datetime.date()
                
                # Determine deadline date based on deadline_on_same_day setting
                if deadline_on_same_day:
                    # Deadline is on the same day as appointment (date X)
                    deadline_date = slot_date
                else:
                    # Deadline is on the day before (date X-1)
                    deadline_date = slot_date - timedelta(days=1)
                
                deadline_datetime = datetime.combine(deadline_date, deadline_time_obj).replace(tzinfo=now.tzinfo)
                
                # Check if current time is after deadline
                if now >= deadline_datetime:
                    # After deadline, so skip slots on this date
                    if deadline_on_same_day:
                        # Deadline on same day: skip slots on day X if past deadline on day X
                        if slot_datetime.date() == slot_date:
                            continue  # Skip this slot
                    else:
                        # Deadline on X-1: skip slots on day X if past deadline on day X-1
                        if slot_datetime.date() <= slot_date:
                            continue  # Skip this slot
                # If before deadline, slots are allowed (no filtering needed)
            elif booking_settings.booking_restriction_type == 'minimum_hours_required':
                # Must be at least X hours from now
                time_diff: timedelta = slot_datetime - now
                if time_diff.total_seconds() < (booking_settings.minimum_booking_hours_ahead * 3600):
                    continue  # Skip this slot
            # If restriction type is unknown, allow the slot (backward compatibility)

            filtered_slots.append(slot)

        return filtered_slots
    
    @staticmethod
    def _calculate_compact_schedule_recommendations(
        confirmed_appointments: List[CalendarEvent],
        available_slots: List[Dict[str, Any]],
        default_intervals: List[PractitionerAvailability],
        events: List[CalendarEvent]
    ) -> set[str]:
        """
        Calculate which available slots are recommended for compact scheduling.
        
        Logic:
        1. Identify "Working Blocks" (contiguous availability without exceptions).
        2. For each confirmed appointment, find its working block.
        3. Recommend the closest available slots before and after the appointment
           ONLY if they are within the same working block.
        
        Args:
            confirmed_appointments: List of confirmed appointment CalendarEvents.
            available_slots: List of available slot dicts with 'start_time' and 'end_time'.
            default_intervals: List of default availability intervals for the day.
            events: All calendar events (including exceptions) for the day.
            
        Returns:
            Set of recommended slot start times.
        """
        if not confirmed_appointments or not available_slots:
            return set()
            
        # 1. Identify "Working Blocks"
        # Filter for availability exceptions
        exceptions = [e for e in events if e.event_type == 'availability_exception']
        working_blocks = AvailabilityService._get_working_blocks(default_intervals, exceptions)
        
        if not working_blocks:
            return set()
            
        recommended_slots: set[str] = set()
        
        # Pre-calculate slot minutes for efficiency
        slot_data: List[Dict[str, Any]] = []
        for slot in available_slots:
            try:
                s_hour, s_min = map(int, slot['start_time'].split(':'))
                e_hour, e_min = map(int, slot['end_time'].split(':'))
                slot_data.append({
                    'start_str': slot['start_time'],
                    'start_min': s_hour * 60 + s_min,
                    'end_min': e_hour * 60 + e_min
                })
            except (ValueError, KeyError):
                continue

        for appt in confirmed_appointments:
            if not appt.start_time or not appt.end_time:
                continue
                
            appt_start_min = appt.start_time.hour * 60 + appt.start_time.minute
            appt_end_min = appt.end_time.hour * 60 + appt.end_time.minute
            
            # Find the block containing this appointment
            current_block = None
            for b_start, b_end in working_blocks:
                if b_start <= appt_start_min and appt_end_min <= b_end:
                    current_block = (b_start, b_end)
                    break
            
            if not current_block:
                continue
                
            block_start, block_end = current_block
            
            # Find closest slot BEFORE appointment in the same block
            best_before: Dict[str, Any] | None = None
            for s in slot_data:
                # Slot must end before or at appointment start, and be within the block
                if s['end_min'] <= appt_start_min and s['start_min'] >= block_start:
                    if best_before is None or s['start_min'] > best_before['start_min']:
                        best_before = s
                        
            # Find closest slot AFTER appointment in the same block
            best_after: Dict[str, Any] | None = None
            for s in slot_data:
                # Slot must start after or at appointment end, and be within the block
                if s['start_min'] >= appt_end_min and s['end_min'] <= block_end:
                    if best_after is None or s['start_min'] < best_after['start_min']:
                        best_after = s
            
            if best_before:
                recommended_slots.add(cast(str, best_before['start_str']))
            if best_after:
                recommended_slots.add(cast(str, best_after['start_str']))
                
        # Only return recommendations if some slots are recommended and some aren't
        if recommended_slots and len(recommended_slots) < len(available_slots):
            return recommended_slots
        return set()

    @staticmethod
    def _get_working_blocks(
        default_intervals: List[PractitionerAvailability],
        exceptions: List[CalendarEvent]
    ) -> List[tuple[int, int]]:
        """
        Calculate working blocks by subtracting exceptions from default intervals.
        Returns a list of (start_minutes, end_minutes) tuples.
        """
        # Convert default intervals to (start_min, end_min)
        working_periods: List[tuple[int, int]] = []
        for interval in default_intervals:
            start_min = interval.start_time.hour * 60 + interval.start_time.minute
            end_min = interval.end_time.hour * 60 + interval.end_time.minute
            working_periods.append((start_min, end_min))
            
        # Sort exceptions by start time
        valid_exceptions = [e for e in exceptions if e.start_time is not None and e.end_time is not None]
        sorted_exceptions = sorted(
            valid_exceptions,
            key=lambda e: cast(time, e.start_time)
        )
        
        for exc in sorted_exceptions:
            exc_start_time = cast(time, exc.start_time)
            exc_end_time = cast(time, exc.end_time)
            exc_start = exc_start_time.hour * 60 + exc_start_time.minute
            exc_end = exc_end_time.hour * 60 + exc_end_time.minute
            
            new_periods: List[tuple[int, int]] = []
            for p_start, p_end in working_periods:
                # No overlap
                if exc_end <= p_start or exc_start >= p_end:
                    new_periods.append((p_start, p_end))
                else:
                    # Partial or full overlap
                    if exc_start > p_start:
                        new_periods.append((p_start, exc_start))
                    if exc_end < p_end:
                        new_periods.append((exc_end, p_end))
            working_periods = new_periods
            
        # Return merged or just sorted periods
        return sorted(working_periods)


    @staticmethod
    def _format_time(time_obj: time) -> str:
        """Format time object to HH:MM string."""
        return time_obj.strftime('%H:%M')

    @staticmethod
    def validate_batch_dates(dates: List[str], max_dates: int = 31) -> List[str]:
        """
        Validate and limit batch date requests.
        
        Shared utility for batch availability endpoints to validate date format
        and enforce maximum date limit.
        
        Args:
            dates: List of date strings in YYYY-MM-DD format
            max_dates: Maximum number of dates allowed (default: 31)
            
        Returns:
            List of validated date strings
            
        Raises:
            HTTPException: If validation fails (too many dates or invalid format)
        """
        # Limit number of dates to prevent excessive queries
        if len(dates) > max_dates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"一次最多只能查詢 {max_dates} 個日期"
            )
        
        # Validate dates format
        validated_dates: List[str] = []
        for date_str in dates:
            try:
                # Validate date format
                parse_date_string(date_str)
                validated_dates.append(date_str)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"無效的日期格式: {date_str}，請使用 YYYY-MM-DD"
                )
        
        return validated_dates

    @staticmethod
    def _filter_dates_by_booking_window(
        db: Session,
        clinic_id: int,
        dates: List[str]
    ) -> List[str]:
        """
        Filter dates to only include those within the clinic's booking window.
        
        Shared helper method to filter dates before processing batch requests.
        This prevents 400 errors when requesting dates beyond the booking window.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            dates: List of validated date strings in YYYY-MM-DD format
            
        Returns:
            List of date strings that are within the booking window
            
        Raises:
            HTTPException: If clinic not found
        """
        today = taiwan_now().date()
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )
        settings = SettingsService.get_clinic_settings(db, clinic_id)
        max_booking_window_days = settings.booking_restriction_settings.max_booking_window_days
        max_date = today + timedelta(days=max_booking_window_days)
        
        # Filter dates to only include valid ones (within booking window and not in past)
        valid_dates: List[str] = []
        for date_str in dates:
            try:
                requested_date = parse_date_string(date_str)
                if today <= requested_date <= max_date:
                    valid_dates.append(date_str)
            except ValueError:
                # Invalid date format - skip it (shouldn't happen after validate_batch_dates)
                continue
        
        return valid_dates

    @staticmethod
    def get_batch_available_slots_for_practitioner(
        db: Session,
        practitioner_id: int,
        dates: List[str],
        appointment_type_id: int,
        clinic_id: int,
        exclude_calendar_event_id: int | None = None,
        apply_booking_restrictions: bool = True,
        for_patient_display: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get available slots for a practitioner across multiple dates.
        
        Shared method for batch availability fetching. Validates dates and
        fetches availability for all dates in a single operation.
        
        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            dates: List of date strings in YYYY-MM-DD format
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID
            exclude_calendar_event_id: Optional calendar event ID to exclude from conflict checking
            
        Returns:
            List of dictionaries, one per date, with:
            - date: str (YYYY-MM-DD)
            - slots: List[Dict] with start_time and end_time
            
        Raises:
            HTTPException: If validation fails
        """
        # Validate dates
        validated_dates = AvailabilityService.validate_batch_dates(dates)
        
        # Verify practitioner exists, is active, belongs to clinic, and offers appointment type
        AvailabilityService.validate_practitioner_for_clinic(
            db, practitioner_id, clinic_id
        )
        
        if not AvailabilityService.validate_practitioner_offers_appointment_type(
            db, practitioner_id, appointment_type_id, clinic_id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到治療師"
            )
        
        # Verify appointment type exists and belongs to clinic
        appointment_type = AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)
        if appointment_type.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到預約類型"
            )
        
        # Filter dates by booking window only if restrictions are applied
        if apply_booking_restrictions:
            valid_dates = AvailabilityService._filter_dates_by_booking_window(
                db, clinic_id, validated_dates
            )
        else:
            # For clinic admin endpoints, don't filter dates by booking window
            valid_dates = validated_dates
        
        # Fetch availability for all valid dates
        results: List[Dict[str, Any]] = []
        
        for date_str in valid_dates:
            try:
                slots_data = AvailabilityService.get_available_slots_for_practitioner(
                    db=db,
                    practitioner_id=practitioner_id,
                    date=date_str,
                    appointment_type_id=appointment_type_id,
                    clinic_id=clinic_id,
                    exclude_calendar_event_id=exclude_calendar_event_id,
                    apply_booking_restrictions=apply_booking_restrictions,
                    for_patient_display=for_patient_display
                )
                
                results.append({
                    'date': date_str,
                    'slots': slots_data
                })
            except HTTPException as e:
                # If it's a booking window validation error (400), skip this date
                # This is a defensive check - dates should already be filtered, but handle gracefully
                if e.status_code == status.HTTP_400_BAD_REQUEST:
                    # Check if it's a date validation error (booking window or past date)
                    # Status code 400 with date-related validation indicates booking window issue
                    logger.debug(f"Skipping date {date_str} due to validation error: {e.detail}")
                    results.append({
                        'date': date_str,
                        'slots': []
                    })
                else:
                    # Re-raise other HTTP exceptions (404, 500, etc.)
                    raise
            except Exception as e:
                # Log error but continue with other dates
                logger.warning(
                    f"Error fetching availability for date {date_str}: {e}"
                )
                # Return empty slots for this date
                results.append({
                    'date': date_str,
                    'slots': []
                })
        
        return results

    @staticmethod
    def _format_normal_hours(
        date: date_type,
        default_intervals: List[PractitionerAvailability]
    ) -> Optional[str]:
        """
        Format normal availability hours for a given date.
        
        Shows all intervals if multiple exist, e.g., "週一 09:00-12:00, 14:00-18:00"
        
        Args:
            date: Date to format
            default_intervals: List of default availability intervals for the day
            
        Returns:
            Formatted string with day name and all intervals, or None if no intervals
        """
        if not default_intervals:
            return None
        
        day_of_week = date.weekday()
        day_names = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
        day_name = day_names[day_of_week]
        
        # Format all intervals
        intervals_str = ", ".join([
            f"{AvailabilityService._format_time(interval.start_time)}-{AvailabilityService._format_time(interval.end_time)}"
            for interval in default_intervals
        ])
        
        return f"{day_name} {intervals_str}"

    @staticmethod
    def check_scheduling_conflicts(
        db: Session,
        practitioner_id: int,
        date: date_type,
        start_time: time,
        appointment_type_id: int,
        clinic_id: int,
        exclude_calendar_event_id: Optional[int] = None,
        check_past_appointment: bool = True
    ) -> Dict[str, Any]:
        """
        Check for scheduling conflicts at a specific time.
        
        Checks conflicts in priority order:
        1. Past appointment (highest priority, only if check_past_appointment=True)
        2. Appointment conflicts
        3. Availability exception conflicts (medium priority)
        4. Outside default availability
        5. Resource conflicts (lowest priority)
        
        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            date: Date to check
            start_time: Start time to check (HH:MM)
            appointment_type_id: Appointment type ID (for duration calculation)
            clinic_id: Clinic ID
            exclude_calendar_event_id: Optional calendar event ID to exclude from conflict checking
            check_past_appointment: Whether to check if appointment is in the past (default: True for clinic users)
            
        Returns:
            Dict with conflict information:
            {
                "has_conflict": bool,
                "conflict_type": "past_appointment" | "appointment" | "exception" | "availability" | "resource" | None,
                "appointment_conflict": {...} | None,
                "exception_conflict": {...} | None,
                "resource_conflicts": List[Dict] | None,
                "default_availability": {
                    "is_within_hours": bool,
                    "normal_hours": str | None
                }
            }
        """
        from services.appointment_type_service import AppointmentTypeService
        from models import Appointment
        
        # Get appointment type for duration
        # Note: get_appointment_type_by_id raises HTTPException if not found, so no need for None check
        appointment_type = AppointmentTypeService.get_appointment_type_by_id(
            db, appointment_type_id, clinic_id=clinic_id
        )
        
        # Calculate end_time = start_time + duration_minutes + scheduling_buffer_minutes
        total_minutes = start_time.hour * 60 + start_time.minute
        total_minutes += appointment_type.duration_minutes
        total_minutes += (appointment_type.scheduling_buffer_minutes or 0)
        
        end_hour = total_minutes // 60
        end_minute = total_minutes % 60
        
        # Handle overflow past 23:59
        if end_hour >= 24:
            logger.warning(
                f"Appointment end time overflow: start_time={start_time}, "
                f"duration={appointment_type.duration_minutes}, "
                f"buffer={appointment_type.scheduling_buffer_minutes}, "
                f"calculated_end_hour={end_hour}"
            )
            end_hour = 23
            end_minute = 59
        
        end_time = time(end_hour, end_minute)
        
        # Fetch schedule data for this practitioner and date
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, [practitioner_id], date, clinic_id, exclude_calendar_event_id
        )
        
        practitioner_data = schedule_data.get(practitioner_id, {
            'default_intervals': [],
            'events': []
        })
        
        default_intervals = practitioner_data['default_intervals']
        events = practitioner_data['events']
        
        # Check all conflict types and collect all conflicts found
        # conflict_type will still indicate the highest priority conflict for backward compatibility
        
        # Initialize conflict tracking
        past_appointment_conflict = False
        appointment_conflict = None
        exception_conflict = None
        is_within_hours = AvailabilityService.is_slot_within_default_intervals(
            default_intervals, start_time, end_time
        )
        normal_hours = AvailabilityService._format_normal_hours(date, default_intervals)
        resource_conflicts = None
        
        # 0. Check if appointment is in the past (highest priority, only for clinic users)
        if check_past_appointment:
            from utils.datetime_utils import TAIWAN_TZ
            scheduled_datetime = datetime.combine(date, start_time).replace(tzinfo=TAIWAN_TZ)
            current_datetime = taiwan_now()
            
            if scheduled_datetime < current_datetime:
                past_appointment_conflict = True
        
        # 1. Check for appointment conflicts
        for event in events:
            if (event.start_time and event.end_time and
                event.event_type == 'appointment' and
                AvailabilityService._check_time_overlap(
                    start_time, end_time,
                    event.start_time, event.end_time
                )):
                # Get appointment details
                appointment = db.query(Appointment).filter(
                    Appointment.calendar_event_id == event.id,
                    Appointment.status == 'confirmed'
                ).first()
                
                if appointment:
                    # Get appointment type name
                    appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "未知"
                    patient_name = appointment.patient.full_name if appointment.patient else "未知"
                    
                    # Note: appointment.calendar_event_id is the primary key of Appointment
                    # and represents the appointment ID used throughout the API
                    appointment_conflict = {
                        "appointment_id": appointment.calendar_event_id,
                        "patient_name": patient_name,
                        "start_time": AvailabilityService._format_time(event.start_time),
                        "end_time": AvailabilityService._format_time(event.end_time),
                        "appointment_type": appointment_type_name
                    }
                    break  # Only need first conflict of this type for display
        
        # 2. Check for availability exception conflicts
        for event in events:
            if (event.start_time and event.end_time and
                event.event_type == 'availability_exception' and
                AvailabilityService._check_time_overlap(
                    start_time, end_time,
                    event.start_time, event.end_time
                )):
                # Get exception reason if available (use custom_event_name as reason)
                reason = event.custom_event_name if event.custom_event_name else None
                
                exception_conflict = {
                    "exception_id": event.id,
                    "start_time": AvailabilityService._format_time(event.start_time),
                    "end_time": AvailabilityService._format_time(event.end_time),
                    "reason": reason
                }
                break  # Only need first conflict for display
        
        # 3. Check for resource conflicts
        from services.resource_service import ResourceService
        start_datetime = datetime.combine(date, start_time)
        end_datetime = datetime.combine(date, end_time)
        resource_result = ResourceService.check_resource_availability(
            db=db,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            start_time=start_datetime,
            end_time=end_datetime,
            exclude_calendar_event_id=exclude_calendar_event_id
        )
        
        if not resource_result['is_available']:
            resource_conflicts = resource_result['conflicts']
        
        # Determine highest priority conflict type for backward compatibility
        conflict_type = None
        if past_appointment_conflict:
            conflict_type = "past_appointment"
        elif appointment_conflict:
            conflict_type = "appointment"
        elif exception_conflict:
            conflict_type = "exception"
        elif not is_within_hours:
            conflict_type = "availability"
        elif resource_conflicts:
            conflict_type = "resource"
        
        # Return all conflicts found
        has_conflict = (
            past_appointment_conflict or
            appointment_conflict is not None or
            exception_conflict is not None or
            not is_within_hours or
            resource_conflicts is not None
        )
        
        return {
            "has_conflict": has_conflict,
            "conflict_type": conflict_type,  # Highest priority for backward compatibility
            "appointment_conflict": appointment_conflict,
            "exception_conflict": exception_conflict,
            "resource_conflicts": resource_conflicts,
            "default_availability": {
                "is_within_hours": is_within_hours,
                "normal_hours": normal_hours
            }
        }

    @staticmethod
    def _check_conflicts_with_schedule_data(
        db: Session,
        practitioner_id: int,
        date: date_type,
        start_time: time,
        end_time: time,
        schedule_data: Dict[str, Any],
        appointment_type: Any,
        resource_requirements: List[Any],
        clinic_id: int,
        check_past_appointment: bool = True
    ) -> Dict[str, Any]:
        """
        Check conflicts using pre-fetched schedule data.

        This is a helper method for batch conflict checking.
        """
        from services.appointment_type_service import AppointmentTypeService
        from models import Appointment

        default_intervals = schedule_data['default_intervals']
        events = schedule_data['events']

        # Initialize conflict tracking
        past_appointment_conflict = False
        appointment_conflict = None
        exception_conflict = None
        is_within_hours = AvailabilityService.is_slot_within_default_intervals(
            default_intervals, start_time, end_time
        )
        normal_hours = AvailabilityService._format_normal_hours(date, default_intervals)
        resource_conflicts = None

        # 0. Check if appointment is in the past (highest priority, only for clinic users)
        if check_past_appointment:
            from utils.datetime_utils import TAIWAN_TZ
            scheduled_datetime = datetime.combine(date, start_time).replace(tzinfo=TAIWAN_TZ)
            current_datetime = taiwan_now()

            if scheduled_datetime < current_datetime:
                past_appointment_conflict = True

        # 1. Check for appointment conflicts
        for event in events:
            if (event.start_time and event.end_time and
                event.event_type == 'appointment' and
                AvailabilityService._check_time_overlap(
                    start_time, end_time,
                    event.start_time, event.end_time
                )):
                # Get appointment details
                appointment = db.query(Appointment).filter(
                    Appointment.calendar_event_id == event.id,
                    Appointment.status == 'confirmed'
                ).first()

                if appointment:
                    # Get appointment type name
                    appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "未知"
                    patient_name = appointment.patient.full_name if appointment.patient else "未知"

                    appointment_conflict = {
                        "appointment_id": appointment.calendar_event_id,
                        "patient_name": patient_name,
                        "start_time": AvailabilityService._format_time(event.start_time),
                        "end_time": AvailabilityService._format_time(event.end_time),
                        "appointment_type": appointment_type_name
                    }
                    break  # Only need first conflict of this type for display

        # 2. Check for availability exception conflicts
        for event in events:
            if (event.start_time and event.end_time and
                event.event_type == 'availability_exception' and
                AvailabilityService._check_time_overlap(
                    start_time, end_time,
                    event.start_time, event.end_time
                )):
                # Get exception reason if available (use custom_event_name as reason)
                reason = event.custom_event_name if event.custom_event_name else None

                exception_conflict = {
                    "exception_id": event.id,
                    "start_time": AvailabilityService._format_time(event.start_time),
                    "end_time": AvailabilityService._format_time(event.end_time),
                    "reason": reason
                }
                break  # Only need first conflict for display

        # 3. Check for resource conflicts
        from services.resource_service import ResourceService
        start_datetime = datetime.combine(date, start_time)
        end_datetime = datetime.combine(date, end_time)
        resource_result = ResourceService.check_resource_availability(
            db=db,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic_id,
            start_time=start_datetime,
            end_time=end_datetime,
            exclude_calendar_event_id=None  # We'll handle exclusion per practitioner if needed
        )

        if not resource_result['is_available']:
            resource_conflicts = resource_result['conflicts']

        # Determine highest priority conflict type for backward compatibility
        conflict_type = None
        if past_appointment_conflict:
            conflict_type = "past_appointment"
        elif appointment_conflict:
            conflict_type = "appointment"
        elif exception_conflict:
            conflict_type = "exception"
        elif not is_within_hours:
            conflict_type = "availability"
        elif resource_conflicts:
            conflict_type = "resource"

        # Return all conflicts found
        has_conflict = (
            past_appointment_conflict or
            appointment_conflict is not None or
            exception_conflict is not None or
            not is_within_hours or
            resource_conflicts is not None
        )

        return {
            "has_conflict": has_conflict,
            "conflict_type": conflict_type,  # Highest priority for backward compatibility
            "appointment_conflict": appointment_conflict,
            "exception_conflict": exception_conflict,
            "resource_conflicts": resource_conflicts,
            "default_availability": {
                "is_within_hours": is_within_hours,
                "normal_hours": normal_hours
            }
        }

    @staticmethod
    def check_batch_scheduling_conflicts(
        db: Session,
        practitioners: List[Dict[str, Any]],
        date: date_type,
        start_time: time,
        appointment_type_id: int,
        clinic_id: int
    ) -> List[Dict[str, Any]]:
        """
        Check for scheduling conflicts for multiple practitioners at once.

        This method optimizes conflict checking by fetching schedule data in batch
        (~2 queries total vs 2N for N practitioners) and processing conflicts in-memory.

        Args:
            db: Database session
            practitioners: List of practitioner configs with user_id and exclude_calendar_event_id
                [{"user_id": 1, "exclude_calendar_event_id": 123}, ...]
            date: Date to check
            start_time: Start time to check
            appointment_type_id: Appointment type ID (for duration calculation)
            clinic_id: Clinic ID

        Returns:
            List of conflict results for each practitioner:
            [{
                "practitioner_id": int,
                "has_conflict": bool,
                "conflict_type": str | None,
                "appointment_conflict": dict | None,
                "exception_conflict": dict | None,
                "resource_conflicts": list | None,
                "default_availability": dict
            }, ...]
        """
        from services.appointment_type_service import AppointmentTypeService

        if not practitioners:
            return []

        # Extract practitioner IDs for batch fetching
        practitioner_ids = [p["user_id"] for p in practitioners]

        # Get appointment type for duration calculation
        appointment_type = AppointmentTypeService.get_appointment_type_by_id(
            db, appointment_type_id, clinic_id
        )

        # Fetch schedule data for all practitioners in batch (~2 queries total)
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db=db,
            practitioner_ids=practitioner_ids,
            date=date,
            clinic_id=clinic_id,
            exclude_calendar_event_id=None  # We'll filter per-practitioner below
        )

        results: List[Dict[str, Any]] = []

        # Calculate end time for the appointment
        total_minutes = start_time.hour * 60 + start_time.minute
        total_minutes += appointment_type.duration_minutes
        total_minutes += (appointment_type.scheduling_buffer_minutes or 0)

        end_hour = total_minutes // 60
        end_minute = total_minutes % 60

        # Handle overflow past 23:59
        if end_hour >= 24:
            logger.warning(
                f"Appointment end time overflow: start_time={start_time}, "
                f"duration={appointment_type.duration_minutes}, "
                f"buffer={appointment_type.scheduling_buffer_minutes}, "
                f"calculated_end_hour={end_hour}"
            )
            end_hour = 23
            end_minute = 59

        end_time = time(end_hour, end_minute)

        # Process conflicts for each practitioner in-memory
        for practitioner_config in practitioners:
            practitioner_id = practitioner_config["user_id"]
            exclude_calendar_event_id = practitioner_config.get("exclude_calendar_event_id")

            # Get practitioner's schedule data
            practitioner_schedule = schedule_data.get(practitioner_id, {
                'default_intervals': [],
                'events': []
            })

            # Filter events to exclude the specified calendar event if needed
            filtered_events = practitioner_schedule['events']
            if exclude_calendar_event_id:
                filtered_events = [
                    event for event in filtered_events
                    if event.id != exclude_calendar_event_id
                ]

            # Check conflicts using the helper method
            conflict_result = AvailabilityService._check_conflicts_with_schedule_data(
                db=db,
                practitioner_id=practitioner_id,
                date=date,
                start_time=start_time,
                end_time=end_time,
                schedule_data={
                    'default_intervals': practitioner_schedule['default_intervals'],
                    'events': filtered_events
                },
                appointment_type=appointment_type,
                resource_requirements=[],  # Resource conflicts are checked within the method
                clinic_id=clinic_id,
                check_past_appointment=True  # Check past appointments for consistency with single API
            )

            # Add practitioner_id to result
            conflict_result["practitioner_id"] = practitioner_id
            results.append(conflict_result)

        return results

    @staticmethod
    def get_batch_available_slots_for_clinic(
        db: Session,
        clinic_id: int,
        dates: List[str],
        appointment_type_id: int,
        practitioner_id: Optional[int] = None,
        exclude_calendar_event_id: int | None = None,
        apply_booking_restrictions: bool = True,
        for_patient_display: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get available slots for a clinic across multiple dates.
        
        Shared method for batch availability fetching. Can fetch for all practitioners
        or a specific practitioner in the clinic.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            dates: List of date strings in YYYY-MM-DD format
            appointment_type_id: Appointment type ID
            practitioner_id: Optional specific practitioner ID, or None for all practitioners
            
        Returns:
            List of dictionaries, one per date, with:
            - date: str (YYYY-MM-DD)
            - slots: List[Dict] with start_time, end_time, practitioner_id, practitioner_name
            
        Raises:
            HTTPException: If validation fails
        """
        # Validate dates
        validated_dates = AvailabilityService.validate_batch_dates(dates)
        
        # Verify appointment type exists and belongs to clinic
        appointment_type = AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)
        if appointment_type.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到預約類型"
            )
        
        # Filter dates by booking window only if restrictions are applied
        if apply_booking_restrictions:
            valid_dates = AvailabilityService._filter_dates_by_booking_window(
                db, clinic_id, validated_dates
            )
        else:
            # For clinic admin endpoints, don't filter dates by booking window
            valid_dates = validated_dates
        
        # Fetch availability for all valid dates
        results: List[Dict[str, Any]] = []
        
        for date_str in valid_dates:
            try:
                if practitioner_id:
                    # Specific practitioner requested
                    slots_data = AvailabilityService.get_available_slots_for_practitioner(
                        db=db,
                        practitioner_id=practitioner_id,
                        date=date_str,
                        appointment_type_id=appointment_type_id,
                        clinic_id=clinic_id,
                        exclude_calendar_event_id=exclude_calendar_event_id,
                        apply_booking_restrictions=apply_booking_restrictions,
                        for_patient_display=for_patient_display
                    )
                else:
                    # All practitioners in clinic
                    slots_data = AvailabilityService.get_available_slots_for_clinic(
                        db=db,
                        clinic_id=clinic_id,
                        date=date_str,
                        appointment_type_id=appointment_type_id,
                        exclude_calendar_event_id=exclude_calendar_event_id,
                        apply_booking_restrictions=apply_booking_restrictions,
                        for_patient_display=for_patient_display
                    )
                
                results.append({
                    'date': date_str,
                    'slots': slots_data
                })
            except HTTPException as e:
                # If it's a booking window validation error (400), skip this date
                # This is a defensive check - dates should already be filtered, but handle gracefully
                if e.status_code == status.HTTP_400_BAD_REQUEST:
                    # Check if it's a date validation error (booking window or past date)
                    # Status code 400 with date-related validation indicates booking window issue
                    logger.debug(f"Skipping date {date_str} due to validation error: {e.detail}")
                    results.append({
                        'date': date_str,
                        'slots': []
                    })
                else:
                    # Re-raise other HTTP exceptions (404, 500, etc.)
                    raise
            except Exception as e:
                # Log error but continue with other dates
                logger.warning(
                    f"Error fetching availability for date {date_str}: {e}"
                )
                # Return empty slots for this date
                results.append({
                    'date': date_str,
                    'slots': []
                })
        
        return results
