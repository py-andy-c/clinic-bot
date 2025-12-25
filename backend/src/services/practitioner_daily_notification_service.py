"""
Practitioner daily notification service.

This module handles sending daily notifications to practitioners about their
appointments for the next day. Notifications are sent via LINE messaging
and scheduled using APScheduler.
"""

import logging
from datetime import datetime, date, timedelta
from typing import List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy.orm import Session, joinedload

from core.database import get_db_context
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.user_clinic_association import UserClinicAssociation
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, format_datetime, TAIWAN_TZ

logger = logging.getLogger(__name__)


class PractitionerDailyNotificationService:
    """
    Service for managing daily appointment notifications for practitioners.
    
    **DEPRECATED**: The scheduler functionality in this service is deprecated.
    Practitioner notifications are now handled by the unified `ScheduledMessageScheduler`
    and `PractitionerNotificationSchedulingService` which use the `scheduled_line_messages` table.
    
    This class is kept for backward compatibility, but the scheduler methods
    (`start_scheduler()`, `stop_scheduler()`, `_send_daily_notifications()`) are deprecated
    and should not be used. The scheduler is not started in `main.py`.
    """

    def __init__(self):
        """
        Initialize the daily notification service.
        
        **DEPRECATED**: Scheduler functionality is deprecated. Use `PractitionerNotificationSchedulingService`
        and `ScheduledMessageScheduler` instead.
        
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
        **DEPRECATED**: This scheduler is no longer used.
        
        Practitioner notifications are now scheduled via `PractitionerNotificationSchedulingService`
        and sent by the unified `ScheduledMessageScheduler`.
        
        This method is kept for backward compatibility but should not be called.
        The scheduler is not started in `main.py`.
        
        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Practitioner daily notification scheduler is already started")
            return

        # Schedule notification checks to run every hour
        # This allows us to check for practitioners who have configured
        # different notification times throughout the day
        self.scheduler.add_job(  # type: ignore
            self._send_daily_notifications,
            CronTrigger(hour="*"),  # Run every hour
            id="send_practitioner_daily_notifications",
            name="Send practitioner daily appointment notifications",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True
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
        **DEPRECATED**: This method is no longer used.
        
        Practitioner notifications are now sent via the unified `ScheduledMessageScheduler`
        which processes messages from the `scheduled_line_messages` table.
        
        Original functionality:
        Check for and send daily appointment notifications to practitioners.
        
        This method is called by the scheduler every hour to check for
        practitioners who should receive notifications at this time.
        
        Uses a fresh database session for each run to avoid stale session issues.
        """
        # Use fresh database session for each scheduler run
        with get_db_context() as db:
            try:
                # Get current time in Taiwan timezone (UTC+8)
                # All time comparisons are done in Taiwan time
                current_time = taiwan_now()
                current_hour = current_time.hour
                next_day = (current_time + timedelta(days=1)).date()
                
                logger.info(
                    f"Checking for practitioners needing daily notifications at "
                    f"{current_time.strftime('%H:%M')} for appointments on {next_day}"
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

                    # Get practitioner settings
                    # Notification time is stored as "HH:MM" string and interpreted as Taiwan time
                    try:
                        settings = association.get_validated_settings()
                        notification_time_str = settings.next_day_notification_time
                    except Exception as e:
                        logger.warning(f"Error getting settings for association {association.id}: {e}, using default 21:00")
                        notification_time_str = "21:00"

                    # Parse notification time (interpreted as Taiwan time, e.g., "21:00" = 9 PM)
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

                    # Get appointments for this practitioner for next day
                    appointments = self._get_practitioner_appointments_for_date(
                        db, association.user_id, association.clinic_id, next_day
                    )

                    if not appointments:
                        logger.debug(f"No appointments found for practitioner {association.user_id} on {next_day}")
                        total_skipped += 1
                        continue

                    # Send notification
                    if await self._send_notification_for_practitioner(
                        db, association, appointments, next_day
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

    def _get_practitioner_appointments_for_date(
        self,
        db: Session,
        practitioner_id: int,
        clinic_id: int,
        target_date: date
    ) -> List[Appointment]:
        """
        Get confirmed appointments for a practitioner on a specific date.
        
        Args:
            db: Database session
            practitioner_id: ID of the practitioner
            clinic_id: ID of the clinic
            target_date: Date to get appointments for
            
        Returns:
            List of appointments for the practitioner on the target date
        """
        appointments = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.status == "confirmed",
            CalendarEvent.user_id == practitioner_id,
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == target_date
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event)
        ).order_by(CalendarEvent.start_time).all()
        
        return appointments

    async def _send_notification_for_practitioner(
        self,
        db: Session,
        association: UserClinicAssociation,
        appointments: List[Appointment],
        target_date: date
    ) -> bool:
        """
        Send daily notification to a practitioner about their appointments.
        
        Args:
            db: Database session
            association: UserClinicAssociation for the practitioner
            appointments: List of appointments for the next day
            target_date: Date of the appointments
            
        Returns:
            True if notification was sent successfully, False otherwise
        """
        try:
            clinic = association.clinic
            practitioner = association.user

            # Build notification message
            # target_date is in Taiwan timezone (next day from current Taiwan time)
            date_str = target_date.strftime("%Y年%m月%d日")
            message = f"📅 明日預約提醒 ({date_str})\n\n"
            
            if len(appointments) == 1:
                message += "您有 1 個預約：\n\n"
            else:
                message += f"您有 {len(appointments)} 個預約：\n\n"

            for i, appointment in enumerate(appointments, 1):
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
                
                message += f"{i}. {formatted_time}\n"
                message += f"   病患：{patient_name}\n"
                message += f"   類型：{appointment_type_name}"
                
                if appointment.notes:
                    message += f"\n   備註：{appointment.notes}"
                
                message += "\n\n"

            message += "請準時為病患服務！"

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
            # Type safety check: association.line_user_id is filtered to be non-null before calling this method,
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
                f"Sent daily notification to practitioner {practitioner.id} "
                f"for {len(appointments)} appointment(s) on {target_date}"
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

