"""
Patient form scheduler service for automated patient form sending.

This service handles scheduling patient forms (medical records) to be sent
before or after appointments based on appointment type configuration.
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import cast, String

from models import (
    Appointment,
    AppointmentTypePatientFormConfig,
    ScheduledLineMessage,
    MedicalRecord,
    MedicalRecordTemplate
)
from services.line_service import LINEService
from services.message_template_service import MessageTemplateService
from utils.datetime_utils import taiwan_now, ensure_taiwan
from utils.timing_utils import calculate_scheduled_time
from utils.liff_token import generate_liff_url

logger = logging.getLogger(__name__)


class PatientFormSchedulerService:
    """Service for scheduling automated patient form sending."""

    @staticmethod
    def _send_patient_form_immediately(
        db: Session,
        appointment: Appointment,
        config: AppointmentTypePatientFormConfig,
        template: MedicalRecordTemplate
    ) -> None:
        """
        Send a patient form immediately (synchronously).
        
        This is used for 'send_immediately' cases when timing is impossible.
        Creates the MedicalRecord and sends the LINE message synchronously.
        
        Args:
            db: Database session
            appointment: Appointment to send form for
            config: Patient form configuration
            template: Medical record template
            
        Raises:
            Exception: If send fails (caller should handle)
        """
        patient = appointment.patient
        line_user = patient.line_user
        clinic = patient.clinic
        
        if not line_user:
            raise ValueError(f"Patient {patient.id} has no LINE user")
        
        # Check if medical record already exists (de-duplication)
        existing_record = db.query(MedicalRecord).filter(
            MedicalRecord.appointment_id == appointment.calendar_event_id,
            MedicalRecord.template_id == template.id
        ).first()
        
        if existing_record:
            medical_record = existing_record
            logger.info(
                f"Reusing existing medical record {medical_record.id} for immediate send"
            )
        else:
            # Create medical record
            medical_record = MedicalRecord(
                clinic_id=clinic.id,
                patient_id=patient.id,
                template_id=template.id,
                template_name=template.name,
                template_snapshot={"fields": template.fields},
                values={},
                appointment_id=appointment.calendar_event_id,
                created_by_user_id=None,  # System-created
                is_submitted=False
            )
            db.add(medical_record)
            db.flush()
            db.commit()  # Commit before sending (Commit-Before-Send pattern)
            logger.info(
                f"Created medical record {medical_record.id} for immediate send"
            )
        
        # Generate LIFF URL
        liff_url = generate_liff_url(
            clinic=clinic,
            mode="form",
            path=f"records/{medical_record.id}"
        )
        
        # Render message
        message_template = template.message_template or "請填寫{模板名稱}"
        context = {
            '病患姓名': patient.full_name,
            '模板名稱': template.name,
            '診所名稱': clinic.effective_display_name or clinic.name
        }
        resolved_text = MessageTemplateService.render_message(
            message_template,
            context
        )
        
        # Send LINE message with timeout
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
                'trigger_source': 'system_triggered_immediate'
            },
            db=db
        )
        
        logger.info(
            f"Successfully sent patient form immediately for appointment {appointment.calendar_event_id}, "
            f"medical record {medical_record.id}"
        )

    @staticmethod
    def schedule_patient_forms(db: Session, appointment: Appointment) -> list[str]:
        """
        Schedule all patient forms for an appointment.
        
        This is called when an appointment is created and confirmed.
        It creates ScheduledLineMessage records for all enabled patient form configs.
        For 'send_immediately' cases, sends synchronously and returns warnings if failed.
        
        Args:
            db: Database session
            appointment: Appointment to schedule patient forms for
            
        Returns:
            List of warning messages for forms that failed to send immediately
        """
        warnings: list[str] = []
        
        appointment_type = appointment.appointment_type
        if not appointment_type:
            logger.warning(f"Appointment {appointment.calendar_event_id} has no appointment type")
            return warnings
        
        # Get all enabled patient form configs for this appointment type
        configs = db.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.appointment_type_id == appointment_type.id,
            AppointmentTypePatientFormConfig.is_enabled == True
        ).order_by(AppointmentTypePatientFormConfig.display_order).all()
        
        if not configs:
            return warnings
        
        # Calculate appointment start and end times
        start_datetime = datetime.combine(
            appointment.calendar_event.date,
            appointment.calendar_event.start_time
        )
        start_datetime = ensure_taiwan(start_datetime)
        if start_datetime is None:
            raise ValueError("Failed to ensure timezone for start_datetime")
        
        end_datetime = start_datetime + timedelta(
            minutes=appointment_type.duration_minutes
        )
        
        # Check if patient has LINE user
        patient = appointment.patient
        line_user = patient.line_user
        
        if not line_user:
            logger.debug(f"Patient {patient.id} has no LINE user, skipping patient form scheduling")
            return warnings
        
        current_time = taiwan_now()
        
        # Schedule each patient form
        for config in configs:
            try:
                template = config.medical_record_template
                
                # Check if form was already sent (prevent duplicates on reschedule)
                existing_record = db.query(MedicalRecord).filter(
                    MedicalRecord.appointment_id == appointment.calendar_event_id,
                    MedicalRecord.template_id == template.id
                ).first()
                
                if existing_record:
                    logger.info(
                        f"Skipping patient form config {config.id} - medical record {existing_record.id} "
                        f"already exists for appointment {appointment.calendar_event_id}"
                    )
                    continue
                
                # Determine reference time based on timing_type
                reference_time = start_datetime if config.timing_type == 'before' else end_datetime
                
                # Cast timing_type and timing_mode to expected literal types for type safety
                from typing import Literal, cast as type_cast
                timing_type = type_cast(Literal['before', 'after'], config.timing_type)
                timing_mode = type_cast(Literal['hours', 'specific_time'], config.timing_mode)
                
                # Calculate scheduled time
                scheduled_time = calculate_scheduled_time(
                    reference_time,
                    timing_type,
                    timing_mode,
                    config.hours,
                    config.days,
                    config.time_of_day
                )
                
                # Handle late booking logic for 'before' timing
                should_send_immediately = False
                if config.timing_type == 'before':
                    if scheduled_time < current_time:
                        # Check if appointment start time is also in the past (recorded walk-in)
                        if start_datetime < current_time:
                            logger.info(
                                f"Skipping patient form config {config.id} - appointment {appointment.calendar_event_id} "
                                f"start time is in past (recorded walk-in)"
                            )
                            continue
                        
                        # Handle based on on_impossible setting
                        if config.on_impossible == 'skip':
                            logger.info(
                                f"Skipping patient form config {config.id} - scheduled time {scheduled_time} "
                                f"is in past and on_impossible='skip'"
                            )
                            continue
                        elif config.on_impossible == 'send_immediately':
                            # Send immediately (synchronously)
                            should_send_immediately = True
                            logger.info(
                                f"Will send patient form config {config.id} immediately "
                                f"(scheduled time {scheduled_time} is in past)"
                            )
                
                # Send immediately if needed
                if should_send_immediately:
                    try:
                        PatientFormSchedulerService._send_patient_form_immediately(
                            db, appointment, config, template
                        )
                    except Exception as e:
                        warning = f"無法發送病患表單 '{template.name}': {str(e)}"
                        warnings.append(warning)
                        logger.warning(
                            f"Failed to send patient form immediately for config {config.id}: {e}",
                            exc_info=True
                        )
                    continue  # Don't schedule if sent immediately
                
                # Validate scheduled time is not in past (for 'after' timing or adjusted 'before' timing)
                if scheduled_time < current_time:
                    logger.warning(
                        f"Skipping patient form config {config.id} - scheduled time {scheduled_time} is in past"
                    )
                    continue
                
                # Get template for message
                message_template = template.message_template or "請填寫{模板名稱}"
                
                # Create scheduled message record
                scheduled = ScheduledLineMessage(
                    recipient_type='patient',
                    recipient_line_user_id=line_user.line_user_id,
                    clinic_id=appointment.patient.clinic_id,
                    message_type='patient_form',
                    message_template=message_template,
                    message_context={
                        'appointment_id': appointment.calendar_event_id,
                        'patient_form_config_id': config.id,
                        'medical_record_template_id': config.medical_record_template_id
                    },
                    scheduled_send_time=scheduled_time,
                    status='pending'
                )
                db.add(scheduled)
                logger.debug(
                    f"Scheduled patient form config {config.id} for appointment {appointment.calendar_event_id} "
                    f"at {scheduled_time}"
                )
            except Exception as e:
                logger.exception(
                    f"Failed to schedule patient form config {config.id} for appointment "
                    f"{appointment.calendar_event_id}: {e}"
                )
                # Continue with other configs even if one fails
        
        # Commit all successfully scheduled messages
        # If commit fails, log error but don't raise - appointment is already created
        try:
            db.commit()
        except Exception as e:
            logger.exception(f"Failed to commit scheduled patient forms for appointment {appointment.calendar_event_id}: {e}")
            db.rollback()
            # Don't raise - appointment is already committed, we just failed to schedule messages
        
        return warnings

    @staticmethod
    def cancel_pending_patient_forms(db: Session, appointment_id: int) -> None:
        """
        Cancel all pending patient forms for an appointment.
        
        This is called when an appointment is canceled or edited.
        
        Args:
            db: Database session
            appointment_id: Calendar event ID of the appointment
        """
        # Use PostgreSQL JSONB operator to safely extract and compare appointment_id
        # Cast to string for comparison since JSONB stores numbers as strings in text extraction
        updated = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form',
            ScheduledLineMessage.status == 'pending',
            cast(ScheduledLineMessage.message_context['appointment_id'].astext, String) == str(appointment_id)
        ).update(
            {'status': 'skipped'},
            synchronize_session=False
        )
        
        if updated > 0:
            logger.info(f"Cancelled {updated} pending patient forms for appointment {appointment_id}")
            try:
                db.commit()
            except Exception as e:
                logger.exception(f"Failed to commit cancellation of patient forms for appointment {appointment_id}: {e}")
                db.rollback()
                # Don't raise - appointment is already canceled, we just failed to update message status

    @staticmethod
    def reschedule_patient_forms(db: Session, appointment: Appointment) -> list[str]:
        """
        Reschedule all patient forms for an appointment.
        
        This cancels existing pending messages and schedules new ones.
        Called when appointment time is edited.
        
        Args:
            db: Database session
            appointment: Appointment to reschedule patient forms for
            
        Returns:
            List of warning messages for forms that failed to send immediately
        """
        # Cancel existing pending messages
        PatientFormSchedulerService.cancel_pending_patient_forms(
            db, appointment.calendar_event_id
        )
        
        # Schedule new messages (will skip if form was already sent)
        return PatientFormSchedulerService.schedule_patient_forms(db, appointment)
