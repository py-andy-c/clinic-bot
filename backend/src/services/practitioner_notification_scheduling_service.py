"""
Practitioner notification scheduling service for pre-scheduling daily notifications.

This service schedules practitioner daily notifications in the scheduled_line_messages table
when appointments are created or confirmed.
"""

import logging
from datetime import datetime, timedelta, time
from sqlalchemy.orm import Session

from models import Appointment, ScheduledLineMessage
from models.user_clinic_association import UserClinicAssociation
from utils.datetime_utils import taiwan_now, ensure_taiwan

logger = logging.getLogger(__name__)


class PractitionerNotificationSchedulingService:
    """Service for scheduling practitioner daily notifications."""

    @staticmethod
    def schedule_notification_for_appointment(db: Session, appointment: Appointment) -> None:
        """
        Schedule a daily notification for a practitioner about this appointment.
        
        This is called when an appointment is created and confirmed.
        It creates a ScheduledLineMessage record for the notification.
        
        Args:
            db: Database session
            appointment: Appointment to schedule notification for
        """
        # Only schedule for confirmed appointments
        if appointment.status != 'confirmed':
            logger.debug(f"Appointment {appointment.calendar_event_id} is not confirmed, skipping notification scheduling")
            return
        
        # Only schedule for non-auto-assigned appointments (practitioners don't see auto-assigned)
        if appointment.is_auto_assigned:
            logger.debug(f"Appointment {appointment.calendar_event_id} is auto-assigned, skipping notification scheduling")
            return
        
        # Get practitioner from calendar event
        calendar_event = appointment.calendar_event
        if not calendar_event or not calendar_event.user_id:
            logger.debug(f"Appointment {appointment.calendar_event_id} has no practitioner")
            return
        
        practitioner_id = calendar_event.user_id
        clinic_id = appointment.patient.clinic_id
        
        # Get practitioner association
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == practitioner_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()
        
        if not association:
            logger.debug(f"No active association found for practitioner {practitioner_id} in clinic {clinic_id}")
            return
        
        # Check if practitioner has LINE account linked
        if not association.line_user_id:
            logger.debug(f"Practitioner {practitioner_id} has no LINE account linked for clinic {clinic_id}")
            return
        
        # Get practitioner notification time setting
        try:
            settings = association.get_validated_settings()
            notification_time_str = settings.next_day_notification_time
        except Exception as e:
            logger.warning(f"Error getting settings for association {association.id}: {e}, using default 21:00")
            notification_time_str = "21:00"
        
        # Parse notification time (HH:MM format, interpreted as Taiwan time)
        try:
            notification_hour, notification_minute = map(int, notification_time_str.split(':'))
            notification_time = time(notification_hour, notification_minute)
        except (ValueError, AttributeError):
            logger.warning(
                f"Invalid notification time format '{notification_time_str}' for association {association.id}, "
                f"using default 21:00"
            )
            notification_time = time(21, 0)
        
        # Calculate notification send time: appointment date at practitioner's notification time
        # Notification is sent on the day before the appointment at the practitioner's configured time
        appointment_date = calendar_event.date
        notification_date = appointment_date - timedelta(days=1)
        
        notification_send_time = datetime.combine(notification_date, notification_time)
        notification_send_time = ensure_taiwan(notification_send_time)
        if notification_send_time is None:
            raise ValueError("Failed to ensure timezone for notification_send_time")
        
        # Validate notification send time is not in past
        current_time = taiwan_now()
        if notification_send_time < current_time:
            logger.debug(
                f"Skipping notification for appointment {appointment.calendar_event_id} - "
                f"notification send time {notification_send_time} is in past"
            )
            return
        
        # Build notification message template
        # We'll build the full message here since it includes all appointments for that day
        # But we need to check if there are other appointments on the same day for this practitioner
        # For now, we'll schedule individual notifications per appointment, and the scheduler
        # will group them when sending (or we can optimize later to group at scheduling time)
        
        # For simplicity, we'll schedule one notification per appointment
        # The scheduler can deduplicate or group them when sending
        # But actually, we should group by (practitioner_id, clinic_id, appointment_date, notification_time)
        # to avoid sending multiple notifications for the same day
        
        # Check if notification already scheduled for this practitioner/date/time combination
        # We use a composite key: practitioner_id + appointment_date + notification_time
        from sqlalchemy import cast, String
        existing = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'practitioner_daily',
            ScheduledLineMessage.status == 'pending',
            ScheduledLineMessage.recipient_line_user_id == association.line_user_id,
            ScheduledLineMessage.clinic_id == clinic_id,
            ScheduledLineMessage.scheduled_send_time == notification_send_time,
            cast(ScheduledLineMessage.message_context['appointment_date'].astext, String) == appointment_date.isoformat()
        ).first()
        
        if existing:
            # Update existing notification to include this appointment
            # We'll store appointment IDs in a list in the context
            from sqlalchemy.orm.attributes import flag_modified
            appointment_ids = existing.message_context.get('appointment_ids', [])
            if appointment.calendar_event_id not in appointment_ids:
                appointment_ids.append(appointment.calendar_event_id)
                existing.message_context['appointment_ids'] = appointment_ids
                # Flag JSONB field as modified so SQLAlchemy detects the change
                flag_modified(existing, 'message_context')
                # Template will be built when sending, no need to update here
                db.commit()
                logger.debug(
                    f"Updated existing notification for practitioner {practitioner_id} "
                    f"on {appointment_date} to include appointment {appointment.calendar_event_id}"
                )
            return
        
        # Create new scheduled message
        # The template is a placeholder - actual message will be built when sending
        # using the appointment data from the database
        scheduled = ScheduledLineMessage(
            recipient_type='practitioner',
            recipient_line_user_id=association.line_user_id,
            clinic_id=clinic_id,
            message_type='practitioner_daily',
            message_template='',  # Will be built when sending
            message_context={
                'practitioner_id': practitioner_id,
                'appointment_date': appointment_date.isoformat(),
                'appointment_ids': [appointment.calendar_event_id],
                'notification_time': notification_time_str
            },
            scheduled_send_time=notification_send_time,
            status='pending'
        )
        db.add(scheduled)
        logger.debug(
            f"Scheduled daily notification for practitioner {practitioner_id} "
            f"for appointment {appointment.calendar_event_id} on {appointment_date} "
            f"at {notification_send_time}"
        )
        
        # Commit (but don't fail appointment creation if this fails)
        try:
            db.commit()
        except Exception as e:
            logger.exception(
                f"Failed to commit scheduled notification for appointment {appointment.calendar_event_id}: {e}"
            )
            db.rollback()


    @staticmethod
    def cancel_pending_notifications(db: Session, appointment_id: int) -> None:
        """
        Cancel pending notifications for an appointment.
        
        This is called when an appointment is canceled or edited.
        We need to update or remove the notification that includes this appointment.
        
        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
        """
        # Find notifications that include this appointment
        notifications = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'practitioner_daily',
            ScheduledLineMessage.status == 'pending'
        ).all()
        
        from sqlalchemy.orm.attributes import flag_modified
        updated_count = 0
        for notification in notifications:
            appointment_ids = notification.message_context.get('appointment_ids', [])
            if appointment_id in appointment_ids:
                # Remove this appointment from the list
                appointment_ids = [aid for aid in appointment_ids if aid != appointment_id]
                
                if not appointment_ids:
                    # No more appointments, mark notification as skipped
                    notification.status = 'skipped'
                    updated_count += 1
                else:
                    # Update notification to remove this appointment
                    notification.message_context['appointment_ids'] = appointment_ids
                    # Flag JSONB field as modified so SQLAlchemy detects the change
                    flag_modified(notification, 'message_context')
                    # Note: We can't rebuild the template here without appointment data,
                    # so we'll rebuild it when sending
                    updated_count += 1
        
        if updated_count > 0:
            logger.info(f"Updated/cancelled {updated_count} notification(s) for appointment {appointment_id}")
            try:
                db.commit()
            except Exception as e:
                logger.exception(f"Failed to commit cancellation of notifications for appointment {appointment_id}: {e}")
                db.rollback()

    @staticmethod
    def reschedule_notification(db: Session, appointment: Appointment) -> None:
        """
        Reschedule notification for an appointment.
        
        This cancels existing pending notification and schedules a new one.
        Called when appointment time is edited.
        
        Args:
            db: Database session
            appointment: Appointment to reschedule notification for
        """
        # Cancel existing pending notification
        PractitionerNotificationSchedulingService.cancel_pending_notifications(
            db, appointment.calendar_event_id
        )
        
        # Schedule new notification
        PractitionerNotificationSchedulingService.schedule_notification_for_appointment(db, appointment)

