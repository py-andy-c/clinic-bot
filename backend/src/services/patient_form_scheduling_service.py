"""
Patient form scheduling service for scheduling patient forms relative to appointments.
"""

import logging
from datetime import datetime, timedelta, time as time_type
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import cast, String

from models import Appointment, ScheduledLineMessage, PatientFormSetting
from utils.datetime_utils import taiwan_now, ensure_taiwan

logger = logging.getLogger(__name__)


class PatientFormSchedulingService:
    """Service for scheduling patient forms."""

    @staticmethod
    def calculate_scheduled_time(
        appointment_time: datetime,
        timing_mode: str,
        hours_after: Optional[int] = None,
        days_after: Optional[int] = None,
        time_of_day: Optional[time_type] = None
    ) -> datetime:
        """
        Calculate scheduled send time based on timing mode.
        
        Args:
            appointment_time: When the appointment starts (for immediate) or ends (for others)
            timing_mode: 'immediate', 'hours_after', or 'specific_time'
            hours_after: For 'hours_after' mode
            days_after: For 'specific_time' mode
            time_of_day: For 'specific_time' mode
            
        Returns:
            Scheduled send time
        """
        base_time = ensure_taiwan(appointment_time)
        if base_time is None:
            raise ValueError("appointment_time cannot be None")
        
        if timing_mode == 'immediate':
            return base_time
        
        elif timing_mode == 'hours_after':
            if hours_after is None:
                raise ValueError("hours_after is required for timing_mode='hours_after'")
            return base_time + timedelta(hours=hours_after)
        
        elif timing_mode == 'specific_time':
            if days_after is None or time_of_day is None:
                raise ValueError("days_after and time_of_day are required for timing_mode='specific_time'")
            
            # Calculate target date
            target_date = base_time.date() + timedelta(days=days_after)
            
            # Combine date and time
            scheduled_time = datetime.combine(target_date, time_of_day)
            scheduled_time = ensure_taiwan(scheduled_time)
            if scheduled_time is None:
                raise ValueError("Failed to ensure timezone for scheduled_time")
            
            # Auto-adjust if time is in past (for days_after=0 case)
            if scheduled_time < base_time:
                # Move to next day at same time
                scheduled_time = scheduled_time + timedelta(days=1)
            
            return scheduled_time
        
        else:
            raise ValueError(f"Invalid timing_mode: {timing_mode}")

    @staticmethod
    def schedule_patient_forms(db: Session, appointment: Appointment) -> None:
        """
        Schedule all patient forms for an appointment.
        
        Called when an appointment is created/confirmed.
        """
        appointment_type = appointment.appointment_type  # type: ignore
        if not appointment_type:
            return
        
        # Get all enabled patient form settings for this appointment type
        form_settings = db.query(PatientFormSetting).filter(
            PatientFormSetting.appointment_type_id == appointment_type.id,  # type: ignore
            PatientFormSetting.is_enabled == True  # type: ignore
        ).order_by(PatientFormSetting.display_order).all()  # type: ignore
        
        if not form_settings:
            return
        
        # Check if patient has LINE user
        patient = appointment.patient  # type: ignore
        line_user = patient.line_user  # type: ignore
        if not line_user:
            logger.debug(f"Patient {patient.id} has no LINE user, skipping patient form scheduling")  # type: ignore
            return

        # Calculate base times
        start_datetime = datetime.combine(
            appointment.calendar_event.date,  # type: ignore
            appointment.calendar_event.start_time  # type: ignore
        )
        start_datetime = ensure_taiwan(start_datetime)
        
        # End time for relative scheduling
        appointment_end_time = start_datetime + timedelta(  # type: ignore
            minutes=appointment_type.duration_minutes  # type: ignore
        )
        
        for setting in form_settings:
            try:
                # 'immediate' uses current time, others use end time
                if setting.timing_mode == 'immediate':  # type: ignore
                    scheduled_time = taiwan_now() + timedelta(seconds=5) # Small buffer
                else:
                    scheduled_time = PatientFormSchedulingService.calculate_scheduled_time(
                        appointment_end_time,  # type: ignore
                        setting.timing_mode,  # type: ignore
                        setting.hours_after,  # type: ignore
                        setting.days_after,  # type: ignore
                        setting.time_of_day  # type: ignore
                    )
                
                # Validate scheduled time is not in past
                current_time = taiwan_now()
                if scheduled_time < current_time:
                    # For immediate, if it's just a few seconds/minutes past, we can still send it
                    # But if it's significantly in the past, skip it
                    if setting.timing_mode == 'immediate' and (current_time - scheduled_time).total_seconds() < 3600:  # type: ignore
                        scheduled_time = current_time + timedelta(seconds=5)
                    else:
                        logger.warning(f"Skipping patient form {setting.id} - scheduled time {scheduled_time} is in past")  # type: ignore
                        continue
                
                # Create scheduled message record
                scheduled = ScheduledLineMessage(
                    recipient_type='patient',
                    recipient_line_user_id=line_user.line_user_id,  # type: ignore
                    clinic_id=appointment.patient.clinic_id,  # type: ignore
                    message_type='patient_form',
                    message_template=setting.message_template,  # type: ignore
                    message_context={
                        'appointment_id': appointment.calendar_event_id,  # type: ignore
                        'patient_form_setting_id': setting.id,  # type: ignore
                        'template_id': setting.template_id,  # type: ignore
                        'flex_button_text': setting.flex_button_text  # type: ignore
                    },
                    scheduled_send_time=scheduled_time,
                    status='pending'
                )
                db.add(scheduled)
            except Exception as e:
                logger.exception(f"Failed to schedule patient form {setting.id} for appointment {appointment.calendar_event_id}: {e}")  # type: ignore
        
        try:
            db.commit()
        except Exception as e:
            logger.exception(f"Failed to commit scheduled patient forms for appointment {appointment.calendar_event_id}: {e}")  # type: ignore
            db.rollback()

    @staticmethod
    def cancel_pending_patient_forms(db: Session, appointment_id: int) -> None:
        """Cancel all pending patient forms for an appointment."""
        updated = db.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form',  # type: ignore
            ScheduledLineMessage.status == 'pending',  # type: ignore
            cast(ScheduledLineMessage.message_context['appointment_id'].astext, String) == str(appointment_id)  # type: ignore
        ).update(
            {'status': 'skipped'},
            synchronize_session=False
        )
        
        if updated > 0:
            try:
                db.commit()
            except Exception as e:
                logger.exception(f"Failed to commit cancellation of patient forms for appointment {appointment_id}: {e}")
                db.rollback()

    @staticmethod
    def reschedule_patient_forms(db: Session, appointment: Appointment) -> None:
        """Reschedule all patient forms for an appointment."""
        PatientFormSchedulingService.cancel_pending_patient_forms(db, appointment.calendar_event_id)  # type: ignore
        PatientFormSchedulingService.schedule_patient_forms(db, appointment)
