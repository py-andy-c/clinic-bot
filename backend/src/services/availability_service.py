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
                practitioners = db.query(User).filter(
                    User.id.in_(practitioner_ids),
                    User.is_active == True,
                    User.roles.contains(['practitioner'])
                ).join(PractitionerAppointmentTypes).filter(
                    PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
                ).all()
            else:
                # All practitioners who offer this type
                practitioners = db.query(User).filter(
                    User.is_active == True,
                    User.roles.contains(['practitioner'])
                ).join(PractitionerAppointmentTypes).filter(
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

        Args:
            db: Database session
            requested_date: Date to check availability for
            practitioners: List of practitioners to check
            duration_minutes: Duration of appointment type

        Returns:
            List of available slot dictionaries
        """
        available_slots: List[Dict[str, Any]] = []

        # Sample: 9 AM to 5 PM in 30-minute increments (simplified for MVP)
        # TODO: Replace with proper practitioner availability logic
        current_time = datetime.combine(requested_date, datetime.strptime("09:00", "%H:%M").time())
        end_time = datetime.combine(requested_date, datetime.strptime("17:00", "%H:%M").time())

        while current_time + timedelta(minutes=duration_minutes) <= end_time:
            slot_end = current_time + timedelta(minutes=duration_minutes)

            # Check if this slot conflicts with existing appointments for ANY practitioner
            conflicts = db.query(CalendarEvent).filter(
                CalendarEvent.user_id.in_([p.id for p in practitioners]),
                CalendarEvent.date == requested_date,
                CalendarEvent.start_time < slot_end.time(),
                CalendarEvent.end_time > current_time.time(),
                CalendarEvent.event_type == 'appointment'
            ).count()

            if conflicts == 0:
                # Slot is available - return all practitioner options
                for practitioner in practitioners:
                    available_slots.append({
                        'start_time': current_time.strftime("%H:%M"),
                        'end_time': slot_end.strftime("%H:%M"),
                        'practitioner_id': practitioner.id,
                        'practitioner_name': practitioner.full_name
                    })

            current_time += timedelta(minutes=30)  # 30-minute increments

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

        Args:
            default_intervals: List of practitioner's default availability intervals
            exceptions: List of availability exceptions for the date
            appointments: List of existing appointments for the date
            duration_minutes: Duration of appointment type

        Returns:
            List of available slot dictionaries
        """
        available_slots: List[Dict[str, Any]] = []

        for interval in default_intervals:
            # Check if this interval is blocked by an exception
            blocked = False
            for exception in exceptions:
                if (exception.start_time and exception.end_time and
                    AvailabilityService._check_time_overlap(
                        interval.start_time, interval.end_time,
                        exception.start_time, exception.end_time
                    )):
                    blocked = True
                    break

            if blocked:
                continue

            # Generate slots within this interval
            current_time = interval.start_time
            while True:
                # Calculate end time for this slot
                slot_end_minutes = (current_time.hour * 60 + current_time.minute + duration_minutes)
                slot_end_hour = slot_end_minutes // 60
                slot_end_minute = slot_end_minutes % 60
                slot_end_time = time(slot_end_hour, slot_end_minute)

                # Check if slot fits within the interval
                if slot_end_time > interval.end_time:
                    break

                # Check if slot conflicts with existing appointments
                slot_conflicts = False
                for appointment in appointments:
                    if (appointment.start_time and appointment.end_time and
                        AvailabilityService._check_time_overlap(
                            current_time, slot_end_time,
                            appointment.start_time, appointment.end_time
                        )):
                        slot_conflicts = True
                        break

                if not slot_conflicts:
                    available_slots.append({
                        'start_time': AvailabilityService._format_time(current_time),
                        'end_time': AvailabilityService._format_time(slot_end_time)
                    })

                # Move to next slot (15-minute increments)
                current_minutes = current_time.hour * 60 + current_time.minute + 15
                current_time = time(current_minutes // 60, current_minutes % 60)

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
            User.is_active == True,
            User.roles.contains(['practitioner'])
        ).join(PractitionerAppointmentTypes).filter(
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
