"""
Availability service for shared scheduling and availability logic.

This module contains all availability-related business logic that is shared
between different API endpoints (LIFF, clinic admin, practitioner calendar).
"""

import logging
from datetime import datetime, date as date_type, time, timedelta
from typing import List, Dict, Any, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import (
    User, AppointmentType, PractitionerAvailability, CalendarEvent,
    PractitionerAppointmentTypes
)
from utils.query_helpers import filter_by_role

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service class for availability operations.

    Contains business logic for availability checking and scheduling that is shared
    across different API endpoints.
    """

    @staticmethod
    def get_available_slots(
        db: Session,
        date: str,
        appointment_type_id: int,
        practitioner_ids: Optional[List[int]] = None,
        clinic_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get available time slots for booking.

        Args:
            db: Database session
            date: Date in YYYY-MM-DD format
            appointment_type_id: Appointment type ID
            practitioner_ids: Optional list of specific practitioner IDs to check
            clinic_id: Optional clinic ID for filtering

        Returns:
            List of available slot dictionaries

        Raises:
            HTTPException: If validation fails
        """
        try:
            # Validate date
            try:
                requested_date = datetime.strptime(date, '%Y-%m-%d').date()
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date format (use YYYY-MM-DD)"
                )

            # Validate date range
            today = datetime.now().date()
            max_date = today + timedelta(days=90)

            if requested_date < today:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot book appointments in the past"
                )
            if requested_date > max_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="最多只能預約 90 天內的時段"
                )

            # Get appointment type
            appointment_type = db.query(AppointmentType).filter_by(
                id=appointment_type_id
            ).first()

            if not appointment_type:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Appointment type not found"
                )

            # If clinic_id provided, ensure appointment type belongs to clinic
            if clinic_id and appointment_type.clinic_id != clinic_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Appointment type not found"
                )

            duration_minutes = appointment_type.duration_minutes

            # Get practitioners who offer this type
            if practitioner_ids:
                query = db.query(User).filter(
                    User.id.in_(practitioner_ids),
                    User.is_active == True
                )
                query = filter_by_role(query, 'practitioner')
                practitioners = query.join(PractitionerAppointmentTypes).filter(
                    PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
                ).all()
            else:
                # All practitioners who offer this type
                query = db.query(User).filter(
                    User.is_active == True
                )
                query = filter_by_role(query, 'practitioner')
                practitioners = query.join(PractitionerAppointmentTypes).filter(
                    PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
                ).all()

                # Filter by clinic if specified
                if clinic_id:
                    practitioners = [p for p in practitioners if p.clinic_id == clinic_id]

            if not practitioners:
                return []

            # Calculate available slots
            return AvailabilityService._calculate_available_slots(
                db, requested_date, practitioners, duration_minutes
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Availability query error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve availability"
            )

    @staticmethod
    def _calculate_available_slots(
        db: Session,
        requested_date: date_type,
        practitioners: List[User],
        duration_minutes: int
    ) -> List[Dict[str, Any]]:
        """
        Calculate available time slots for the given date and practitioners.

        Considers each practitioner's:
        - Default availability schedule (PractitionerAvailability)
        - Availability exceptions (CalendarEvent with event_type='availability_exception')
        - Existing appointments (CalendarEvent with event_type='appointment')

        Args:
            db: Database session
            requested_date: Date to check availability for
            practitioners: List of practitioners to check
            duration_minutes: Duration of appointment type

        Returns:
            List of available slot dictionaries with practitioner_id and practitioner_name
        """
        available_slots: List[Dict[str, Any]] = []
        day_of_week = requested_date.weekday()

        for practitioner in practitioners:
            # Get default schedule for this day of week
            default_intervals = db.query(PractitionerAvailability).filter(
                PractitionerAvailability.user_id == practitioner.id,
                PractitionerAvailability.day_of_week == day_of_week
            ).order_by(PractitionerAvailability.start_time).all()

            if not default_intervals:
                # Practitioner has no availability for this day of week
                continue

            # Get availability exceptions for this date
            exceptions = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == practitioner.id,
                CalendarEvent.event_type == 'availability_exception',
                CalendarEvent.date == requested_date
            ).all()

            # Get existing appointments for this date
            appointments = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == practitioner.id,
                CalendarEvent.event_type == 'appointment',
                CalendarEvent.date == requested_date
            ).all()

            # Calculate available slots for this practitioner
            practitioner_slots = AvailabilityService._calculate_slots_from_schedule(
                default_intervals, exceptions, appointments, duration_minutes
            )

            # Add practitioner info to each slot
            for slot in practitioner_slots:
                available_slots.append({
                    'start_time': slot['start_time'],
                    'end_time': slot['end_time'],
                    'practitioner_id': practitioner.id,
                    'practitioner_name': practitioner.full_name
                })

        return available_slots

    @staticmethod
    def get_available_slots_for_practitioner(
        db: Session,
        practitioner_id: int,
        date: str,
        appointment_type_id: int
    ) -> List[Dict[str, Any]]:
        """
        Get available time slots for a specific practitioner.

        Uses the practitioner's actual availability schedule, exceptions, and existing appointments.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            date: Date in YYYY-MM-DD format
            appointment_type_id: Appointment type ID

        Returns:
            List of available slot dictionaries

        Raises:
            HTTPException: If validation fails
        """
        try:
            # Verify user exists and is a practitioner
            user = db.query(User).filter(User.id == practitioner_id).first()
            if not user or not user.is_practitioner:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Practitioner not found"
                )

            # Verify appointment type exists
            appointment_type = db.query(AppointmentType).filter(
                AppointmentType.id == appointment_type_id
            ).first()
            if not appointment_type:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Appointment type not found"
                )

            try:
                target_date = datetime.strptime(date, '%Y-%m-%d').date()
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date format. Use YYYY-MM-DD"
                )

            # Get default schedule for this day of week
            day_of_week = target_date.weekday()
            default_intervals = db.query(PractitionerAvailability).filter(
                PractitionerAvailability.user_id == practitioner_id,
                PractitionerAvailability.day_of_week == day_of_week
            ).order_by(PractitionerAvailability.start_time).all()

            if not default_intervals:
                return []

            # Get availability exceptions for this date
            exceptions = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == practitioner_id,
                CalendarEvent.event_type == 'availability_exception',
                CalendarEvent.date == target_date
            ).all()

            # Get existing appointments for this date
            appointments = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == practitioner_id,
                CalendarEvent.event_type == 'appointment',
                CalendarEvent.date == target_date
            ).all()

            # Calculate available slots
            return AvailabilityService._calculate_slots_from_schedule(
                default_intervals, exceptions, appointments, appointment_type.duration_minutes
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Failed to fetch available slots for user {practitioner_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch available slots"
            )

    @staticmethod
    def _calculate_slots_from_schedule(
        default_intervals: List[PractitionerAvailability],
        exceptions: List[CalendarEvent],
        appointments: List[CalendarEvent],
        duration_minutes: int
    ) -> List[Dict[str, Any]]:
        """
        Calculate available slots from practitioner schedule data.

        Algorithm:
        1. Generate all possible candidate slots from default intervals
           at quarter hours (00, 15, 30, 45) with the given duration
        2. Filter out slots that overlap with exceptions or appointments

        Args:
            default_intervals: List of practitioner's default availability intervals
            exceptions: List of availability exceptions for the date
            appointments: List of existing appointments for the date
            duration_minutes: Duration of appointment type

        Returns:
            List of available slot dictionaries
        """
        # Step 1: Generate all candidate slots from default intervals
        candidate_slots: List[tuple[time, time]] = []

        for interval in default_intervals:
            # Round up interval start to next quarter hour
            current_time = AvailabilityService._round_up_to_quarter_hour(interval.start_time)
            
            # Generate slots at quarter-hour intervals within this interval
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
                
                # Move to next quarter hour
                current_minutes = current_time.hour * 60 + current_time.minute + 15
                current_time = time(current_minutes // 60, current_minutes % 60)
        
        # Step 2: Filter out slots that overlap with exceptions or appointments
        available_slots: List[Dict[str, Any]] = []
        
        for slot_start, slot_end in candidate_slots:
            # Check if slot overlaps with any exception
            overlaps_exception = False
            for exception in exceptions:
                if (exception.start_time and exception.end_time and
                    AvailabilityService._check_time_overlap(
                        slot_start, slot_end,
                        exception.start_time, exception.end_time
                    )):
                    overlaps_exception = True
                    break
            
            if overlaps_exception:
                continue
            
            # Check if slot overlaps with any appointment
            overlaps_appointment = False
            for appointment in appointments:
                if (appointment.start_time and appointment.end_time and
                    AvailabilityService._check_time_overlap(
                        slot_start, slot_end,
                        appointment.start_time, appointment.end_time
                    )):
                    overlaps_appointment = True
                    break

            if not overlaps_appointment:
                available_slots.append({
                    'start_time': AvailabilityService._format_time(slot_start),
                    'end_time': AvailabilityService._format_time(slot_end)
                })

        return available_slots

    @staticmethod
    def get_practitioners_for_appointment_type(
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
        query = filter_by_role(query, 'practitioner')
        query = query.join(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
        )

        if clinic_id:
            query = query.filter(User.clinic_id == clinic_id)

        return query.all()

    @staticmethod
    def check_practitioner_availability(
        db: Session,
        practitioner_id: int,
        start_time: datetime,
        duration_minutes: int
    ) -> bool:
        """
        Check if a practitioner is available at a specific time.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID
            start_time: Start time of proposed appointment
            duration_minutes: Duration in minutes

        Returns:
            True if practitioner is available, False otherwise
        """
        end_time = start_time + timedelta(minutes=duration_minutes)

        # Check for conflicting appointments
        conflicts = db.query(CalendarEvent).filter(
            CalendarEvent.user_id == practitioner_id,
            CalendarEvent.date == start_time.date(),
            CalendarEvent.start_time < end_time.time(),
            CalendarEvent.end_time > start_time.time(),
            CalendarEvent.event_type == 'appointment'
        ).count()

        return conflicts == 0

    @staticmethod
    def get_practitioner_availability_schedule(
        db: Session,
        practitioner_id: int
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Get a practitioner's complete availability schedule.

        Args:
            db: Database session
            practitioner_id: Practitioner user ID

        Returns:
            Dict with availability data organized by day of week
        """
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == practitioner_id
        ).order_by(PractitionerAvailability.day_of_week).all()

        # Group by day of week
        schedule: Dict[str, List[Dict[str, Any]]] = {}
        for avail in availability:
            day_name = avail.day_name.lower()
            if day_name not in schedule:
                schedule[day_name] = []

            schedule[day_name].append({
                'id': avail.id,
                'user_id': avail.user_id,
                'day_of_week': avail.day_of_week,
                'day_name': avail.day_name,
                'day_name_zh': avail.day_name_zh,
                'start_time': avail.start_time.strftime("%H:%M"),
                'end_time': avail.end_time.strftime("%H:%M"),
                'created_at': avail.created_at,
                'updated_at': avail.updated_at
            })

        return schedule

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
    def _format_time(time_obj: time) -> str:
        """Format time object to HH:MM string."""
        return time_obj.strftime('%H:%M')

    @staticmethod
    def _parse_time(time_str: str) -> time:
        """Parse time string in HH:MM format to time object."""
        hour, minute = map(int, time_str.split(':'))
        return time(hour, minute)

    @staticmethod
    def _round_up_to_quarter_hour(time_obj: time) -> time:
        """
        Round up time to the next quarter hour (00, 15, 30, 45).
        
        Args:
            time_obj: Time object to round up
            
        Returns:
            Time object rounded up to the next quarter hour
            If rounding would exceed 23:59, returns 23:59 (max valid time)
        """
        total_minutes = time_obj.hour * 60 + time_obj.minute
        
        # Calculate minutes to add to reach next quarter hour
        remainder = total_minutes % 15
        if remainder == 0:
            # Already on a quarter hour
            return time_obj
        
        # Round up to next quarter hour
        minutes_to_add = 15 - remainder
        rounded_minutes = total_minutes + minutes_to_add
        
        hour = rounded_minutes // 60
        minute = rounded_minutes % 60
        
        # Handle overflow past 23:59 (shouldn't happen in practice, but be defensive)
        if hour >= 24:
            # Clamp to max valid time (23:59)
            return time(23, 59)
        
        return time(hour, minute)
