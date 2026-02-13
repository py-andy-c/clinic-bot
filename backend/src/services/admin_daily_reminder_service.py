"""
Admin daily appointment notification service.

This module handles sending daily notifications to clinic admins about
all appointments for all practitioners scheduled for the next day.
Notifications are sent via LINE messaging and scheduled using APScheduler.
Uses next_day_notification_time setting (same as practitioners).
"""

import logging
from datetime import timedelta, date
from typing import List, Optional, Dict

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from core.database import get_db_context
from core.constants import MISFIRE_GRACE_TIME_SECONDS
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.user_clinic_association import UserClinicAssociation
from services.notification_service import NotificationService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from utils.daily_notification_message_builder import DailyNotificationMessageBuilder

logger = logging.getLogger(__name__)

# LINE message length limits
LINE_MESSAGE_MAX_CHARS = 5000
LINE_MESSAGE_TARGET_CHARS = 4500  # Target with buffer


class AdminDailyNotificationService:
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
            CronTrigger(hour="*", minute=2),  # Run every hour at :02
            id="send_admin_daily_notifications",
            name="Send admin daily appointment notifications",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True,
            misfire_grace_time=MISFIRE_GRACE_TIME_SECONDS  # Allow jobs to run up to 15 minutes late
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
                today = current_time.date()
                
                logger.info(
                    f"Checking for clinics needing admin daily reminders at "
                    f"{current_time.strftime('%H:%M')}"
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

                    # Get all clinic admins (auto-enabled, no opt-in check)
                    all_admins = self._get_clinic_admins_with_daily_reminder(db, clinic.id)

                    if not all_admins:
                        logger.debug(f"No admins found for clinic {clinic.id}")
                        continue

                    # Group admins by their notification time and reminder_days_ahead
                    admins_by_config: Dict[tuple[int, int], List[UserClinicAssociation]] = {}
                    for admin_association in all_admins:
                        # Get admin's notification time setting (same as practitioners)
                        try:
                            admin_settings = admin_association.get_validated_settings()
                            notification_time_str = admin_settings.next_day_notification_time
                            reminder_days_ahead = admin_settings.reminder_days_ahead
                        except Exception as e:
                            logger.warning(
                                f"Error getting notification settings for admin {admin_association.user_id} "
                                f"in clinic {clinic.id}: {e}, using defaults (21:00, 1 day)"
                            )
                            notification_time_str = "21:00"
                            reminder_days_ahead = 1

                        # Parse notification time (interpreted as Taiwan time, e.g., "21:00" = 9 PM)
                        try:
                            notification_hour, _ = map(int, notification_time_str.split(':'))
                        except (ValueError, AttributeError):
                            logger.warning(
                                f"Invalid notification time format '{notification_time_str}' for admin "
                                f"{admin_association.user_id} in clinic {clinic.id}, using default 21:00"
                            )
                            notification_hour = 21

                        # Only process admins whose notification time matches current hour
                        if notification_hour != current_hour:
                            continue

                        config_key = (notification_hour, reminder_days_ahead)
                        if config_key not in admins_by_config:
                            admins_by_config[config_key] = []
                        admins_by_config[config_key].append(admin_association)

                    # If no admins match current hour, skip this clinic
                    if not admins_by_config:
                        continue

                    # Process each unique configuration
                    for (notification_hour, reminder_days_ahead), admins in admins_by_config.items():
                        # Get appointments for the date range
                        start_date = today + timedelta(days=1)
                        end_date = today + timedelta(days=reminder_days_ahead)
                        
                        appointments = self._get_appointments_for_date_range(db, clinic.id, start_date, end_date)

                        if not appointments:
                            logger.debug(
                                f"No appointments found for clinic {clinic.id} from {start_date} to {end_date}"
                            )
                            continue

                        # Group appointments by date, then by practitioner
                        from itertools import groupby
                        # Ensure appointments are sorted by date for groupby
                        appointments.sort(key=lambda a: a.calendar_event.date)
                        appointments_by_date = {
                            d: list(g) for d, g in groupby(appointments, key=lambda a: a.calendar_event.date)
                        }

                        # Build message(s) with splitting
                        messages = self._build_clinic_wide_message_for_range(
                            db, appointments_by_date, start_date, end_date, clinic.id
                        )

                        if not messages:
                            logger.warning(f"Failed to build messages for clinic {clinic.id}")
                            continue

                        # Send to all admins who match this configuration
                        labels = {
                            'recipient_type': 'admin',
                            'event_type': 'daily_appointment_reminder',
                            'trigger_source': 'system_triggered',
                            'notification_context': 'daily_reminder'
                        }

                        # Send each message part to all admins
                        for message in messages:
                            success_count = NotificationService._send_notification_to_recipients(  # type: ignore[reportPrivateUsage]
                                db, clinic, message, admins, labels
                            )
                            total_sent += success_count
                            total_skipped += (len(admins) - success_count)

                if total_sent == 0 and total_skipped == 0:
                    logger.debug("No clinics found needing admin daily reminders at this time")
                else:
                    logger.info(f"Successfully sent {total_sent} admin daily reminder(s), skipped {total_skipped}")

            except Exception as e:
                logger.exception(f"Error sending admin daily reminders: {e}")

    def _get_appointments_for_date_range(
        self,
        db: Session,
        clinic_id: int,
        start_date: date,
        end_date: date
    ) -> List[Appointment]:
        """
        Get all confirmed appointments for a date range (from Taiwan timezone perspective).
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            start_date: Start date of the range
            end_date: End date of the range
            
        Returns:
            List of confirmed appointments for the range
        """
        # Query confirmed appointments for the range
        # Filter out appointments with deleted appointment types (edge case #10)
        appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).outerjoin(
            AppointmentType, Appointment.appointment_type_id == AppointmentType.id
        ).filter(
            Appointment.status == 'confirmed',
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date >= start_date,
            CalendarEvent.date <= end_date,
            CalendarEvent.start_time.isnot(None),
            # Filter out appointments with deleted appointment types
            # If appointment_type is None, include it (legacy data)
            # If appointment_type exists, only include if not deleted
            or_(
                Appointment.appointment_type_id.is_(None),
                AppointmentType.is_deleted == False
            )
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()
        
        return appointments

    def _get_next_day_appointments(
        self,
        db: Session,
        clinic_id: int
    ) -> List[Appointment]:
        """
        DEPRECATED: Use _get_appointments_for_date_range instead.
        
        Get all confirmed appointments for the next day (from Taiwan timezone perspective).
        
        "Next day" is defined as: appointments with date = notification_date + 1 day
        (00:00 to 23:59 Taiwan time).
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            List of confirmed appointments for next day
        """
        logger.warning(
            "DEPRECATED: _get_next_day_appointments is deprecated. "
            "Use _get_appointments_for_date_range instead."
        )
        # Get current Taiwan time
        now = taiwan_now()
        # Next day is current date + 1 day
        next_day = (now.date() + timedelta(days=1))
        
        return self._get_appointments_for_date_range(db, clinic_id, next_day, next_day)

    def _get_clinic_admins_with_daily_reminder(
        self,
        db: Session,
        clinic_id: int
    ) -> List[UserClinicAssociation]:
        """
        Get all clinic admins with LINE accounts linked.
        
        Daily reminder is now auto-enabled for all admins (no opt-in check).
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            List of UserClinicAssociation for all admins with LINE accounts
        """
        # Query all admins with LINE accounts (no opt-in check)
        # Daily reminder is auto-enabled for all admins
        admins = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True,
            UserClinicAssociation.roles.contains(['admin']),
            UserClinicAssociation.line_user_id.isnot(None)
        ).all()
        
        return admins

    def _group_appointments_by_practitioner(
        self,
        appointments: List[Appointment]
    ) -> Dict[Optional[int], List[Appointment]]:
        """
        Group appointments by practitioner ID.
        
        Args:
            appointments: List of appointments
            
        Returns:
            Dictionary mapping practitioner_id to list of appointments
        """
        appointments_by_practitioner: Dict[Optional[int], List[Appointment]] = {}
        for appointment in appointments:
            practitioner_id: Optional[int] = appointment.calendar_event.user_id if appointment.calendar_event else None
            if practitioner_id not in appointments_by_practitioner:
                appointments_by_practitioner[practitioner_id] = []
            appointments_by_practitioner[practitioner_id].append(appointment)
        return appointments_by_practitioner

    def _build_clinic_wide_message_for_range(
        self,
        db: Session,
        appointments_by_date: Dict[date, List[Appointment]],
        start_date: date,
        end_date: date,
        clinic_id: int
    ) -> List[str]:
        """
        Build clinic-wide reminder message(s) for a date range with splitting if needed.
        
        Args:
            db: Database session
            appointments_by_date: Dictionary mapping date to list of appointments
            start_date: Start date of the range
            end_date: End date of the range
            clinic_id: ID of the clinic
            
        Returns:
            List of message strings (may be multiple if splitting occurred)
        """
        messages: List[str] = []
        current_message_parts: List[str] = []
        current_length = 0
        
        # Sort dates for consistent ordering
        sorted_dates = sorted(appointments_by_date.keys())
        
        for target_date in sorted_dates:
            date_appointments = appointments_by_date[target_date]
            
            # Group appointments by practitioner for this date
            appointments_by_practitioner = self._group_appointments_by_practitioner(date_appointments)
            
            # Sort practitioners by ID for consistent ordering
            practitioner_ids_only = [
                pid for pid in appointments_by_practitioner.keys() if pid is not None
            ]
            sorted_practitioner_ids: List[int] = sorted(practitioner_ids_only)
            
            all_practitioner_ids: List[Optional[int]] = [pid for pid in sorted_practitioner_ids]
            if None in appointments_by_practitioner:
                all_practitioner_ids.append(None)
            
            # Build date section header
            date_header = DailyNotificationMessageBuilder.build_date_section_header(target_date)
            
            # Check if adding date header exceeds limit
            if current_length + len(date_header) > LINE_MESSAGE_TARGET_CHARS and current_message_parts:
                messages.append("".join(current_message_parts))
                current_message_parts = []
                current_length = 0
                # Add continuation header if we're splitting mid-range
                date_header = DailyNotificationMessageBuilder.build_date_section_header(target_date, is_continuation=True)
            
            current_message_parts.append(date_header)
            current_length += len(date_header)
            
            for practitioner_id in all_practitioner_ids:
                practitioner_appointments = appointments_by_practitioner[practitioner_id]
                
                # Get practitioner name
                if practitioner_id is None:
                    practitioner_name = "不指定"
                else:
                    from utils.practitioner_helpers import get_practitioner_display_name_with_title
                    practitioner_name = get_practitioner_display_name_with_title(
                        db, practitioner_id, clinic_id
                    )
                
                # Build practitioner section
                practitioner_section = DailyNotificationMessageBuilder.build_practitioner_section(
                    practitioner_name, practitioner_appointments, is_clinic_wide=True
                )
                
                appointment_lines: List[str] = []
                for i, appointment in enumerate(practitioner_appointments, 1):
                    appointment_line = DailyNotificationMessageBuilder.build_appointment_line(appointment, i)
                    appointment_lines.append(appointment_line)
                
                practitioner_text = practitioner_section + "".join(appointment_lines)
                
                # Check if adding this practitioner section exceeds limit
                if current_length + len(practitioner_text) > LINE_MESSAGE_TARGET_CHARS and current_message_parts:
                    messages.append("".join(current_message_parts))
                    # Start new message with continuation headers
                    current_message_parts = [
                        DailyNotificationMessageBuilder.build_date_section_header(target_date, is_continuation=True),
                        f"治療師：{practitioner_name} (續上頁)\n",
                        f"共有 {len(practitioner_appointments)} 個預約：\n\n"
                    ]
                    current_length = sum(len(p) for p in current_message_parts)
                    
                    # If the practitioner section itself is still too long, we need to split it further
                    if current_length + len(practitioner_text) > LINE_MESSAGE_TARGET_CHARS:
                        # Split appointment lines
                        for line in appointment_lines:
                            if current_length + len(line) > LINE_MESSAGE_TARGET_CHARS:
                                messages.append("".join(current_message_parts))
                                current_message_parts = [
                                    DailyNotificationMessageBuilder.build_date_section_header(target_date, is_continuation=True),
                                    f"治療師：{practitioner_name} (續上頁)\n",
                                    f"共有 {len(practitioner_appointments)} 個預約：\n\n"
                                ]
                                current_length = sum(len(p) for p in current_message_parts)
                            current_message_parts.append(line)
                            current_length += len(line)
                    else:
                        current_message_parts.append(practitioner_text)
                        current_length += len(practitioner_text)
                else:
                    current_message_parts.append(practitioner_text)
                    current_length += len(practitioner_text)
            
            # Add separator between days
            if target_date != sorted_dates[-1]:
                separator = "--------------------\n\n"
                if current_length + len(separator) < LINE_MESSAGE_TARGET_CHARS:
                    current_message_parts.append(separator)
                    current_length += len(separator)

        # Add final message
        if current_message_parts:
            messages.append("".join(current_message_parts))

        # Add headers to all messages
        total_parts = len(messages)
        for i, msg in enumerate(messages, 1):
            header = DailyNotificationMessageBuilder.build_message_header(
                start_date, end_date,
                is_clinic_wide=True,
                part_number=i if total_parts > 1 else None,
                total_parts=total_parts if total_parts > 1 else None
            )
            messages[i - 1] = header + msg
            
        return messages

    def _build_clinic_wide_message(
        self,
        db: Session,
        appointments_by_practitioner: Dict[Optional[int], List[Appointment]],
        target_date: date,
        clinic_id: int
    ) -> List[str]:
        """
        Build clinic-wide reminder message(s) with splitting if needed.
        (Legacy method for single date)
        """
        appointments_by_date: Dict[date, List[Appointment]] = {target_date: []}
        for appts in appointments_by_practitioner.values():
            appointments_by_date[target_date].extend(appts)
            
        return self._build_clinic_wide_message_for_range(
            db, appointments_by_date, target_date, target_date, clinic_id
        )


# Global service instance
_admin_daily_notification_service: Optional[AdminDailyNotificationService] = None


def get_admin_daily_notification_service() -> AdminDailyNotificationService:
    """
    Get the global admin daily reminder service instance.
    
    Returns:
        The global service instance
    """
    global _admin_daily_notification_service
    if _admin_daily_notification_service is None:
        _admin_daily_notification_service = AdminDailyNotificationService()
    return _admin_daily_notification_service


async def start_admin_daily_notification_scheduler() -> None:
    """
    Start the global admin daily notification scheduler.
    
    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_admin_daily_notification_service()
    await service.start_scheduler()


async def stop_admin_daily_notification_scheduler() -> None:
    """
    Stop the global admin daily notification scheduler.
    
    This should be called during application shutdown.
    """
    global _admin_daily_notification_service
    if _admin_daily_notification_service:
        await _admin_daily_notification_service.stop_scheduler()
