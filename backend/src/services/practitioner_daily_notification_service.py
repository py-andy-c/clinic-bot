"""
Practitioner daily notification service.

This module handles sending daily notifications to practitioners about their
appointments for the next day. Notifications are sent via LINE messaging
and scheduled using APScheduler.
"""

import logging
from datetime import date, timedelta
from typing import List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from core.database import get_db_context
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from models.user_clinic_association import UserClinicAssociation
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from utils.daily_notification_message_builder import DailyNotificationMessageBuilder
from core.constants import MISFIRE_GRACE_TIME_SECONDS

logger = logging.getLogger(__name__)


class PractitionerDailyNotificationService:
    """
    Service for managing daily appointment notifications for practitioners.
    
    Uses hourly check (real-time aggregation) to send notifications to practitioners
    about their appointments for the next day. Notifications are sent via LINE messaging
    and scheduled using APScheduler.
    """

    def __init__(self):
        """
        Initialize the daily notification service.
        
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
        Start the background scheduler for sending practitioner daily notifications.
        
        This should be called during application startup.
        Note: Database sessions are created fresh for each scheduler run.
        """
        if self._is_started:
            logger.warning("Practitioner daily notification scheduler is already started")
            return

        # Schedule notification checks to run every hour
        # This allows us to check for practitioners who have configured
        # different notification times throughout the day
        self.scheduler.add_job(  # type: ignore
            self._send_daily_notifications,
            CronTrigger(hour="*", minute=1),  # Run every hour at :01
            id="send_practitioner_daily_notifications",
            name="Send practitioner daily appointment notifications",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True,
            misfire_grace_time=MISFIRE_GRACE_TIME_SECONDS  # Allow jobs to run up to 15 minutes late
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Practitioner daily notification scheduler started")

    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Practitioner daily notification scheduler stopped")

    async def _send_daily_notifications(self) -> None:
        """
        Check for and send daily appointment notifications to practitioners.
        
        This method is called by the scheduler every hour to check for
        practitioners who should receive notifications at this time.
        Uses real-time aggregation (hourly check) instead of pre-scheduling.
        
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
                    f"Checking for practitioners needing daily notifications at "
                    f"{current_time.strftime('%H:%M')}"
                )

                # Get all active practitioner associations
                # We need to check each practitioner's notification time setting
                associations = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.is_active == True
                ).options(
                    joinedload(UserClinicAssociation.user),
                    joinedload(UserClinicAssociation.clinic)
                ).all()

                total_sent = 0
                total_skipped = 0

                for association in associations:
                    # Check if user is a practitioner
                    if 'practitioner' not in (association.roles or []):
                        continue
                    
                    # Deduplication: Skip if practitioner is also an admin
                    # Admin-practitioners receive clinic-wide admin notification instead of personal practitioner reminder
                    # This prevents duplicate notifications (clinic-wide + personal)
                    if 'admin' in (association.roles or []):
                        logger.debug(
                            f"Practitioner {association.user_id} is also an admin in clinic {association.clinic_id}, "
                            f"skipping personal practitioner reminder (will receive clinic-wide admin reminder instead)"
                        )
                        continue

                    # Parse notification time (interpreted as Taiwan time, e.g., "21:00" = 9 PM)
                    try:
                        settings = association.get_validated_settings()
                        notification_time_str = settings.next_day_notification_time
                        reminder_days_ahead = settings.reminder_days_ahead
                    except Exception as e:
                        logger.warning(f"Error getting settings for association {association.id}: {e}, using defaults (21:00, 1 day)")
                        notification_time_str = "21:00"
                        reminder_days_ahead = 1

                    # Parse notification hour
                    try:
                        notification_hour, _ = map(int, notification_time_str.split(':'))
                    except (ValueError, AttributeError):
                        logger.warning(
                            f"Invalid notification time format '{notification_time_str}' for association {association.id}, "
                            f"using default 21:00"
                        )
                        notification_hour = 21

                    # Check if it's time to send notification for this practitioner
                    # Compare current Taiwan time hour with notification hour (both in Taiwan timezone)
                    # Send if current hour matches notification hour (within the hour window)
                    if current_hour != notification_hour:
                        continue
                    
                    logger.debug(
                        f"Practitioner {association.user_id} notification time matches: "
                        f"{notification_hour}:00 (current: {current_hour}:00)"
                    )

                    # Check if practitioner has LINE account linked for this clinic
                    if not association.line_user_id:
                        logger.debug(f"Practitioner {association.user_id} has no LINE account linked for clinic {association.clinic_id}, skipping")
                        total_skipped += 1
                        continue

                    # Check if clinic has LINE credentials
                    if not association.clinic.line_channel_secret or not association.clinic.line_channel_access_token:
                        logger.warning(f"Clinic {association.clinic_id} has no LINE credentials, skipping")
                        total_skipped += 1
                        continue

                    # Get appointments for this practitioner for the date range
                    start_date = today + timedelta(days=1)
                    end_date = today + timedelta(days=reminder_days_ahead)
                    
                    appointments = self._get_practitioner_appointments_for_date_range(
                        db, association.user_id, association.clinic_id, start_date, end_date
                    )

                    if not appointments:
                        logger.debug(f"No appointments found for practitioner {association.user_id} from {start_date} to {end_date}")
                        total_skipped += 1
                        continue

                    # Send notification
                    if await self._send_notification_for_practitioner(
                        db, association, appointments, start_date, end_date
                    ):
                        total_sent += 1
                    else:
                        total_skipped += 1

                if total_sent == 0 and total_skipped == 0:
                    logger.debug("No practitioners found needing daily notifications at this time")
                else:
                    logger.info(f"Successfully sent {total_sent} daily notification(s), skipped {total_skipped}")

            except Exception as e:
                logger.exception(f"Error sending daily notifications: {e}")

    def _get_practitioner_appointments_for_date_range(
        self,
        db: Session,
        practitioner_id: int,
        clinic_id: int,
        start_date: date,
        end_date: date
    ) -> List[Appointment]:
        """
        Get confirmed appointments for a practitioner within a specific date range.
        
        Args:
            db: Database session
            practitioner_id: ID of the practitioner
            clinic_id: ID of the clinic
            start_date: Start date of the range
            end_date: End date of the range
            
        Returns:
            List of appointments for the practitioner in the target range
        """
        # Filter out appointments with deleted appointment types (edge case #10)
        appointments = db.query(Appointment).join(CalendarEvent).outerjoin(
            AppointmentType, Appointment.appointment_type_id == AppointmentType.id
        ).filter(
            Appointment.status == "confirmed",
            Appointment.is_auto_assigned == False,  # Practitioners don't see auto-assigned appointments
            CalendarEvent.user_id == practitioner_id,
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date >= start_date,
            CalendarEvent.date <= end_date,
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
            joinedload(Appointment.calendar_event)
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()
        
        return appointments

    async def _send_notification_for_practitioner(
        self,
        db: Session,
        association: UserClinicAssociation,
        appointments: List[Appointment],
        start_date: date,
        end_date: date
    ) -> bool:
        """
        Send daily notification to a practitioner about their appointments.
        
        Args:
            db: Database session
            association: UserClinicAssociation for the practitioner
            appointments: List of appointments for the range
            start_date: Start date of the range
            end_date: End date of the range
            
        Returns:
            True if notification was sent successfully, False otherwise
        """
        try:
            clinic = association.clinic
            practitioner = association.user

            # Build notification message using shared utilities
            # Get practitioner name for section header
            from utils.practitioner_helpers import get_practitioner_display_name_with_title
            practitioner_name = get_practitioner_display_name_with_title(
                db, practitioner.id, clinic.id
            )
            
            # Group appointments by date
            from itertools import groupby
            # Ensure appointments are sorted by date for groupby
            appointments.sort(key=lambda a: a.calendar_event.date)
            appointments_by_date = {
                d: list(g) for d, g in groupby(appointments, key=lambda a: a.calendar_event.date)
            }
            
            # Sort dates for consistent ordering
            sorted_dates = sorted(appointments_by_date.keys())
            
            from services.admin_daily_reminder_service import LINE_MESSAGE_TARGET_CHARS
            
            messages: List[str] = []
            current_message_parts: List[str] = []
            current_length = 0
            
            for target_date in sorted_dates:
                date_appointments = appointments_by_date[target_date]
                
                # Build date section header
                date_header = DailyNotificationMessageBuilder.build_date_section_header(target_date)
                
                # Check if adding date header exceeds limit
                if current_length + len(date_header) > LINE_MESSAGE_TARGET_CHARS and current_message_parts:
                    messages.append("".join(current_message_parts))
                    current_message_parts = []
                    current_length = 0
                    date_header = DailyNotificationMessageBuilder.build_date_section_header(target_date, is_continuation=True)
                
                current_message_parts.append(date_header)
                current_length += len(date_header)
                
                # Build practitioner section
                practitioner_header = DailyNotificationMessageBuilder.build_practitioner_section(
                    practitioner_name, date_appointments, is_clinic_wide=False
                )
                
                appointment_lines: List[str] = []
                for i, appointment in enumerate(date_appointments, 1):
                    line = DailyNotificationMessageBuilder.build_appointment_line(appointment, i)
                    appointment_lines.append(line)
                
                practitioner_text = practitioner_header + "".join(appointment_lines)
                
                # Check if adding this practitioner section exceeds limit
                if current_length + len(practitioner_text) > LINE_MESSAGE_TARGET_CHARS and current_message_parts:
                    # If we already have content, save it and start new message
                    if len(current_message_parts) > 1: # More than just the date header
                        messages.append("".join(current_message_parts))
                        current_message_parts = [
                            DailyNotificationMessageBuilder.build_date_section_header(target_date, is_continuation=True)
                        ]
                        current_length = sum(len(p) for p in current_message_parts)
                    
                    # Split appointment lines if needed
                    current_message_parts.append(practitioner_header)
                    current_length += len(practitioner_header)
                    
                    for line in appointment_lines:
                        if current_length + len(line) > LINE_MESSAGE_TARGET_CHARS:
                            messages.append("".join(current_message_parts))
                            current_message_parts = [
                                DailyNotificationMessageBuilder.build_date_section_header(target_date, is_continuation=True),
                                f"治療師：{practitioner_name} (續上頁)\n",
                                f"您有 {len(date_appointments)} 個預約：\n\n"
                            ]
                            current_length = sum(len(p) for p in current_message_parts)
                        current_message_parts.append(line)
                        current_length += len(line)
                else:
                    current_message_parts.append(practitioner_text)
                    current_length += len(practitioner_text)
                
                # Add a separator between days if not the last day
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
            final_messages: List[str] = []
            for i, msg in enumerate(messages, 1):
                header = DailyNotificationMessageBuilder.build_message_header(
                    start_date, end_date,
                    is_clinic_wide=False,
                    part_number=i if total_parts > 1 else None,
                    total_parts=total_parts if total_parts > 1 else None
                )
                final_messages.append(header + msg)

            # Send notification via LINE with labels for tracking
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            labels = {
                'recipient_type': 'practitioner',
                'event_type': 'daily_appointment_reminder',
                'trigger_source': 'system_triggered',
                'notification_context': 'daily_summary'
            }
            
            if association.line_user_id:
                for message in final_messages:
                    line_service.send_text_message(
                        association.line_user_id, 
                        message,
                        db=db,
                        clinic_id=clinic.id,
                        labels=labels
                    )

            logger.info(
                f"Sent daily notification to practitioner {practitioner.id} "
                f"for {len(appointments)} appointment(s) from {start_date} to {end_date}"
            )
            return True

        except Exception as e:
            logger.exception(
                f"Failed to send daily notification to practitioner {association.user_id}: {e}"
            )
            return False


# Global service instance
_practitioner_daily_notification_service: Optional[PractitionerDailyNotificationService] = None


def get_practitioner_daily_notification_service() -> PractitionerDailyNotificationService:
    """
    Get the global practitioner daily notification service instance.
    
    Returns:
        The global service instance
    """
    global _practitioner_daily_notification_service
    if _practitioner_daily_notification_service is None:
        _practitioner_daily_notification_service = PractitionerDailyNotificationService()
    return _practitioner_daily_notification_service


async def start_practitioner_daily_notification_scheduler() -> None:
    """
    Start the global practitioner daily notification scheduler.
    
    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_practitioner_daily_notification_service()
    await service.start_scheduler()


async def stop_practitioner_daily_notification_scheduler() -> None:
    """
    Stop the global practitioner daily notification scheduler.
    
    This should be called during application shutdown.
    """
    global _practitioner_daily_notification_service
    if _practitioner_daily_notification_service:
        await _practitioner_daily_notification_service.stop_scheduler()

