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
    Clinic, MedicalRecord
)
from services.message_template_service import MessageTemplateService
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now
from utils.practitioner_helpers import get_practitioner_display_name_with_title

logger = logging.getLogger(__name__)


class ScheduledMessageService:
    """Service for sending scheduled LINE messages."""

    @staticmethod
    def _process_patient_form_message(
        db: Session,
        scheduled: ScheduledLineMessage
    ) -> bool:
        """
        Process patient form message with Commit-Before-Send flow.
        
        This implements the robust message processing requirements:
        1. De-duplication check: Don't create duplicate medical records
        2. Commit-Before-Send: Create and commit medical record BEFORE sending LINE message
        3. Audit trail: Link medical_record_id in message_context after successful send
        
        Args:
            db: Database session
            scheduled: Scheduled message to process
            
        Returns:
            True if processing was successful, False if skipped/failed
        """
        from models import MedicalRecord, MedicalRecordTemplate, Patient, LineUser
        from utils.liff_token import generate_liff_url
        
        try:
            # Extract context
            appointment_id = scheduled.message_context.get('appointment_id')
            template_id = scheduled.message_context.get('medical_record_template_id')
            
            if not appointment_id or not template_id:
                logger.warning(
                    f"Scheduled message {scheduled.id} missing appointment_id or template_id"
                )
                scheduled.status = 'skipped'
                scheduled.error_message = 'Missing required context'
                db.commit()
                return False
            
            # Get appointment
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).first()
            
            if not appointment:
                logger.warning(f"Appointment {appointment_id} not found")
                scheduled.status = 'skipped'
                scheduled.error_message = 'Appointment not found'
                db.commit()
                return False
            
            patient = appointment.patient
            clinic = patient.clinic
            
            # Check if patient has LINE user
            line_user = patient.line_user
            if not line_user:
                logger.warning(f"Patient {patient.id} has no LINE user")
                scheduled.status = 'skipped'
                scheduled.error_message = 'Patient has no LINE user'
                db.commit()
                return False
            
            # Get template first (needed for creating medical record)
            template = db.query(MedicalRecordTemplate).filter(
                MedicalRecordTemplate.id == template_id
            ).first()
            
            if not template:
                logger.warning(f"Template {template_id} not found")
                scheduled.status = 'skipped'
                scheduled.error_message = 'Template not found'
                db.commit()
                return False
            
            # DE-DUPLICATION CHECK: Check if medical record already exists for this appointment + template
            existing_record = db.query(MedicalRecord).filter(
                MedicalRecord.appointment_id == appointment_id,
                MedicalRecord.template_id == template_id
            ).first()
            
            if existing_record:
                logger.info(
                    f"Medical record already exists for appointment {appointment_id} "
                    f"and template {template_id}, skipping creation"
                )
                # Update message context with existing record ID for audit trail
                from sqlalchemy.orm.attributes import flag_modified
                scheduled.message_context['medical_record_id'] = existing_record.id
                flag_modified(scheduled, 'message_context')
                # Still try to send the message (retry scenario)
                medical_record = existing_record
            else:
                # COMMIT-BEFORE-SEND: Create and commit medical record BEFORE sending message
                # Set status to 'processing' to prevent race condition with other workers
                # This must be done BEFORE committing the medical record
                scheduled.status = 'processing'
                
                medical_record = MedicalRecord(
                    clinic_id=clinic.id,
                    patient_id=patient.id,
                    template_id=template_id,
                    template_name=template.name,
                    template_snapshot={"fields": template.fields},
                    values={},  # Empty values for patient to fill
                    appointment_id=appointment_id,
                    created_by_user_id=None,  # System-created
                    is_submitted=False
                )
                db.add(medical_record)
                db.flush()  # Get medical_record.id
                
                # Commit the medical record BEFORE attempting to send LINE message
                # This ensures the LIFF link will never be broken
                # The 'processing' status prevents other workers from picking up this message
                db.commit()
                logger.info(
                    f"Created medical record {medical_record.id} for appointment {appointment_id}"
                )
            
            # Generate LIFF URL
            try:
                liff_url = generate_liff_url(
                    clinic=clinic,
                    mode="form",
                    path=f"records/{medical_record.id}"
                )
            except ValueError as e:
                logger.error(f"Failed to generate LIFF URL: {e}")
                scheduled.status = 'failed'
                scheduled.error_message = f'LIFF configuration error: {str(e)}'
                scheduled.retry_count += 1
                
                # Retry logic
                if scheduled.retry_count < scheduled.max_retries:
                    backoff_hours = 2 ** (scheduled.retry_count - 1)
                    scheduled.scheduled_send_time = taiwan_now() + timedelta(hours=backoff_hours)
                    scheduled.status = 'pending'
                    logger.info(
                        f"Rescheduled message {scheduled.id} for retry {scheduled.retry_count}/"
                        f"{scheduled.max_retries}"
                    )
                
                db.commit()
                return False
            
            # Render message
            context = {
                '病患姓名': patient.full_name,
                '模板名稱': template.name,
                '診所名稱': clinic.effective_display_name or clinic.name
            }
            
            resolved_text = MessageTemplateService.render_message(
                scheduled.message_template,
                context
            )
            
            # Send LINE message with button
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            
            line_service.send_template_message_with_button(
                line_user_id=line_user.line_user_id,
                text=resolved_text,
                button_label="填寫表單 (Fill Form)",
                button_uri=liff_url,
                clinic_id=clinic.id,
                labels={
                    'event_type': 'patient_form_request',
                    'recipient_type': 'patient',
                    'trigger_source': 'system_triggered'
                },
                db=db
            )
            
            # AUDIT TRAIL: Update message context with medical_record_id
            # Use flag_modified to ensure SQLAlchemy detects the JSONB change
            from sqlalchemy.orm.attributes import flag_modified
            scheduled.message_context['medical_record_id'] = medical_record.id
            flag_modified(scheduled, 'message_context')
            scheduled.status = 'sent'
            scheduled.actual_send_time = taiwan_now()
            db.commit()
            
            logger.info(
                f"Successfully sent patient form message {scheduled.id} "
                f"for medical record {medical_record.id}"
            )
            return True
            
        except Exception as e:
            logger.exception(f"Failed to process patient form message {scheduled.id}: {e}")
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
                    f"{scheduled.max_retries}"
                )
            else:
                logger.error(
                    f"Message {scheduled.id} failed after {scheduled.max_retries} retries: {e}"
                )
            
            db.commit()
            return False

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
        if scheduled.message_type == 'follow_up':
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
            
            # Check if appointment type is deleted
            appointment_type = appointment.appointment_type
            if not appointment_type or appointment_type.is_deleted:
                logger.info(
                    f"Appointment type {appointment_type.id if appointment_type else 'unknown'} is deleted, "
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
        
        elif scheduled.message_type == 'patient_form':
            # For patient form messages, check appointment and config
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
            
            # Check if appointment type is deleted
            appointment_type = appointment.appointment_type
            if not appointment_type or appointment_type.is_deleted:
                logger.info(
                    f"Appointment type {appointment_type.id if appointment_type else 'unknown'} is deleted, "
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            # Check if patient form config is still enabled
            from models import AppointmentTypePatientFormConfig
            config_id = scheduled.message_context.get('patient_form_config_id')
            if config_id:
                config = db.query(AppointmentTypePatientFormConfig).filter(
                    AppointmentTypePatientFormConfig.id == config_id
                ).first()
                
                if not config or not config.is_enabled:
                    logger.info(
                        f"Patient form config {config_id} is disabled or deleted, "
                        f"skipping scheduled message {scheduled.id}"
                    )
                    return False
            
            return True
        
        elif scheduled.message_type == 'appointment_reminder':
            # For reminder messages, check appointment
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
            
            # Check if appointment is still not auto-assigned
            if appointment.is_auto_assigned:
                logger.info(
                    f"Appointment {appointment_id} is auto-assigned, "
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            # Check if reminder is still enabled for appointment type
            appointment_type = appointment.appointment_type
            if not appointment_type or appointment_type.is_deleted:
                logger.info(
                    f"Appointment type {appointment_type.id if appointment_type else 'unknown'} is deleted, "
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            if not appointment_type.send_reminder:
                logger.info(
                    f"Reminder disabled for appointment type {appointment_type.id}, "
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            return True
        
        elif scheduled.message_type == 'practitioner_daily':
            # For practitioner daily notifications, check that at least one appointment is still valid
            appointment_ids = scheduled.message_context.get('appointment_ids', [])
            if not appointment_ids:
                logger.warning(f"Scheduled message {scheduled.id} missing appointment_ids in context")
                return False
            
            # Check if at least one appointment is still valid (not deleted appointment type)
            valid_appointments = db.query(Appointment).filter(
                Appointment.calendar_event_id.in_(appointment_ids),
                Appointment.status == 'confirmed'
            ).all()
            
            # Filter out appointments with deleted appointment types
            valid_appointments = [
                appt for appt in valid_appointments
                if appt.appointment_type and not appt.appointment_type.is_deleted
            ]
            
            if not valid_appointments:
                logger.info(
                    f"No valid appointments found for scheduled message {scheduled.id}, "
                    f"skipping"
                )
                return False
            
            # Update context with only valid appointment IDs
            scheduled.message_context['appointment_ids'] = [
                appt.calendar_event_id for appt in valid_appointments
            ]
            
            return True
        
        # For other message types, assume valid
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
        
        elif scheduled.message_type == 'patient_form':
            # For patient form messages, we need to create the medical record first
            # This is handled in send_pending_messages with the "Commit-Before-Send" flow
            appointment_id = scheduled.message_context.get('appointment_id')
            template_id = scheduled.message_context.get('medical_record_template_id')
            
            if not appointment_id or not template_id:
                raise ValueError(
                    f"Scheduled message {scheduled.id} missing appointment_id or medical_record_template_id"
                )
            
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).first()
            
            if not appointment:
                raise ValueError(f"Appointment {appointment_id} not found")
            
            from models import MedicalRecordTemplate
            template = db.query(MedicalRecordTemplate).filter(
                MedicalRecordTemplate.id == template_id
            ).first()
            
            if not template:
                raise ValueError(f"Medical record template {template_id} not found")
            
            patient = appointment.patient
            clinic = patient.clinic
            
            # Build context for message rendering
            context = {
                '病患姓名': patient.full_name,
                '模板名稱': template.name,
                '診所名稱': clinic.effective_display_name or clinic.name,
                'recipient_type': 'patient'
            }
            
            return context
        
        elif scheduled.message_type == 'appointment_reminder':
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
                therapist_name = "不指定"
            else:
                user = appointment.calendar_event.user
                therapist_name = get_practitioner_display_name_with_title(
                    db, user.id, clinic.id
                )
            
            # Build context using MessageTemplateService
            context = MessageTemplateService.build_reminder_context(
                appointment, patient, therapist_name, clinic
            )
            context['recipient_type'] = 'patient'
            
            return context
        
        elif scheduled.message_type == 'practitioner_daily':
            # Build context for practitioner daily notification
            appointment_ids = scheduled.message_context.get('appointment_ids', [])
            if not appointment_ids:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_ids")
            
            appointment_date_str = scheduled.message_context.get('appointment_date')
            if not appointment_date_str:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_date")
            
            from datetime import date
            appointment_date = date.fromisoformat(appointment_date_str)
            
            # Get all appointments for this date
            appointments = db.query(Appointment).filter(
                Appointment.calendar_event_id.in_(appointment_ids),
                Appointment.status == 'confirmed'
            ).all()
            
            if not appointments:
                raise ValueError(f"No valid appointments found for scheduled message {scheduled.id}")
            
            # Build notification message
            from utils.datetime_utils import format_datetime
            from datetime import datetime
            
            date_str = appointment_date.strftime("%Y年%m月%d日")
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
            
            # Return context with the built message
            # Note: We override the template with the built message since practitioner notifications
            # don't use the standard template system
            context = {
                'recipient_type': 'practitioner',
                'built_message': message
            }
            
            return context
        
        # Add other message types as needed
        raise ValueError(f"Unsupported message_type: {scheduled.message_type}")

    @staticmethod
    def send_pending_messages(db: Session, batch_size: int = 100) -> None:
        """
        Send all pending scheduled messages.
        
        This is called by the cron job hourly. Processes messages in batches
        to avoid long-running transactions.
        
        Rate Limiting:
        - No artificial delays are added between message sends
        - LINE API allows 2,000 requests/second per channel, which is far above
          our typical usage (hourly batches of ~100 messages)
        - If rate limits are exceeded (429 errors), the retry logic with exponential
          backoff handles it gracefully
        - This approach maximizes throughput while remaining safe
        - Note: Monitor production logs for 429 errors. If frequent, consider adding
          per-clinic rate limiting or increasing batch processing delays
        
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
                    
                    # Special handling for patient_form: Commit-Before-Send flow
                    if scheduled.message_type == 'patient_form':
                        # Process patient form with de-duplication and commit-before-send
                        success = ScheduledMessageService._process_patient_form_message(
                            db, scheduled
                        )
                        if not success:
                            # Already handled (skipped or failed), continue to next message
                            continue
                        # If successful, status is already updated and committed
                        continue
                    
                    # Build context and render message
                    context = ScheduledMessageService.build_message_context(db, scheduled)
                    
                    # For practitioner_daily, use the built message directly
                    if scheduled.message_type == 'practitioner_daily':
                        resolved_text = context.get('built_message', scheduled.message_template)
                    else:
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
                    
                    # No rate limiting delays: LINE API allows 2,000 requests/second per channel.
                    # Our scheduled messages are sent hourly in batches of 100, so we're well below limits.
                    # If we exceed limits and receive 429 errors, the retry logic with exponential backoff
                    # (below) will handle it gracefully. Adding fixed delays would unnecessarily slow down
                    # message sending, especially when scaling to many clinics and appointments.
                    # Reference: https://developers.line.biz/en/reference/messaging-api/
                    
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

