"""
Admin daily appointment reminder service.

This module handles sending daily notifications to clinic admins about
all appointments for all practitioners scheduled for the next day.
Notifications are sent via LINE messaging and scheduled using APScheduler.
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy.orm import Session, joinedload

from core.database import get_db_context
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.user_clinic_association import UserClinicAssociation
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, format_datetime, TAIWAN_TZ

logger = logging.getLogger(__name__)


class AdminDailyReminderService:
    """
    Service for managing daily notifications to clinic admins about all appointments for the next day.
    
    This service schedules and sends automated notifications to clinic admins
    about all confirmed appointments for all practitioners scheduled for the next day.
    """

    def __init__(self):
        """
        Initialize the admin daily reminder service.
        
        Note: Database sessions are created fresh for each scheduler run
        to avoid stale session issues. Do not pass a session here.
        
        The scheduler is configured with Taiwan timezone (UTC+8) to ensure
        all time comparisons and scheduling are done in Taiwan time.
        """
        # Configure scheduler to use Taiwan timezone (UTC+8) to ensure correct timing
        # All notification times are interpreted as Taiwan time
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False

    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for sending admin daily reminders.
        
        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Admin daily reminder scheduler is already started")
            return

        # Schedule notification checks to run every hour
        # This allows us to check for clinics that have configured
        # different notification times throughout the day
        self.scheduler.add_job(  # type: ignore
            self._send_admin_reminders,
            CronTrigger(hour="*"),  # Run every hour
            id="send_admin_daily_reminders",
            name="Send admin daily appointment reminders",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Admin daily reminder scheduler started")

    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Admin daily reminder scheduler stopped")

    async def _send_admin_reminders(self) -> None:
        """
        Check for and send daily reminders to clinic admins about appointments for the next day.
        
        This method is called by the scheduler every hour to check for
        clinics that should receive reminders at this time.
        
        Uses a fresh database session for each run to avoid stale session issues.
        """
        # Use fresh database session for each scheduler run
        with get_db_context() as db:
            try:
                # Get current time in Taiwan timezone (UTC+8)
                # All time comparisons are done in Taiwan time
                current_time = taiwan_now()
                current_hour = current_time.hour
                
                logger.info(
                    f"Checking for clinics needing admin daily reminders at "
                    f"{current_time.strftime('%H:%M')} for next day appointments"
                )

                # Get all clinics
                clinics = db.query(Clinic).all()

                total_sent = 0
                total_skipped = 0

                for clinic in clinics:
                    # Check if clinic has LINE credentials
                    if not clinic.line_channel_secret or not clinic.line_channel_access_token:
                        logger.debug(f"Clinic {clinic.id} has no LINE credentials, skipping")
                        continue

                    # Get all clinic admins with daily reminder enabled
                    admins = self._get_clinic_admins_with_daily_reminder(db, clinic.id)

                    if not admins:
                        logger.debug(f"No admins with daily reminder enabled found for clinic {clinic.id}")
                        continue

                    # Send reminder to each admin based on their individual setting
                    for admin_association in admins:
                        # Get admin's reminder time setting
                        try:
                            admin_settings = admin_association.get_validated_settings()
                            reminder_time_str = admin_settings.admin_daily_reminder_time
                        except Exception as e:
                            logger.warning(
                                f"Error getting reminder settings for admin {admin_association.user_id} "
                                f"in clinic {clinic.id}: {e}, using default 21:00"
                            )
                            reminder_time_str = "21:00"

                        # Parse reminder time (interpreted as Taiwan time, e.g., "21:00" = 9 PM)
                        try:
                            reminder_hour, _ = map(int, reminder_time_str.split(':'))
                        except (ValueError, AttributeError):
                            logger.warning(
                                f"Invalid reminder time format '{reminder_time_str}' for admin "
                                f"{admin_association.user_id} in clinic {clinic.id}, using default 21:00"
                            )
                            reminder_hour = 21

                        # Check if it's time to send reminder for this admin
                        # Compare current Taiwan time hour with reminder hour (both in Taiwan timezone)
                        # Send if current hour matches reminder hour (within the hour window)
                        if current_hour != reminder_hour:
                            continue
                        
                        logger.debug(
                            f"Admin {admin_association.user_id} reminder time matches: "
                            f"{reminder_hour}:00 (current: {current_hour}:00)"
                        )

                        # Get appointments for next day
                        next_day_appointments = self._get_next_day_appointments(db, clinic.id)

                        if not next_day_appointments:
                            logger.debug(
                                f"No appointments for next day found for clinic {clinic.id}, "
                                f"skipping reminder for admin {admin_association.user_id}"
                            )
                            continue

                        # Send reminder to this admin
                        if await self._send_reminder_for_admin(
                            db, admin_association, clinic, next_day_appointments, current_time
                        ):
                            total_sent += 1
                        else:
                            total_skipped += 1

                if total_sent == 0 and total_skipped == 0:
                    logger.debug("No clinics found needing admin daily reminders at this time")
                else:
                    logger.info(f"Successfully sent {total_sent} admin daily reminder(s), skipped {total_skipped}")

            except Exception as e:
                logger.exception(f"Error sending admin daily reminders: {e}")

    def _get_next_day_appointments(
        self,
        db: Session,
        clinic_id: int
    ) -> List[Appointment]:
        """
        Get all confirmed appointments for the next day (from Taiwan timezone perspective).
        
        "Next day" is defined as: appointments with date = notification_date + 1 day
        (00:00 to 23:59 Taiwan time).
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            List of confirmed appointments for next day
        """
        # Get current Taiwan time
        now = taiwan_now()
        # Next day is current date + 1 day
        next_day = (now.date() + timedelta(days=1))
        
        # Query confirmed appointments for next day
        appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.status == 'confirmed',
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == next_day,
            CalendarEvent.start_time.isnot(None)
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).order_by(CalendarEvent.start_time).all()
        
        return appointments

    def _get_clinic_admins_with_daily_reminder(
        self,
        db: Session,
        clinic_id: int
    ) -> List[UserClinicAssociation]:
        """
        Get all clinic admins who have daily reminder enabled and LINE accounts linked.
        
        Uses direct JSONB query for efficiency, similar to other notification methods.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            List of UserClinicAssociation for admins with daily reminder enabled
        """
        # Use direct JSONB query for efficiency (similar to send_admin_appointment_change_notification)
        admins = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True,
            UserClinicAssociation.roles.contains(['admin']),
            UserClinicAssociation.settings['admin_daily_reminder_enabled'].astext == 'true',
            UserClinicAssociation.line_user_id.isnot(None)
        ).all()
        
        return admins

    async def _send_reminder_for_admin(
        self,
        db: Session,
        association: UserClinicAssociation,
        clinic: Clinic,
        appointments: List[Appointment],
        current_time: datetime
    ) -> bool:
        """
        Send daily reminder to an admin about appointments for the next day.
        
        Args:
            db: Database session
            association: UserClinicAssociation for the admin
            clinic: Clinic object
            appointments: List of appointments for next day
            current_time: Current time in Taiwan timezone
            
        Returns:
            True if reminder was sent successfully, False otherwise
        """
        try:
            admin = association.user

            # Group appointments by practitioner
            appointments_by_practitioner: Dict[Optional[int], List[Appointment]] = {}
            for appointment in appointments:
                practitioner_id: Optional[int] = appointment.calendar_event.user_id if appointment.calendar_event else None
                if practitioner_id not in appointments_by_practitioner:
                    appointments_by_practitioner[practitioner_id] = []
                appointments_by_practitioner[practitioner_id].append(appointment)
            
            # Build message
            next_day = (current_time.date() + timedelta(days=1))
            next_day_formatted = next_day.strftime("%Y/%m/%d")
            
            message = f"📅 明日預約總覽 ({next_day_formatted})\n\n"
            
            total_appointments = len(appointments)
            shown_count = 0
            max_show = 50
            
            # Sort practitioners by ID for consistent ordering
            # Separate None (auto-assigned) from actual practitioner IDs
            practitioner_ids_only = [
                pid for pid in appointments_by_practitioner.keys() if pid is not None
            ]
            sorted_practitioner_ids: List[Optional[int]] = sorted(practitioner_ids_only)  # type: ignore[assignment]
            
            # Handle None practitioner_id separately (auto-assigned) - append at end
            if None in appointments_by_practitioner:
                sorted_practitioner_ids.append(None)
            
            for practitioner_id in sorted_practitioner_ids:
                if shown_count >= max_show:
                    break
                    
                practitioner_appointments = appointments_by_practitioner[practitioner_id]
                
                # Get practitioner name
                if practitioner_id is None:
                    practitioner_name = "不指定"
                else:
                    from utils.practitioner_helpers import get_practitioner_display_name_with_title
                    practitioner_name = get_practitioner_display_name_with_title(
                        db, practitioner_id, clinic.id
                    )
                
                message += f"治療師：{practitioner_name}\n"
                message += f"共有 {len(practitioner_appointments)} 個預約：\n"
                
                # Show appointments for this practitioner (up to max_show total)
                remaining_slots = max_show - shown_count
                appointments_to_show = practitioner_appointments[:remaining_slots]
                
                for i, appointment in enumerate(appointments_to_show, 1):
                    # Get patient name
                    patient_name = appointment.patient.full_name if appointment.patient else "未知病患"
                    
                    # Format appointment time
                    start_datetime = datetime.combine(
                        appointment.calendar_event.date,
                        appointment.calendar_event.start_time
                    )
                    formatted_time = format_datetime(start_datetime)
                    
                    # Get appointment type name
                    appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"
                    
                    message += f"{shown_count + i}. {formatted_time} - {patient_name} - {appointment_type_name}\n"
                
                shown_count += len(appointments_to_show)
                message += "\n"
            
            # If there are more appointments, append summary
            if total_appointments > max_show:
                remaining_count = total_appointments - max_show
                message += f"... 還有 {remaining_count} 個預約"

            # Send notification via LINE with labels for tracking
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            labels = {
                'recipient_type': 'admin',
                'event_type': 'daily_appointment_reminder',
                'trigger_source': 'system_triggered',
                'notification_context': 'daily_reminder'
            }
            # Type safety check: association.line_user_id is filtered to be non-null in _get_clinic_admins_with_daily_reminder,
            # but type system doesn't know this, so we check here for type safety
            if association.line_user_id:
                line_service.send_text_message(
                    association.line_user_id, 
                    message,
                    db=db,
                    clinic_id=clinic.id,
                    labels=labels
                )

            logger.info(
                f"Sent daily reminder to admin {admin.id} "
                f"for {total_appointments} appointment(s) in clinic {clinic.id}"
            )
            return True

        except Exception as e:
            logger.exception(
                f"Failed to send daily reminder to admin {association.user_id}: {e}"
            )
            return False


# Global service instance
_admin_daily_reminder_service: Optional[AdminDailyReminderService] = None


def get_admin_daily_reminder_service() -> AdminDailyReminderService:
    """
    Get the global admin daily reminder service instance.
    
    Returns:
        The global service instance
    """
    global _admin_daily_reminder_service
    if _admin_daily_reminder_service is None:
        _admin_daily_reminder_service = AdminDailyReminderService()
    return _admin_daily_reminder_service


async def start_admin_daily_reminder_scheduler() -> None:
    """
    Start the global admin daily reminder scheduler.
    
    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_admin_daily_reminder_service()
    await service.start_scheduler()


async def stop_admin_daily_reminder_scheduler() -> None:
    """
    Stop the global admin daily reminder scheduler.
    
    This should be called during application shutdown.
    """
    global _admin_daily_reminder_service
    if _admin_daily_reminder_service:
        await _admin_daily_reminder_service.stop_scheduler()

