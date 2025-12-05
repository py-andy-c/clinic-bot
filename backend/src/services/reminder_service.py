"""
Appointment reminder service.

This module handles sending automated reminders to patients before their appointments.
Reminders are sent via LINE messaging and scheduled using APScheduler.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, contains_eager

from core.constants import (
    REMINDER_WINDOW_SIZE_MINUTES,
    REMINDER_SCHEDULER_MAX_INSTANCES
)
from core.database import get_db_context
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.user_clinic_association import UserClinicAssociation
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, ensure_taiwan, format_datetime, TAIWAN_TZ

logger = logging.getLogger(__name__)


class ReminderService:
    """
    Service for managing appointment reminders.

    This service schedules and sends automated reminders to patients
    before their appointments via LINE messaging.
    """

    def __init__(self):
        """
        Initialize the reminder service.
        
        Note: Database sessions are created fresh for each scheduler run
        to avoid stale session issues. Do not pass a session here.
        """
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
        
        # Run reminder check immediately on startup to catch up on missed reminders
        # during downtime and handle reminder_hours_before setting changes
        await self._send_pending_reminders()

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
        appointments that need reminders sent. It also automatically catches up
        on missed reminders during downtime and handles reminder_hours_before setting changes.
        
        Window logic:
        - Start: current_time (checks from now)
        - End: current_time + reminder_hours_before + REMINDER_WINDOW_SIZE_MINUTES
        - This catches:
          * Late reminders: appointments < reminder_hours_before away that should have been reminded earlier
          * On-time reminders: appointments ≈ reminder_hours_before away
          * Early reminders: appointments slightly > reminder_hours_before away (within window)
        
        Uses a fresh database session for each run to avoid stale session issues.
        """
        # Use fresh database session for each scheduler run
        # This prevents stale session issues and ensures proper transaction handling
        with get_db_context() as db:
            try:
                logger.info("Checking for appointments needing reminders...")

                # Get all clinics and their reminder configurations
                clinics = db.query(Clinic).all()

                total_appointments_found = 0
                total_sent = 0

                for clinic in clinics:
                    # Calculate reminder window for this clinic using Taiwan time
                    # Window: current_time to current_time + reminder_hours_before + window_size
                    # This automatically catches up on missed reminders during downtime and
                    # handles reminder_hours_before setting increases
                    current_time = taiwan_now()
                    reminder_window_start = current_time
                    reminder_window_end = current_time + timedelta(
                        hours=clinic.reminder_hours_before,
                        minutes=REMINDER_WINDOW_SIZE_MINUTES
                    )

                    # Get confirmed appointments for this clinic in the reminder window
                    appointments_needing_reminders = self._get_appointments_needing_reminders(
                        db, clinic.id, reminder_window_start, reminder_window_end
                    )

                    if appointments_needing_reminders:
                        logger.info(f"Found {len(appointments_needing_reminders)} appointment(s) for clinic {clinic.id} needing reminders")

                        # Batch load practitioner associations to avoid N+1 queries
                        practitioner_ids = [
                            appt.calendar_event.user_id 
                            for appt in appointments_needing_reminders 
                            if appt.calendar_event and appt.calendar_event.user_id
                        ]
                        
                        # Guard against empty practitioner_ids list to avoid unnecessary query
                        if not practitioner_ids:
                            logger.warning(f"No practitioner IDs found for appointments needing reminders in clinic {clinic.id}")
                            practitioner_associations = []
                        else:
                            practitioner_associations = db.query(UserClinicAssociation).filter(
                                UserClinicAssociation.user_id.in_(practitioner_ids),
                                UserClinicAssociation.clinic_id == clinic.id,
                                UserClinicAssociation.is_active == True
                            ).all()
                        
                        association_lookup = {a.user_id: a for a in practitioner_associations}

                        # Send reminders for each appointment
                        for appointment in appointments_needing_reminders:
                            if await self._send_reminder_for_appointment(db, appointment, association_lookup):
                                total_sent += 1

                        total_appointments_found += len(appointments_needing_reminders)

                if total_appointments_found == 0:
                    logger.info("No appointments found that need reminders")
                else:
                    logger.info(f"Successfully sent {total_sent} appointment reminder(s)")

            except Exception as e:
                logger.exception(f"Error sending pending reminders: {e}")

    def _get_appointments_needing_reminders(
        self,
        db: Session,
        clinic_id: int,
        window_start: datetime,
        window_end: datetime
    ) -> List[Appointment]:
        """
        Get appointments that need reminders sent.

        Args:
            db: Database session
            clinic_id: ID of the clinic to check appointments for
            window_start: Start of the reminder time window (Taiwan time)
            window_end: End of the reminder time window (Taiwan time)

        Returns:
            List of appointments that need reminders
        """
        # Optimize query by filtering in SQL instead of Python
        # Convert window boundaries to date/time for SQL filtering
        window_start_date = window_start.date()
        window_start_time = window_start.time()
        window_end_date = window_end.date()
        window_end_time = window_end.time()
        
        # Build SQL query with date/time filtering
        # Filter by date range first, then by time for boundary dates
        # Optimized: Use CalendarEvent.clinic_id directly instead of joining Patient
        # This avoids an unnecessary join since CalendarEvent already has clinic_id
        # CRITICAL: Filter out auto-assigned appointments (practitioners shouldn't receive reminders for hidden appointments)
        query = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.status == "confirmed",
            Appointment.is_auto_assigned == False,  # Only send reminders for visible appointments
            CalendarEvent.clinic_id == clinic_id,
            Appointment.reminder_sent_at.is_(None),  # Only get appointments that haven't received reminders
            # Appointment date is after window start date, or on window start date with time after/equal to window start time
            or_(
                CalendarEvent.date > window_start_date,
                and_(
                    CalendarEvent.date == window_start_date,
                    CalendarEvent.start_time >= window_start_time
                )
            ),
            # Appointment date is before window end date, or on window end date with time before/equal to window end time
            or_(
                CalendarEvent.date < window_end_date,
                and_(
                    CalendarEvent.date == window_end_date,
                    CalendarEvent.start_time <= window_end_time
                )
            )
        )
        
        # Eagerly load calendar_event to avoid N+1 queries when accessing appt.calendar_event.user_id
        # Since we already joined CalendarEvent, use contains_eager for it
        appointments = query.options(
            contains_eager(Appointment.calendar_event)
        ).all()
        
        return appointments

    def format_reminder_message(
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

    async def _send_reminder_for_appointment(
        self, 
        db: Session, 
        appointment: Appointment, 
        association_lookup: Dict[int, UserClinicAssociation]
    ) -> bool:
        """
        Send a reminder for a specific appointment.

        Args:
            db: Database session
            appointment: The appointment to send reminder for
            association_lookup: Pre-loaded dictionary mapping user_id to UserClinicAssociation

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

            # Format reminder message - get practitioner name from pre-loaded association lookup
            # Show "不指定" if appointment is auto-assigned
            if appointment.is_auto_assigned:
                therapist_name = "不指定"
            else:
                user = appointment.calendar_event.user
                association = association_lookup.get(user.id)
                if not association:
                    logger.warning(
                        f"No active association found for user {user.id} in clinic {clinic.id}. "
                        f"Using email as fallback."
                    )
                therapist_name = association.full_name if association else user.email
            appointment_datetime = ensure_taiwan(datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            ))
            if not appointment_datetime:
                logger.error(f"Invalid appointment datetime for appointment {appointment.calendar_event_id}")
                return False
            appointment_time = format_datetime(appointment_datetime)
            appointment_type = appointment.appointment_type.name

            message = self.format_reminder_message(
                appointment_type=appointment_type,
                appointment_time=appointment_time,
                therapist_name=therapist_name,
                clinic=clinic
            )

            # Send reminder via LINE with labels for tracking
            labels = {
                'recipient_type': 'patient',
                'event_type': 'appointment_reminder',
                'trigger_source': 'system_triggered',
                'appointment_context': 'existing_appointment'
            }
            line_service.send_text_message(
                line_user.line_user_id, 
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )

            # Update reminder_sent_at after successful send
            # Note: LINE send and database commit are not truly atomic (they're separate systems).
            # If LINE send succeeds but commit fails, the reminder will be sent but reminder_sent_at
            # won't be updated, which could result in a duplicate reminder on the next run.
            # This is a known limitation - it's better to send the reminder than to miss it.
            # In production, consider using database-level locking (SELECT FOR UPDATE) to prevent
            # race conditions when multiple scheduler instances run concurrently.
            appointment.reminder_sent_at = taiwan_now()
            db.commit()

            logger.info(f"Sent reminder for appointment {appointment.calendar_event_id} to patient {appointment.patient_id}")
            return True

        except Exception as e:
            # Rollback on any exception to ensure database consistency
            db.rollback()
            logger.exception(f"Failed to send reminder for appointment {appointment.calendar_event_id}: {e}")
            return False

# Global reminder service instance
_reminder_service: Optional[ReminderService] = None


def get_reminder_service() -> ReminderService:
    """
    Get the global reminder service instance.

    Returns:
        The global reminder service instance
    """
    global _reminder_service
    if _reminder_service is None:
        _reminder_service = ReminderService()
    return _reminder_service


async def start_reminder_scheduler() -> None:
    """
    Start the global reminder scheduler.

    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_reminder_service()
    await service.start_scheduler()


async def stop_reminder_scheduler() -> None:
    """
    Stop the global reminder scheduler.

    This should be called during application shutdown.
    """
    global _reminder_service
    if _reminder_service:
        await _reminder_service.stop_scheduler()
