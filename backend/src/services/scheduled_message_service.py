"""
Scheduled LINE message service for sending scheduled messages.

This service handles sending all scheduled LINE messages (follow-ups, reminders, etc.)
via a cron job that runs hourly.
"""

import logging
from datetime import timedelta
from typing import Dict, Any
from sqlalchemy.orm import Session

from models.appointment import Appointment  # type: ignore
from models.follow_up_message import FollowUpMessage
from models.scheduled_line_message import ScheduledLineMessage
from models.clinic import Clinic  # type: ignore
from models.patient import Patient  # type: ignore
from models.patient_form_setting import PatientFormSetting  # type: ignore
from models.patient_form_request import PatientFormRequest  # type: ignore
from models.medical_record import MedicalRecord  # type: ignore
from models.line_user import LineUser  # type: ignore
from services.message_template_service import MessageTemplateService
from services.line_service import LINEService
from services.patient_form_request_service import PatientFormRequestService  # type: ignore
from utils.datetime_utils import taiwan_now
from utils.practitioner_helpers import get_practitioner_display_name_with_title
from sqlalchemy import cast, String  # type: ignore
import os  # type: ignore
from typing import Dict, Any
from sqlalchemy.orm import Session

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
        elif message_type == 'patient_form':
            base_labels['event_type'] = 'patient_form_request'
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
            appointment_id = scheduled.message_context.get('appointment_id')  # type: ignore
            if not appointment_id:
                logger.warning(f"Scheduled message {scheduled.id} missing appointment_id in context")
                return False
            
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id  # type: ignore
            ).first()
            
            if not appointment:
                logger.warning(f"Appointment {appointment_id} not found for scheduled message {scheduled.id}")
                return False
            
            # Check appointment status
            if appointment.status != 'confirmed':  # type: ignore
                logger.info(
                    f"Appointment {appointment_id} status is {appointment.status}, "  # type: ignore
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            # Check if appointment type is deleted
            appointment_type = appointment.appointment_type  # type: ignore
            if not appointment_type or appointment_type.is_deleted:  # type: ignore
                logger.info(
                    f"Appointment type {appointment_type.id if appointment_type else 'unknown'} is deleted, "  # type: ignore
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            # Check if follow-up message is still enabled
            follow_up_message_id = scheduled.message_context.get('follow_up_message_id')  # type: ignore
            if follow_up_message_id:
                follow_up = db.query(FollowUpMessage).filter(
                    FollowUpMessage.id == follow_up_message_id  # type: ignore
                ).first()
                
                if not follow_up or not follow_up.is_enabled:  # type: ignore
                    logger.info(
                        f"Follow-up message {follow_up_message_id} is disabled or deleted, "
                        f"skipping scheduled message {scheduled.id}"
                    )
                    return False
            
            return True
        
        elif scheduled.message_type == 'patient_form':
            # For patient form messages, check appointment (if linked)
            appointment_id = scheduled.message_context.get('appointment_id')  # type: ignore
            if appointment_id:
                appointment = db.query(Appointment).filter(
                    Appointment.calendar_event_id == appointment_id  # type: ignore
                ).first()
                
                if not appointment:
                    logger.warning(f"Appointment {appointment_id} not found for scheduled message {scheduled.id}")
                    return False
                
                # Check appointment status
                if appointment.status != 'confirmed':  # type: ignore
                    logger.info(
                        f"Appointment {appointment_id} status is {appointment.status}, "  # type: ignore
                        f"skipping scheduled message {scheduled.id}"
                    )
                    return False
            
            # Check if patient form setting is still enabled
            setting_id = scheduled.message_context.get('patient_form_setting_id')  # type: ignore
            if setting_id:
                from models.patient_form_setting import PatientFormSetting
                setting = db.query(PatientFormSetting).filter(
                    PatientFormSetting.id == setting_id  # type: ignore
                ).first()
                
                if not setting or not setting.is_enabled:  # type: ignore
                    logger.info(
                        f"Patient form setting {setting_id} is disabled or deleted, "
                        f"skipping scheduled message {scheduled.id}"
                    )
                    return False
            
            return True
        
        elif scheduled.message_type == 'appointment_reminder':
            # For reminder messages, check appointment
            appointment_id = scheduled.message_context.get('appointment_id')  # type: ignore
            if not appointment_id:
                logger.warning(f"Scheduled message {scheduled.id} missing appointment_id in context")
                return False
            
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id  # type: ignore
            ).first()
            
            if not appointment:
                logger.warning(f"Appointment {appointment_id} not found for scheduled message {scheduled.id}")
                return False
            
            # Check appointment status
            if appointment.status != 'confirmed':  # type: ignore
                logger.info(
                    f"Appointment {appointment_id} status is {appointment.status}, "  # type: ignore
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            # Check if appointment is still not auto-assigned
            if appointment.is_auto_assigned:  # type: ignore
                logger.info(
                    f"Appointment {appointment_id} is auto-assigned, "
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            # Check if reminder is still enabled for appointment type
            appointment_type = appointment.appointment_type  # type: ignore
            if not appointment_type or appointment_type.is_deleted:  # type: ignore
                logger.info(
                    f"Appointment type {appointment_type.id if appointment_type else 'unknown'} is deleted, "  # type: ignore
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            if not appointment_type.send_reminder:  # type: ignore
                logger.info(
                    f"Reminder disabled for appointment type {appointment_type.id}, "  # type: ignore
                    f"skipping scheduled message {scheduled.id}"
                )
                return False
            
            return True
        
        elif scheduled.message_type == 'practitioner_daily':
            # For practitioner daily notifications, check that at least one appointment is still valid
            appointment_ids = scheduled.message_context.get('appointment_ids', [])  # type: ignore
            if not appointment_ids:
                logger.warning(f"Scheduled message {scheduled.id} missing appointment_ids in context")
                return False
            
            # Check if at least one appointment is still valid (not deleted appointment type)
            valid_appointments = db.query(Appointment).filter(
                Appointment.calendar_event_id.in_(appointment_ids),  # type: ignore
                Appointment.status == 'confirmed'  # type: ignore
            ).all()
            
            # Filter out appointments with deleted appointment types
            valid_appointments = [
                appt for appt in valid_appointments
                if appt.appointment_type and not appt.appointment_type.is_deleted  # type: ignore
            ]
            
            if not valid_appointments:
                logger.info(
                    f"No valid appointments found for scheduled message {scheduled.id}, "
                    f"skipping"
                )
                return False
            
            # Update context with only valid appointment IDs
            scheduled.message_context['appointment_ids'] = [  # type: ignore
                appt.calendar_event_id for appt in valid_appointments  # type: ignore
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
            appointment_id = scheduled.message_context.get('appointment_id')  # type: ignore
            if not appointment_id:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_id")
            
            from models.appointment import Appointment
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id  # type: ignore
            ).first()
            
            if not appointment:
                raise ValueError(f"Appointment {appointment_id} not found")
            
            patient = appointment.patient  # type: ignore
            clinic = patient.clinic  # type: ignore
            
            # Get practitioner name
            if appointment.is_auto_assigned:  # type: ignore
                practitioner_name = "不指定"
            else:
                user = appointment.calendar_event.user  # type: ignore
                practitioner_name = get_practitioner_display_name_with_title(
                    db, user.id, clinic.id  # type: ignore
                )
            
            # Build context using MessageTemplateService
            context = MessageTemplateService.build_confirmation_context(
                appointment, patient, practitioner_name, clinic  # type: ignore
            )
            context['recipient_type'] = 'patient'
            
            return context

        elif scheduled.message_type == 'patient_form':
            # Build context for patient form request
            from services.patient_form_request_service import PatientFormRequestService
            from models.patient import Patient
            from models.clinic import Clinic
            from models.appointment import Appointment
            
            appointment_id = scheduled.message_context.get('appointment_id')  # type: ignore
            patient_form_setting_id = scheduled.message_context.get('patient_form_setting_id')  # type: ignore
            template_id = scheduled.message_context.get('template_id')  # type: ignore
            flex_button_text = scheduled.message_context.get('flex_button_text', '填寫表單')  # type: ignore

            # Find patient and clinic
            # For scheduled messages, we usually have clinic_id on the message
            clinic = db.query(Clinic).filter(Clinic.id == scheduled.clinic_id).first()  # type: ignore
            if not clinic:
                raise ValueError(f"Clinic {scheduled.clinic_id} not found")

            # Find patient from LINE user ID and clinic
            from models.line_user import LineUser
            line_user = db.query(LineUser).filter(
                LineUser.line_user_id == scheduled.recipient_line_user_id,  # type: ignore
                LineUser.clinic_id == scheduled.clinic_id  # type: ignore
            ).first()
            if not line_user or not line_user.patient_id:  # type: ignore
                raise ValueError(f"Patient not found for LINE user {scheduled.recipient_line_user_id}")
            
            patient = db.query(Patient).filter(Patient.id == line_user.patient_id).first()  # type: ignore
            if not patient:
                raise ValueError(f"Patient {line_user.patient_id} not found")  # type: ignore

            # Create the patient form request record
            from services.patient_form_request_service import PatientFormRequestService
            from models.patient_form_setting import PatientFormSetting
            
            notify_admin = False
            notify_appointment_practitioner = False
            notify_assigned_practitioner = False
            
            if patient_form_setting_id:
                setting = db.query(PatientFormSetting).filter(PatientFormSetting.id == patient_form_setting_id).first()  # type: ignore
                if setting:
                    notify_admin = setting.notify_admin  # type: ignore
                    notify_appointment_practitioner = setting.notify_appointment_practitioner  # type: ignore
                    notify_assigned_practitioner = setting.notify_assigned_practitioner  # type: ignore

            request = PatientFormRequestService.create_request(
                db=db,
                clinic_id=scheduled.clinic_id,  # type: ignore
                patient_id=patient.id,  # type: ignore
                template_id=template_id,  # type: ignore
                request_source='auto',
                appointment_id=appointment_id,  # type: ignore
                patient_form_setting_id=patient_form_setting_id,  # type: ignore
                notify_admin=notify_admin,
                notify_appointment_practitioner=notify_appointment_practitioner,
                notify_assigned_practitioner=notify_assigned_practitioner
            )

            # Build context
            if appointment_id:
                appointment = db.query(Appointment).filter(Appointment.calendar_event_id == appointment_id).first()  # type: ignore
                if appointment:
                    # Get practitioner name
                    if appointment.is_auto_assigned:  # type: ignore
                        practitioner_name = "不指定"
                    else:
                        user = appointment.calendar_event.user  # type: ignore
                        practitioner_name = get_practitioner_display_name_with_title(
                            db, user.id, clinic.id  # type: ignore
                        )
                    context = MessageTemplateService.build_confirmation_context(
                        appointment, patient, practitioner_name, clinic  # type: ignore
                    )
                else:
                    # Fallback if appointment not found but ID was provided
                    context = MessageTemplateService.build_patient_context(patient, clinic)  # type: ignore
            else:
                context = MessageTemplateService.build_patient_context(patient, clinic)  # type: ignore

            # Add form link
            # The URL should be the LIFF URL with the access token
            liff_id = clinic.liff_id  # type: ignore
            if not liff_id:
                raise ValueError(f"Clinic {clinic.id} missing liff_id")
            
            form_url = f"https://liff.line.me/{liff_id}?mode=form&token={request.access_token}"  # type: ignore
            context['表單連結'] = form_url  # type: ignore
            context['recipient_type'] = 'patient'  # type: ignore
            
            # Note: The actual Flex Message button rendering happens in LINEService.send_text_message
            # if it detects the {表單連結} placeholder or if we pass it explicitly.
            # For now, we'll just put the URL in the context.
            
            return context  # type: ignore
        
        elif scheduled.message_type == 'appointment_reminder':
            appointment_id = scheduled.message_context.get('appointment_id')  # type: ignore
            if not appointment_id:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_id")
            
            from models.appointment import Appointment
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id  # type: ignore
            ).first()
            
            if not appointment:
                raise ValueError(f"Appointment {appointment_id} not found")
            
            patient = appointment.patient  # type: ignore
            clinic = patient.clinic  # type: ignore
            
            # Get practitioner name
            if appointment.is_auto_assigned:  # type: ignore
                therapist_name = "不指定"
            else:
                user = appointment.calendar_event.user  # type: ignore
                therapist_name = get_practitioner_display_name_with_title(
                    db, user.id, clinic.id  # type: ignore
                )
            
            # Build context using MessageTemplateService
            context = MessageTemplateService.build_reminder_context(
                appointment, patient, therapist_name, clinic  # type: ignore
            )
            context['recipient_type'] = 'patient'
            
            return context
        
        elif scheduled.message_type == 'practitioner_daily':
            # Build context for practitioner daily notification
            appointment_ids = scheduled.message_context.get('appointment_ids', [])  # type: ignore
            if not appointment_ids:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_ids")
            
            appointment_date_str = scheduled.message_context.get('appointment_date')  # type: ignore
            if not appointment_date_str:
                raise ValueError(f"Scheduled message {scheduled.id} missing appointment_date")
            
            from datetime import date
            appointment_date = date.fromisoformat(appointment_date_str)  # type: ignore
            
            # Get all appointments for this date
            from models.appointment import Appointment
            appointments = db.query(Appointment).filter(
                Appointment.calendar_event_id.in_(appointment_ids),  # type: ignore
                Appointment.status == 'confirmed'  # type: ignore
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
                patient_name = appointment.patient.full_name if appointment.patient else "未知病患"  # type: ignore
                
                # Format appointment time
                start_datetime = datetime.combine(
                    appointment.calendar_event.date,  # type: ignore
                    appointment.calendar_event.start_time  # type: ignore
                )
                formatted_time = format_datetime(start_datetime)
                
                # Get appointment type name
                appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"  # type: ignore
                
                message += f"{i}. {formatted_time}\n"
                message += f"   病患：{patient_name}\n"
                message += f"   類型：{appointment_type_name}"
                
                if appointment.notes:  # type: ignore
                    message += f"\n   備註：{appointment.notes}"  # type: ignore
                
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
                        scheduled.status = 'skipped'  # type: ignore
                        scheduled.error_message = 'Appointment no longer valid'  # type: ignore
                        db.commit()
                        continue
                    
                    # Build context and render message
                    context = ScheduledMessageService.build_message_context(db, scheduled)
                    
                    # For practitioner_daily, use the built message directly
                    if scheduled.message_type == 'practitioner_daily':  # type: ignore
                        resolved_text = context.get('built_message', scheduled.message_template)  # type: ignore
                    else:
                        resolved_text = MessageTemplateService.render_message(
                            scheduled.message_template,  # type: ignore
                            context
                        )
                    
                    # Build analytics labels
                    labels = ScheduledMessageService.build_labels_for_message_type(
                        scheduled.message_type,  # type: ignore
                        context
                    )
                    
                    # Get clinic and LINE service
                    clinic = db.query(Clinic).filter(
                        Clinic.id == scheduled.clinic_id  # type: ignore
                    ).first()
                    
                    if not clinic or not clinic.line_channel_secret or not clinic.line_channel_access_token:  # type: ignore
                        logger.warning(
                            f"Clinic {scheduled.clinic_id} missing LINE credentials, "  # type: ignore
                            f"skipping scheduled message {scheduled.id}"
                        )
                        scheduled.status = 'skipped'  # type: ignore
                        scheduled.error_message = 'Clinic missing LINE credentials'  # type: ignore
                        db.commit()
                        continue
                    
                    line_service = LINEService(
                        channel_secret=clinic.line_channel_secret,  # type: ignore
                        channel_access_token=clinic.line_channel_access_token  # type: ignore
                    )
                    
                    # Special handling for patient form to use template message with button
                    if scheduled.message_type == 'patient_form' and '{表單連結}' in scheduled.message_template:  # type: ignore
                        # Extract button text and URL from context
                        button_text = scheduled.message_context.get('flex_button_text', '填寫表單')  # type: ignore
                        form_url = context.get('表單連結')
                        
                        if form_url:
                            # Split message into text before {表單連結} and after
                            parts = scheduled.message_template.split('{表單連結}')  # type: ignore
                            # We'll use the first part as text, and render it
                            text_to_render = parts[0].strip()
                            resolved_text = MessageTemplateService.render_message(
                                text_to_render,
                                context
                            )
                            
                            # Send template message
                            line_service.send_template_message_with_button(
                                line_user_id=scheduled.recipient_line_user_id,  # type: ignore
                                text=resolved_text,
                                button_label=button_text,
                                button_uri=form_url,
                                db=db,
                                clinic_id=scheduled.clinic_id,  # type: ignore
                                labels=labels
                            )
                        else:
                            # Fallback to normal text message if URL missing
                            resolved_text = MessageTemplateService.render_message(
                                scheduled.message_template,  # type: ignore
                                context
                            )
                            line_service.send_text_message(
                                line_user_id=scheduled.recipient_line_user_id,  # type: ignore
                                text=resolved_text,
                                labels=labels,
                                db=db,
                                clinic_id=scheduled.clinic_id  # type: ignore
                            )
                    else:
                        # Send normal text message
                        line_service.send_text_message(
                            line_user_id=scheduled.recipient_line_user_id,  # type: ignore
                            text=resolved_text,
                            labels=labels,
                            db=db,
                            clinic_id=scheduled.clinic_id  # type: ignore
                        )
                    
                    # Update status
                    scheduled.status = 'sent'  # type: ignore
                    scheduled.actual_send_time = taiwan_now()  # type: ignore
                    logger.info(f"Successfully sent scheduled message {scheduled.id}")
                    
                except Exception as e:
                    logger.exception(f"Failed to send scheduled message {scheduled.id}: {e}")
                    scheduled.status = 'failed'  # type: ignore
                    scheduled.error_message = str(e)  # type: ignore
                    scheduled.retry_count += 1  # type: ignore
                    
                    # Retry logic with exponential backoff
                    if scheduled.retry_count < scheduled.max_retries:  # type: ignore
                        backoff_hours = 2 ** (scheduled.retry_count - 1)  # type: ignore
                        scheduled.scheduled_send_time = taiwan_now() + timedelta(hours=backoff_hours)  # type: ignore
                        scheduled.status = 'pending'  # type: ignore
                        logger.info(
                            f"Rescheduled message {scheduled.id} for retry {scheduled.retry_count}/"  # type: ignore
                            f"{scheduled.max_retries} at {scheduled.scheduled_send_time}"  # type: ignore
                        )
                    else:
                        logger.error(
                            f"Message {scheduled.id} failed after {scheduled.max_retries} retries: {e}"  # type: ignore
                        )
                    
                db.commit()

