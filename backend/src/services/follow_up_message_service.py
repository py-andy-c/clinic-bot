"""
Follow-up message service for scheduling post-appointment follow-up messages.

This service handles scheduling follow-up messages when appointments are created,
and managing follow-up message configurations.
"""

import logging
from datetime import datetime, timedelta, time as time_type
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import cast, String

from models import Appointment, FollowUpMessage, ScheduledLineMessage
from utils.datetime_utils import taiwan_now, ensure_taiwan
from utils.timing_utils import calculate_follow_up_scheduled_time

logger = logging.getLogger(__name__)


class FollowUpMessageService:
    """Service for managing follow-up messages."""

    @staticmethod
    def calculate_scheduled_time(
        appointment_end_time: datetime,
        timing_mode: str,
        hours_after: Optional[int] = None,
        days_after: Optional[int] = None,
        time_of_day: Optional[time_type] = None
    ) -> datetime:
        """
        Calculate scheduled send time based on timing mode.
        
        This method delegates to the shared timing utility for consistency.
        
        Args:
            appointment_end_time: When the appointment ends
            timing_mode: 'hours_after' or 'specific_time'
            hours_after: For Mode A: hours after appointment end
            days_after: For Mode B: days after appointment date
            time_of_day: For Mode B: specific time (e.g., 21:00)
            
        Returns:
            Scheduled send time
        """
        return calculate_follow_up_scheduled_time(
            appointment_end_time=appointment_end_time,
            timing_mode=timing_mode,
            hours_after=hours_after,
            days_after=days_after,
            time_of_day=time_of_day
        )

    @staticmethod
    def schedule_follow_up_messages(db: Session, appointment: Appointment) -> None:
        """
        Schedule all follow-up messages for an appointment.
        
        This is called when an appointment is created and confirmed.
        It creates ScheduledLineMessage records for all enabled follow-up messages.
        
        Args:
            db: Database session
            appointment: Appointment to schedule follow-up messages for
        """
        appointment_type = appointment.appointment_type
        if not appointment_type:
            logger.warning(f"Appointment {appointment.calendar_event_id} has no appointment type")
            return
        
        # Get all enabled follow-up messages for this appointment type
        follow_up_messages = db.query(FollowUpMessage).filter(
            FollowUpMessage.appointment_type_id == appointment_type.id,
            FollowUpMessage.is_enabled == True
        ).order_by(FollowUpMessage.display_order).all()
        
        if not follow_up_messages:
            return
        
        # Calculate appointment end time: start_time + duration_minutes
        start_datetime = datetime.combine(
            appointment.calendar_event.date,
            appointment.calendar_event.start_time
        )
        start_datetime = ensure_taiwan(start_datetime)
        if start_datetime is None:
            raise ValueError("Failed to ensure timezone for start_datetime")
        appointment_end_time = start_datetime + timedelta(
            minutes=appointment_type.duration_minutes
        )
        
        # Check if patient has LINE user
        patient = appointment.patient
        line_user = patient.line_user
        
        if not line_user:
            logger.debug(f"Patient {patient.id} has no LINE user, skipping follow-up message scheduling")
            return
        
        # Schedule each follow-up message
        for follow_up in follow_up_messages:
            try:
                scheduled_time = FollowUpMessageService.calculate_scheduled_time(
                    appointment_end_time,
                    follow_up.timing_mode,
                    follow_up.hours_after,
                    follow_up.days_after,
                    follow_up.time_of_day
                )
                
                # Validate scheduled time is not in past
                current_time = taiwan_now()
                if scheduled_time < current_time:
                    logger.warning(
                        f"Skipping follow-up message {follow_up.id} - scheduled time {scheduled_time} is in past"
                    )
                    continue
                
                # Create scheduled message record
                scheduled = ScheduledLineMessage(
                    recipient_type='patient',
                    recipient_line_user_id=line_user.line_user_id,
                    clinic_id=appointment.patient.clinic_id,
                    message_type='follow_up',
                    message_template=follow_up.message_template,
                    message_context={
                        'appointment_id': appointment.calendar_event_id,
                        'follow_up_message_id': follow_up.id
                    },
                    scheduled_send_time=scheduled_time,
                    status='pending'
                )
                db.add(scheduled)
                logger.debug(
                    f"Scheduled follow-up message {follow_up.id} for appointment {appointment.calendar_event_id} "
                    f"at {scheduled_time}"
                )
            except Exception as e:
                logger.exception(
                    f"Failed to schedule follow-up message {follow_up.id} for appointment "
                    f"{appointment.calendar_event_id}: {e}"
                )
                # Continue with other messages even if one fails
        
        # Commit all successfully scheduled messages
        # If commit fails, log error but don't raise - appointment is already created
        try:
            db.commit()
        except Exception as e:
            logger.exception(f"Failed to commit scheduled follow-up messages for appointment {appointment.calendar_event_id}: {e}")
            db.rollback()
            # Don't raise - appointment is already committed, we just failed to schedule messages

    @staticmethod
    def cancel_pending_follow_up_messages(db: Session, appointment_id: int) -> None:
        """
        Cancel all pending follow-up messages for an appointment.
        
        This is called when an appointment is canceled or edited.
        
        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
        """
        # Use PostgreSQL JSONB operator to safely extract and compare appointment_id
        # Cast to string for comparison since JSONB stores numbers as strings in text extraction
        updated = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'follow_up',
            ScheduledLineMessage.status == 'pending',
            cast(ScheduledLineMessage.message_context['appointment_id'].astext, String) == str(appointment_id)
        ).update(
            {'status': 'skipped'},
            synchronize_session=False
        )
        
        if updated > 0:
            logger.info(f"Cancelled {updated} pending follow-up messages for appointment {appointment_id}")
            try:
                db.commit()
            except Exception as e:
                logger.exception(f"Failed to commit cancellation of follow-up messages for appointment {appointment_id}: {e}")
                db.rollback()
                # Don't raise - appointment is already canceled, we just failed to update message status

    @staticmethod
    def reschedule_follow_up_messages(db: Session, appointment: Appointment) -> None:
        """
        Reschedule all follow-up messages for an appointment.
        
        This cancels existing pending messages and schedules new ones.
        Called when appointment time is edited.
        
        Args:
            db: Database session
            appointment: Appointment to reschedule follow-up messages for
        """
        # Cancel existing pending messages
        FollowUpMessageService.cancel_pending_follow_up_messages(
            db, appointment.calendar_event_id
        )
        
        # Schedule new messages
        FollowUpMessageService.schedule_follow_up_messages(db, appointment)

