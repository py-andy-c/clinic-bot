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

        # Get clinic settings for booking window
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )
        
        settings = SettingsService.get_clinic_settings(db, clinic_id)
        max_booking_window_days = settings.booking_restriction_settings.max_booking_window_days

        # Validate date range (using Taiwan timezone)
        today = taiwan_now().date()
        max_date = today + timedelta(days=max_booking_window_days)

        if requested_date < today:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法預約過去的時間"
            )
        if requested_date > max_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"最多只能預約 {max_booking_window_days} 天內的時段"
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
            PractitionerAppointmentTypes.clinic_id == clinic_id
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
        exclude_calendar_event_id: int | None = None
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
            slots = AvailabilityService._calculate_available_slots(
                db, requested_date, [practitioner], appointment_type.duration_minutes, 
                clinic, clinic_id, exclude_calendar_event_id, schedule_data=schedule_data
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
                            confirmed_appointments, slots
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
        exclude_calendar_event_id: int | None = None
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
            all_slots = AvailabilityService._calculate_available_slots(
                db, requested_date, practitioners, appointment_type.duration_minutes, clinic, clinic_id,
                exclude_calendar_event_id=exclude_calendar_event_id
            )
            
            # Deduplicate slots by start_time (practitioner assignment happens in _assign_practitioner)
            deduplicated_slots = AvailabilityService._deduplicate_slots_by_time(all_slots)
            
            # Sort by start_time to ensure consistent chronological ordering
            # (slots from multiple practitioners may not be in order)
            deduplicated_slots.sort(key=lambda s: s['start_time'])
            
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
        schedule_data: Dict[int, Dict[str, Any]] | None = None
    ) -> List[Dict[str, Any]]:
        """
        Calculate available time slots for the given date and practitioners.

        Considers each practitioner's:
        - Default availability schedule (PractitionerAvailability)
        - Availability exceptions (CalendarEvent with event_type='availability_exception')
        - Existing appointments (CalendarEvent with event_type='appointment')
        - Clinic booking restrictions (same day disallowed or minimum hours ahead)

        Args:
            db: Database session
            requested_date: Date to check availability for
            practitioners: List of practitioners to check
            duration_minutes: Duration of appointment type
            clinic: Clinic object with booking restriction settings

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
        
        for practitioner_id, data in schedule_data.items():
            practitioner = practitioner_lookup.get(practitioner_id)
            if not practitioner:
                continue
            
            # Get association for this practitioner
            association = association_lookup.get(practitioner_id)
            practitioner_name = association.full_name if association else practitioner.email
            
            default_intervals = data['default_intervals']
            if not default_intervals:
                # Practitioner has no availability for this day of week
                continue

            events = data['events']
            
            # Generate all candidate slots from default intervals
            # and filter out slots that overlap with exceptions or appointments
            # Get step_size_minutes from clinic settings (default: 30)
            validated_settings = clinic.get_validated_settings()
            step_size_minutes = validated_settings.booking_restriction_settings.step_size_minutes
            candidate_slots = AvailabilityService._generate_candidate_slots(
                default_intervals, duration_minutes, step_size_minutes=step_size_minutes
            )
            
            # Filter out slots that overlap with exceptions or appointments
            # Note: candidate_slots are already guaranteed to be within default_intervals,
            # so we only need to check for conflicts (exceptions and appointments)
            for slot_start, slot_end in candidate_slots:
                if not AvailabilityService.has_slot_conflicts(
                    events, slot_start, slot_end
                ):
                    available_slots.append({
                        'start_time': AvailabilityService._format_time(slot_start),
                        'end_time': AvailabilityService._format_time(slot_end),
                        'practitioner_id': practitioner.id,
                        'practitioner_name': practitioner_name
                    })

        # Apply clinic booking restrictions
        filtered_slots = AvailabilityService._filter_slots_by_booking_restrictions(
            available_slots, requested_date, clinic
        )

        return filtered_slots

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
            # Since we know slot_datetime is not None, this should be safe
            assert slot_datetime_tz is not None
            slot_datetime: datetime = slot_datetime_tz

            # Apply booking restrictions
            # Note: same_day_disallowed is deprecated, all clinics now use minimum_hours_required
            if clinic.booking_restriction_type == 'minimum_hours_required':
                # Must be at least X hours from now
                time_diff: timedelta = slot_datetime - now
                if time_diff.total_seconds() < (clinic.minimum_booking_hours_ahead * 3600):
                    continue  # Skip this slot
            # If restriction type is unknown, allow the slot (backward compatibility)

            filtered_slots.append(slot)

        return filtered_slots
    
    @staticmethod
    def _calculate_compact_schedule_recommendations(
        confirmed_appointments: List[CalendarEvent],
        available_slots: List[Dict[str, Any]]
    ) -> set[str]:
        """
        Calculate which available slots are recommended for compact scheduling.
        
        Logic (regardless of number of appointments):
        1. Recommend slots that don't expand the total time (fully within span)
        2. If no slots exist that don't expand total time, recommend:
           - The latest slot before the first appointment (if exists)
           - The earliest slot after the last appointment (if exists)
        
        Args:
            confirmed_appointments: List of confirmed appointment CalendarEvents (already fetched).
                                   Must have non-None start_time and end_time.
            available_slots: List of available slot dicts with 'start_time' and 'end_time' keys.
            
        Returns:
            Set of recommended slot start times (as HH:MM strings). Empty set if no recommendations
            should be shown (e.g., all slots extend or none extend).
        """
        if not confirmed_appointments:
            # No appointments → no recommendations
            return set()
        
        # Filter out appointments with None start_time or end_time
        valid_appointments = [
            a for a in confirmed_appointments 
            if a.start_time is not None and a.end_time is not None
        ]
        
        if not valid_appointments:
            return set()
        
        # Sort appointments by start_time to find earliest and latest
        # Use cast to help type checker understand that start_time is not None after filtering
        sorted_appointments = sorted(
            valid_appointments, 
            key=lambda a: cast(time, a.start_time)
        )
        
        # Find earliest start and latest end
        # We know these are not None because we filtered them
        earliest_start = cast(time, sorted_appointments[0].start_time)
        latest_end = cast(time, sorted_appointments[0].end_time)
        
        for appointment in sorted_appointments[1:]:  # Start from second element
            appt_start = cast(time, appointment.start_time)
            appt_end = cast(time, appointment.end_time)
            if appt_start < earliest_start:
                earliest_start = appt_start
            if appt_end > latest_end:
                latest_end = appt_end
        
        earliest_start_minutes = earliest_start.hour * 60 + earliest_start.minute
        latest_end_minutes = latest_end.hour * 60 + latest_end.minute
        
        recommended_slots: set[str] = set()
        latest_before_first: tuple[str, int] | None = None  # (slot_start_str, slot_end_minutes)
        earliest_after_last: tuple[str, int] | None = None  # (slot_start_str, slot_start_minutes)
        
        # Process all available slots
        for slot in available_slots:
            slot_start_str = slot['start_time']
            slot_end_str = slot['end_time']
            
            try:
                slot_start_hour, slot_start_min = map(int, slot_start_str.split(':'))
                slot_end_hour, slot_end_min = map(int, slot_end_str.split(':'))
                slot_start_minutes = slot_start_hour * 60 + slot_start_min
                slot_end_minutes = slot_end_hour * 60 + slot_end_min
                
                # 1. Slots that don't expand total time (fully within span)
                if (slot_start_minutes >= earliest_start_minutes and 
                    slot_end_minutes <= latest_end_minutes):
                    recommended_slots.add(slot_start_str)
                
                # 2. Find latest slot before first appointment (ends before earliest_start)
                # Only track this if we don't have slots that don't extend total time
                if slot_end_minutes <= earliest_start_minutes:
                    if latest_before_first is None or slot_end_minutes > latest_before_first[1]:
                        latest_before_first = (slot_start_str, slot_end_minutes)
                
                # 3. Find earliest slot after last appointment (starts after latest_end)
                # Only track this if we don't have slots that don't extend total time
                if slot_start_minutes >= latest_end_minutes:
                    if earliest_after_last is None or slot_start_minutes < earliest_after_last[1]:
                        earliest_after_last = (slot_start_str, slot_start_minutes)
                        
            except (ValueError, AttributeError):
                continue
        
        # Only add latest_before_first and earliest_after_last if there are NO slots that don't extend total time
        if not recommended_slots:
            if latest_before_first:
                recommended_slots.add(latest_before_first[0])
            if earliest_after_last:
                recommended_slots.add(earliest_after_last[0])
        
        # Only return recommendations if some slots extend and some don't
        # If all slots extend or none extend, return empty set (display all normally)
        if recommended_slots and len(recommended_slots) < len(available_slots):
            return recommended_slots
        else:
            return set()

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
        exclude_calendar_event_id: int | None = None
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
        
        # Filter dates to only include those within booking window
        valid_dates = AvailabilityService._filter_dates_by_booking_window(
            db, clinic_id, validated_dates
        )
        
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
                    exclude_calendar_event_id=exclude_calendar_event_id
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
    def get_batch_available_slots_for_clinic(
        db: Session,
        clinic_id: int,
        dates: List[str],
        appointment_type_id: int,
        practitioner_id: Optional[int] = None,
        exclude_calendar_event_id: int | None = None
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
        
        # Filter dates to only include those within booking window
        valid_dates = AvailabilityService._filter_dates_by_booking_window(
            db, clinic_id, validated_dates
        )
        
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
                        exclude_calendar_event_id=exclude_calendar_event_id
                    )
                else:
                    # All practitioners in clinic
                    slots_data = AvailabilityService.get_available_slots_for_clinic(
                        db=db,
                        clinic_id=clinic_id,
                        date=date_str,
                        appointment_type_id=appointment_type_id,
                        exclude_calendar_event_id=exclude_calendar_event_id
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
