"""
Availability service for shared scheduling and availability logic.

This module contains all availability-related business logic that is shared
between different API endpoints (LIFF, clinic admin, practitioner calendar).
"""

import logging
from datetime import datetime, date as date_type, time, timedelta
from typing import List, Dict, Any

from fastapi import HTTPException, status
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from models import (
    User, PractitionerAvailability, CalendarEvent,
    PractitionerAppointmentTypes, Appointment, Clinic, UserClinicAssociation
)
from services.appointment_type_service import AppointmentTypeService
from utils.query_helpers import filter_by_role
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service class for availability operations.

    Contains business logic for availability checking and scheduling that is shared
    across different API endpoints.
    """

    @staticmethod
    def _validate_date(date: str) -> date_type:
        """
        Validate date format and range.

        Args:
            date: Date string in YYYY-MM-DD format

        Returns:
            Parsed date object

        Raises:
            HTTPException: If validation fails
        """
        # Validate date format
        try:
            requested_date = datetime.strptime(date, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式（請使用 YYYY-MM-DD）"
            )

        # Validate date range (using Taiwan timezone)
        today = taiwan_now().date()
        max_date = today + timedelta(days=90)

        if requested_date < today:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法預約過去的時間"
            )
        if requested_date > max_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="最多只能預約 90 天內的時段"
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
        from models import UserClinicAssociation
        query = db.query(User).join(UserClinicAssociation).filter(
            User.id == practitioner_id,
            User.is_active == True,
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
    def get_available_slots_for_practitioner(
        db: Session,
        practitioner_id: int,
        date: str,
        appointment_type_id: int,
        clinic_id: int
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
            requested_date = AvailabilityService._validate_date(date)
            appointment_type = AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)

            # Verify practitioner exists, is active, and is a practitioner
            practitioner = AvailabilityService._get_practitioner_by_id(db, practitioner_id)

            # Verify appointment type belongs to practitioner's clinic
            # Get practitioner's clinic from UserClinicAssociation
            from models import UserClinicAssociation
            practitioner_association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == practitioner.id,
                UserClinicAssociation.is_active == True
            ).first()
            
            if not practitioner_association:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到治療師"
                )
            
            if appointment_type.clinic_id != practitioner_association.clinic_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到預約類型"
                )

            # Verify clinic_id matches practitioner's clinic
            if practitioner_association.clinic_id != clinic_id:
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

            # Calculate available slots for this practitioner
            return AvailabilityService._calculate_available_slots(
                db, requested_date, [practitioner], appointment_type.duration_minutes, clinic, clinic_id
            )
            
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
        appointment_type_id: int
    ) -> List[Dict[str, Any]]:
        """
        Get available time slots for all practitioners in a clinic.
        
        Returns slots from all active practitioners in the clinic who offer
        the specified appointment type.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            date: Date in YYYY-MM-DD format
            appointment_type_id: Appointment type ID
            
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
            requested_date = AvailabilityService._validate_date(date)
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
            return AvailabilityService._calculate_available_slots(
                db, requested_date, practitioners, appointment_type.duration_minutes, clinic, clinic_id
            )

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
        clinic_id: int
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
        practitioner_ids = [p.id for p in practitioners]
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, practitioner_ids, requested_date, clinic_id
        )
        
        available_slots: List[Dict[str, Any]] = []
        
        # Create a lookup dict for practitioner info
        practitioner_lookup = {p.id: p for p in practitioners}
        
        for practitioner_id, data in schedule_data.items():
            practitioner = practitioner_lookup.get(practitioner_id)
            if not practitioner:
                continue
            
            default_intervals = data['default_intervals']
            if not default_intervals:
                # Practitioner has no availability for this day of week
                continue

            events = data['events']
            
            # Generate all candidate slots from default intervals
            # and filter out slots that overlap with exceptions or appointments
            candidate_slots = AvailabilityService._generate_candidate_slots(
                default_intervals, duration_minutes, step_size_minutes=15
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
                        'practitioner_name': practitioner.full_name
                    })

        # Apply clinic booking restrictions
        filtered_slots = AvailabilityService._filter_slots_by_booking_restrictions(
            available_slots, requested_date, clinic
        )

        return filtered_slots

    @staticmethod
    def _generate_candidate_slots(
        default_intervals: List[PractitionerAvailability],
        duration_minutes: int,
        step_size_minutes: int = 15
    ) -> List[tuple[time, time]]:
        """
        Generate candidate time slots from default availability intervals.
        
        Generates slots at regular intervals (step_size_minutes) within each
        default availability interval, with each slot having the specified duration.

        Args:
            default_intervals: List of practitioner's default availability intervals
            duration_minutes: Duration of each slot in minutes
            step_size_minutes: Step size between slots in minutes (default: 15)

        Returns:
            List of (start_time, end_time) tuples for candidate slots
        """
        candidate_slots: List[tuple[time, time]] = []

        for interval in default_intervals:
            # Round up interval start to next step_size_minutes boundary
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
            UserClinicAssociation.is_active == True,
            User.is_active == True
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
        clinic_id: int
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
        events = db.query(CalendarEvent).outerjoin(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
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
        ).all()
        
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
        today = now.date()

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
            if clinic.booking_restriction_type == 'same_day_disallowed':
                # Disallow same-day booking, allow next day and later
                if requested_date <= today:
                    continue  # Skip this slot
            elif clinic.booking_restriction_type == 'minimum_hours_required':
                # Must be at least X hours from now
                time_diff: timedelta = slot_datetime - now
                if time_diff.total_seconds() < (clinic.minimum_booking_hours_ahead * 3600):
                    continue  # Skip this slot
            # If restriction type is unknown, allow the slot (backward compatibility)

            filtered_slots.append(slot)

        return filtered_slots

    @staticmethod
    def _format_time(time_obj: time) -> str:
        """Format time object to HH:MM string."""
        return time_obj.strftime('%H:%M')
