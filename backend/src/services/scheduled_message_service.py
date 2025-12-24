"""
Scheduled LINE message service for sending scheduled messages.

This service handles sending all scheduled LINE messages (follow-ups, reminders, etc.)
via a cron job that runs hourly.
"""

import logging
from datetime import timedelta
from typing import Dict, Any
from sqlalchemy.orm import Session

from models import (
    Appointment, FollowUpMessage, ScheduledLineMessage,
    Clinic
)
from services.message_template_service import MessageTemplateService
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now
from utils.practitioner_helpers import get_practitioner_display_name_with_title

logger = logging.getLogger(__name__)


class ScheduledMessageService:
    """Service for sending scheduled LINE messages."""

    @staticmethod
    def build_labels_for_message_type(
        message_type: str,
        context: Dict[str, Any]
    ) -> Dict[str, str]:
        """
        Convert message_type to analytics labels for LinePushMessage.
        
        Args:
            message_type: Message type (e.g., 'follow_up', 'appointment_reminder')
            context: Context dictionary with recipient_type and other info
            
        Returns:
            Labels dictionary for analytics
        """
        base_labels = {
            'recipient_type': context.get('recipient_type', 'patient'),
            'trigger_source': 'system_triggered',  # All scheduled messages are system_triggered
        }
        
        if message_type == 'appointment_reminder':
            base_labels['event_type'] = 'appointment_reminder'
        elif message_type == 'follow_up':
            base_labels['event_type'] = 'appointment_follow_up'
        elif message_type == 'practitioner_daily':
            base_labels['event_type'] = 'practitioner_daily_notification'
            base_labels['recipient_type'] = 'practitioner'
        # Add other message types as needed
        
        return base_labels

    @staticmethod
    def validate_appointment_for_message(
        db: Session,
        scheduled: ScheduledLineMessage
    ) -> bool:
        """
        Validate that appointment still exists and is valid for sending message.
        
        Args:
            db: Database session
            scheduled: Scheduled message to validate
            
        Returns:
            True if appointment is valid, False otherwise
        """
        if scheduled.message_type != 'follow_up':
            # For other message types, validation logic can be added here
            return True
        
        # For follow-up messages, check appointment
        appointment_id = scheduled.message_context.get('appointment_id')
        if not appointment_id:
            logger.warning(f"Scheduled message {scheduled.id} missing appointment_id in context")
            return False
        
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        
        if not appointment:
            logger.warning(f"Appointment {appointment_id} not found for scheduled message {scheduled.id}")
            return False
        
        # Check appointment status
        if appointment.status != 'confirmed':
            logger.info(
                f"Appointment {appointment_id} status is {appointment.status}, "
                f"skipping scheduled message {scheduled.id}"
            )
            return False
        
        # Check if follow-up message is still enabled
        follow_up_message_id = scheduled.message_context.get('follow_up_message_id')
        if follow_up_message_id:
            follow_up = db.query(FollowUpMessage).filter(
                FollowUpMessage.id == follow_up_message_id
            ).first()
            
            if not follow_up or not follow_up.is_enabled:
                logger.info(
                    f"Follow-up message {follow_up_message_id} is disabled or deleted, "
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
        
        return True

    @staticmethod
    def build_message_context(
        db: Session,
        scheduled: ScheduledLineMessage
    ) -> Dict[str, Any]:
        """
        Build context for rendering message template.
        
        Args:
            db: Database session
            scheduled: Scheduled message
            
        Returns:
            Context dictionary for MessageTemplateService
        """
        if scheduled.message_type == 'follow_up':
            appointment_id = scheduled.message_context.get('appointment_id')
            if not appointment_id:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_id")
            
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).first()
            
            if not appointment:
                raise ValueError(f"Appointment {appointment_id} not found")
            
            patient = appointment.patient
            clinic = patient.clinic
            
            # Get practitioner name
            if appointment.is_auto_assigned:
                practitioner_name = "不指定"
            else:
                user = appointment.calendar_event.user
                practitioner_name = get_practitioner_display_name_with_title(
                    db, user.id, clinic.id
                )
            
            # Build context using MessageTemplateService
            context = MessageTemplateService.build_confirmation_context(
                appointment, patient, practitioner_name, clinic
            )
            context['recipient_type'] = 'patient'
            
            return context
        
        # Add other message types as needed
        raise ValueError(f"Unsupported message_type: {scheduled.message_type}")

    @staticmethod
    def send_pending_messages(db: Session, batch_size: int = 100) -> None:
        """
        Send all pending scheduled messages.
        
        This is called by the cron job hourly. Processes messages in batches
        to avoid long-running transactions.
        
        Args:
            db: Database session
            batch_size: Number of messages to process per batch
        """
        current_time = taiwan_now()
        
        while True:
            # Use SELECT FOR UPDATE SKIP LOCKED for concurrent scheduler support
            pending = db.query(ScheduledLineMessage).filter(
                ScheduledLineMessage.status == 'pending',
                ScheduledLineMessage.scheduled_send_time <= current_time
            ).with_for_update(skip_locked=True).limit(batch_size).all()
            
            if not pending:
                break
            
            logger.info(f"Processing {len(pending)} pending scheduled messages")
            
            for scheduled in pending:
                try:
                    # Validate appointment still exists and is valid
                    if not ScheduledMessageService.validate_appointment_for_message(db, scheduled):
                        scheduled.status = 'skipped'
                        scheduled.error_message = 'Appointment no longer valid'
                        db.commit()
                        continue
                    
                    # Build context and render message
                    context = ScheduledMessageService.build_message_context(db, scheduled)
                    resolved_text = MessageTemplateService.render_message(
                        scheduled.message_template,
                        context
                    )
                    
                    # Build analytics labels
                    labels = ScheduledMessageService.build_labels_for_message_type(
                        scheduled.message_type,
                        context
                    )
                    
                    # Get clinic and LINE service
                    clinic = db.query(Clinic).filter(
                        Clinic.id == scheduled.clinic_id
                    ).first()
                    
                    if not clinic or not clinic.line_channel_secret or not clinic.line_channel_access_token:
                        logger.warning(
                            f"Clinic {scheduled.clinic_id} missing LINE credentials, "
                            f"skipping scheduled message {scheduled.id}"
                        )
                        scheduled.status = 'skipped'
                        scheduled.error_message = 'Clinic missing LINE credentials'
                        db.commit()
                        continue
                    
                    line_service = LINEService(
                        channel_secret=clinic.line_channel_secret,
                        channel_access_token=clinic.line_channel_access_token
                    )
                    
                    # Send message (creates LinePushMessage record)
                    line_service.send_text_message(
                        line_user_id=scheduled.recipient_line_user_id,
                        text=resolved_text,
                        labels=labels,
                        db=db,
                        clinic_id=scheduled.clinic_id
                    )
                    
                    # Update status
                    scheduled.status = 'sent'
                    scheduled.actual_send_time = taiwan_now()
                    logger.info(f"Successfully sent scheduled message {scheduled.id}")
                    
                except Exception as e:
                    logger.exception(f"Failed to send scheduled message {scheduled.id}: {e}")
                    scheduled.status = 'failed'
                    scheduled.error_message = str(e)
                    scheduled.retry_count += 1
                    
                    # Retry logic with exponential backoff
                    if scheduled.retry_count < scheduled.max_retries:
                        backoff_hours = 2 ** (scheduled.retry_count - 1)
                        scheduled.scheduled_send_time = taiwan_now() + timedelta(hours=backoff_hours)
                        scheduled.status = 'pending'
                        logger.info(
                            f"Rescheduled message {scheduled.id} for retry {scheduled.retry_count}/"
                            f"{scheduled.max_retries} at {scheduled.scheduled_send_time}"
                        )
                    else:
                        logger.error(
                            f"Message {scheduled.id} failed after {scheduled.max_retries} retries: {e}"
                        )
                
                db.commit()

