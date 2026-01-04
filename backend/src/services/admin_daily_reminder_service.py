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
            CronTrigger(hour="*"),  # Run every hour
            id="send_admin_daily_notifications",
            name="Send admin daily appointment notifications",
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

                    # Get all clinic admins (auto-enabled, no opt-in check)
                    all_admins = self._get_clinic_admins_with_daily_reminder(db, clinic.id)

                    if not all_admins:
                        logger.debug(f"No admins found for clinic {clinic.id}")
                        continue

                    # Group admins by their notification time (using next_day_notification_time)
                    admins_by_time: Dict[int, List[UserClinicAssociation]] = {}
                    for admin_association in all_admins:
                        # Get admin's notification time setting (same as practitioners)
                        try:
                            admin_settings = admin_association.get_validated_settings()
                            notification_time_str = admin_settings.next_day_notification_time
                        except Exception as e:
                            logger.warning(
                                f"Error getting notification settings for admin {admin_association.user_id} "
                                f"in clinic {clinic.id}: {e}, using default 21:00"
                            )
                            notification_time_str = "21:00"

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

                        if notification_hour not in admins_by_time:
                            admins_by_time[notification_hour] = []
                        admins_by_time[notification_hour].append(admin_association)

                    # If no admins match current hour, skip this clinic
                    if not admins_by_time:
                        continue

                    # Get appointments for next day (once per clinic)
                    next_day_appointments = self._get_next_day_appointments(db, clinic.id)

                    if not next_day_appointments:
                        logger.debug(
                            f"No appointments for next day found for clinic {clinic.id}"
                        )
                        continue

                    # Group appointments by practitioner
                    appointments_by_practitioner = self._group_appointments_by_practitioner(
                        next_day_appointments
                    )

                    # Build message(s) with splitting
                    target_date = (current_time.date() + timedelta(days=1))
                    messages = self._build_clinic_wide_message(
                        db, appointments_by_practitioner, target_date, clinic.id
                    )

                    if not messages:
                        logger.warning(f"Failed to build messages for clinic {clinic.id}")
                        continue

                    # Send to all admins who match current hour (batched)
                    # All admins in admins_by_time[current_hour] get the same message(s)
                    for notification_hour, admins in admins_by_time.items():
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
        # Filter out appointments with deleted appointment types (edge case #10)
        appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).outerjoin(
            AppointmentType, Appointment.appointment_type_id == AppointmentType.id
        ).filter(
            Appointment.status == 'confirmed',
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == next_day,
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
        ).order_by(CalendarEvent.start_time).all()
        
        return appointments

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

    def _build_clinic_wide_message(
        self,
        db: Session,
        appointments_by_practitioner: Dict[Optional[int], List[Appointment]],
        target_date: date,
        clinic_id: int
    ) -> List[str]:
        """
        Build clinic-wide reminder message(s) with splitting if needed.
        
        Uses practitioner-style format but includes all practitioners' appointments.
        Splits messages if they exceed LINE_MESSAGE_TARGET_CHARS (4500).
        
        Args:
            db: Database session
            appointments_by_practitioner: Dictionary mapping practitioner_id to appointments
            target_date: Date of the appointments
            clinic_id: ID of the clinic
            
        Returns:
            List of message strings (may be multiple if splitting occurred)
        """
        # Sort practitioners by ID for consistent ordering
        # Separate None (auto-assigned) from actual practitioner IDs
        practitioner_ids_only = [
            pid for pid in appointments_by_practitioner.keys() if pid is not None
        ]
        sorted_practitioner_ids: List[Optional[int]] = sorted(practitioner_ids_only)  # type: ignore[assignment]
        
        # Handle None practitioner_id separately (auto-assigned) - append at end
        if None in appointments_by_practitioner:
            sorted_practitioner_ids.append(None)

        messages: List[str] = []
        current_message_parts: List[str] = []
        current_length = 0

        for practitioner_id in sorted_practitioner_ids:
            practitioner_appointments = appointments_by_practitioner[practitioner_id]
            
            # Get practitioner name
            if practitioner_id is None:
                practitioner_name = "不指定"
            else:
                from utils.practitioner_helpers import get_practitioner_display_name_with_title
                practitioner_name = get_practitioner_display_name_with_title(
                    db, practitioner_id, clinic_id
                )
            
            # Build practitioner section using shared utility
            practitioner_section = DailyNotificationMessageBuilder.build_practitioner_section(
                practitioner_name, practitioner_appointments, is_clinic_wide=True
            )
            
            appointment_lines: List[str] = []
            for i, appointment in enumerate(practitioner_appointments, 1):
                # Build appointment line using shared utility
                appointment_line = DailyNotificationMessageBuilder.build_appointment_line(
                    appointment, i
                )
                appointment_lines.append(appointment_line)
            
            # Check if adding this practitioner would exceed limit
            practitioner_text = practitioner_section + "".join(appointment_lines)
            practitioner_length = len(practitioner_text)
            
            # If single practitioner exceeds limit, split mid-practitioner
            if practitioner_length > LINE_MESSAGE_TARGET_CHARS and len(appointment_lines) > 1:
                # Split mid-practitioner (fallback case)
                remaining_in_current = LINE_MESSAGE_TARGET_CHARS - current_length - len(practitioner_section) - 50  # Buffer
                split_index = 0
                accumulated_length = 0
                
                for idx, line in enumerate(appointment_lines):
                    if accumulated_length + len(line) > remaining_in_current and idx > 0:
                        split_index = idx
                        break
                    accumulated_length += len(line)
                
                if split_index > 0:
                    # Split the practitioner's appointments
                    first_part = appointment_lines[:split_index]
                    second_part = appointment_lines[split_index:]
                    
                    # Add first part to current message
                    if current_message_parts:
                        messages.append("".join(current_message_parts) + practitioner_section + "".join(first_part))
                    else:
                        messages.append(practitioner_section + "".join(first_part))
                    
                    # Start new message with continuation
                    continuation_section = f"治療師：{practitioner_name} (續上頁)\n"
                    continuation_section += f"共有 {len(practitioner_appointments)} 個預約：\n\n"
                    current_message_parts = [continuation_section] + second_part
                    current_length = len(continuation_section) + sum(len(line) for line in second_part)
                    continue
            
            # Check if adding this practitioner would exceed limit
            if current_length + len(practitioner_text) > LINE_MESSAGE_TARGET_CHARS and current_message_parts:
                # Save current message and start new one
                messages.append("".join(current_message_parts))
                current_message_parts = []
                current_length = 0
            
            # Add practitioner section to current message
            current_message_parts.append(practitioner_text)
            current_length += len(practitioner_text)

        # Add final message if there are remaining parts
        if current_message_parts:
            messages.append("".join(current_message_parts))

        # Add headers to all messages using shared utility
        total_parts = len(messages)
        for i, msg in enumerate(messages, 1):
            header = DailyNotificationMessageBuilder.build_message_header(
                target_date,
                is_clinic_wide=True,
                part_number=i if total_parts > 1 else None,
                total_parts=total_parts if total_parts > 1 else None
            )
            full_message = header + msg
            
            # Validate final message length (including header) stays under limit
            if len(full_message) > LINE_MESSAGE_MAX_CHARS:
                logger.warning(
                    f"Message part {i}/{total_parts} exceeds LINE limit: {len(full_message)} chars "
                    f"(limit: {LINE_MESSAGE_MAX_CHARS}). This should not happen with current splitting logic."
                )
                # Truncate if somehow we exceeded (shouldn't happen, but safety check)
                full_message = full_message[:LINE_MESSAGE_MAX_CHARS - 3] + "..."
            
            messages[i - 1] = full_message

        return messages


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
