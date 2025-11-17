"""
Appointment service for shared appointment business logic.

This module contains all appointment-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
from datetime import datetime, timedelta, time
from typing import List, Optional, Dict, Any, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from models import (
    Appointment, CalendarEvent, User, Patient, UserClinicAssociation
)
from services.patient_service import PatientService
from services.availability_service import AvailabilityService
from services.appointment_type_service import AppointmentTypeService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from utils.appointment_type_queries import get_appointment_type_by_id_with_soft_delete_check

logger = logging.getLogger(__name__)


def get_appointment_type_name_safe(appointment_type_id: int, db: Session) -> str:
    """
    Get appointment type name safely, handling deleted types.

    Args:
        appointment_type_id: The appointment type ID
        db: Database session

    Returns:
        Appointment type name or fallback for deleted types
    """
    try:
        appointment_type = get_appointment_type_by_id_with_soft_delete_check(
            db, appointment_type_id, include_deleted=True
        )
        if appointment_type.is_deleted:
            return "已刪除服務類型"
        return appointment_type.name
    except ValueError:
        return "未知服務類型"


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
            appointment_type = AppointmentTypeService.get_appointment_type_by_id(
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
                clinic_id=clinic_id,
                event_type='appointment',
                date=start_time.date(),
                start_time=start_time.time(),
                end_time=end_time.time()
            )

            db.add(calendar_event)
            db.flush()  # Get calendar_event.id

            # Determine auto-assignment flags
            # If practitioner_id was None, it was auto-assigned
            was_auto_assigned = practitioner_id is None

            # Create appointment
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient_id,
                appointment_type_id=appointment_type_id,
                status='confirmed',
                notes=notes,
                is_auto_assigned=was_auto_assigned,
                originally_auto_assigned=was_auto_assigned
            )

            db.add(appointment)
            db.commit()
            db.refresh(appointment)

            # Get related objects for response
            practitioner = db.query(User).get(assigned_practitioner_id)
            patient = db.query(Patient).get(patient_id)

            logger.info(f"Created appointment {appointment.calendar_event_id} for patient {patient_id}")

            # Get practitioner name from association
            practitioner_name = ''
            if practitioner:
                association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == practitioner.id,
                    UserClinicAssociation.clinic_id == clinic_id,
                    UserClinicAssociation.is_active == True
                ).first()
                practitioner_name = association.full_name if association else practitioner.email

            return {
                'appointment_id': appointment.calendar_event_id,
                'calendar_event_id': calendar_event.id,
                'patient_name': patient.full_name if patient else '',
                'practitioner_name': practitioner_name,
                'appointment_type_name': get_appointment_type_name_safe(appointment_type_id, db),
                'start_time': start_time,
                'end_time': end_time,
                'status': appointment.status,
                'notes': appointment.notes,
                'practitioner_id': assigned_practitioner_id
            }

        except HTTPException:
            raise
        except IntegrityError as e:
            logger.warning(f"Appointment booking conflict: {e}")
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此時段已被預約，請選擇其他時間"
            )
        except Exception as e:
            logger.exception(f"Failed to create appointment: {e}")
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="建立預約失敗"
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
        if not AvailabilityService.is_slot_within_default_intervals(
            data['default_intervals'], start_time, end_time
        ):
            return False
        
        # Check if slot has conflicts
        if AvailabilityService.has_slot_conflicts(
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
        practitioners = AvailabilityService.get_practitioners_for_appointment_type(
            db, appointment_type_id, clinic_id
        )
        
        # Batch fetch schedule data for all practitioners (2 queries total)
        practitioner_ids = [p.id for p in practitioners]
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, practitioner_ids, start_time.date(), clinic_id
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
                    detail="找不到治療師或該治療師不提供此預約類型"
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

            # Batch fetch appointment counts for all candidates in one query
            practitioner_ids = [p.id for p in available_candidates]
            date_filter = start_time.date()

            # Single query to get counts for all practitioners
            counts_query = db.query(
                CalendarEvent.user_id,
                func.count(CalendarEvent.id).label('appointment_count')
            ).join(
                Appointment, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                CalendarEvent.user_id.in_(practitioner_ids),
                CalendarEvent.date == date_filter,
                CalendarEvent.event_type == 'appointment',
                Appointment.status == 'confirmed'
            ).group_by(CalendarEvent.user_id).all()

            # Create lookup dict
            counts_map = {user_id: count for user_id, count in counts_query}

            # Find practitioner with minimum count (default to 0 if not found)
            selected_practitioner = min(
                available_candidates,
                key=lambda p: counts_map.get(p.id, 0)
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

        # Build query - explicitly join CalendarEvent for filtering and ordering
        query = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.patient_id.in_(patient_ids)
        )

        if upcoming_only:
            # Filter for upcoming appointments using utility function
            from utils.appointment_queries import filter_future_appointments
            query = filter_future_appointments(query)

        # Eagerly load all relationships to avoid N+1 queries
        # Since we already joined CalendarEvent, use contains_eager for it
        from sqlalchemy.orm import contains_eager
        appointments: List[Appointment] = query.options(
            contains_eager(Appointment.calendar_event).joinedload(CalendarEvent.user),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.patient)
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()

        # Format response
        result: List[Dict[str, Any]] = []
        
        # Get all practitioner associations in one query
        practitioner_ids = [appt.calendar_event.user_id for appt in appointments if appt.calendar_event and appt.calendar_event.user_id]
        associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id.in_(practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()
        association_lookup: Dict[int, UserClinicAssociation] = {a.user_id: a for a in associations}
        
        for appointment in appointments:
            # All relationships are now eagerly loaded, no database queries needed
            practitioner = appointment.calendar_event.user
            appointment_type = appointment.appointment_type
            patient = appointment.patient

            if not all([practitioner, appointment_type, patient]):
                continue  # Skip if any related object not found

            # Type assertions for Pyright
            assert practitioner is not None
            assert appointment_type is not None
            assert patient is not None

            # Get practitioner name from association
            association = association_lookup.get(practitioner.id)
            practitioner_name = association.full_name if association else practitioner.email

            # Combine date and time into full datetime strings (Taiwan timezone)
            event_date = appointment.calendar_event.date
            if appointment.calendar_event.start_time:
                start_datetime = datetime.combine(event_date, appointment.calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
            else:
                start_datetime = None
            if appointment.calendar_event.end_time:
                end_datetime = datetime.combine(event_date, appointment.calendar_event.end_time).replace(tzinfo=TAIWAN_TZ)
            else:
                end_datetime = None

            result.append({
                "id": appointment.calendar_event_id,
                "patient_id": appointment.patient_id,
                "patient_name": patient.full_name,
                "practitioner_name": practitioner_name,
                "appointment_type_name": get_appointment_type_name_safe(appointment.appointment_type_id, db),
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

        # Filter by clinic (use CalendarEvent.clinic_id for clinic isolation)
        query = query.filter(CalendarEvent.clinic_id == clinic_id)

        # Filter by date if provided
        if date_filter:
            try:
                from datetime import datetime as dt
                filter_date = dt.fromisoformat(date_filter).date()
                query = query.filter(CalendarEvent.date == filter_date)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的日期格式，請使用 YYYY-MM-DD"
                )

        # Filter by practitioner if provided
        if practitioner_id:
            query = query.filter(CalendarEvent.user_id == practitioner_id)

        # Filter by status if provided
        if status_filter:
            if status_filter not in ['confirmed', 'canceled_by_patient', 'canceled_by_clinic']:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的狀態。必須是 'confirmed'、'canceled_by_patient' 或 'canceled_by_clinic'"
                )
            query = query.filter(Appointment.status == status_filter)

        # Eagerly load all relationships to avoid N+1 queries
        appointments = query.options(
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.patient)
        ).order_by(CalendarEvent.start_time.desc()).all()

        # Format response
        result: List[Dict[str, Any]] = []
        
        # Get all practitioner associations in one query
        practitioner_ids = [appt.calendar_event.user_id for appt in appointments if appt.calendar_event and appt.calendar_event.user_id]
        associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id.in_(practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()
        association_lookup: Dict[int, UserClinicAssociation] = {a.user_id: a for a in associations}
        
        for appointment in appointments:
            # All relationships are now eagerly loaded, no database queries needed
            practitioner = appointment.calendar_event.user
            if not practitioner:
                continue  # Skip if practitioner not found

            # Get practitioner name from association
            association = association_lookup.get(practitioner.id)
            practitioner_name = association.full_name if association else practitioner.email

            # Construct datetime from date and time (Taiwan timezone)
            start_datetime = datetime.combine(appointment.calendar_event.date, appointment.calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
            end_datetime = datetime.combine(appointment.calendar_event.date, appointment.calendar_event.end_time).replace(tzinfo=TAIWAN_TZ)

            result.append({
                'appointment_id': appointment.calendar_event_id,
                'calendar_event_id': appointment.calendar_event_id,
                'patient_name': appointment.patient.full_name,
                'patient_phone': appointment.patient.phone_number,
                'practitioner_name': practitioner_name,
                'appointment_type_name': get_appointment_type_name_safe(appointment.appointment_type_id, db),
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
        appointment.canceled_at = taiwan_now()

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

        Updates status and prepares for LINE notification.

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
        # Optimized: Combine multiple queries into a single query with joins
        # Find appointment, verify it belongs to clinic, and get practitioner in one query
        # Use contains_eager since we're already joining these relationships
        from sqlalchemy.orm import contains_eager
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).join(
            User, CalendarEvent.user_id == User.id
        ).join(
            UserClinicAssociation, User.id == UserClinicAssociation.user_id
        ).options(
            contains_eager(Appointment.calendar_event).contains_eager(CalendarEvent.user)
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        calendar_event = appointment.calendar_event
        practitioner = calendar_event.user

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
                'already_cancelled': True
            }

        # Update appointment status
        appointment.status = 'canceled_by_clinic'
        appointment.canceled_at = taiwan_now()

        db.commit()

        logger.info(f"Clinic admin cancelled appointment {appointment_id}")

        return {
            'appointment': appointment,
            'practitioner': practitioner
        }

    @staticmethod
    def create_appointment_for_patient(
        db: Session,
        clinic_id: int,
        patient_id: int,
        appointment_type_id: int,
        start_time: datetime,
        practitioner_id: Optional[int] = None,  # Optional for backward compatibility, but required by API endpoint
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create an appointment on behalf of a patient (clinic user version).
        
        This is similar to create_appointment but without LINE user validation,
        allowing clinic users to create appointments for any patient.
        
        Note: The API endpoint requires practitioner_id, but this method accepts
        Optional for backward compatibility with tests. For clinic-initiated
        appointments via the API, practitioner_id is always provided.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            patient_id: Patient ID
            appointment_type_id: Appointment type ID
            start_time: Appointment start time
            practitioner_id: Practitioner ID (Optional for backward compatibility)
            notes: Optional appointment notes
            
        Returns:
            Dict with appointment details
            
        Raises:
            HTTPException: If creation fails or validation errors
        """
        # Use the existing create_appointment method but without line_user_id
        return AppointmentService.create_appointment(
            db=db,
            clinic_id=clinic_id,
            patient_id=patient_id,
            appointment_type_id=appointment_type_id,
            start_time=start_time,
            practitioner_id=practitioner_id,
            notes=notes,
            line_user_id=None  # No LINE validation for clinic users
        )

    @staticmethod
    def check_appointment_edit_conflicts(
        db: Session,
        appointment_id: int,
        new_practitioner_id: Optional[int],
        new_start_time: Optional[datetime],
        appointment_type_id: int,
        clinic_id: int
    ) -> Tuple[bool, Optional[str], List[str]]:
        """
        Check if appointment edit would cause conflicts.
        
        Args:
            appointment_id: ID of appointment being edited (exclude from conflict check)
            new_practitioner_id: New practitioner ID (None = keep current)
            new_start_time: New start time (None = keep current)
            appointment_type_id: Appointment type ID (for duration)
            clinic_id: Clinic ID
            
        Returns:
            (is_valid, error_message, conflict_details)
            - is_valid: True if no conflicts
            - error_message: Human-readable error if invalid
            - conflict_details: List of specific conflicts found
        """
        conflicts: List[str] = []
        
        # Get appointment type for duration
        appointment_type = AppointmentTypeService.get_appointment_type_by_id(
            db, appointment_type_id, clinic_id=clinic_id
        )
        duration_minutes = appointment_type.duration_minutes
        
        # Get current appointment to determine what we're changing
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        
        if not appointment:
            return (False, "預約不存在", [])
        
        calendar_event = appointment.calendar_event
        if not calendar_event:
            return (False, "找不到預約事件", [])
        
        # Determine actual values to check
        practitioner_id_to_check = new_practitioner_id if new_practitioner_id is not None else calendar_event.user_id
        start_time_to_check = new_start_time if new_start_time is not None else datetime.combine(
            calendar_event.date, calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        
        # Calculate end time
        end_time_to_check = start_time_to_check + timedelta(minutes=duration_minutes)
        
        # Check practitioner offers appointment type
        if new_practitioner_id is not None:
            practitioners = AvailabilityService.get_practitioners_for_appointment_type(
                db, appointment_type_id, clinic_id
            )
            if not any(p.id == new_practitioner_id for p in practitioners):
                conflicts.append("此治療師不提供此預約類型")
                return (False, "此治療師不提供此預約類型", conflicts)
        
        # Check availability at new time/practitioner
        # Exclude current appointment from conflict checking
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, [practitioner_id_to_check], start_time_to_check.date(), clinic_id, exclude_calendar_event_id=appointment_id
        )
        
        slot_start_time = start_time_to_check.time()
        slot_end_time = end_time_to_check.time()
        
        is_available = AppointmentService._is_practitioner_available_at_slot(
            schedule_data, practitioner_id_to_check, slot_start_time, slot_end_time
        )
        
        if not is_available:
            conflicts.append("此時段不可用")
        
        # Check for conflicts with other appointments (exclude current appointment)
        # Note: CalendarEvent.end_time should always be set, but we add a check for safety
        conflicting_appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            CalendarEvent.user_id == practitioner_id_to_check,
            CalendarEvent.date == start_time_to_check.date(),
            CalendarEvent.event_type == 'appointment',
            Appointment.status == 'confirmed',
            Appointment.calendar_event_id != appointment_id,  # Exclude current appointment
            CalendarEvent.end_time.isnot(None),  # Ensure end_time is set
            # Check for time overlap: appointments overlap if start < other_end AND end > other_start
            CalendarEvent.start_time < slot_end_time,
            CalendarEvent.end_time > slot_start_time
        ).all()
        
        if conflicting_appointments:
            conflicts.append(f"此時段與 {len(conflicting_appointments)} 個其他預約衝突")
        
        is_valid = len(conflicts) == 0
        error_message = conflicts[0] if conflicts else None
        
        return (is_valid, error_message, conflicts)

    @staticmethod
    def should_send_edit_notification(
        old_appointment: Appointment,
        new_practitioner_id: int,
        new_start_time: datetime
    ) -> bool:
        """
        Determine if LINE notification should be sent for appointment edit.
        
        Rules:
        - Notify patient when either the practitioner OR time changes
        - This applies to both auto-assigned and non-auto-assigned appointments
        
        Args:
            old_appointment: Current appointment state (must be unmodified)
            new_practitioner_id: New practitioner ID (must be the actual value, not None)
            new_start_time: New start time (must be the actual value, not None)
            
        Returns:
            True if notification should be sent, False otherwise
        """
        # Read old values from appointment (must be called before appointment is updated)
        old_start_time = datetime.combine(
            old_appointment.calendar_event.date,
            old_appointment.calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id = old_appointment.calendar_event.user_id
        
        # Check if practitioner changed
        if new_practitioner_id != old_practitioner_id:
            return True
        
        # Check if time changed
        if new_start_time != old_start_time:
            return True
        
        # No changes detected
        return False

    @staticmethod
    def edit_appointment(
        db: Session,
        appointment_id: int,
        clinic_id: int,
        current_user_id: int,
        new_practitioner_id: Optional[int] = None,
        new_start_time: Optional[datetime] = None,
        new_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Edit an appointment (time and/or practitioner).
        
        Note: This method assumes permission checks have been performed by the caller.
        The appointment update is committed before returning.
        
        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
            clinic_id: Clinic ID
            current_user_id: Current user ID (for tracking reassignment)
            new_practitioner_id: New practitioner ID (None = keep current)
            new_start_time: New start time (None = keep current)
            new_notes: New notes (None = keep current)
            
        Returns:
            Dict with updated appointment details
            
        Raises:
            HTTPException: If edit fails or validation errors
        """
        # Get appointment
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Check if appointment is cancelled
        if appointment.status in ['canceled_by_patient', 'canceled_by_clinic']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="此預約已取消，無法編輯"
            )
        
        calendar_event = appointment.calendar_event
        
        # Validate new practitioner exists and belongs to clinic if provided
        if new_practitioner_id is not None:
            practitioner = db.query(User).get(new_practitioner_id)
            if not practitioner:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="治療師不存在"
                )
            # Verify practitioner belongs to clinic and is active
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == new_practitioner_id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            ).first()
            if not association:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="此治療師不屬於此診所"
                )
        
        # Check if practitioner or time actually changed (not just provided)
        # Skip conflict check if only notes are being changed
        practitioner_actually_changed = (
            new_practitioner_id is not None and 
            new_practitioner_id != calendar_event.user_id
        )
        time_actually_changed = False
        if new_start_time is not None:
            current_start_time = datetime.combine(
                calendar_event.date, calendar_event.start_time
            ).replace(tzinfo=TAIWAN_TZ)
            time_actually_changed = new_start_time != current_start_time
        
        # Check for conflicts only if time or practitioner is actually being changed
        if practitioner_actually_changed or time_actually_changed:
            is_valid, error_message, _ = AppointmentService.check_appointment_edit_conflicts(
                db, appointment_id, new_practitioner_id, new_start_time,
                appointment.appointment_type_id, clinic_id
            )
            
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=error_message or "編輯預約時發生衝突"
                )
        
        # Store old values for notification (before any updates)
        old_is_auto_assigned = appointment.is_auto_assigned
        
        # practitioner_actually_changed and time_actually_changed were already calculated above for conflict check
        
        # Update appointment
        if new_notes is not None:
            appointment.notes = new_notes
        
        # Update tracking fields based on practitioner change
        # Only update if practitioner actually changed
        # Note: new_practitioner_id=None means "keep current" (per API contract), not "change to auto-assigned"
        if practitioner_actually_changed and old_is_auto_assigned:
            # Changing from auto-assigned to specific
            appointment.is_auto_assigned = False
            appointment.reassigned_by_user_id = current_user_id
            appointment.reassigned_at = taiwan_now()
            # Keep originally_auto_assigned=True (preserve historical fact)
        elif practitioner_actually_changed and not old_is_auto_assigned:
            # Changing from specific to specific - keep is_auto_assigned=False
            pass
        # Note: Changing from specific to auto-assigned is not supported via edit endpoint
        # (would require explicit API design change or separate endpoint)
        
        # Update calendar event if time or practitioner changed
        if new_start_time is not None:
            calendar_event.date = new_start_time.date()
            calendar_event.start_time = new_start_time.time()
            # Calculate end time
            appointment_type = AppointmentTypeService.get_appointment_type_by_id(
                db, appointment.appointment_type_id, clinic_id=clinic_id
            )
            end_time = new_start_time + timedelta(minutes=appointment_type.duration_minutes)
            calendar_event.end_time = end_time.time()
        
        if new_practitioner_id is not None:
            calendar_event.user_id = new_practitioner_id
        
        db.commit()
        db.refresh(appointment)
        
        logger.info(f"Edited appointment {appointment_id} by user {current_user_id}")
        
        return {
            'success': True,
            'appointment_id': appointment_id,
            'message': '預約已更新'
        }
