"""
Admin auto-assigned appointment notification service.

This module handles sending daily notifications to clinic admins about
pending auto-assigned appointments that need confirmation/reassignment.
Notifications are sent via LINE messaging and scheduled using APScheduler.
"""

import logging
from datetime import datetime
from typing import List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy import cast, func, String
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import sqltypes

from core.database import get_db_context
from core.constants import MISFIRE_GRACE_TIME_SECONDS
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.user_clinic_association import UserClinicAssociation
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, format_datetime, TAIWAN_TZ
from utils.query_helpers import filter_by_role

logger = logging.getLogger(__name__)


class AdminAutoAssignedNotificationService:
    """
    Service for managing daily notifications to clinic admins about pending auto-assigned appointments.
    
    This service schedules and sends automated notifications to clinic admins
    about appointments that need confirmation/reassignment via LINE messaging.
    """

    def __init__(self):
        """
        Initialize the admin notification service.
        
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
        Start the background scheduler for sending admin notifications.
        
        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Admin auto-assigned notification scheduler is already started")
            return

        # Schedule notification checks to run every hour
        # This allows us to check for clinics that have configured
        # different notification times throughout the day
        self.scheduler.add_job(  # type: ignore
            self._send_admin_notifications,
            CronTrigger(hour="*", minute=5),  # Run every hour at :05
            id="send_admin_auto_assigned_notifications",
            name="Send admin auto-assigned appointment notifications",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True,
            misfire_grace_time=MISFIRE_GRACE_TIME_SECONDS  # Allow jobs to run up to 15 minutes late
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Admin auto-assigned notification scheduler started")

    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Admin auto-assigned notification scheduler stopped")

    async def _send_admin_notifications(self) -> None:
        """
        Check for and send notifications to clinic admins about pending auto-assigned appointments.
        
        This method is called by the scheduler every hour to check for
        clinics that should receive notifications at this time.
        
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
                    f"Checking for clinics needing admin notifications at "
                    f"{current_time.strftime('%H:%M')} for pending auto-assigned appointments"
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

                    # Get pending auto-assigned appointments for this clinic
                    appointments = self._get_pending_auto_assigned_appointments(db, clinic.id)

                    if not appointments:
                        logger.debug(f"No pending auto-assigned appointments found for clinic {clinic.id}")
                        continue

                    # Get all clinic admins with LINE accounts
                    admins = self._get_clinic_admins_with_line(db, clinic.id)

                    if not admins:
                        logger.debug(f"No admins with LINE accounts found for clinic {clinic.id}")
                        continue

                    # Send notification to each admin based on their individual setting
                    for admin_association in admins:
                        # Get admin's notification settings
                        try:
                            admin_settings = admin_association.get_validated_settings()
                            notification_time_str = admin_settings.auto_assigned_notification_time
                            notification_mode = admin_settings.auto_assigned_notification_mode
                        except Exception as e:
                            logger.warning(
                                f"Error getting notification settings for admin {admin_association.user_id} "
                                f"in clinic {clinic.id}: {e}, using defaults"
                            )
                            notification_time_str = "21:00"
                            notification_mode = "scheduled"
                        
                        # Only send if mode is "scheduled" (immediate mode sends notifications when appointments are created)
                        # This prevents duplicate notifications - immediate mode admins already received notification
                        # when the auto-assigned appointment was created in AppointmentService.create_appointment()
                        if notification_mode != "scheduled":
                            logger.debug(
                                f"Admin {admin_association.user_id} has notification mode '{notification_mode}', "
                                f"skipping scheduled notification (already notified on creation)"
                            )
                            continue

                        # Parse notification time (interpreted as Taiwan time, e.g., "21:00" = 9 PM)
                        try:
                            notification_hour, _ = map(int, notification_time_str.split(':'))
                        except (ValueError, AttributeError):
                            logger.warning(
                                f"Invalid notification time format '{notification_time_str}' for admin "
                                f"{admin_association.user_id} in clinic {clinic.id}, using default 21:00"
                            )
                            notification_hour = 21

                        # Check if it's time to send notification for this admin
                        # Compare current Taiwan time hour with notification hour (both in Taiwan timezone)
                        # Send if current hour matches notification hour (within the hour window)
                        if current_hour != notification_hour:
                            continue
                        
                        logger.debug(
                            f"Admin {admin_association.user_id} notification time matches: "
                            f"{notification_hour}:00 (current: {current_hour}:00)"
                        )

                        # Send notification to this admin
                        if await self._send_notification_for_admin(
                            db, admin_association, clinic, appointments
                        ):
                            total_sent += 1
                        else:
                            total_skipped += 1

                if total_sent == 0 and total_skipped == 0:
                    logger.debug("No clinics found needing admin notifications at this time")
                else:
                    logger.info(f"Successfully sent {total_sent} admin notification(s), skipped {total_skipped}")

            except Exception as e:
                logger.exception(f"Error sending admin notifications: {e}")

    def _get_pending_auto_assigned_appointments(
        self,
        db: Session,
        clinic_id: int
    ) -> List[Appointment]:
        """
        Get pending auto-assigned appointments for a clinic.
        
        Returns appointments that are:
        - Still auto-assigned (is_auto_assigned = True)
        - Confirmed status
        - In the future
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            List of pending auto-assigned appointments
        """
        # Get current Taiwan time for filtering future appointments
        now = taiwan_now()
        now_naive = now.replace(tzinfo=None)

        # Query auto-assigned appointments for this clinic
        # Same logic as the API endpoint
        appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.is_auto_assigned == True,
            Appointment.status == 'confirmed',
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.start_time.isnot(None),
            # Filter out past appointments
            cast(
                func.concat(
                    cast(CalendarEvent.date, String),
                    ' ',
                    cast(CalendarEvent.start_time, String)
                ),
                sqltypes.TIMESTAMP
            ) > now_naive
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()
        
        return appointments

    def _get_clinic_admins_with_line(
        self,
        db: Session,
        clinic_id: int
    ) -> List[UserClinicAssociation]:
        """
        Get all clinic admins who have LINE accounts linked.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            List of UserClinicAssociation for admins with LINE accounts
        """
        from models.user import User
        
        # Get all users with admin role in this clinic
        query = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        )
        
        # Filter by admin role
        query = filter_by_role(query, 'admin')
        
        # Eagerly load associations and user
        admins_query = query.options(
            joinedload(User.clinic_associations)
        ).all()
        
        # Filter to only admins with LINE accounts linked for this clinic
        admin_associations: List[UserClinicAssociation] = []
        for user in admins_query:
            # Find the association for this clinic
            association = next(
                (a for a in user.clinic_associations 
                 if a.clinic_id == clinic_id and a.is_active),
                None
            )
            if association and association.line_user_id:
                admin_associations.append(association)
        
        return admin_associations

    async def _send_notification_for_admin(
        self,
        db: Session,
        association: UserClinicAssociation,
        clinic: Clinic,
        appointments: List[Appointment]
    ) -> bool:
        """
        Send notification to an admin about pending auto-assigned appointments.
        
        Args:
            db: Database session
            association: UserClinicAssociation for the admin
            clinic: Clinic object
            appointments: List of pending auto-assigned appointments
            
        Returns:
            True if notification was sent successfully, False otherwise
        """
        try:
            admin = association.user

            # Build notification message
            if len(appointments) == 1:
                message = "📋 待審核預約提醒\n\n"
                message += "您有 1 個待審核的預約：\n\n"
            else:
                message = "📋 待審核預約提醒\n\n"
                message += f"您有 {len(appointments)} 個待審核的預約：\n\n"

            for i, appointment in enumerate(appointments, 1):
                # Get patient name
                patient_name = appointment.patient.full_name if appointment.patient else "未知病患"
                
                # Format appointment time
                if appointment.pending_time_confirmation:
                    formatted_time = "時間：待安排"
                else:
                    start_datetime = datetime.combine(
                        appointment.calendar_event.date,
                        appointment.calendar_event.start_time
                    )
                    formatted_time = format_datetime(start_datetime)
                
                # Get appointment type name
                appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"
                
                # Get practitioner name (from association if available)
                practitioner = appointment.calendar_event.user if appointment.calendar_event else None
                practitioner_name = "不指定"
                if practitioner:
                    # Get practitioner association for name
                    from models.user_clinic_association import UserClinicAssociation
                    practitioner_association = db.query(UserClinicAssociation).filter(
                        UserClinicAssociation.user_id == practitioner.id,
                        UserClinicAssociation.clinic_id == clinic.id,
                        UserClinicAssociation.is_active == True
                    ).first()
                    if practitioner_association:
                        practitioner_name = practitioner_association.full_name
                    else:
                        practitioner_name = practitioner.email
                
                message += f"{i}. {formatted_time}\n"
                message += f"   病患：{patient_name}\n"
                message += f"   類型：{appointment_type_name}\n"
                message += f"   治療師：{practitioner_name}"
                
                if appointment.notes:
                    message += f"\n   備註：{appointment.notes}"
                
                message += "\n\n"

            message += "請前往「待審核預約」頁面進行確認或重新指派。"

            # Send notification via LINE with labels for tracking
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            labels = {
                'recipient_type': 'admin',
                'event_type': 'auto_assigned_notification',
                'trigger_source': 'system_triggered',
                'notification_context': 'auto_assignment'
            }
            # Type safety check: association.line_user_id is filtered to be non-null in _get_admins_with_line_accounts,
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
                f"Sent auto-assigned notification to admin {admin.id} "
                f"for {len(appointments)} pending appointment(s) in clinic {clinic.id}"
            )
            return True

        except Exception as e:
            logger.exception(
                f"Failed to send auto-assigned notification to admin {association.user_id}: {e}"
            )
            return False


# Global service instance
_admin_auto_assigned_notification_service: Optional[AdminAutoAssignedNotificationService] = None


def get_admin_auto_assigned_notification_service() -> AdminAutoAssignedNotificationService:
    """
    Get the global admin auto-assigned notification service instance.
    
    Returns:
        The global service instance
    """
    global _admin_auto_assigned_notification_service
    if _admin_auto_assigned_notification_service is None:
        _admin_auto_assigned_notification_service = AdminAutoAssignedNotificationService()
    return _admin_auto_assigned_notification_service


async def start_admin_auto_assigned_notification_scheduler() -> None:
    """
    Start the global admin auto-assigned notification scheduler.
    
    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    service = get_admin_auto_assigned_notification_service()
    await service.start_scheduler()


async def stop_admin_auto_assigned_notification_scheduler() -> None:
    """
    Stop the global admin auto-assigned notification scheduler.
    
    This should be called during application shutdown.
    """
    global _admin_auto_assigned_notification_service
    if _admin_auto_assigned_notification_service:
        await _admin_auto_assigned_notification_service.stop_scheduler()

