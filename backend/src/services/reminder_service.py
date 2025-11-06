"""
Appointment reminder service.

This module handles sending automated reminders to patients before their appointments.
Reminders are sent via LINE messaging and scheduled using APScheduler.
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from core.constants import (
    REMINDER_WINDOW_SIZE_MINUTES,
    REMINDER_SCHEDULER_MAX_INSTANCES,
    REMINDER_CATCHUP_WINDOW_HOURS
)
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, ensure_taiwan, format_datetime, TAIWAN_TZ

logger = logging.getLogger(__name__)


class ReminderService:
    """
    Service for managing appointment reminders.

    This service schedules and sends automated reminders to patients
    before their appointments via LINE messaging.
    """

    def __init__(self, db: Session):
        """
        Initialize the reminder service.

        Args:
            db: Database session for querying appointments
        """
        self.db = db
        # Configure scheduler to use Taiwan timezone to ensure correct timing
        # This is critical for ensuring reminders are sent at the correct time
        # regardless of the server's timezone
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False

    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for sending reminders.

        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Reminder scheduler is already started")
            return

        # Schedule reminder checks to run every hour
        self.scheduler.add_job(  # type: ignore
            self._send_pending_reminders,
            CronTrigger(hour="*"),  # Run every hour
            id="send_reminders",
            name="Send appointment reminders",
            max_instances=REMINDER_SCHEDULER_MAX_INSTANCES,  # Prevent overlapping runs
            replace_existing=True
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Appointment reminder scheduler started")
        
        # Run catch-up logic on startup to handle missed reminders during downtime
        # and handle reminder_hours_before setting changes
        await self._catch_up_missed_reminders()

    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.

        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Appointment reminder scheduler stopped")

    async def _send_pending_reminders(self) -> None:
        """
        Check for and send pending appointment reminders.

        This method is called by the scheduler every hour to check for
        appointments that need reminders sent.
        """
        try:
            logger.info("Checking for appointments needing reminders...")

            # Get all clinics and their reminder configurations
            clinics = self.db.query(Clinic).all()

            total_appointments_found = 0
            total_sent = 0

            for clinic in clinics:
                # Calculate reminder window for this clinic using Taiwan time
                # Use ±REMINDER_WINDOW_SIZE_MINUTES to ensure overlap between hourly runs
                # This prevents missed reminders at window boundaries:
                # - Run at 2:00 PM checks (reminder_time - window_size) to (reminder_time + window_size)
                # - Run at 3:00 PM checks (reminder_time + 25min) to (reminder_time + 95min)
                # - Overlap ensures no appointments are missed
                current_time = taiwan_now()
                reminder_time = current_time + timedelta(hours=clinic.reminder_hours_before)
                reminder_window_start = reminder_time - timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES)
                reminder_window_end = reminder_time + timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES)

                # Get confirmed appointments for this clinic in the reminder window
                appointments_needing_reminders = self._get_appointments_needing_reminders(
                    clinic.id, reminder_window_start, reminder_window_end
                )

                if appointments_needing_reminders:
                    logger.info(f"Found {len(appointments_needing_reminders)} appointment(s) for clinic {clinic.id} needing reminders")

                    # Send reminders for each appointment
                    for appointment in appointments_needing_reminders:
                        if await self._send_reminder_for_appointment(appointment):
                            total_sent += 1

                    total_appointments_found += len(appointments_needing_reminders)

            if total_appointments_found == 0:
                logger.info("No appointments found that need reminders")
            else:
                logger.info(f"Successfully sent {total_sent} appointment reminder(s)")

        except Exception as e:
            logger.exception(f"Error sending pending reminders: {e}")

    async def _catch_up_missed_reminders(self) -> None:
        """
        Catch up on missed reminders due to server downtime or reminder_hours_before setting changes.
        
        This method:
        1. Handles server downtime recovery: Finds appointments that should have been reminded
           during downtime but weren't
        2. Handles reminder_hours_before setting increases: When the setting increases,
           appointments that should have been reminded with the new setting but weren't
           will be caught up
        
        Only sends reminders for future appointments within the catch-up window to avoid
        sending reminders for past appointments.
        """
        try:
            logger.info("Running catch-up logic for missed reminders...")
            
            current_time = taiwan_now()
            catchup_window_end = current_time + timedelta(hours=REMINDER_CATCHUP_WINDOW_HOURS)
            
            # Get all clinics
            clinics = self.db.query(Clinic).all()
            
            total_caught_up = 0
            
            for clinic in clinics:
                # Calculate catch-up window for this clinic
                # We check for appointments that should have been reminded based on
                # the current reminder_hours_before setting
                reminder_hours = clinic.reminder_hours_before
                
                # Find appointments that:
                # 1. Are confirmed and haven't received reminders yet
                # 2. Are in the future (not past)
                # 3. Are within the catch-up window (next 48 hours)
                # 4. Should have been reminded based on current reminder_hours_before setting
                #
                # Optimize query by filtering in SQL:
                # - appointment_time > current_time (future appointments)
                # - appointment_time <= catchup_window_end (within catch-up window)
                # - appointment_time <= current_time + reminder_hours_before (should have been reminded)
                
                # Calculate bounds for SQL filtering
                # Upper bound: min(catchup_window_end, current_time + reminder_hours_before)
                upper_bound = min(catchup_window_end, current_time + timedelta(hours=reminder_hours))
                lower_bound = current_time
                
                # Convert bounds to date/time for SQL filtering
                lower_bound_date = lower_bound.date()
                lower_bound_time = lower_bound.time()
                upper_bound_date = upper_bound.date()
                upper_bound_time = upper_bound.time()
                
                # Build SQL query with date/time filtering
                # Filter by date range first, then by time for boundary dates
                query = self.db.query(Appointment).join(CalendarEvent).join(
                    Appointment.patient
                ).filter(
                    Appointment.status == "confirmed",
                    Appointment.patient.has(clinic_id=clinic.id),
                    Appointment.reminder_sent_at.is_(None),  # Haven't received reminders yet
                    # Appointment date is after lower bound date, or on lower bound date with time after lower bound time
                    or_(
                        CalendarEvent.date > lower_bound_date,
                        and_(
                            CalendarEvent.date == lower_bound_date,
                            CalendarEvent.start_time > lower_bound_time
                        )
                    ),
                    # Appointment date is before upper bound date, or on upper bound date with time before/equal to upper bound time
                    or_(
                        CalendarEvent.date < upper_bound_date,
                        and_(
                            CalendarEvent.date == upper_bound_date,
                            CalendarEvent.start_time <= upper_bound_time
                        )
                    )
                )
                
                # Execute query and get appointments
                appointments_needing_catchup = query.all()
                
                if appointments_needing_catchup:
                    logger.info(
                        f"Found {len(appointments_needing_catchup)} appointment(s) for clinic {clinic.id} "
                        f"needing catch-up reminders"
                    )
                    
                    # Send catch-up reminders
                    for appointment in appointments_needing_catchup:
                        # Calculate ideal reminder time for logging
                        appointment_datetime = ensure_taiwan(datetime.combine(
                            appointment.calendar_event.date,
                            appointment.calendar_event.start_time
                        ))
                        ideal_reminder_time = appointment_datetime - timedelta(hours=reminder_hours) if appointment_datetime else None
                        
                        if await self._send_reminder_for_appointment(appointment):
                            total_caught_up += 1
                            if ideal_reminder_time:
                                logger.info(
                                    f"Sent catch-up reminder for appointment {appointment.calendar_event_id} "
                                    f"(should have been reminded at {ideal_reminder_time})"
                                )
                            else:
                                logger.info(
                                    f"Sent catch-up reminder for appointment {appointment.calendar_event_id}"
                                )
            
            if total_caught_up > 0:
                logger.info(f"Successfully sent {total_caught_up} catch-up reminder(s)")
            else:
                logger.info("No appointments found that need catch-up reminders")
                
        except Exception as e:
            logger.exception(f"Error in catch-up logic for missed reminders: {e}")

    def _get_appointments_needing_reminders(
        self,
        clinic_id: int,
        window_start: datetime,
        window_end: datetime
    ) -> List[Appointment]:
        """
        Get appointments that need reminders sent.

        Args:
            clinic_id: ID of the clinic to check appointments for
            window_start: Start of the reminder time window (Taiwan time)
            window_end: End of the reminder time window (Taiwan time)

        Returns:
            List of appointments that need reminders
        """
        # Get all appointments for this clinic that are confirmed and haven't received reminders yet
        appointments = self.db.query(Appointment).join(CalendarEvent).join(
            Appointment.patient
        ).filter(
            Appointment.status == "confirmed",
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.reminder_sent_at.is_(None),  # Only get appointments that haven't received reminders
        ).all()

        # Filter appointments that fall within the reminder window
        appointments_needing_reminders: List[Appointment] = []
        for appointment in appointments:
            # Combine appointment date and time to get full datetime
            appointment_datetime = ensure_taiwan(datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            ))

            # Check if appointment falls within reminder window
            if appointment_datetime and window_start <= appointment_datetime <= window_end:
                appointments_needing_reminders.append(appointment)

        return appointments_needing_reminders

    def _format_reminder_message(
        self,
        appointment_type: str,
        appointment_time: str,
        therapist_name: str,
        clinic: "Clinic"
    ) -> str:
        """
        Format a LINE reminder message with clinic information.

        This method ensures consistent message formatting between actual reminders
        and preview messages.
        """
        # Add clinic information if available
        clinic_info: list[str] = []
        if clinic.effective_display_name:
            clinic_info.append(f"診所：{clinic.effective_display_name}")
        if clinic.address:
            clinic_info.append(f"地址：{clinic.address}")
        if clinic.phone_number:
            clinic_info.append(f"電話：{clinic.phone_number}")

        clinic_info_str = ""
        if clinic_info:
            clinic_info_str = "\n\n" + "\n".join(clinic_info)

        message = (
            f"提醒您，您預約的【{appointment_type}】預計於【{appointment_time}】"
            f"開始，由【{therapist_name}治療師】為您服務。{clinic_info_str}"
            f"\n\n請準時前往診所，期待為您服務！"
        )

        return message

    def generate_reminder_preview(
        self,
        appointment_type: str,
        appointment_time: str,
        therapist_name: str,
        clinic: "Clinic"
    ) -> str:
        """
        Generate a preview of what a LINE reminder message would look like.

        This method can be used by API endpoints to show users what their
        reminder messages will look like before they are sent.

        Args:
            appointment_type: Name of the appointment type
            appointment_time: Formatted appointment time (e.g., "12/25 (三) 1:30 PM")
            therapist_name: Name of the therapist/practitioner
            clinic: Clinic object with display information

        Returns:
            Formatted reminder message string
        """
        return self._format_reminder_message(
            appointment_type=appointment_type,
            appointment_time=appointment_time,
            therapist_name=therapist_name,
            clinic=clinic
        )

    async def _send_reminder_for_appointment(self, appointment: Appointment) -> bool:
        """
        Send a reminder for a specific appointment.

        Args:
            appointment: The appointment to send reminder for

        Returns:
            True if reminder was sent successfully, False otherwise
        """
        try:
            # Get the clinic and LINE service
            clinic = appointment.patient.clinic

            if not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.error(f"Clinic {clinic.id} missing LINE credentials")
                return False

            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )

            # Get patient's LINE user (relationship is on Patient, not LineUser)
            line_user = appointment.patient.line_user

            if not line_user:
                logger.warning(f"No LINE user found for patient {appointment.patient_id}")
                return False

            # Format reminder message
            therapist_name = appointment.calendar_event.user.full_name
            appointment_datetime = ensure_taiwan(datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            ))
            if not appointment_datetime:
                logger.error(f"Invalid appointment datetime for appointment {appointment.calendar_event_id}")
                return False
            appointment_time = format_datetime(appointment_datetime)
            appointment_type = appointment.appointment_type.name

            message = self._format_reminder_message(
                appointment_type=appointment_type,
                appointment_time=appointment_time,
                therapist_name=therapist_name,
                clinic=clinic
            )

            # Send reminder via LINE
            line_service.send_text_message(line_user.line_user_id, message)

            # Update reminder_sent_at after successful send
            # Note: LINE send and database commit are not truly atomic (they're separate systems).
            # If LINE send succeeds but commit fails, the reminder will be sent but reminder_sent_at
            # won't be updated, which could result in a duplicate reminder on the next run.
            # This is a known limitation - it's better to send the reminder than to miss it.
            # In production, consider using database-level locking (SELECT FOR UPDATE) to prevent
            # race conditions when multiple scheduler instances run concurrently.
            appointment.reminder_sent_at = taiwan_now()
            self.db.commit()

            logger.info(f"Sent reminder for appointment {appointment.calendar_event_id} to patient {appointment.patient_id}")
            return True

        except Exception as e:
            # Rollback on any exception to ensure database consistency
            self.db.rollback()
            logger.exception(f"Failed to send reminder for appointment {appointment.calendar_event_id}: {e}")
            return False

    async def send_immediate_reminder(self, appointment_id: int) -> bool:
        """
        Send an immediate reminder for a specific appointment.

        This can be used for testing or manual reminder sending.

        Args:
            appointment_id: ID of the appointment to send reminder for

        Returns:
            True if reminder was sent successfully, False otherwise
        """
        appointment = self.db.query(Appointment).filter_by(id=appointment_id).first()
        if not appointment:
            logger.warning(f"Appointment {appointment_id} not found")
            return False

        return await self._send_reminder_for_appointment(appointment)


# Global reminder service instance
_reminder_service: Optional[ReminderService] = None


def get_reminder_service(db: Session) -> ReminderService:
    """
    Get the global reminder service instance.

    Args:
        db: Database session

    Returns:
        The global reminder service instance
    """
    global _reminder_service
    if _reminder_service is None:
        _reminder_service = ReminderService(db)
    return _reminder_service


async def start_reminder_scheduler(db: Session) -> None:
    """
    Start the global reminder scheduler.

    This should be called during application startup.

    Args:
        db: Database session
    """
    service = get_reminder_service(db)
    await service.start_scheduler()


async def stop_reminder_scheduler() -> None:
    """
    Stop the global reminder scheduler.

    This should be called during application shutdown.
    """
    global _reminder_service
    if _reminder_service:
        await _reminder_service.stop_scheduler()
