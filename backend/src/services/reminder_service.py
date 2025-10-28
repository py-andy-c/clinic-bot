"""
Appointment reminder service.

This module handles sending automated reminders to patients before their appointments.
Reminders are sent via LINE messaging and scheduled using APScheduler.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy.orm import Session

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.line_user import LineUser
from services.line_service import LINEService
from core.constants import DEFAULT_REMINDER_HOURS_BEFORE

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
        self.scheduler = AsyncIOScheduler()
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
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Appointment reminder scheduler started")

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

            # Find appointments that need reminders (configured hours before, not yet reminded)
            reminder_time = datetime.now(timezone.utc) + timedelta(hours=DEFAULT_REMINDER_HOURS_BEFORE)
            reminder_window_start = reminder_time - timedelta(minutes=30)  # 30-minute window
            reminder_window_end = reminder_time + timedelta(minutes=30)

            # Get confirmed appointments in the reminder window
            appointments_needing_reminders = self._get_appointments_needing_reminders(
                reminder_window_start, reminder_window_end
            )

            if not appointments_needing_reminders:
                logger.info("No appointments found that need reminders")
                return

            logger.info(f"Found {len(appointments_needing_reminders)} appointments needing reminders")

            # Send reminders for each appointment
            sent_count = 0
            for appointment in appointments_needing_reminders:
                if await self._send_reminder_for_appointment(appointment):
                    sent_count += 1

            logger.info(f"Successfully sent {sent_count} appointment reminders")

        except Exception as e:
            logger.error(f"Error sending pending reminders: {e}", exc_info=True)

    def _get_appointments_needing_reminders(
        self,
        window_start: datetime,
        window_end: datetime
    ) -> List[Appointment]:
        """
        Get appointments that need reminders sent.

        Args:
            window_start: Start of the reminder time window
            window_end: End of the reminder time window

        Returns:
            List of appointments that need reminders
        """
        return self.db.query(Appointment).join(CalendarEvent).filter(
            Appointment.status == "confirmed",
            CalendarEvent.start_time >= window_start,
            CalendarEvent.start_time <= window_end,
            # For now, we'll send reminders for all appointments
            # In the future, we could add a flag to track if reminder was sent
        ).all()

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

            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )

            # Get patient's LINE user ID
            line_user = self.db.query(LineUser).filter_by(
                patient_id=appointment.patient_id
            ).first()

            if not line_user:
                logger.warning(f"No LINE user found for patient {appointment.patient_id}")
                return False

            # Format reminder message
            therapist_name = appointment.calendar_event.user.full_name
            appointment_time = appointment.calendar_event.start_time.strftime("%m/%d (%a) %H:%M")
            appointment_type = appointment.appointment_type.name

            message = (
                f"提醒您，您預約的【{appointment_type}】預計於【{appointment_time}】"
                f"開始，由【{therapist_name}治療師】為您服務。"
                f"請準時前往診所，期待為您服務！"
            )

            # Send reminder via LINE
            line_service.send_text_message(line_user.line_user_id, message)

            logger.info(f"Sent reminder for appointment {appointment.calendar_event_id} to patient {appointment.patient_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to send reminder for appointment {appointment.calendar_event_id}: {e}", exc_info=True)
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
