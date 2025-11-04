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
from models.clinic import Clinic
from services.line_service import LINEService

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

            # Get all clinics and their reminder configurations
            clinics = self.db.query(Clinic).all()

            total_appointments_found = 0
            total_sent = 0

            for clinic in clinics:
                # Calculate reminder window for this clinic using Taiwan time
                taiwan_tz = timezone(timedelta(hours=8))
                taiwan_now = datetime.now(taiwan_tz)
                reminder_time = taiwan_now + timedelta(hours=clinic.reminder_hours_before)
                reminder_window_start = reminder_time - timedelta(minutes=30)  # 30-minute window
                reminder_window_end = reminder_time + timedelta(minutes=30)

                # Get confirmed appointments for this clinic in the reminder window
                appointments_needing_reminders = self._get_appointments_needing_reminders(
                    clinic.id, reminder_window_start, reminder_window_end
                )

                if appointments_needing_reminders:
                    logger.info(f"Found {len(appointments_needing_reminders)} appointments for clinic {clinic.id} needing reminders")

                    # Send reminders for each appointment
                    for appointment in appointments_needing_reminders:
                        if await self._send_reminder_for_appointment(appointment):
                            total_sent += 1

                    total_appointments_found += len(appointments_needing_reminders)

            if total_appointments_found == 0:
                logger.info("No appointments found that need reminders")
            else:
                logger.info(f"Successfully sent {total_sent} appointment reminders")

        except Exception as e:
            logger.exception(f"Error sending pending reminders: {e}")

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
        # Get all appointments for this clinic that are confirmed
        appointments = self.db.query(Appointment).join(CalendarEvent).join(
            Appointment.patient
        ).filter(
            Appointment.status == "confirmed",
            Appointment.patient.has(clinic_id=clinic_id),
            # For now, we'll send reminders for all appointments
            # In the future, we could add a flag to track if reminder was sent
        ).all()

        # Filter appointments that fall within the reminder window
        appointments_needing_reminders: List[Appointment] = []
        for appointment in appointments:
            # Combine appointment date and time to get full datetime
            appointment_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            ).replace(tzinfo=window_start.tzinfo)  # Add timezone info

            # Check if appointment falls within reminder window
            if window_start <= appointment_datetime <= window_end:
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
        if clinic.effective_display_name != clinic.name:
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
            appointment_time: Formatted appointment time (e.g., "12/25 (三) 14:30")
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
            appointment_datetime = datetime.combine(appointment.calendar_event.date, appointment.calendar_event.start_time)
            appointment_time = appointment_datetime.strftime("%m/%d (%a) %H:%M")
            appointment_type = appointment.appointment_type.name

            message = self._format_reminder_message(
                appointment_type=appointment_type,
                appointment_time=appointment_time,
                therapist_name=therapist_name,
                clinic=clinic
            )

            # Send reminder via LINE
            line_service.send_text_message(line_user.line_user_id, message)

            logger.info(f"Sent reminder for appointment {appointment.calendar_event_id} to patient {appointment.patient_id}")
            return True

        except Exception as e:
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
