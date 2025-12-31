"""
Auto-assignment service for making auto-assigned appointments visible.

This module handles automatically making auto-assigned appointments visible
to practitioners when the booking recency limit is reached.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import func, cast, String
from sqlalchemy.sql import sqltypes

from core.database import get_db_context
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from services.notification_service import NotificationService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ

logger = logging.getLogger(__name__)


class AutoAssignmentService:
    """
    Service for automatically making auto-assigned appointments visible
    when booking recency limit is reached.
    """

    def __init__(self):
        """
        Initialize the auto-assignment service.
        
        Note: Database sessions are created fresh for each scheduler run
        to avoid stale session issues. Do not pass a session here.
        """
        # Configure scheduler to use Taiwan timezone to ensure correct timing
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False

    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for auto-assigning appointments.

        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Auto-assignment scheduler is already started")
            return

        # Schedule to run every hour
        self.scheduler.add_job(  # type: ignore
            self._process_auto_assigned_appointments,
            CronTrigger(hour="*"),  # Every hour
            id="auto_assign_appointments",
            name="Auto-assign appointments at recency limit",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Auto-assignment scheduler started")
        
        # Run immediately on startup to catch up on any missed appointments
        await self._process_auto_assigned_appointments()

    async def stop_scheduler(self) -> None:
        """Stop the auto-assignment scheduler."""
        if not self._is_started:
            return
        
        self.scheduler.shutdown(wait=True)
        self._is_started = False
        logger.info("Auto-assignment scheduler stopped")

    async def _process_auto_assigned_appointments(self) -> None:
        """
        Check and process auto-assigned appointments that have reached
        the booking recency limit.
        
        This method is called by the scheduler every hour to check for
        appointments that need to be made visible to practitioners.
        """
        # Use fresh database session for each scheduler run
        with get_db_context() as db:
            try:
                logger.info("Checking for auto-assigned appointments at recency limit...")

                # Get all clinics
                clinics = db.query(Clinic).filter(Clinic.is_active == True).all()

                total_processed = 0
                total_errors = 0

                for clinic in clinics:
                    try:
                        # Get booking restriction settings
                        settings = clinic.get_validated_settings()
                        booking_settings = settings.booking_restriction_settings
                        booking_restriction_type = booking_settings.booking_restriction_type
                        
                        # All datetime operations use Taiwan timezone
                        now = taiwan_now()
                        
                        # Calculate cutoff based on restriction type
                        if booking_restriction_type == "deadline_time_day_before":
                            # For deadline mode, we need to check each appointment individually
                            # because the deadline is relative to each appointment's date
                            # Get all auto-assigned appointments first, then filter by deadline logic
                            appointments_query = db.query(Appointment).join(
                                CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
                            ).filter(
                                Appointment.is_auto_assigned == True,
                                Appointment.status == 'confirmed',
                                CalendarEvent.clinic_id == clinic.id,
                                CalendarEvent.start_time.isnot(None)
                            )
                            appointments = appointments_query.all()
                            
                            # Filter appointments based on deadline logic
                            deadline_time_str = booking_settings.deadline_time_day_before or "08:00"
                            deadline_on_same_day = booking_settings.deadline_on_same_day
                            
                            from utils.datetime_utils import parse_deadline_time_string
                            deadline_time_obj = parse_deadline_time_string(deadline_time_str, default_hour=8, default_minute=0)
                            
                            filtered_appointments: List[Appointment] = []
                            for appointment in appointments:
                                appointment_datetime = datetime.combine(
                                    appointment.calendar_event.date,
                                    appointment.calendar_event.start_time
                                ).replace(tzinfo=TAIWAN_TZ)
                                
                                # Get appointment date (day X)
                                appointment_date = appointment_datetime.date()
                                
                                # Determine deadline date based on deadline_on_same_day setting
                                if deadline_on_same_day:
                                    # Deadline is on the same day as appointment (date X)
                                    deadline_date = appointment_date
                                else:
                                    # Deadline is on the day before (date X-1)
                                    deadline_date = appointment_date - timedelta(days=1)
                                
                                deadline_datetime = datetime.combine(deadline_date, deadline_time_obj).replace(tzinfo=TAIWAN_TZ)
                                
                                # Make visible when current time >= deadline
                                if now >= deadline_datetime:
                                    filtered_appointments.append(appointment)
                            
                            appointments = filtered_appointments
                        else:
                            # Default: minimum_hours_required mode
                            minimum_hours = booking_settings.minimum_booking_hours_ahead
                            
                            # Calculate cutoff datetime (not just date)
                            cutoff_datetime = now + timedelta(hours=minimum_hours)
                            
                            # Convert to timezone-naive for PostgreSQL comparison
                            # CalendarEvent stores date and time as separate fields (timezone-naive)
                            # We need to compare timezone-naive timestamps
                            cutoff_datetime_naive = cutoff_datetime.replace(tzinfo=None)
                            
                            # Find appointments that need to be made visible
                            # Use proper datetime comparison instead of just date
                            # PostgreSQL: combine date and time by casting to timestamp
                            # Note: CalendarEvent.date and start_time are stored as timezone-naive
                            # (they represent Taiwan local time without timezone info)
                            appointments = db.query(Appointment).join(
                                CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
                            ).filter(
                                Appointment.is_auto_assigned == True,
                                Appointment.status == 'confirmed',
                                CalendarEvent.clinic_id == clinic.id,
                                # Combine date and time for proper datetime comparison
                                # PostgreSQL: cast concatenated date+time string to timestamp (timezone-naive)
                                # Compare with timezone-naive cutoff_datetime
                                cast(
                                    func.concat(
                                        cast(CalendarEvent.date, String),
                                        ' ',
                                        cast(CalendarEvent.start_time, String)
                                    ),
                                    sqltypes.TIMESTAMP
                                ) <= cutoff_datetime_naive
                            ).all()
                        
                        # Batch fetch all practitioners to avoid N+1 queries
                        practitioner_ids = [
                            appt.calendar_event.user_id 
                            for appt in appointments 
                            if appt.calendar_event and appt.calendar_event.user_id
                        ]
                        practitioners_dict = {
                            p.id: p 
                            for p in db.query(User).filter(User.id.in_(practitioner_ids)).all()
                        } if practitioner_ids else {}
                        
                        # Process each appointment with error handling
                        clinic_processed = 0
                        clinic_errors = 0
                        
                        for appointment in appointments:
                            try:
                                # Double-check timing (defensive programming)
                                appointment_datetime = datetime.combine(
                                    appointment.calendar_event.date,
                                    appointment.calendar_event.start_time
                                ).replace(tzinfo=TAIWAN_TZ)
                                
                                # For minimum_hours_required mode, verify hours_until
                                if booking_restriction_type != "deadline_time_day_before":
                                    hours_until = (appointment_datetime - now).total_seconds() / 3600
                                    minimum_hours = booking_settings.minimum_booking_hours_ahead
                                    
                                    # Make visible when appointment is within or past the recency limit
                                    if hours_until > minimum_hours:
                                        continue  # Skip if not yet within limit
                                # For deadline_time_day_before mode, timing already verified above
                                
                                # Make appointment visible
                                    # Get practitioner from batch-fetched dict
                                    practitioner = practitioners_dict.get(
                                        appointment.calendar_event.user_id
                                    ) if appointment.calendar_event else None
                                    
                                    # Check if practitioner is active before making appointment visible
                                    # If practitioner is inactive, skip (appointment remains hidden)
                                    if not practitioner:
                                        logger.warning(
                                            f"Practitioner {appointment.calendar_event.user_id if appointment.calendar_event else 'unknown'} "
                                            f"not found for appointment {appointment.calendar_event_id}, skipping"
                                        )
                                        clinic_errors += 1
                                        continue
                                    
                                    # Check if practitioner association is active
                                    association = db.query(UserClinicAssociation).filter(
                                        UserClinicAssociation.user_id == practitioner.id,
                                        UserClinicAssociation.clinic_id == clinic.id,
                                        UserClinicAssociation.is_active == True
                                    ).first()
                                    
                                    if not association:
                                        logger.warning(
                                            f"Practitioner {practitioner.id} is not active in clinic {clinic.id} "
                                            f"for appointment {appointment.calendar_event_id}, skipping"
                                        )
                                        clinic_errors += 1
                                        continue
                                    
                                    # Make appointment visible
                                    appointment.is_auto_assigned = False
                                    
                                    # Commit appointment visibility change first
                                    db.commit()
                                    
                                    # Send unified notification to practitioner and admins (with deduplication)
                                    # Use the SAME notification format as patient booking or admin reassignment
                                    if practitioner:
                                        try:
                                            NotificationService.send_unified_appointment_notification(
                                                db, appointment, clinic, practitioner,
                                                include_practitioner=True, include_admins=True
                                            )
                                            # No custom notes, no mention of auto-assignment
                                            # Practitioner receives standard notification as if patient booked directly
                                        except Exception as notify_error:
                                            # Log notification failure but don't fail the whole process
                                            # Appointment is already visible, so continue
                                            logger.error(
                                                f"Failed to send notification for appointment "
                                                f"{appointment.calendar_event_id}: {notify_error}"
                                            )
                                    
                                    clinic_processed += 1
                                    total_processed += 1
                                    logger.info(
                                        f"Auto-assigned appointment {appointment.calendar_event_id} "
                                        f"made visible to practitioner {practitioner.id if practitioner else 'unknown'}"
                                    )
                                else:
                                    # Appointment not yet at recency limit, skip
                                    continue
                                    
                            except Exception as e:
                                # Log error but continue processing other appointments
                                clinic_errors += 1
                                total_errors += 1
                                logger.error(
                                    f"Failed to process auto-assigned appointment "
                                    f"{appointment.calendar_event_id}: {e}",
                                    exc_info=True
                                )
                                db.rollback()  # Rollback this appointment's changes
                                continue  # Process next appointment
                        
                        # Log summary for this clinic
                        if clinic_processed > 0 or clinic_errors > 0:
                            logger.info(
                                f"Auto-assignment job for clinic {clinic.id}: "
                                f"{clinic_processed} appointments made visible, {clinic_errors} errors"
                            )
                            
                    except Exception as e:
                        # Log clinic-level error but continue with next clinic
                        logger.error(
                            f"Failed to process clinic {clinic.id} in auto-assignment job: {e}",
                            exc_info=True
                        )
                        continue
                
                # Log overall summary
                if total_processed > 0 or total_errors > 0:
                    logger.info(
                        f"Auto-assignment job completed: "
                        f"{total_processed} appointments made visible, {total_errors} errors"
                    )
                else:
                    logger.info("No auto-assigned appointments found at recency limit")

            except Exception as e:
                logger.exception(f"Error in auto-assignment job: {e}")


# Global auto-assignment service instance
_auto_assignment_service: Optional[AutoAssignmentService] = None


def get_auto_assignment_service() -> AutoAssignmentService:
    """
    Get the global auto-assignment service instance.
    
    Returns:
        AutoAssignmentService instance
    """
    global _auto_assignment_service
    if _auto_assignment_service is None:
        _auto_assignment_service = AutoAssignmentService()
    return _auto_assignment_service


async def start_auto_assignment_scheduler() -> None:
    """
    Start the global auto-assignment scheduler.

    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_auto_assignment_service()
    await service.start_scheduler()


async def stop_auto_assignment_scheduler() -> None:
    """
    Stop the global auto-assignment scheduler.

    This should be called during application shutdown.
    """
    service = get_auto_assignment_service()
    await service.stop_scheduler()

