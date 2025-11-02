"""
Appointment service for shared appointment business logic.

This module contains all appointment-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
from datetime import datetime, timedelta, time, timezone
from typing import List, Optional, Dict, Any

from fastapi import HTTPException, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from models import (
    Appointment, CalendarEvent, User, Patient, AppointmentType,
    PractitionerAppointmentTypes
)
from services.patient_service import PatientService
from services.availability_service import AvailabilityService

logger = logging.getLogger(__name__)


class AppointmentService:
    """
    Service class for appointment operations.

    Contains business logic for appointment management that is shared
    across different API endpoints.
    """

    @staticmethod
    def create_appointment(
        db: Session,
        clinic_id: int,
        patient_id: int,
        appointment_type_id: int,
        start_time: datetime,
        practitioner_id: Optional[int] = None,
        notes: Optional[str] = None,
        line_user_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Create a new appointment with automatic practitioner assignment if needed.

        Args:
            db: Database session
            clinic_id: Clinic ID
            patient_id: Patient ID
            appointment_type_id: Appointment type ID
            start_time: Appointment start time
            practitioner_id: Specific practitioner ID or None for auto-assignment
            notes: Optional appointment notes
            line_user_id: LINE user ID for ownership validation (if provided)

        Returns:
            Dict with appointment details

        Raises:
            HTTPException: If creation fails or validation errors
        """
        try:
            # Validate patient ownership if line_user_id provided
            if line_user_id:
                PatientService.validate_patient_ownership(
                    db, patient_id, line_user_id, clinic_id
                )

            # Get appointment type and validate it belongs to clinic
            appointment_type = AvailabilityService._get_appointment_type_by_id(
                db, appointment_type_id, clinic_id=clinic_id
                )

            # Calculate end time (start_time is already in Taiwan timezone)
            end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

            # Handle practitioner assignment
            assigned_practitioner_id = AppointmentService._assign_practitioner(
                db, clinic_id, appointment_type_id, practitioner_id,
                start_time, end_time
            )

            # Extract date and time components directly (start_time is already in Taiwan timezone)
            # CalendarEvent stores date and time as naive values, interpreted as Taiwan time
            calendar_event = CalendarEvent(
                user_id=assigned_practitioner_id,
                event_type='appointment',
                date=start_time.date(),
                start_time=start_time.time(),
                end_time=end_time.time(),
                sync_status='pending'  # Will be synced to Google Calendar later
            )

            db.add(calendar_event)
            db.flush()  # Get calendar_event.id

            # Create appointment
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient_id,
                appointment_type_id=appointment_type_id,
                status='confirmed',
                notes=notes
            )

            db.add(appointment)
            db.commit()
            db.refresh(appointment)

            # Get related objects for response
            practitioner = db.query(User).get(assigned_practitioner_id)
            patient = db.query(Patient).get(patient_id)

            logger.info(f"Created appointment {appointment.calendar_event_id} for patient {patient_id}")

            return {
                'appointment_id': appointment.calendar_event_id,
                'calendar_event_id': calendar_event.id,
                'patient_name': patient.full_name if patient else '',
                'practitioner_name': practitioner.full_name if practitioner else '',
                'appointment_type_name': appointment_type.name,
                'start_time': start_time,
                'end_time': end_time,
                'status': appointment.status,
                'notes': appointment.notes,
                'practitioner_id': assigned_practitioner_id
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to create appointment: {e}")
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create appointment"
            )

    @staticmethod
    def _is_practitioner_available_at_slot(
        schedule_data: Dict[int, Dict[str, Any]],
        practitioner_id: int,
        start_time: time,
        end_time: time
    ) -> bool:
        """
        Check if a practitioner is available at the given time slot.
        
        Args:
            schedule_data: Schedule data from fetch_practitioner_schedule_data
            practitioner_id: Practitioner ID to check
            start_time: Slot start time
            end_time: Slot end time
            
        Returns:
            True if practitioner is available, False otherwise
        """
        data = schedule_data.get(practitioner_id, {
            'default_intervals': [],
            'events': []
        })
        
        # Check if slot is within default intervals
        if not AvailabilityService._is_slot_within_default_intervals(
            data['default_intervals'], start_time, end_time
        ):
            return False
        
        # Check if slot has conflicts
        if AvailabilityService._has_slot_conflicts(
            data['events'], start_time, end_time
        ):
            return False
        
        return True

    @staticmethod
    def _assign_practitioner(
        db: Session,
        clinic_id: int,
        appointment_type_id: int,
        requested_practitioner_id: Optional[int],
        start_time: datetime,
        end_time: datetime
    ) -> int:
        """
        Assign a practitioner to an appointment.

        Either uses the requested practitioner or auto-assigns the one with least appointments.

        Args:
            db: Database session
            clinic_id: Clinic ID
            appointment_type_id: Appointment type ID
            requested_practitioner_id: Specific practitioner or None for auto-assignment
            start_time: Appointment start time (Taiwan timezone datetime)
            end_time: Appointment end time (Taiwan timezone datetime)

        Returns:
            Assigned practitioner ID

        Raises:
            HTTPException: If no available practitioner found
        """
        # Get all practitioners who offer this appointment type
        practitioners = AvailabilityService._get_practitioners_for_appointment_type(
            db, appointment_type_id, clinic_id
        )
        
        # Batch fetch schedule data for all practitioners (2 queries total)
        practitioner_ids = [p.id for p in practitioners]
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, practitioner_ids, start_time.date()
        )
        
        slot_start_time = start_time.time()
        slot_end_time = end_time.time()
        
        if requested_practitioner_id:
            # Specific practitioner requested - validate they're in the list and available
            practitioner = next(
                (p for p in practitioners if p.id == requested_practitioner_id),
                None
            )

            if not practitioner:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Practitioner not found or doesn't offer this appointment type"
                )

            if not AppointmentService._is_practitioner_available_at_slot(
                schedule_data, practitioner.id, slot_start_time, slot_end_time
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="時段不可用"
                )

            return practitioner.id

        else:
            # Auto-assign to practitioner with least appointments that day
            # Filter by availability at requested time
            available_candidates = [
                p for p in practitioners
                if AppointmentService._is_practitioner_available_at_slot(
                    schedule_data, p.id, slot_start_time, slot_end_time
                )
            ]

            if not available_candidates:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="無可用治療師"
                )

            # Assign to practitioner with least appointments that day
            # Only count confirmed appointments for load balancing (exclude cancelled ones)
            selected_practitioner = min(
                available_candidates,
                key=lambda p: db.query(CalendarEvent).join(
                    Appointment, CalendarEvent.id == Appointment.calendar_event_id
                ).filter(
                    CalendarEvent.user_id == p.id,
                    CalendarEvent.date == start_time.date(),
                    CalendarEvent.event_type == 'appointment',
                    Appointment.status == 'confirmed'
                ).count()
            )

            return selected_practitioner.id

    @staticmethod
    def list_appointments_for_line_user(
        db: Session,
        line_user_id: int,
        clinic_id: int,
        upcoming_only: bool = True
    ) -> List[Dict[str, Any]]:
        """
        List appointments for all patients associated with a LINE user.

        Args:
            db: Database session
            line_user_id: LINE user ID
            clinic_id: Clinic ID
            upcoming_only: Filter for upcoming appointments only

        Returns:
            List of appointment dictionaries
        """
        # Get all patients for this LINE user at this clinic
        patients: List[Patient] = db.query(Patient).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic_id
        ).all()

        if not patients:
            return []

        patient_ids = [p.id for p in patients]

        # Build query
        query = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id.in_(patient_ids)
        )

        if upcoming_only:
            # Filter for upcoming appointments: future dates or today with future times
            today = datetime.now().date()
            current_time = datetime.now().time()
            query = query.filter(
                (CalendarEvent.date > today) |
                and_(CalendarEvent.date == today, CalendarEvent.start_time > current_time)
            )

        appointments: List[Appointment] = query.order_by(CalendarEvent.start_time).all()

        # Format response
        result: List[Dict[str, Any]] = []
        for appointment in appointments:
            practitioner = db.query(User).get(appointment.calendar_event.user_id)
            appointment_type = db.query(AppointmentType).get(appointment.appointment_type_id)
            patient = db.query(Patient).get(appointment.patient_id)

            if not all([practitioner, appointment_type, patient]):
                continue  # Skip if any related object not found

            # Type assertions for Pyright
            assert practitioner is not None
            assert appointment_type is not None
            assert patient is not None

            # Combine date and time into full datetime strings
            event_date = appointment.calendar_event.date
            start_datetime = datetime.combine(event_date, appointment.calendar_event.start_time) if appointment.calendar_event.start_time else None
            end_datetime = datetime.combine(event_date, appointment.calendar_event.end_time) if appointment.calendar_event.end_time else None

            result.append({
                "id": appointment.calendar_event_id,
                "patient_id": appointment.patient_id,
                "patient_name": patient.full_name,
                "practitioner_name": practitioner.full_name,
                "appointment_type_name": appointment_type.name,
                "start_time": start_datetime.isoformat() if start_datetime else "",
                "end_time": end_datetime.isoformat() if end_datetime else "",
                "status": appointment.status,
                "notes": appointment.notes
            })

        return result

    @staticmethod
    def list_appointments_for_clinic(
        db: Session,
        clinic_id: int,
        date_filter: Optional[str] = None,
        practitioner_id: Optional[int] = None,
        status_filter: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        List all appointments for a clinic (admin view).

        Args:
            db: Database session
            clinic_id: Clinic ID
            date_filter: Optional date filter (YYYY-MM-DD)
            practitioner_id: Optional practitioner filter
            status_filter: Optional status filter

        Returns:
            List of appointment dictionaries
        """
        # Base query - join appointments with calendar events
        query = db.query(Appointment).join(CalendarEvent).join(Patient).join(User, CalendarEvent.user_id == User.id)

        # Filter by clinic
        query = query.filter(User.clinic_id == clinic_id)

        # Filter by date if provided
        if date_filter:
            try:
                from datetime import datetime as dt
                filter_date = dt.fromisoformat(date_filter).date()
                query = query.filter(CalendarEvent.date == filter_date)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date format. Use YYYY-MM-DD"
                )

        # Filter by practitioner if provided
        if practitioner_id:
            query = query.filter(CalendarEvent.user_id == practitioner_id)

        # Filter by status if provided
        if status_filter:
            if status_filter not in ['confirmed', 'canceled_by_patient', 'canceled_by_clinic']:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status. Must be 'confirmed', 'canceled_by_patient', or 'canceled_by_clinic'"
                )
            query = query.filter(Appointment.status == status_filter)

        # Order by start time (most recent first)
        appointments = query.order_by(CalendarEvent.start_time.desc()).all()

        # Format response
        result: List[Dict[str, Any]] = []
        for appointment in appointments:
            practitioner = db.query(User).get(appointment.calendar_event.user_id)
            if not practitioner:
                continue  # Skip if practitioner not found

            # Construct datetime from date and time
            from datetime import datetime
            start_datetime = datetime.combine(appointment.calendar_event.date, appointment.calendar_event.start_time)
            end_datetime = datetime.combine(appointment.calendar_event.date, appointment.calendar_event.end_time)

            result.append({
                'appointment_id': appointment.calendar_event_id,
                'calendar_event_id': appointment.calendar_event_id,
                'patient_name': appointment.patient.full_name,
                'patient_phone': appointment.patient.phone_number,
                'practitioner_name': practitioner.full_name,
                'appointment_type_name': appointment.appointment_type.name,
                'start_time': start_datetime,
                'end_time': end_datetime,
                'status': appointment.status,
                'notes': appointment.notes,
                'created_at': appointment.patient.created_at
            })

        return result

    @staticmethod
    def cancel_appointment_by_patient(
        db: Session,
        appointment_id: int,
        line_user_id: int,
        clinic_id: int
    ) -> Dict[str, Any]:
        """
        Cancel an appointment by patient (LINE user).

        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
            line_user_id: LINE user ID for ownership validation
            clinic_id: Clinic ID

        Returns:
            Success message

        Raises:
            HTTPException: If appointment not found or access denied

        Note:
            This method is idempotent - if the appointment is already cancelled,
            it returns success without making changes.
        """
        # Find appointment
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        # Verify ownership through patient
        patient = db.query(Patient).filter(
            Patient.id == appointment.patient_id,
            Patient.line_user_id == line_user_id,
            Patient.clinic_id == clinic_id
        ).first()

        if not patient:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="無權限取消此預約"
            )

        # Check if appointment is already cancelled - if so, return success (idempotent)
        if appointment.status in ['canceled_by_patient', 'canceled_by_clinic']:
            logger.info(f"Appointment {appointment_id} already cancelled with status {appointment.status}, returning success")
            return {"success": True, "message": "預約已取消"}

        # Update status
        appointment.status = 'canceled_by_patient'
        appointment.canceled_at = datetime.now(timezone.utc)

        db.commit()

        logger.info(f"Patient {line_user_id} cancelled appointment {appointment_id}")
        return {"success": True, "message": "預約已取消"}

    @staticmethod
    def cancel_appointment_by_clinic_admin(
        db: Session,
        appointment_id: int,
        clinic_id: int
    ) -> Dict[str, Any]:
        """
        Cancel an appointment by clinic admin.

        Updates status, deletes Google Calendar event, and prepares for LINE notification.

        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
            clinic_id: Clinic ID

        Returns:
            Dict with appointment and practitioner details for notification

        Raises:
            HTTPException: If appointment not found

        Note:
            This method is idempotent - if the appointment is already cancelled,
            it returns success without making changes.
        """
        # Find appointment
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        # Verify appointment belongs to current clinic
        calendar_event = db.query(CalendarEvent).filter(
            CalendarEvent.id == appointment_id
        ).first()

        if not calendar_event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        practitioner = db.query(User).filter(
            User.id == calendar_event.user_id,
            User.clinic_id == clinic_id
        ).first()

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到相關治療師"
            )

        # Check if appointment is already cancelled - if so, return success (idempotent)
        if appointment.status in ['canceled_by_patient', 'canceled_by_clinic']:
            logger.info(f"Appointment {appointment_id} already cancelled with status {appointment.status}, returning success")
            return {
                'appointment': appointment,
                'practitioner': practitioner,
                'gcal_deleted': False,  # Already cancelled, no GCal deletion needed
                'already_cancelled': True
            }

        # Update appointment status
        appointment.status = 'canceled_by_clinic'
        appointment.canceled_at = datetime.now(timezone.utc)

        # Delete Google Calendar event if it exists
        gcal_deleted = False
        if calendar_event.gcal_event_id and practitioner.gcal_credentials:
            try:
                from services.encryption_service import get_encryption_service
                from services.google_calendar_service import GoogleCalendarService
                import asyncio
                import json

                decrypted_credentials = get_encryption_service().decrypt_data(practitioner.gcal_credentials)
                gcal_service = GoogleCalendarService(json.dumps(decrypted_credentials))

                # Delete event from Google Calendar
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(gcal_service.delete_event(calendar_event.gcal_event_id))
                    gcal_deleted = True
                    logger.info(f"Deleted Google Calendar event {calendar_event.gcal_event_id} for appointment {appointment_id}")
                finally:
                    loop.close()
            except Exception as e:
                logger.exception(f"Failed to delete Google Calendar event: {e}")
                # Continue with cancellation even if GCal deletion fails

        db.commit()

        logger.info(f"Clinic admin cancelled appointment {appointment_id}")

        return {
            'appointment': appointment,
            'practitioner': practitioner,
            'gcal_deleted': gcal_deleted
        }
