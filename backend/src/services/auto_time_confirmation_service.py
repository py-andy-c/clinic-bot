"""
Auto-time confirmation service for multiple time slot appointments.

This module handles automatically confirming time slots for multiple time slot appointments
when the booking recency limit is reached.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import func, cast, String
from sqlalchemy.sql import sqltypes

from core.database import get_db_context
from core.constants import MISFIRE_GRACE_TIME_SECONDS
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from services.notification_service import NotificationService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ

logger = logging.getLogger(__name__)


class AutoTimeConfirmationService:
    """
    Service for automatically confirming time slots for multiple time slot appointments
    when booking recency limit is reached.
    """

    def __init__(self):
        """
        Initialize the auto-time confirmation service.

        Note: Database sessions are created fresh for each scheduler run
        to avoid stale session issues. Do not pass a session here.
        """
        # Configure scheduler to use Taiwan timezone to ensure correct timing
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False

    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for auto-time confirmation.

        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Auto-time confirmation scheduler is already started")
            return

        # Schedule to run every hour
        self.scheduler.add_job(  # type: ignore
            self._process_pending_time_confirmations,
            CronTrigger(hour="*", minute=4),  # Every hour at :04
            id="auto_confirm_time_slots",
            name="Auto-confirm time slots at recency limit",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True,
            misfire_grace_time=MISFIRE_GRACE_TIME_SECONDS  # Allow jobs to run up to 15 minutes late
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Auto-time confirmation scheduler started")

        # Run immediately on startup to catch up on any missed confirmations
        await self._process_pending_time_confirmations()

    async def stop_scheduler(self) -> None:
        """Stop the auto-time confirmation scheduler."""
        if not self._is_started:
            return

        self.scheduler.shutdown(wait=True)
        self._is_started = False
        logger.info("Auto-time confirmation scheduler stopped")

    async def _process_pending_time_confirmations(self) -> None:
        """
        Check and process multiple time slot appointments that have reached
        the booking recency limit.
        """
        # Use fresh database session for each scheduler run
        with get_db_context() as db:
            try:
                logger.info("Checking for pending time confirmations at recency limit...")

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
                            appointments_query = db.query(Appointment).join(
                                CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
                            ).filter(
                                Appointment.pending_time_confirmation == True,
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
                                # Calculate appointment datetime safely
                                event_date = appointment.calendar_event.date
                                event_time = appointment.calendar_event.start_time
                                if event_time:
                                    appointment_datetime = datetime.combine(event_date, event_time).replace(tzinfo=TAIWAN_TZ)

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

                            # Calculate cutoff datetime
                            cutoff_datetime = now + timedelta(hours=minimum_hours)

                            # Convert to timezone-naive for PostgreSQL comparison
                            cutoff_datetime_naive = cutoff_datetime.replace(tzinfo=None)

                            # Find appointments that need to be confirmed
                            appointments = db.query(Appointment).join(
                                CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
                            ).filter(
                                Appointment.pending_time_confirmation == True,
                                Appointment.status == 'confirmed',
                                CalendarEvent.clinic_id == clinic.id,
                                # Combine date and time for proper datetime comparison
                                cast(
                                    func.concat(
                                        cast(CalendarEvent.date, String),
                                        ' ',
                                        cast(CalendarEvent.start_time, String)
                                    ),
                                    sqltypes.TIMESTAMP
                                ) <= cutoff_datetime_naive
                            ).all()

                        # Process each appointment with error handling
                        clinic_processed = 0
                        clinic_errors = 0

                        for appointment in appointments:
                            try:
                                # Double-check timing (defensive programming)
                                event_date = appointment.calendar_event.date
                                event_time = appointment.calendar_event.start_time
                                if not event_time:
                                    continue  # Skip if no start time

                                appointment_datetime = datetime.combine(event_date, event_time).replace(tzinfo=TAIWAN_TZ)

                                # For minimum_hours_required mode, verify hours_until
                                if booking_restriction_type != "deadline_time_day_before":
                                    hours_until = (appointment_datetime - now).total_seconds() / 3600
                                    minimum_hours = booking_settings.minimum_booking_hours_ahead

                                    # Confirm when appointment is within or past the recency limit
                                    if hours_until > minimum_hours:
                                        continue  # Skip if not yet within limit

                                # Auto-confirm time slot - confirm the current held slot (which is the earliest)
                                # Since we hold the earliest slot initially, just confirm the current appointment time
                                confirmed_datetime = appointment_datetime

                                # Update calendar event with confirmed time (no change needed since we're confirming the current slot)
                                appointment.calendar_event.start_time = confirmed_datetime.time()
                                appointment.calendar_event.end_time = (confirmed_datetime + timedelta(minutes=appointment.appointment_type.duration_minutes)).time()

                                # Mark appointment as confirmed
                                appointment.pending_time_confirmation = False

                                # Commit the confirmation
                                db.commit()

                                # Send notification to patient about confirmed time
                                try:
                                    # Get practitioner name for notification
                                    practitioner = appointment.calendar_event.user
                                    practitioner_name = practitioner.full_name if practitioner else "醫師"
                                    NotificationService.send_appointment_confirmation(
                                        db, appointment, practitioner_name, clinic, "auto_confirmed"
                                    )
                                    # Note: Practitioner notification happens in the standard flow
                                    # since the appointment now has a confirmed time
                                except Exception as notify_error:
                                    logger.error(
                                        f"Failed to send confirmation notification for appointment "
                                        f"{appointment.calendar_event_id}: {notify_error}"
                                    )

                                clinic_processed += 1
                                total_processed += 1
                                logger.info(
                                    f"Auto-confirmed time slot for appointment {appointment.calendar_event_id} "
                                    f"at {confirmed_datetime}"
                                )

                            except Exception as e:
                                # Log error but continue processing other appointments
                                clinic_errors += 1
                                total_errors += 1
                                logger.error(
                                    f"Failed to auto-confirm appointment {appointment.calendar_event_id}: {e}",
                                    exc_info=True
                                )
                                db.rollback()  # Rollback this appointment's changes
                                continue  # Process next appointment

                        # Log summary for this clinic
                        if clinic_processed > 0 or clinic_errors > 0:
                            logger.info(
                                f"Auto-time confirmation job for clinic {clinic.id}: "
                                f"{clinic_processed} appointments confirmed, {clinic_errors} errors"
                            )

                    except Exception as e:
                        # Log clinic-level error but continue with next clinic
                        logger.error(
                            f"Failed to process clinic {clinic.id} in auto-time confirmation job: {e}",
                            exc_info=True
                        )
                        continue

                # Log overall summary
                if total_processed > 0 or total_errors > 0:
                    logger.info(
                        f"Auto-time confirmation job completed: "
                        f"{total_processed} appointments confirmed, {total_errors} errors"
                    )
                else:
                    logger.info("No pending time confirmations found at recency limit")

            except Exception as e:
                logger.exception(f"Error in auto-time confirmation job: {e}")


# Global auto-time confirmation service instance
_auto_time_confirmation_service: Optional[AutoTimeConfirmationService] = None


def get_auto_time_confirmation_service() -> AutoTimeConfirmationService:
    """
    Get the global auto-time confirmation service instance.

    Returns:
        AutoTimeConfirmationService instance
    """
    global _auto_time_confirmation_service
    if _auto_time_confirmation_service is None:
        _auto_time_confirmation_service = AutoTimeConfirmationService()
    return _auto_time_confirmation_service


async def start_auto_time_confirmation_scheduler() -> None:
    """
    Start the global auto-time confirmation scheduler.

    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_auto_time_confirmation_service()
    await service.start_scheduler()


async def stop_auto_time_confirmation_scheduler() -> None:
    """
    Stop the global auto-time confirmation scheduler.

    This should be called during application shutdown.
    """
    service = get_auto_time_confirmation_service()
    await service.stop_scheduler()