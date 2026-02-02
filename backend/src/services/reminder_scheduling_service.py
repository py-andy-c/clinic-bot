"""
Reminder scheduling service for pre-scheduling appointment reminders.

This service follows a "schedule-on-event" strategy (Pre-Scheduling Model):
- When an appointment is created or confirmed, a reminder is immediately calculated
  and inserted into the `scheduled_line_messages` table for future delivery.
- This ensures reliable delivery regardless of when the appointment was created,
  provided the reminder time (e.g., 24h before) hasn't already passed.
- It replaces the deprecated hourly polling-based `ReminderService`.
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from models import Appointment, ScheduledLineMessage, Clinic, CalendarEvent
from utils.datetime_utils import taiwan_now, ensure_taiwan

logger = logging.getLogger(__name__)


class ReminderSchedulingService:

    @staticmethod
    def calculate_previous_day_send_time(calendar_event: CalendarEvent, clinic: Clinic) -> datetime:
        """
        Calculate reminder send time for previous day mode.

        Args:
            calendar_event: CalendarEvent to calculate reminder time for
            clinic: Clinic with reminder configuration

        Returns:
            datetime: When to send the reminder (on previous day at configured time)
        """
        # Get appointment datetime (same as existing hours_before logic)
        if calendar_event.start_time is None:
            raise ValueError("Calendar event start_time cannot be None for reminder scheduling")

        appointment_dt = datetime.combine(
            calendar_event.date,
            calendar_event.start_time
        )
        appointment_dt = ensure_taiwan(appointment_dt)

        if appointment_dt is None:
            raise ValueError("Failed to ensure timezone for appointment datetime")

        # Parse configured time (e.g., "21:00" -> hour=21, minute=0)
        configured_time_str = clinic.reminder_previous_day_time
        time_parts = configured_time_str.split(':')
        configured_hour = int(time_parts[0])
        configured_minute = int(time_parts[1])

        # Create reminder time on the previous day at configured time
        reminder_dt = appointment_dt.replace(hour=configured_hour, minute=configured_minute)
        reminder_send_time = reminder_dt - timedelta(days=1)

        return reminder_send_time
    """Service for scheduling appointment reminders."""

    @staticmethod
    def schedule_reminder(db: Session, appointment: Appointment) -> None:
        """
        Schedule a reminder for an appointment.
        
        This is called when an appointment is created and confirmed.
        It creates a ScheduledLineMessage record for the reminder.
        
        Args:
            db: Database session
            appointment: Appointment to schedule reminder for
        """
        # Only schedule reminders for confirmed, non-auto-assigned appointments
        if appointment.status != 'confirmed':
            logger.debug(f"Appointment {appointment.calendar_event_id} is not confirmed, skipping reminder scheduling")
            return
        
        if appointment.is_auto_assigned:
            logger.debug(f"Appointment {appointment.calendar_event_id} is auto-assigned, skipping reminder scheduling")
            return
        
        # Check if reminder is enabled for this appointment type
        appointment_type = appointment.appointment_type
        if not appointment_type:
            logger.warning(f"Appointment {appointment.calendar_event_id} has no appointment type")
            return
        
        if not appointment_type.send_reminder:
            logger.debug(f"Reminder disabled for appointment type {appointment_type.id}, skipping")
            return
        
        # Get clinic and reminder configuration
        clinic = appointment.patient.clinic
        if not clinic:
            logger.warning(f"Appointment {appointment.calendar_event_id} has no clinic")
            return

        # Calculate reminder send time based on timing mode
        reminder_hours_before = clinic.reminder_hours_before  # Always define for later use
        if clinic.reminder_timing_mode == "previous_day":
            reminder_send_time = ReminderSchedulingService.calculate_previous_day_send_time(
                appointment.calendar_event, clinic
            )

            # Skip if appointment is today (can't send reminder yesterday)
            current_time = taiwan_now()
            if reminder_send_time.date() >= current_time.date():
                logger.debug(f"Skipping previous day reminder for same-day appointment {appointment.calendar_event_id}")
                return
        else:
            # Hours before mode: existing logic
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            start_datetime = ensure_taiwan(start_datetime)
            if start_datetime is None:
                raise ValueError("Failed to ensure timezone for start_datetime")

            reminder_send_time = start_datetime - timedelta(hours=reminder_hours_before)
        
        # Check if patient has LINE user
        patient = appointment.patient
        line_user = patient.line_user
        
        if not line_user:
            logger.debug(f"Patient {patient.id} has no LINE user, skipping reminder scheduling")
            return
        
        # Validate reminder send time is not in past
        current_time = taiwan_now()
        if reminder_send_time < current_time:
            logger.warning(
                f"Skipping reminder for appointment {appointment.calendar_event_id} - "
                f"reminder send time {reminder_send_time} is in past"
            )
            return
        
        # Get reminder message template
        reminder_template = appointment_type.reminder_message
        if not reminder_template:
            logger.warning(f"Appointment type {appointment_type.id} has no reminder message template")
            return
        
        # Check if reminder already scheduled (avoid duplicates)
        existing = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'appointment_reminder',
            ScheduledLineMessage.status == 'pending',
            ScheduledLineMessage.message_context['appointment_id'].astext == str(appointment.calendar_event_id)
        ).first()
        
        if existing:
            logger.debug(f"Reminder already scheduled for appointment {appointment.calendar_event_id}")
            return
        
        # Create scheduled message record
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
            clinic_id=appointment.patient.clinic_id,
            message_type='appointment_reminder',
            message_template=reminder_template,
            message_context={
                'appointment_id': appointment.calendar_event_id
            },
            scheduled_send_time=reminder_send_time,
            status='pending'
        )
        db.add(scheduled)
        logger.debug(
            f"Scheduled reminder for appointment {appointment.calendar_event_id} "
            f"at {reminder_send_time}"
        )
        
        # Commit (but don't fail appointment creation if this fails)
        try:
            db.commit()
        except Exception as e:
            logger.exception(f"Failed to commit scheduled reminder for appointment {appointment.calendar_event_id}: {e}")
            db.rollback()

    @staticmethod
    def cancel_pending_reminder(db: Session, appointment_id: int) -> None:
        """
        Cancel pending reminder for an appointment.
        
        This is called when an appointment is canceled or edited.
        
        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
        """
        from sqlalchemy import cast, String
        
        updated = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'appointment_reminder',
            ScheduledLineMessage.status == 'pending',
            cast(ScheduledLineMessage.message_context['appointment_id'].astext, String) == str(appointment_id)
        ).update(
            {'status': 'skipped'},
            synchronize_session=False
        )
        
        if updated > 0:
            logger.info(f"Cancelled {updated} pending reminder(s) for appointment {appointment_id}")
            try:
                db.commit()
            except Exception as e:
                logger.exception(f"Failed to commit cancellation of reminder for appointment {appointment_id}: {e}")
                db.rollback()

    @staticmethod
    def reschedule_reminder(db: Session, appointment: Appointment) -> None:
        """
        Reschedule reminder for an appointment.
        
        This cancels existing pending reminder and schedules a new one.
        Called when appointment time is edited.
        
        Args:
            db: Database session
            appointment: Appointment to reschedule reminder for
        """
        # Cancel existing pending reminder
        ReminderSchedulingService.cancel_pending_reminder(db, appointment.calendar_event_id)
        
        # Schedule new reminder
        ReminderSchedulingService.schedule_reminder(db, appointment)

