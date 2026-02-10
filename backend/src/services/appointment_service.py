"""
Appointment service for shared appointment business logic.

This module contains all appointment-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
import os
from datetime import datetime, timedelta, time
from typing import List, Optional, Dict, Any, Tuple, TypedDict

from fastapi import HTTPException, status
from fastapi import status as http_status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from models import (
    Appointment, CalendarEvent, User, Patient, Clinic,
    AppointmentResourceAllocation
)
from services.patient_service import PatientService
from services.availability_service import AvailabilityService
from services.appointment_type_service import AppointmentTypeService
# Import follow_up_message_service here to avoid circular imports
# (follow_up_message_service imports Appointment, but we need it here)
from services.follow_up_message_service import FollowUpMessageService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from utils.appointment_type_queries import get_appointment_type_by_id_with_soft_delete_check
from utils.appointment_queries import filter_future_appointments
from services.resource_service import ResourceService

logger = logging.getLogger(__name__)


class NotificationRequirements(TypedDict):
    """Type definition for notification requirements return value."""
    will_send_notification: bool
    requires_notification_note: bool
    should_show_preview: bool


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
        clinic_notes: Optional[str] = None,
        line_user_id: Optional[int] = None,
        skip_notifications: bool = False,
        selected_resource_ids: Optional[List[int]] = None,
        selected_time_slots: Optional[List[str]] = None,
        allow_multiple_time_slot_selection: Optional[bool] = None
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
            notes: Optional patient-provided appointment notes
            clinic_notes: Optional clinic internal notes (visible only to clinic users)
            line_user_id: LINE user ID for ownership validation (if provided)
            skip_notifications: If True, skip sending individual notifications (for consolidated notifications)
            selected_time_slots: List of ISO datetime strings for multiple time slot selection
            allow_multiple_time_slot_selection: Whether appointment type supports multiple slots

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

            # Get clinic to check settings
            clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
            if not clinic:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="診所不存在"
                )

            # Validate booking restrictions for patient bookings only
            # Clinic admins (line_user_id=None) bypass all booking restrictions
            if line_user_id is not None:
                AppointmentService._validate_booking_constraints(
                    clinic=clinic,
                    new_start_time=start_time,
                    db=db,
                    patient_id=patient_id,
                    check_max_future_appointments=True,
                    check_minimum_cancellation_hours=False
                )
            # Clinic admins bypass all booking restrictions (no validation when line_user_id is None)

            # Get appointment type and validate it belongs to clinic
            appointment_type = AppointmentTypeService.get_appointment_type_by_id(
                db, appointment_type_id, clinic_id=clinic_id
                )

            # Calculate end time (start_time is already in Taiwan timezone)
            end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

            # Validate patient booking restrictions BEFORE practitioner assignment
            # Skip this check for multiple time slot appointments since they require clinic review anyway
            if line_user_id is not None and practitioner_id is not None and not allow_multiple_time_slot_selection:
                from models.user_clinic_association import UserClinicAssociation
                from pydantic import ValidationError
                association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == practitioner_id,
                    UserClinicAssociation.clinic_id == clinic_id,
                    UserClinicAssociation.is_active == True
                ).first()
                
                if association:
                    try:
                        settings = association.get_validated_settings()
                        if not settings.patient_booking_allowed:
                            raise HTTPException(
                                status_code=status.HTTP_403_FORBIDDEN,
                                detail="此治療師不接受患者預約，請聯繫診所預約"
                            )
                    except (ValidationError, ValueError) as e:
                        # If settings validation fails, log and default to allowing booking (backward compatibility)
                        logger.warning(
                            f"Settings validation failed for practitioner {practitioner_id} "
                            f"in clinic {clinic_id}: {e}. Defaulting to allowing patient booking."
                        )
                    except HTTPException:
                        # Re-raise HTTP exceptions (like the 403 above)
                        raise

            # Handle practitioner assignment
            # Allow override for clinic-created appointments (line_user_id is None)
            # Override mode allows scheduling outside normal hours and despite conflicts
            # (conflicts are shown as warnings in frontend, but backend allows scheduling)
            allow_override = (line_user_id is None)
            assigned_practitioner_id = AppointmentService._assign_practitioner(
                db, clinic_id, appointment_type_id, practitioner_id,
                start_time, end_time, allow_override=allow_override
            )

            # Validate patient booking restrictions for auto-assigned practitioners
            # Skip this check for multiple time slot appointments since they require clinic review anyway
            if line_user_id is not None and practitioner_id is None and not allow_multiple_time_slot_selection:
                from models.user_clinic_association import UserClinicAssociation
                from pydantic import ValidationError
                association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == assigned_practitioner_id,
                    UserClinicAssociation.clinic_id == clinic_id,
                    UserClinicAssociation.is_active == True
                ).first()
                
                if association:
                    try:
                        settings = association.get_validated_settings()
                        if not settings.patient_booking_allowed:
                            raise HTTPException(
                                status_code=status.HTTP_403_FORBIDDEN,
                                detail="此治療師不接受患者預約，請聯繫診所預約"
                            )
                    except (ValidationError, ValueError) as e:
                        # If settings validation fails, log and default to allowing booking (backward compatibility)
                        logger.warning(
                            f"Settings validation failed for practitioner {assigned_practitioner_id} "
                            f"in clinic {clinic_id}: {e}. Defaulting to allowing patient booking."
                        )
                    except HTTPException:
                        # Re-raise HTTP exceptions (like the 403 above)
                        raise

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

            # Handle multiple time slot selection
            pending_time_confirmation = False
            alternative_time_slots = None

            if allow_multiple_time_slot_selection and selected_time_slots and len(selected_time_slots) > 1:
                # Only use pending confirmation workflow when multiple slots (2+) are selected
                # Single slot selection should behave like regular appointments
                pending_time_confirmation = True
                alternative_time_slots = sorted(selected_time_slots)

                # Select the earliest slot from the alternatives for the initial appointment
                # This prioritizes the patient's earliest preference and holds that time slot
                sorted_slots = sorted(selected_time_slots)
                initial_slot = sorted_slots[0]

                # Update calendar event with the initial slot
                initial_datetime = datetime.fromisoformat(initial_slot.replace('Z', '+00:00'))
                calendar_event.start_time = initial_datetime.time()
                calendar_event.end_time = (initial_datetime + timedelta(minutes=appointment_type.duration_minutes)).time()

                # Update the start_time variable used below
                start_time = initial_datetime
                end_time = initial_datetime + timedelta(minutes=appointment_type.duration_minutes)

            # Create appointment
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient_id,
                appointment_type_id=appointment_type_id,
                status='confirmed',
                notes=notes,
                clinic_notes=clinic_notes,
                is_auto_assigned=was_auto_assigned,
                originally_auto_assigned=was_auto_assigned,
                pending_time_confirmation=pending_time_confirmation,
                alternative_time_slots=alternative_time_slots
            )

            db.add(appointment)
            db.flush()  # Flush to ensure appointment is available for resource allocation

            # Allocate resources for the appointment
            from services.resource_service import ResourceService
            ResourceService.allocate_resources(
                db=db,
                appointment_id=calendar_event.id,
                appointment_type_id=appointment_type_id,
                start_time=start_time,
                end_time=end_time,
                clinic_id=clinic_id,
                selected_resource_ids=selected_resource_ids,
                exclude_calendar_event_id=None  # No exclusion needed for new appointments
            )

            db.commit()
            db.refresh(appointment)

            # Schedule follow-up messages, reminders, and practitioner notifications for this appointment
            # Note: This happens after appointment commit, so if scheduling fails,
            # the appointment is still created (intentional - we don't want scheduling
            # failures to prevent appointment creation)
            try:
                FollowUpMessageService.schedule_follow_up_messages(db, appointment)
            except Exception as e:
                logger.exception(f"Failed to schedule follow-up messages for appointment {appointment.calendar_event_id}: {e}")
                # Don't fail appointment creation if scheduling fails
            
            try:
                from services.reminder_scheduling_service import ReminderSchedulingService
                ReminderSchedulingService.schedule_reminder(db, appointment)
            except Exception as e:
                logger.exception(f"Failed to schedule reminder for appointment {appointment.calendar_event_id}: {e}")
                # Don't fail appointment creation if scheduling fails
            # Practitioner daily notifications are now handled via hourly check
            # No pre-scheduling needed

            # Get related objects for response
            practitioner = db.query(User).get(assigned_practitioner_id)
            patient = db.query(Patient).get(patient_id)

            # Send LINE notifications (unless skipped for consolidated notifications or E2E test mode)
            if not skip_notifications and not os.getenv("E2E_TEST_MODE"):
                from services.notification_service import NotificationService
                from utils.practitioner_helpers import get_practitioner_name_for_notification
                from models.user_clinic_association import UserClinicAssociation
                
                # Send practitioner notification if NOT auto-assigned (practitioners shouldn't see auto-assigned appointments)
                if practitioner and not was_auto_assigned:
                    # Send unified notification to practitioner and admins (with deduplication)
                    try:
                        NotificationService.send_unified_appointment_notification(
                            db, appointment, clinic, practitioner,
                            include_practitioner=True, include_admins=True
                        )
                    except Exception as e:
                        logger.exception(f"Failed to send appointment notification: {e}")
                        # Don't fail appointment creation if notification fails

                # Send patient confirmation notification
                # For clinic-triggered: send if not auto-assigned (will get reminder anyway)
                # For patient-triggered: send if appointment type allows it (check toggle)
                should_send_clinic_confirmation = (
                    patient and 
                    patient.line_user and 
                    line_user_id is None and  # Only send if clinic triggered (not patient)
                    not was_auto_assigned  # Skip for auto-assigned appointments
                )
                
                if should_send_clinic_confirmation:
                    # Get practitioner name for notification with fallback logic
                    practitioner_name_for_notification = get_practitioner_name_for_notification(
                        db=db,
                        practitioner_id=assigned_practitioner_id,
                        clinic_id=clinic_id,
                        was_auto_assigned=was_auto_assigned,
                        practitioner=practitioner
                    )
                    
                    # Send notification (practitioner_name_for_notification is guaranteed to be str at this point)
                    # Clinic-triggered (line_user_id is None means clinic admin created it)
                    NotificationService.send_appointment_confirmation(
                        db, appointment, practitioner_name_for_notification, clinic, trigger_source='clinic_triggered'
                    )
                
                # Send patient-triggered confirmation if enabled (when line_user_id is provided)
                if line_user_id and patient and patient.line_user and appointment.appointment_type:
                    if appointment.appointment_type.send_patient_confirmation:
                        # Get practitioner name for notification with fallback logic
                        practitioner_name_for_notification = get_practitioner_name_for_notification(
                            db=db,
                            practitioner_id=assigned_practitioner_id,
                            clinic_id=clinic_id,
                            was_auto_assigned=was_auto_assigned,
                            practitioner=practitioner
                        )
                        
                        # Send patient-triggered confirmation
                        NotificationService.send_appointment_confirmation(
                            db, appointment, practitioner_name_for_notification, clinic, trigger_source='patient_triggered'
                        )
                
                # Send immediate auto-assigned notification if appointment is auto-assigned
                if was_auto_assigned:
                    try:
                        NotificationService.send_immediate_auto_assigned_notification(
                            db, appointment, clinic
                        )
                    except Exception as e:
                        logger.exception(f"Failed to send immediate auto-assigned notification: {e}")
                        # Don't fail appointment creation if notification fails

            logger.info(f"Created appointment {appointment.calendar_event_id} for patient {patient_id}")

            # Get practitioner name from association with title for patient-facing display
            # For auto-assigned appointments, return "不指定" instead of actual practitioner name
            from utils.practitioner_helpers import get_practitioner_display_name_with_title, AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
            practitioner_name = ''
            if practitioner:
                if was_auto_assigned:
                    # Return "不指定" for auto-assigned appointments (patient doesn't see practitioner name)
                    practitioner_name = AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
                else:
                    # Use display name with title for patient-facing displays (LIFF)
                    practitioner_name = get_practitioner_display_name_with_title(db, practitioner.id, clinic_id)

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
                'clinic_notes': appointment.clinic_notes,
                'practitioner_id': assigned_practitioner_id,
                'is_auto_assigned': was_auto_assigned
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
        end_time: time,
        allow_override: bool = False
    ) -> bool:
        """
        Check if a practitioner is available at the given time slot.

        Args:
            schedule_data: Schedule data from fetch_practitioner_schedule_data
            practitioner_id: Practitioner ID to check
            start_time: Slot start time
            end_time: Slot end time
            allow_override: If True, skip both availability interval and conflict checks
                           (for clinic users - allows scheduling outside normal hours and despite conflicts)

        Returns:
            True if practitioner is available, False otherwise
        """
        data = schedule_data.get(practitioner_id, {
            'default_intervals': [],
            'events': []
        })

        # Check if slot is within default intervals (skip for override mode)
        # Override mode allows clinic users to schedule outside normal availability hours
        if not allow_override:
            if not AvailabilityService.is_slot_within_default_intervals(
                data['default_intervals'], start_time, end_time
            ):
                return False

        # Check if slot has conflicts (appointments or exceptions)
        # In override mode, we skip conflict checks to allow scheduling despite conflicts
        # Conflicts are shown as warnings in the frontend, but backend allows the scheduling
        # This allows clinic users to override both availability intervals and existing conflicts
        if not allow_override:
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
        end_time: datetime,
        allow_override: bool = False
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
            # Verify practitioner exists and is active in clinic, but don't require
            # them to be in the appointment type's practitioner list.
            # This allows one-off appointments outside normal configurations.
            # Note: LIFF patient bookings should continue to filter by type (handled upstream)
            from models.user_clinic_association import UserClinicAssociation
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == requested_practitioner_id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            ).first()

            if not association:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到治療師"
                )

            if not AppointmentService._is_practitioner_available_at_slot(
                schedule_data, requested_practitioner_id, slot_start_time, slot_end_time, allow_override=allow_override
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="時段不可用"
                )

            return requested_practitioner_id

        else:
            # Auto-assign to practitioner with least appointments that day
            # Filter by availability at requested time
            available_candidates = [
                p for p in practitioners
                if AppointmentService._is_practitioner_available_at_slot(
                    schedule_data, p.id, slot_start_time, slot_end_time, allow_override=allow_override
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
            query = filter_future_appointments(query)

        # Eagerly load all relationships to avoid N+1 queries
        # Since we already joined CalendarEvent, use contains_eager for it
        from sqlalchemy.orm import contains_eager
        appointments: List[Appointment] = query.options(
            contains_eager(Appointment.calendar_event).joinedload(CalendarEvent.user),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.patient).joinedload(Patient.line_user)  # Load line_user for display_name
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()

        # Collect appointment IDs for bulk data fetching (optimized)
        appointment_ids = [a.calendar_event_id for a in appointments]
        
        # Bulk load all receipts for all appointments (optimized)
        from services.receipt_service import ReceiptService
        all_receipts_map = ReceiptService.get_all_receipts_for_appointments(db, appointment_ids)

        # Bulk load all resources for all appointments (optimized)
        from services.resource_service import ResourceService
        all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)

        # Format response
        result: List[Dict[str, Any]] = []

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
            # For auto-assigned appointments, return "不指定" instead of actual practitioner name
            from utils.practitioner_helpers import get_practitioner_display_name_for_appointment
            practitioner_name = get_practitioner_display_name_for_appointment(
                db, appointment, clinic_id
            )

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

            # Get line_display_name if line_user exists
            line_display_name = None
            if patient.line_user:
                line_display_name = patient.line_user.effective_display_name

            # Get effective event name (custom_event_name or default format)
            calendar_event = appointment.calendar_event
            if calendar_event.custom_event_name:
                event_name = calendar_event.custom_event_name
            else:
                # Default format: "{patient_name} - {appointment_type_name}"
                appointment_type_name = get_appointment_type_name_safe(appointment.appointment_type_id, db)
                event_name = f"{patient.full_name} - {appointment_type_name or '未設定'}"

            # Get receipt status from bulk-loaded map (all receipts)
            receipts = all_receipts_map.get(appointment.calendar_event_id, [])
            receipt_fields = ReceiptService.compute_receipt_fields(receipts)
            
            # Get resources from bulk-loaded map
            allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
            resource_names = [r.name for r in allocated_resources]
            resource_ids = [r.id for r in allocated_resources]

            result.append({
                "id": appointment.calendar_event_id,  # Keep for backward compatibility
                "calendar_event_id": appointment.calendar_event_id,  # Explicit field
                "patient_id": appointment.patient_id,
                "patient_name": patient.full_name,
                "practitioner_id": practitioner.id,
                "practitioner_name": practitioner_name,
                "appointment_type_id": appointment.appointment_type_id,
                "appointment_type_name": get_appointment_type_name_safe(appointment.appointment_type_id, db),
                "event_name": event_name,  # Effective calendar event name
                "start_time": start_datetime.isoformat() if start_datetime else "",
                "end_time": end_datetime.isoformat() if end_datetime else "",
                "status": appointment.status,
                "notes": appointment.notes,
                "clinic_notes": None,  # Not exposed to LINE users
                "line_display_name": line_display_name,
                "originally_auto_assigned": appointment.originally_auto_assigned,
                "is_auto_assigned": appointment.is_auto_assigned,
                "resource_names": resource_names,
                "resource_ids": resource_ids,
                "has_active_receipt": receipt_fields["has_active_receipt"],
                "has_any_receipt": receipt_fields["has_any_receipt"],
                "receipt_id": receipt_fields["receipt_id"],
                "receipt_ids": receipt_fields["receipt_ids"],
                "pending_time_confirmation": appointment.pending_time_confirmation,
                "alternative_time_slots": appointment.alternative_time_slots
            })

        return result

    @staticmethod
    def list_appointments_for_patient(
        db: Session,
        patient_id: int,
        clinic_id: int,
        status: Optional[str] = None,
        upcoming_only: bool = False,
        hide_auto_assigned_practitioner_id: bool = False
    ) -> List[Dict[str, Any]]:
        """
        List appointments for a specific patient.

        Args:
            db: Database session
            patient_id: Patient ID
            clinic_id: Clinic ID
            status: Optional status filter ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')
            upcoming_only: Filter for upcoming appointments only
            hide_auto_assigned_practitioner_id: If True, hide practitioner_id for auto-assigned appointments
                (used when non-admin users view patient appointments to prevent them from seeing 
                who was auto-assigned, maintaining the "Auto-Assignment Visibility Principle")

        Returns:
            List of appointment dictionaries
        """
        # Verify patient belongs to clinic
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == clinic_id
        ).first()

        if not patient:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,  # Use http_status to avoid shadowing parameter
                detail="病患不存在"
            )

        # Build query - explicitly join CalendarEvent for filtering and ordering
        query = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.patient_id == patient_id,
            CalendarEvent.clinic_id == clinic_id
        )

        # Apply status filter if provided
        if status:
            query = query.filter(Appointment.status == status)

        if upcoming_only:
            # Filter for upcoming appointments using utility function
            query = filter_future_appointments(query)

        # Eagerly load all relationships to avoid N+1 queries
        from sqlalchemy.orm import contains_eager
        appointments: List[Appointment] = query.options(
            contains_eager(Appointment.calendar_event).joinedload(CalendarEvent.user),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.patient).joinedload(Patient.line_user)  # Load line_user for display_name
        ).order_by(CalendarEvent.date.desc(), CalendarEvent.start_time.desc()).all()

        # Collect appointment IDs for bulk data fetching (optimized)
        appointment_ids = [a.calendar_event_id for a in appointments]
        
        # Bulk load all receipts for all appointments (optimized)
        from services.receipt_service import ReceiptService
        all_receipts_map = ReceiptService.get_all_receipts_for_appointments(db, appointment_ids)

        # Bulk load all resources for all appointments (optimized)
        from services.resource_service import ResourceService
        all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)

        # Format response
        result: List[Dict[str, Any]] = []

        for appointment in appointments:
            # All relationships are now eagerly loaded, no database queries needed
            practitioner = appointment.calendar_event.user
            appointment_type = appointment.appointment_type
            patient_obj = appointment.patient

            if not all([practitioner, appointment_type, patient_obj]):
                continue  # Skip if any related object not found

            # Type assertions for Pyright
            assert practitioner is not None
            assert appointment_type is not None
            assert patient_obj is not None

            # Get practitioner name from association
            from utils.practitioner_helpers import get_practitioner_display_name_for_appointment
            practitioner_name = get_practitioner_display_name_for_appointment(
                db, appointment, clinic_id
            )

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

            # Get line_display_name if line_user exists
            line_display_name = None
            if patient_obj.line_user:
                line_display_name = patient_obj.line_user.effective_display_name

            # Get effective event name (custom_event_name or default format)
            calendar_event = appointment.calendar_event
            if calendar_event.custom_event_name:
                event_name = calendar_event.custom_event_name
            else:
                # Default format: "{patient_name} - {appointment_type_name}"
                appointment_type_name = get_appointment_type_name_safe(appointment.appointment_type_id, db)
                event_name = f"{patient_obj.full_name} - {appointment_type_name or '未設定'}"

            # Hide practitioner_id for auto-assigned appointments if requested
            # This prevents non-admin practitioners from seeing who was auto-assigned
            practitioner_id = appointment.calendar_event.user_id
            if hide_auto_assigned_practitioner_id and appointment.is_auto_assigned:
                practitioner_id = None

            # Get receipt status from bulk-loaded map (all receipts)
            receipts = all_receipts_map.get(appointment.calendar_event_id, [])
            receipt_fields = ReceiptService.compute_receipt_fields(receipts)
            
            # Get resources from bulk-loaded map
            allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
            resource_names = [r.name for r in allocated_resources]
            resource_ids = [r.id for r in allocated_resources]

            result.append({
                "id": appointment.calendar_event_id,  # Keep for backward compatibility
                "calendar_event_id": appointment.calendar_event_id,  # Explicit field
                "patient_id": appointment.patient_id,
                "patient_name": patient_obj.full_name,
                "practitioner_id": practitioner_id,
                "practitioner_name": practitioner_name,
                "appointment_type_id": appointment.appointment_type_id,
                "appointment_type_name": get_appointment_type_name_safe(appointment.appointment_type_id, db),
                "event_name": event_name,  # Effective calendar event name
                "start_time": start_datetime.isoformat() if start_datetime else "",
                "end_time": end_datetime.isoformat() if end_datetime else "",
                "status": appointment.status,
                "notes": appointment.notes,
                "clinic_notes": appointment.clinic_notes,  # Include clinic notes for clinic users
                "line_display_name": line_display_name,
                "originally_auto_assigned": appointment.originally_auto_assigned,
                "is_auto_assigned": appointment.is_auto_assigned,
                "resource_names": resource_names,
                "resource_ids": resource_ids,
                "has_active_receipt": receipt_fields["has_active_receipt"],
                "has_any_receipt": receipt_fields["has_any_receipt"],
                "receipt_id": receipt_fields["receipt_id"],
                "receipt_ids": receipt_fields["receipt_ids"]
            })

        return result

    @staticmethod
    def cancel_appointment(
        db: Session,
        appointment_id: int,
        cancelled_by: str,
        return_details: bool = False,
        note: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Cancel an appointment by patient or clinic admin.

        Note: Permission checks are handled by the API endpoints.
        This method assumes the caller has already validated access.

        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
            cancelled_by: Who is cancelling - 'patient' or 'clinic'
            return_details: If True, return appointment and practitioner objects (for clinic notifications)
            note: Optional note to include in the cancellation notification

        Returns:
            Dict with success message. If return_details=True, also includes 'appointment' and 'practitioner'.

        Raises:
            HTTPException: If appointment not found

        Note:
            This method is idempotent - if the appointment is already cancelled,
            it returns success without making changes.
            This method sends notifications to both practitioner and patient.
        """
        # Find appointment with lock to prevent race conditions
        from sqlalchemy.exc import OperationalError
        try:
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).with_for_update(nowait=True).first()
        except OperationalError as e:
            # Handle lock timeout - another transaction is modifying
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此預約正在被其他操作修改，請稍後再試"
            )

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Constraint 1: Check if appointment has any receipt (active or voided)
        # Check if appointment has any receipt (within same transaction)
        from models.receipt import Receipt
        receipts = db.query(Receipt).filter(
            Receipt.appointment_id == appointment_id
        ).all()
        
        if len(receipts) > 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="此預約已有收據，無法取消"
            )

        # Validate cancellation restriction for patients only (clinic cancellations are not restricted)
        # Check this BEFORE status check to fail fast with clear error message
        if cancelled_by == 'patient':
            # Use relationship if available, otherwise query
            clinic = appointment.patient.clinic if hasattr(appointment.patient, 'clinic') and appointment.patient.clinic else None
            if not clinic:
                clinic = db.query(Clinic).filter(Clinic.id == appointment.patient.clinic_id).first()
            
            if clinic:
                settings = clinic.get_validated_settings()
                booking_settings = settings.booking_restriction_settings
                minimum_cancellation_hours = booking_settings.minimum_cancellation_hours_before
                
                # Get appointment start time from calendar event
                calendar_event = appointment.calendar_event
                if not calendar_event or not calendar_event.start_time or not calendar_event.date:
                    logger.warning(
                        f"Appointment {appointment_id} missing calendar event data, "
                        f"cannot validate cancellation restriction. Allowing cancellation."
                    )
                    # Allow cancellation but log the issue for investigation
                else:
                    # Combine date and time to create datetime
                    appointment_start = datetime.combine(calendar_event.date, calendar_event.start_time)
                    # Ensure timezone-aware in Taiwan timezone
                    appointment_start = appointment_start.replace(tzinfo=TAIWAN_TZ)
                    
                    now = taiwan_now()
                    time_until_appointment = appointment_start - now
                    hours_until_appointment = time_until_appointment.total_seconds() / 3600
                    
                    if hours_until_appointment < minimum_cancellation_hours:
                        # Return structured error response for better frontend handling
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail={
                                "error": "cancellation_too_soon",
                                "message": f"預約必須在至少 {minimum_cancellation_hours} 小時前取消",
                                "minimum_hours": minimum_cancellation_hours
                            }
                        )

        # Check if appointment is already cancelled - if so, return success (idempotent)
        if appointment.status in ['canceled_by_patient', 'canceled_by_clinic']:
            logger.info(f"Appointment {appointment_id} already cancelled with status {appointment.status}, returning success")
            if return_details:
                # Load practitioner for return_details
                calendar_event = appointment.calendar_event
                practitioner = calendar_event.user if calendar_event else None
                return {
                    'appointment': appointment,
                    'practitioner': practitioner,
                    'already_cancelled': True
                }
            return {"success": True, "message": "預約已取消"}

        # Update status based on who is cancelling
        if cancelled_by == 'patient':
            appointment.status = 'canceled_by_patient'
            logger.info(f"Patient cancelled appointment {appointment_id}")
        elif cancelled_by == 'clinic':
            appointment.status = 'canceled_by_clinic'
            logger.info(f"Clinic admin cancelled appointment {appointment_id}")
        else:
            raise ValueError(f"Invalid cancelled_by value: {cancelled_by}. Must be 'patient' or 'clinic'")

        appointment.canceled_at = taiwan_now()
        db.commit()

        # Cancel pending follow-up messages, reminders, and practitioner notifications for this appointment
        # Note: This happens after appointment cancellation commit, so if cancellation fails,
        # the appointment is still canceled (intentional - we don't want message cancellation
        # failures to prevent appointment cancellation)
        try:
            FollowUpMessageService.cancel_pending_follow_up_messages(db, appointment_id)
        except Exception as e:
            logger.exception(f"Failed to cancel follow-up messages for appointment {appointment_id}: {e}")
            # Don't fail cancellation if follow-up message cancellation fails
        
        try:
            from services.reminder_scheduling_service import ReminderSchedulingService
            ReminderSchedulingService.cancel_pending_reminder(db, appointment_id)
        except Exception as e:
            logger.exception(f"Failed to cancel reminder for appointment {appointment_id}: {e}")
            # Don't fail cancellation if reminder cancellation fails
        
        # Practitioner daily notifications are now handled via hourly check
        # No pre-scheduling to cancel

        # Get clinic and practitioner for notifications
        calendar_event = appointment.calendar_event
        practitioner = calendar_event.user if calendar_event else None
        clinic = appointment.patient.clinic
        if not clinic:
            clinic = db.query(Clinic).filter(Clinic.id == appointment.patient.clinic_id).first()

        # Send notifications to both practitioner and patient if they have LINE accounts linked
        # Only send if appointment was not already cancelled (idempotent check)
        if practitioner and clinic:
            try:
                from services.notification_service import NotificationService, CancellationSource
                from models.user_clinic_association import UserClinicAssociation
                
                # Get association for this practitioner and clinic
                association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == practitioner.id,
                    UserClinicAssociation.clinic_id == clinic.id,
                    UserClinicAssociation.is_active == True
                ).first()
                
                # Send unified cancellation notification to practitioner and admins (with deduplication)
                if association:
                    try:
                        NotificationService.send_unified_cancellation_notification(
                            db, appointment, clinic, practitioner, cancelled_by,
                            include_practitioner=True, include_admins=True
                        )
                    except Exception as e:
                        logger.exception(f"Failed to send cancellation notification: {e}")
                        # Don't fail cancellation if notification fails
                
                # Send patient cancellation notification
                # Skip if patient cancelled themselves (they already know they cancelled)
                if cancelled_by == 'clinic':
                    cancellation_source = CancellationSource.CLINIC
                    NotificationService.send_appointment_cancellation(
                        db, appointment, practitioner, cancellation_source, note=note
                    )
            except Exception as e:
                # Log but don't fail - notification failure shouldn't block cancellation
                logger.warning(f"Failed to send cancellation notifications: {e}")
        # Return response
        if return_details:
            calendar_event = appointment.calendar_event
            practitioner = calendar_event.user if calendar_event else None
            return {
                'appointment': appointment,
                'practitioner': practitioner
            }
        return {"success": True, "message": "預約已取消"}

    @staticmethod
    def check_appointment_edit_conflicts(
        db: Session,
        appointment_id: int,
        new_practitioner_id: Optional[int],
        new_start_time: Optional[datetime],
        appointment_type_id: int,
        clinic_id: int,
        allow_override: bool = False
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
            if not AvailabilityService.validate_practitioner_offers_appointment_type(
                db, new_practitioner_id, appointment_type_id, clinic_id
            ):
                conflicts.append("此治療師不提供此預約類型")
                return (False, "此治療師不提供此預約類型", conflicts)

        # Check availability at new time/practitioner
        # Exclude current appointment from conflict checking
        # Note: fetch_practitioner_schedule_data already includes all confirmed appointments
        # and excludes the current appointment via exclude_calendar_event_id parameter
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, [practitioner_id_to_check], start_time_to_check.date(), clinic_id, exclude_calendar_event_id=appointment_id
        )

        slot_start_time = start_time_to_check.time()
        slot_end_time = end_time_to_check.time()

        is_available = AppointmentService._is_practitioner_available_at_slot(
            schedule_data, practitioner_id_to_check, slot_start_time, slot_end_time, allow_override=allow_override
        )

        if not is_available:
            conflicts.append("此時段不可用")

        is_valid = len(conflicts) == 0
        error_message = conflicts[0] if conflicts else None

        return (is_valid, error_message, conflicts)

    @staticmethod
    def _has_appointment_changes(
        old_practitioner_id: Optional[int],
        new_practitioner_id: Optional[int],
        old_start_time: datetime,
        new_start_time: datetime
    ) -> bool:
        """
        Check if appointment has changes that warrant a notification.
        
        Args:
            old_practitioner_id: Original practitioner ID
            new_practitioner_id: New practitioner ID
            old_start_time: Original start time
            new_start_time: New start time
            
        Returns:
            True if practitioner or time changed, False otherwise
        """
        if new_practitioner_id != old_practitioner_id:
            return True
        
        if new_start_time != old_start_time:
            return True
        
        return False

    @staticmethod
    def get_notification_requirements(
        old_appointment: Appointment,
        new_practitioner_id: int,
        new_start_time: datetime,
        originally_auto_assigned: Optional[bool] = None,
        time_actually_changed: Optional[bool] = None
    ) -> NotificationRequirements:
        """
        Determine notification requirements for appointment edit.
        
        This is the single source of truth for determining:
        - Whether to prompt user for notification note
        - Whether to show preview message step
        - Whether to generate LINE message template (implicit: same as will_send_notification)
        - Whether to send notification
        
        Rules:
        - Notify patient when either the practitioner OR time changes
        - Exception: For originally auto-assigned appointments, only notify if time changed OR changing to specific practitioner
        - Resource changes, appointment type changes, etc. do NOT trigger notifications
        
        Note: Currently all three return values are identical, but kept separate for future extensibility
        (e.g., might want to show preview without requiring note, or require note without sending).

        Args:
            old_appointment: Current appointment state (must be unmodified)
            new_practitioner_id: New practitioner ID (must be the actual value, not None)
            new_start_time: New start time (must be the actual value, not None)
            originally_auto_assigned: Whether appointment was originally auto-assigned (optional, will be read from appointment if not provided)
            time_actually_changed: Whether time actually changed (optional, will be calculated if not provided)

        Returns:
            NotificationRequirements dict with:
                - will_send_notification: Whether notification will be sent
                - requires_notification_note: Whether to prompt for notification note (currently same as will_send_notification)
                - should_show_preview: Whether to show preview step (currently same as will_send_notification)
        
        Example:
            >>> requirements = AppointmentService.get_notification_requirements(
            ...     old_appointment=appointment,
            ...     new_practitioner_id=123,
            ...     new_start_time=new_time
            ... )
            >>> if requirements["will_send_notification"]:
            ...     show_note_step()
        """
        # Read old values from appointment (must be called before appointment is updated)
        old_start_time = datetime.combine(
            old_appointment.calendar_event.date,
            old_appointment.calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id = old_appointment.calendar_event.user_id

        # Check if practitioner or time changed
        has_changes = AppointmentService._has_appointment_changes(
            old_practitioner_id, new_practitioner_id, old_start_time, new_start_time
        )
        
        # Determine if originally auto-assigned (use provided value or read from appointment)
        if originally_auto_assigned is None:
            originally_auto_assigned = old_appointment.is_auto_assigned
        
        # Determine if time actually changed (use provided value or calculate)
        if time_actually_changed is None:
            time_actually_changed = (new_start_time != old_start_time)
        
        # Check if practitioner actually changed
        practitioner_changed = (old_practitioner_id != new_practitioner_id)
        
        # For originally auto-assigned appointments:
        # - Notify if time changed (always)
        # - Notify if changing to a specific practitioner (even without time change)
        # - Don't notify if only confirming/changing between auto-assigned practitioners without time change
        if originally_auto_assigned and not time_actually_changed:
            # Only notify if changing to a specific practitioner (not auto-assigned)
            # Note: new_practitioner_id is guaranteed to be a valid practitioner ID (> 0)
            # because this function is called after _resolve_practitioner_id() has resolved
            # any auto-assignment requests to actual practitioner IDs
            if practitioner_changed and new_practitioner_id > 0:
                # Changing from auto-assigned to specific practitioner - notify
                will_send = True
            else:
                # Only confirming/changing auto-assignment without time change - don't notify
                will_send = False
        else:
            # Not originally auto-assigned, or time changed - use standard logic
            will_send = has_changes
        
        return {
            "will_send_notification": will_send,
            "requires_notification_note": will_send,
            "should_show_preview": will_send
        }

    @staticmethod
    def should_send_edit_notification(
        old_appointment: Appointment,
        new_practitioner_id: int,
        new_start_time: datetime
    ) -> bool:
        """
        Determine if LINE notification should be sent for appointment edit.

        This is a convenience method that uses get_notification_requirements().
        Kept for backward compatibility.

        Args:
            old_appointment: Current appointment state (must be unmodified)
            new_practitioner_id: New practitioner ID (must be the actual value, not None)
            new_start_time: New start time (must be the actual value, not None)

        Returns:
            True if notification should be sent, False otherwise
        """
        requirements = AppointmentService.get_notification_requirements(
            old_appointment, new_practitioner_id, new_start_time
        )
        return requirements["will_send_notification"]

    @staticmethod
    def _update_appointment_core(
        db: Session,
        appointment: Appointment,
        calendar_event: CalendarEvent,
        clinic: Clinic,
        clinic_id: int,
        practitioner_id_to_use: int,
        new_start_time: Optional[datetime],
        new_notes: Optional[str],
        new_clinic_notes: Optional[str],
        duration_minutes: int,
        old_practitioner_id: Optional[int],
        old_start_time: datetime,
        old_is_auto_assigned: bool,
        is_auto_assign: bool,
        reassigned_by_user_id: Optional[int],
        send_patient_notification: bool,
        notification_note: Optional[str] = None,
        time_actually_changed: Optional[bool] = None,
        originally_auto_assigned: Optional[bool] = None,
        new_appointment_type_id: Optional[int] = None,
        allow_override: bool = False,
        is_time_confirmation: bool = False
    ) -> None:
        """
        Core shared logic for updating an appointment.

        This method handles the common update operations used by update_appointment.

        Args:
            db: Database session
            appointment: Appointment to update
            calendar_event: Calendar event to update
            clinic: Clinic object
            clinic_id: Clinic ID
            practitioner_id_to_use: Final practitioner ID to use (already resolved)
            new_start_time: New start time (None = keep current)
            new_notes: New patient notes (None = keep current, only for patient reschedules)
            new_clinic_notes: New clinic notes (None = keep current)
            duration_minutes: Appointment duration in minutes
            old_practitioner_id: Original practitioner ID (for notifications)
            old_start_time: Original start time (for notifications)
            old_is_auto_assigned: Whether appointment was originally auto-assigned
            is_auto_assign: Whether the new practitioner is auto-assigned
            reassigned_by_user_id: User ID who made the reassignment (None for patient reschedule)
            send_patient_notification: Whether to send patient edit notification
            notification_note: Optional custom note for patient notification
            time_actually_changed: Whether time actually changed (if None, will be calculated)
            originally_auto_assigned: Whether appointment was originally created as auto-assigned (for special handling)
        """
        # Calculate if practitioner actually changed
        practitioner_actually_changed = (practitioner_id_to_use != old_practitioner_id)
        
        # Calculate if time actually changed (if not provided)
        if time_actually_changed is None:
            time_actually_changed = (new_start_time is not None and new_start_time != old_start_time)

        # Determine if notification should be sent (reuse shared logic)
        # Use old_start_time if new_start_time is None (no time change)
        new_start_time_for_check = new_start_time if new_start_time is not None else old_start_time
        should_send_notification = send_patient_notification and AppointmentService._has_appointment_changes(
            old_practitioner_id, practitioner_id_to_use, old_start_time, new_start_time_for_check
        )

        # Update patient notes if provided (only for patient reschedules)
        if new_notes is not None:
            appointment.notes = new_notes

        # Update clinic notes if provided
        if new_clinic_notes is not None:
            appointment.clinic_notes = new_clinic_notes

        # Update appointment type if provided
        if new_appointment_type_id is not None:
            appointment.appointment_type_id = new_appointment_type_id

        # Update practitioner if changed
        if practitioner_actually_changed:
            calendar_event.user_id = practitioner_id_to_use

        # Update auto-assignment tracking fields
        # This needs to happen even if practitioner didn't change (e.g., patient requests auto-assignment but old practitioner kept)
        if is_auto_assign:
            # Special case: If we kept the old practitioner (they were still available),
            # keep is_auto_assigned=False (appointment stays visible)
            # This happens when: originally_auto_assigned=True, old_is_auto_assigned=False,
            # patient requested auto-assignment, but old practitioner was kept
            # If originally_auto_assigned is None, get it from appointment object
            if originally_auto_assigned is None:
                originally_auto_assigned = appointment.originally_auto_assigned
            if (originally_auto_assigned and not old_is_auto_assigned and 
                not practitioner_actually_changed):
                # Keep old practitioner - appointment stays visible
                appointment.is_auto_assigned = False
                # Keep existing reassigned_by_user_id and reassigned_at (from admin assignment)
            else:
                # Changing to auto-assigned (new practitioner assigned or was already auto-assigned)
                appointment.is_auto_assigned = True
                appointment.reassigned_by_user_id = None
                appointment.reassigned_at = None
        elif old_is_auto_assigned:
            # Changing from auto-assigned to specific
            appointment.is_auto_assigned = False
            appointment.reassigned_by_user_id = reassigned_by_user_id
            appointment.reassigned_at = taiwan_now()
        elif practitioner_actually_changed:
            # Changing from specific to specific
            appointment.is_auto_assigned = False
            if reassigned_by_user_id is not None:
                appointment.reassigned_by_user_id = reassigned_by_user_id
                appointment.reassigned_at = taiwan_now()
            # Otherwise keep existing reassigned_by_user_id and reassigned_at
        
        # CRITICAL: If appointment was auto-assigned and admin confirms (even without changes),
        # make it visible by setting is_auto_assigned = False
        # This handles the case where admin clicks "確認指派" from auto-assigned page without changing anything
        if old_is_auto_assigned and not practitioner_actually_changed and not time_actually_changed and reassigned_by_user_id is not None:
            # Admin is confirming the auto-assigned appointment without changes
            appointment.is_auto_assigned = False
            appointment.reassigned_by_user_id = reassigned_by_user_id
            appointment.reassigned_at = taiwan_now()

        # Update calendar event if time changed or duration changed (appointment type change)
        if new_start_time is not None:
            calendar_event.date = new_start_time.date()
            calendar_event.start_time = new_start_time.time()
            end_time = new_start_time + timedelta(minutes=duration_minutes)
            calendar_event.end_time = end_time.time()
        elif new_appointment_type_id is not None:
            # Appointment type changed but start time stayed the same - recalculate end time based on new duration
            assert calendar_event.start_time is not None, "start_time should be set for appointment events"
            current_start_datetime = datetime.combine(calendar_event.date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
            end_time = current_start_datetime + timedelta(minutes=duration_minutes)
            calendar_event.end_time = end_time.time()

        # CRITICAL: Check if auto-assigned appointment is now within recency limit
        # Note: Patient reschedules to within recency limit are blocked by _validate_booking_constraints
        # This check applies to admin reschedules or other scenarios where booking constraints are bypassed
        # If appointment becomes within recency limit, make it visible immediately and notify practitioner
        if appointment.is_auto_assigned and new_start_time is not None:
            # Get clinic settings for recency limit
            settings = clinic.get_validated_settings()
            booking_settings = settings.booking_restriction_settings
            booking_restriction_type = booking_settings.booking_restriction_type
            now = taiwan_now()
            
            should_make_visible = False
            
            if booking_restriction_type == "deadline_time_day_before":
                # Deadline time mode: check if deadline has passed
                # deadline_on_same_day=False: deadline on day X-1
                # deadline_on_same_day=True: deadline on day X (same day)
                deadline_time_str = booking_settings.deadline_time_day_before or "08:00"
                deadline_on_same_day = booking_settings.deadline_on_same_day
                
                from utils.datetime_utils import parse_deadline_time_string
                deadline_time_obj = parse_deadline_time_string(deadline_time_str, default_hour=8, default_minute=0)
                
                appointment_date = new_start_time.date()
                
                # Determine deadline date based on deadline_on_same_day setting
                if deadline_on_same_day:
                    # Deadline is on the same day as appointment (date X)
                    deadline_date = appointment_date
                else:
                    # Deadline is on the day before (date X-1)
                    deadline_date = appointment_date - timedelta(days=1)
                
                deadline_datetime = datetime.combine(deadline_date, deadline_time_obj).replace(tzinfo=now.tzinfo)
                
                # Make visible when current time >= deadline
                if now >= deadline_datetime:
                    should_make_visible = True
            else:
                # Default: minimum_hours_required mode
                minimum_hours = booking_settings.minimum_booking_hours_ahead
                hours_until = (new_start_time - now).total_seconds() / 3600
                
                # If new time is within or past recency limit, make appointment visible
                if hours_until <= minimum_hours:
                    should_make_visible = True
            
            if should_make_visible:
                appointment.is_auto_assigned = False
                # Notification will be sent below if practitioner changed or time changed

        # Track old status before commit to detect re-activation
        # This handles the design doc requirement: "If appointment is re-activated (canceled → confirmed), reschedule messages"
        # TODO: Currently blocked by validation in _get_and_validate_appointment_for_update() which prevents
        # editing cancelled appointments. To enable re-activation:
        # 1. Update _get_and_validate_appointment_for_update() to allow status changes from cancelled → confirmed
        # 2. Or add a separate re-activate_appointment() method that bypasses the validation
        # Once enabled, this logic will automatically reschedule messages when appointments are re-activated
        old_status = appointment.status
        
        db.commit()
        db.refresh(appointment)
        
        # Detect re-activation: if appointment status changed from cancelled → confirmed
        # This handles the design doc requirement: "If appointment is re-activated (canceled → confirmed), reschedule messages"
        was_cancelled = old_status in ['canceled_by_patient', 'canceled_by_clinic']
        is_now_confirmed = appointment.status == 'confirmed'
        was_reactivated = was_cancelled and is_now_confirmed
        
        # Reschedule follow-up messages, reminders, and practitioner notifications if:
        # 1. Time or appointment type changed, OR
        # 2. Appointment was re-activated (status changed from cancelled → confirmed)
        should_reschedule = (
            time_actually_changed or 
            (new_appointment_type_id is not None and new_appointment_type_id != appointment.appointment_type_id) or
            was_reactivated
        )
        
        if should_reschedule:
            try:
                FollowUpMessageService.reschedule_follow_up_messages(db, appointment)
            except Exception as e:
                logger.exception(f"Failed to reschedule follow-up messages for appointment {appointment.calendar_event_id}: {e}")
                # Don't fail update if rescheduling fails
            
            try:
                from services.reminder_scheduling_service import ReminderSchedulingService
                ReminderSchedulingService.reschedule_reminder(db, appointment)
            except Exception as e:
                logger.exception(f"Failed to reschedule reminder for appointment {appointment.calendar_event_id}: {e}")
                # Don't fail update if rescheduling fails
            
            # Practitioner daily notifications are now handled via hourly check
            # No pre-scheduling to reschedule

        # Send notifications
        try:
            # Get practitioners for notification
            # For old_practitioner: include if appointment was manually assigned (was visible to practitioner)
            old_practitioner = None
            if old_practitioner_id and not old_is_auto_assigned:
                old_practitioner = db.query(User).filter(User.id == old_practitioner_id).first()
            
            new_practitioner = None
            if practitioner_actually_changed:
                new_practitioner = db.query(User).filter(User.id == practitioner_id_to_use).first()
            else:
                # If practitioner didn't change but appointment became visible (recency limit),
                # get the current practitioner for notification
                if old_is_auto_assigned and not appointment.is_auto_assigned:
                    # Appointment became visible due to recency limit, get current practitioner
                    new_practitioner = db.query(User).filter(User.id == practitioner_id_to_use).first()
                else:
                    new_practitioner = old_practitioner

            # CRITICAL: If patient changed from specific practitioner to "不指定" (auto-assigned),
            # send cancellation notification to old practitioner
            # This happens when: was manually assigned (old_is_auto_assigned=False) and now auto-assigned (is_auto_assign=True)
            # EXCEPTION: If we kept the old practitioner (they were still available), don't send cancellation
            # This happens when: originally_auto_assigned=True, old_is_auto_assigned=False, 
            # patient requested auto-assignment, but old practitioner was kept
            if (old_practitioner and not old_is_auto_assigned and is_auto_assign and 
                practitioner_actually_changed):
                # Only send cancellation if practitioner actually changed
                from services.notification_service import NotificationService
                try:
                    NotificationService.send_unified_cancellation_notification(
                        db, appointment, clinic, old_practitioner, cancelled_by='patient',
                        include_practitioner=True, include_admins=True
                    )
                except Exception as e:
                    logger.exception(f"Failed to send cancellation notification: {e}")

            # Send patient edit notification if requested
            # Skip if patient triggered the edit (they already see confirmation in UI)
            if send_patient_notification and reassigned_by_user_id is not None:
                from services.notification_service import NotificationService
                
                if is_time_confirmation:
                    # Final confirmation for pending multi-slot appointment
                    from utils.practitioner_helpers import get_practitioner_display_name_with_title
                    practitioner_name = get_practitioner_display_name_with_title(
                        db, practitioner_id_to_use, clinic.id
                    )
                    
                    NotificationService.send_appointment_confirmation(
                        db=db,
                        appointment=appointment,
                        practitioner_name=practitioner_name,
                        clinic=clinic,
                        trigger_source='clinic_triggered'
                    )
                elif should_send_notification:
                    # Standard edit notification
                    NotificationService.send_appointment_edit_notification(
                        db=db,
                        appointment=appointment,
                        old_practitioner=old_practitioner,
                        new_practitioner=new_practitioner,
                        old_start_time=old_start_time,
                        new_start_time=new_start_time if new_start_time is not None else old_start_time,
                        note=notification_note,
                        trigger_source='clinic_triggered'
                    )

            # Send practitioner notifications
            # Case 1: Practitioner changed (from specific to specific)
            if practitioner_actually_changed and not old_is_auto_assigned and not is_auto_assign:
                # Changing from specific practitioner to specific practitioner
                from services.notification_service import NotificationService
                if reassigned_by_user_id is not None:
                    # Admin edit: use unified edit notification (notifies both old and new practitioners and admins)
                    # new_practitioner must not be None for edit notification
                    if new_practitioner is not None:
                        # Calculate old_start_time for time change detection
                        old_start_datetime = old_start_time.replace(tzinfo=None) if old_start_time.tzinfo else old_start_time
                        try:
                            NotificationService.send_unified_edit_notification(
                                db, appointment, clinic, old_practitioner, new_practitioner,
                                old_start_datetime, include_practitioner=True, include_admins=True
                            )
                        except Exception as e:
                            logger.exception(f"Failed to send edit notification: {e}")
                            # Don't fail update if notification fails
                else:
                    # Patient edit: old receives cancellation, new receives appointment
                    # Use unified methods but send separately (different event types)
                    if old_practitioner:
                        # Old practitioner receives cancellation notification (as if patient cancelled)
                        try:
                            NotificationService.send_unified_cancellation_notification(
                                db, appointment, clinic, old_practitioner, cancelled_by='patient',
                                include_practitioner=True, include_admins=True
                            )
                        except Exception as e:
                            logger.exception(f"Failed to send cancellation notification: {e}")
                    if new_practitioner:
                        # New practitioner receives appointment notification (as if patient just made appointment)
                        try:
                            NotificationService.send_unified_appointment_notification(
                                db, appointment, clinic, new_practitioner,
                                include_practitioner=True, include_admins=True
                            )
                        except Exception as e:
                            logger.exception(f"Failed to send appointment notification: {e}")
            # Case 2: Auto-assigned becomes visible (due to recency limit being reached during reschedule)
            elif old_is_auto_assigned and not appointment.is_auto_assigned and new_practitioner is not None:
                # Was auto-assigned: use unified appointment notification (as if patient booked directly)
                from services.notification_service import NotificationService
                try:
                    NotificationService.send_unified_appointment_notification(
                        db, appointment, clinic, new_practitioner,
                        include_practitioner=True, include_admins=True
                    )
                except Exception as e:
                    logger.exception(f"Failed to send appointment notification: {e}")
            # Case 3: Time changed but practitioner didn't change (and was manually assigned)
            # - Practitioner should receive notification about time change
            elif time_actually_changed and not practitioner_actually_changed and not old_is_auto_assigned and old_practitioner:
                # Time changed but same practitioner (was manually assigned)
                # Send unified edit notification to practitioner and admins (with deduplication)
                from services.notification_service import NotificationService
                # Calculate old_start_time for time change detection
                old_start_datetime = old_start_time.replace(tzinfo=None) if old_start_time.tzinfo else old_start_time
                try:
                    NotificationService.send_unified_edit_notification(
                        db, appointment, clinic, old_practitioner, old_practitioner,
                        old_start_datetime, include_practitioner=True, include_admins=True
                    )
                except Exception as e:
                    logger.exception(f"Failed to send edit notification: {e}")
                    # Don't fail update if notification fails
        except Exception as e:
            # Log but don't fail - notification failure shouldn't block update
            logger.warning(f"Failed to send appointment update notification: {e}")

    @staticmethod
    def _get_and_validate_appointment_for_update(
        db: Session,
        appointment_id: int,
        appointment: Optional[Appointment] = None
    ) -> Tuple[Appointment, CalendarEvent]:
        """
        Get appointment with relationships and validate it exists, is not cancelled, and has valid calendar event.

        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
            appointment: Optional pre-fetched appointment to avoid duplicate query

        Returns:
            Tuple of (appointment, calendar_event)

        Raises:
            HTTPException: If appointment not found, cancelled, or calendar event invalid
        """
        # Use provided appointment or query with eager loading
        if appointment is None:
            appointment = db.query(Appointment).join(
                CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
            ).options(
                joinedload(Appointment.patient),
                joinedload(Appointment.appointment_type),
                joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
            ).filter(
            Appointment.calendar_event_id == appointment_id
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
        if not calendar_event:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="預約時間資料不完整"
            )

        # Validate calendar event has date and start_time
        if not calendar_event.start_time or not calendar_event.date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="預約時間資料不完整"
            )
        
        return appointment, calendar_event

    @staticmethod
    def _normalize_start_time(
        calendar_event: CalendarEvent,
        new_start_time: Optional[datetime]
    ) -> datetime:
        """
        Normalize start time: get current time from calendar event if None, ensure timezone-aware.
        
        Args:
            calendar_event: Calendar event to get current time from
            new_start_time: New start time (None = use current)
            
        Returns:
            Normalized datetime in Taiwan timezone
        """
        # start_time and date are already validated in _get_and_validate_appointment_for_update
        # Type assertion: validated upstream, but type checker needs help
        assert calendar_event.start_time is not None, "start_time validated in _get_and_validate_appointment_for_update"
        current_start_time = datetime.combine(
            calendar_event.date, calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)

        if new_start_time is None:
            return current_start_time
        
        # Ensure new_start_time is timezone-aware
        if new_start_time.tzinfo is None:
            return new_start_time.replace(tzinfo=TAIWAN_TZ)
        else:
            return new_start_time.astimezone(TAIWAN_TZ)

    @staticmethod
    def _validate_booking_constraints(
        clinic: Clinic,
        new_start_time: datetime,
        db: Optional[Session] = None,
        patient_id: Optional[int] = None,
        current_start_time: Optional[datetime] = None,
        check_max_future_appointments: bool = False,
        check_minimum_cancellation_hours: bool = False
    ) -> None:
        """
        Validate booking constraints for patient appointments.
        
        Used for both appointment creation and editing. Validates restrictions that apply
        to patient bookings (LINE users). Clinic admins bypass all restrictions.
        
        Args:
            clinic: Clinic object with settings
            new_start_time: New/appointment start time to validate
            db: Database session (required if check_max_future_appointments=True)
            patient_id: Patient ID (required if check_max_future_appointments=True)
            current_start_time: Current appointment time (required if check_minimum_cancellation_hours=True)
            check_max_future_appointments: Whether to check max future appointments limit (for creation)
            check_minimum_cancellation_hours: Whether to check minimum cancellation hours (for edits)
            
        Raises:
            HTTPException: If any booking constraint is violated
        """
        from utils.appointment_queries import count_future_appointments_for_patient
        
        settings = clinic.get_validated_settings()
        booking_settings = settings.booking_restriction_settings
        now = taiwan_now()

        # Check minimum_cancellation_hours_before for CURRENT appointment time (edit only)
        if check_minimum_cancellation_hours:
            if current_start_time is None:
                raise ValueError("current_start_time is required when check_minimum_cancellation_hours=True")
            
            minimum_cancellation_hours = booking_settings.minimum_cancellation_hours_before
            time_until_appointment = current_start_time - now
            hours_until_appointment = time_until_appointment.total_seconds() / 3600

            if hours_until_appointment < minimum_cancellation_hours:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"預約必須在至少 {minimum_cancellation_hours} 小時前修改"
                )

        # Check max_booking_window_days for NEW appointment time
        max_booking_window_days = booking_settings.max_booking_window_days
        max_booking_date = now + timedelta(days=max_booking_window_days)

        if new_start_time > max_booking_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"最多只能預約 {max_booking_window_days} 天內的時段"
            )

        # Check booking restriction based on mode
        booking_restriction_type = booking_settings.booking_restriction_type
        
        if booking_restriction_type == "deadline_time_day_before":
            # Deadline time mode: appointment on day X must be booked by deadline
            # deadline_on_same_day=False: deadline on day X-1
            # deadline_on_same_day=True: deadline on day X (same day)
            from utils.datetime_utils import parse_deadline_time_string
            
            deadline_time_str = booking_settings.deadline_time_day_before or "08:00"
            deadline_on_same_day = booking_settings.deadline_on_same_day
            
            # Parse deadline time (stored as 24-hour format HH:MM)
            deadline_time = parse_deadline_time_string(deadline_time_str, default_hour=8, default_minute=0)
            
            # Get appointment date (day X)
            appointment_date = new_start_time.date()
            
            # Determine deadline date based on deadline_on_same_day setting
            if deadline_on_same_day:
                # Deadline is on the same day as appointment (date X)
                deadline_date = appointment_date
            else:
                # Deadline is on the day before (date X-1)
                deadline_date = appointment_date - timedelta(days=1)
            
            deadline_datetime = datetime.combine(deadline_date, deadline_time).replace(tzinfo=now.tzinfo)
            
            # Check if current time is before or after deadline
            if now >= deadline_datetime:
                # After deadline, so cannot book for this appointment date
                if deadline_on_same_day:
                    # Deadline on same day: cannot book for day X if past deadline on day X
                    if new_start_time.date() == appointment_date:
                        next_available_date = appointment_date + timedelta(days=1)
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"已超過 {deadline_date.strftime('%Y/%m/%d')} {deadline_time_str} 的預約期限，最早可預約 {next_available_date.strftime('%Y/%m/%d')} 的時段"
                        )
                else:
                    # Deadline on X-1: cannot book for day X if past deadline on day X-1
                    if new_start_time.date() <= appointment_date:
                        next_available_date = appointment_date + timedelta(days=1)
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"已超過 {deadline_date.strftime('%Y/%m/%d')} {deadline_time_str} 的預約期限，最早可預約 {next_available_date.strftime('%Y/%m/%d')} 的時段"
                        )
            # If before deadline, appointment is allowed (no check needed)
        else:
            # Default: minimum_hours_required mode
            minimum_booking_hours_ahead = booking_settings.minimum_booking_hours_ahead
            if minimum_booking_hours_ahead and minimum_booking_hours_ahead > 0:
                time_until_new_appointment = new_start_time - now
                hours_until_new = time_until_new_appointment.total_seconds() / 3600

                if hours_until_new < minimum_booking_hours_ahead:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"預約必須至少提前 {minimum_booking_hours_ahead} 小時預約"
                    )

        # Check max_future_appointments limit (creation only)
        if check_max_future_appointments:
            if db is None or patient_id is None:
                raise ValueError("db and patient_id are required when check_max_future_appointments=True")
            
            max_future_appointments = booking_settings.max_future_appointments
            current_future_count = count_future_appointments_for_patient(
                db, patient_id, status="confirmed"
            )

            if current_future_count >= max_future_appointments:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"您已有 {current_future_count} 個未來的預約，最多只能有 {max_future_appointments} 個未來預約"
                )

    @staticmethod
    def _resolve_practitioner_id(
        db: Session,
        new_practitioner_id: Optional[int],
        calendar_event: CalendarEvent,
        appointment: Appointment,
        clinic_id: int,
        new_start_time: datetime,
        duration_minutes: int,
        allow_auto_assignment: bool,
        allow_override: bool = False
    ) -> int:
        """
        Resolve which practitioner ID to use for the appointment.
        
        Args:
            db: Database session
            new_practitioner_id: Requested practitioner ID (None = keep, -1 = auto-assign if allowed)
            calendar_event: Current calendar event
            appointment: Appointment object
            clinic_id: Clinic ID
            new_start_time: New appointment start time
            duration_minutes: Appointment duration
            allow_auto_assignment: Whether auto-assignment is allowed
            
        Returns:
            Practitioner ID to use
            
        Raises:
            HTTPException: If practitioner validation fails
        """
        is_auto_assign_requested = (allow_auto_assignment and new_practitioner_id == -1)
        
        if is_auto_assign_requested:
            # Special case: If appointment was originally auto-assigned but made visible (by admin or cron),
            # check if old practitioner is still available before auto-assigning
            old_practitioner_id = calendar_event.user_id
            originally_auto_assigned = appointment.originally_auto_assigned
            old_is_auto_assigned = appointment.is_auto_assigned
            
            if originally_auto_assigned and not old_is_auto_assigned:
                # Appointment was originally auto-assigned but is now visible
                # Check if old practitioner is still available at new time
                end_time = new_start_time + timedelta(minutes=duration_minutes)
                
                # Get schedule data for old practitioner, excluding current appointment
                schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
                    db, [old_practitioner_id], new_start_time.date(), clinic_id,
                    exclude_calendar_event_id=calendar_event.id
                )
                
                slot_start_time = new_start_time.time()
                slot_end_time = end_time.time()
                
                # Check if old practitioner is available
                if AppointmentService._is_practitioner_available_at_slot(
                    schedule_data, old_practitioner_id, slot_start_time, slot_end_time, allow_override=allow_override
                ):
                    # Old practitioner is available - keep them (don't auto-assign)
                    return old_practitioner_id
            
            # Auto-assign practitioner (either old not available, or not originally auto-assigned)
            end_time = new_start_time + timedelta(minutes=duration_minutes)
            return AppointmentService._assign_practitioner(
                db=db,
                clinic_id=clinic_id,
                appointment_type_id=appointment.appointment_type_id,
                requested_practitioner_id=None,  # None triggers auto-assignment
                start_time=new_start_time,
                end_time=end_time,
                allow_override=allow_override
            )
        elif new_practitioner_id is not None and new_practitioner_id != -1:
            # Specific practitioner requested - validate
            AvailabilityService.validate_practitioner_for_clinic(
                db, new_practitioner_id, clinic_id
            )
            return new_practitioner_id
        else:
            # None or -1 (when auto-assignment not allowed) = keep current practitioner
            # calendar_event.user_id is guaranteed to be int (non-nullable in model)
            return calendar_event.user_id

    @staticmethod
    def update_appointment(
        db: Session,
        appointment_id: int,
        new_practitioner_id: Optional[int],
        new_start_time: Optional[datetime],
        new_notes: Optional[str] = None,
        new_clinic_notes: Optional[str] = None,
        apply_booking_constraints: bool = False,
        allow_auto_assignment: bool = False,
        reassigned_by_user_id: Optional[int] = None,
        notification_note: Optional[str] = None,
        success_message: str = '預約已更新',
        appointment: Optional[Appointment] = None,
        new_appointment_type_id: Optional[int] = None,
        selected_resource_ids: Optional[List[int]] = None,
        confirm_time_selection: Optional[bool] = None,
        selected_time_slots: Optional[List[str]] = None,
        allow_multiple_time_slot_selection: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Update an appointment (time, practitioner, and/or appointment type).
        
        Unified method for both clinic edits and patient reschedules.
        Authorization checks should be performed by the caller.

        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
            new_practitioner_id: New practitioner ID (None = keep current, -1 = auto-assign if allowed)
            new_start_time: New start time (None = keep current, will use current time)
            new_notes: New patient notes (None = keep current, only for patient reschedules)
            new_clinic_notes: New clinic notes (None = keep current)
            apply_booking_constraints: If True, applies booking restrictions (for patients)
            allow_auto_assignment: If True, allows -1 for auto-assignment (for patients)
            reassigned_by_user_id: User ID who made the reassignment (None for patient, user_id for clinic)
            notification_note: Optional custom note for patient notification
            success_message: Success message to return
            appointment: Optional pre-fetched appointment to avoid duplicate query
            new_appointment_type_id: New appointment type ID (None = keep current)
            selected_resource_ids: Optional list of resource IDs to allocate (None = auto-allocate)
            confirm_time_selection: If True, this is a time confirmation for pending multiple slot appointment
            selected_time_slots: List of ISO datetime strings for multiple time slot selection (patient re-selection)
            allow_multiple_time_slot_selection: Whether appointment type supports multiple slots

        Returns:
            Dict with updated appointment details

        Raises:
            HTTPException: If update fails or validation errors
        """
        # Get and validate appointment
        # Use pre-fetched appointment if provided to avoid duplicate query
        appointment, calendar_event = AppointmentService._get_and_validate_appointment_for_update(
            db, appointment_id, appointment=appointment
        )
        
        # Constraint 1: Check if appointment has any receipt (active or voided)
        # Lock appointment row to prevent race conditions
        from sqlalchemy.exc import OperationalError
        try:
            # Re-query with lock (appointment may have been pre-fetched without lock)
            locked_appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).with_for_update(nowait=True).first()
        except OperationalError:
            # Handle lock timeout - another transaction is modifying
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此預約正在被其他操作修改，請稍後再試"
            )
        
        if not locked_appointment:
            raise HTTPException(status_code=404, detail="預約不存在")
        
        # Capture the original state of the appointment for notification logic
        # this must be done BEFORE any modifications, especially confirm_time_selection
        old_is_auto_assigned = appointment.is_auto_assigned
        originally_auto_assigned = appointment.originally_auto_assigned
        
        # Check if appointment has any receipt (within same transaction)
        # Allow clinic notes updates even when receipts exist (clinic notes don't affect appointment details)
        from models.receipt import Receipt
        receipts = db.query(Receipt).filter(
            Receipt.appointment_id == appointment_id
        ).all()
        
        # Check if this is a clinic notes-only update
        is_clinic_notes_only = (
            new_clinic_notes is not None and
            new_practitioner_id is None and
            new_start_time is None and
            new_appointment_type_id is None and
            new_notes is None
        )
        
        if len(receipts) > 0 and not is_clinic_notes_only:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="此預約已有收據，無法修改"
            )

        # Handle time confirmation for pending multiple slot appointments
        is_resolving_time_confirmation = False
        if confirm_time_selection:
            if not new_start_time:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="確認時間時必須提供新的開始時間"
                )

            # Mark that we are resolving confirmation, but don't return early.
            # We'll set the flags now and let the rest of the method handle the update
            # (practitioner assignment, resource allocation, and visibility).
            is_resolving_time_confirmation = True
            appointment.pending_time_confirmation = False
            appointment.confirmed_by_user_id = reassigned_by_user_id
            appointment.confirmed_at = taiwan_now()
            appointment.alternative_time_slots = None
            
            # Since admin is confirming, it should no longer be auto-assigned
            # This handles the "Immediate Auto-Assigned" visibility principle
            if reassigned_by_user_id is not None:
                appointment.is_auto_assigned = False
                appointment.reassigned_by_user_id = reassigned_by_user_id
                appointment.reassigned_at = taiwan_now()

        # Get clinic from appointment
        clinic_id = appointment.patient.clinic_id
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Handle appointment type change
        appointment_type_id_to_use = appointment.appointment_type_id
        if new_appointment_type_id is not None and new_appointment_type_id != appointment.appointment_type_id:
            # Validate new appointment type exists and belongs to clinic
            new_appointment_type = AppointmentTypeService.get_appointment_type_by_id(
                db, new_appointment_type_id, clinic_id=clinic_id
            )
            if not new_appointment_type:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="預約類型不存在"
                )
            appointment_type_id_to_use = new_appointment_type_id

        # Normalize start times
        # start_time and date are already validated in _get_and_validate_appointment_for_update
        # Type assertion: validated upstream, but type checker needs help
        assert calendar_event.start_time is not None, "start_time validated in _get_and_validate_appointment_for_update"
        current_start_time = datetime.combine(
            calendar_event.date, calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        normalized_start_time = AppointmentService._normalize_start_time(calendar_event, new_start_time)

        # Apply booking constraints if requested (for patients)
        if apply_booking_constraints:
            AppointmentService._validate_booking_constraints(
                clinic=clinic,
                new_start_time=normalized_start_time,
                current_start_time=current_start_time,
                check_max_future_appointments=False,
                check_minimum_cancellation_hours=True
            )

        # Get appointment type for duration (use new type if changed)
        appointment_type = AppointmentTypeService.get_appointment_type_by_id(
            db, appointment_type_id_to_use, clinic_id=clinic_id
        )
        duration_minutes = appointment_type.duration_minutes

        # Store old practitioner ID for notification (before any updates)
        old_practitioner_id = calendar_event.user_id

        # Resolve practitioner ID to use
        # Allow override for clinic edits (when apply_booking_constraints=False)
        allow_override = not apply_booking_constraints
        practitioner_id_to_use = AppointmentService._resolve_practitioner_id(
            db=db,
            new_practitioner_id=new_practitioner_id,
            calendar_event=calendar_event,
            appointment=appointment,
            clinic_id=clinic_id,
            new_start_time=normalized_start_time,
            duration_minutes=duration_minutes,
            allow_auto_assignment=allow_auto_assignment,
            allow_override=allow_override
        )

        # Check if practitioner, time, or appointment type actually changed
        practitioner_actually_changed = (practitioner_id_to_use != calendar_event.user_id)
        time_actually_changed = (normalized_start_time != current_start_time)
        appointment_type_actually_changed = (appointment_type_id_to_use != appointment.appointment_type_id)

        # Validate that practitioner offers the appointment type (if appointment type changed or practitioner changed)
        if appointment_type_actually_changed or practitioner_actually_changed:
            if not AvailabilityService.validate_practitioner_offers_appointment_type(
                db, practitioner_id_to_use, appointment_type_id_to_use, clinic_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="此治療師不提供此預約類型"
                )

        # Validate conflicts only if time, practitioner, or appointment type is actually being changed
        if practitioner_actually_changed or time_actually_changed or appointment_type_actually_changed:
            is_valid, error_message, _ = AppointmentService.check_appointment_edit_conflicts(
                db, appointment_id, practitioner_id_to_use, normalized_start_time,
                appointment_type_id_to_use, clinic_id, allow_override=allow_override
            )

            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=error_message or "調整預約時發生衝突"
                )

        # practitioner_id_to_use is guaranteed to be int from _resolve_practitioner_id
        
        # Determine if auto-assignment was requested (for tracking)
        is_auto_assign_requested = (allow_auto_assignment and new_practitioner_id == -1)

        # Determine notification requirements using centralized logic
        # Calculate new start time for notification check (use normalized time if changed, otherwise current)
        new_start_time_for_notification = normalized_start_time if time_actually_changed else current_start_time
        
        notification_requirements = AppointmentService.get_notification_requirements(
            old_appointment=appointment,
            new_practitioner_id=practitioner_id_to_use,
            new_start_time=new_start_time_for_notification,
            originally_auto_assigned=originally_auto_assigned,
            time_actually_changed=time_actually_changed
        )
        should_send_patient_notification = notification_requirements["will_send_notification"]
        
        # Force notification for time confirmation (approval of multi-slot)
        if is_resolving_time_confirmation:
            should_send_patient_notification = True
        
        # Update appointment using shared core method
        # Allow override (skip availability interval checks) for clinic edits (when apply_booking_constraints=False)
        AppointmentService._update_appointment_core(
            db=db,
            appointment=appointment,
            calendar_event=calendar_event,
            clinic=clinic,
            clinic_id=clinic_id,
            practitioner_id_to_use=practitioner_id_to_use,
            new_start_time=normalized_start_time if time_actually_changed else None,
            new_notes=new_notes,
            new_clinic_notes=new_clinic_notes,
            duration_minutes=duration_minutes,
            old_practitioner_id=old_practitioner_id,
            old_start_time=current_start_time,
            old_is_auto_assigned=old_is_auto_assigned,
            is_auto_assign=is_auto_assign_requested,
            # Preserve reassigned_by_user_id as-is to determine if this is clinic-triggered
            # The notification logic will check reassigned_by_user_id and apply the exception rule
            # (clinic confirms/changes auto-assignment without time change = no notification)
            reassigned_by_user_id=reassigned_by_user_id,  # Preserve as-is (None for patient, user_id for clinic)
            send_patient_notification=should_send_patient_notification,
            notification_note=notification_note if should_send_patient_notification else None,
            time_actually_changed=time_actually_changed,  # Pass pre-calculated value to avoid recalculation
            originally_auto_assigned=originally_auto_assigned,  # Pass for special handling
            new_appointment_type_id=appointment_type_id_to_use if appointment_type_actually_changed else None,
            allow_override=not apply_booking_constraints,  # Allow override for clinic edits
            is_time_confirmation=is_resolving_time_confirmation
        )

        # Handle multi-slot appointment updates
        if allow_multiple_time_slot_selection and selected_time_slots and len(selected_time_slots) > 1:
            # Update to multi-slot appointment - patient is re-selecting slots
            appointment.pending_time_confirmation = True
            appointment.alternative_time_slots = sorted(selected_time_slots)
        elif allow_multiple_time_slot_selection and selected_time_slots and len(selected_time_slots) == 1:
            # Single slot selected for multi-slot appointment type - still keep as multi-slot but with one alternative
            appointment.pending_time_confirmation = True
            appointment.alternative_time_slots = sorted(selected_time_slots)

        # Determine which resources to allocate
        # If selected_resource_ids is None (not provided in request), we'll use existing ones if we need to re-allocate
        resource_ids_to_allocate = selected_resource_ids
        
        # Check if resources changed by comparing current allocations with selected_resource_ids
        resources_changed = False
        
        # We only consider resources "changed" if the frontend explicitly sent a new list (even if empty)
        if selected_resource_ids is not None:
            # Get current resource allocations
            current_allocations = db.query(AppointmentResourceAllocation).filter(
                AppointmentResourceAllocation.appointment_id == appointment_id
            ).all()
            current_resource_ids = sorted([alloc.resource_id for alloc in current_allocations])
            new_resource_ids = sorted(selected_resource_ids)
            
            # Check if resources actually changed
            resources_changed = current_resource_ids != new_resource_ids
        
        # Re-allocate resources if time, appointment type, or resources changed
        if time_actually_changed or appointment_type_actually_changed or resources_changed:
            
            # If we are re-allocating but NO new selection was provided (resource_ids_to_allocate is None):
            # 1. Admin Mode (apply_booking_constraints=False): Fetch existing IDs to preserve them.
            #    This triggers "Manual Mode" in allocate_resources, allowing overrides/conflicts if needed.
            # 2. Patient Mode (apply_booking_constraints=True): Leave as None.
            #    This triggers "Auto-Allocation Mode" in allocate_resources, which strictly enforces availability
            #    and finds *any* available resource to prevent double-booking.
            if resource_ids_to_allocate is None and not apply_booking_constraints:
                current_allocations = db.query(AppointmentResourceAllocation).filter(
                    AppointmentResourceAllocation.appointment_id == appointment_id
                ).all()
                resource_ids_to_allocate = [alloc.resource_id for alloc in current_allocations]

            # Delete old allocations
            db.query(AppointmentResourceAllocation).filter(
                AppointmentResourceAllocation.appointment_id == appointment_id
            ).delete()
            # Flush to ensure deletions are visible to subsequent queries
            db.flush()
            
            # Calculate new end time
            new_end_time = normalized_start_time + timedelta(minutes=duration_minutes)
            
            # Allocate new resources
            ResourceService.allocate_resources(
                db=db,
                appointment_id=appointment_id,
                appointment_type_id=appointment_type_id_to_use,
                start_time=normalized_start_time,
                end_time=new_end_time,
                clinic_id=clinic_id,
                selected_resource_ids=resource_ids_to_allocate,
                exclude_calendar_event_id=appointment_id
            )
            # Flush to ensure new allocations are visible to subsequent queries
            db.flush()

        logger.info(f"Updated appointment {appointment_id}")

        return {
            'success': True,
            'appointment_id': appointment_id,
            'message': success_message
        }
