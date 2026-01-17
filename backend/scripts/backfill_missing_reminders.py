import os
import sys
from datetime import datetime, timedelta
import logging

# Add src to path
sys.path.append(os.path.join(os.getcwd(), 'backend', 'src'))

from sqlalchemy import cast, String, text
from core.database import get_db_context
from models import Appointment, AppointmentType, ScheduledLineMessage, Clinic, CalendarEvent, Patient, LineUser
from utils.datetime_utils import taiwan_now, TAIWAN_TZ, ensure_taiwan
from services.reminder_scheduling_service import ReminderSchedulingService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def backfill_reminders(dry_run: bool = True):
    """
    Find and schedule missing appointment reminders.
    
    Logic:
    1. Find all confirmed, manually-assigned appointments with reminder-enabled types.
    2. Exclude those that already have a reminder scheduled.
    3. Exclude those starting in less than 3 hours.
    4. For others:
       - Calculate ideal reminder time (e.g., 24h before).
       - If ideal time is in the past, schedule for 'now + 1 minute' (catch-up).
       - Otherwise, schedule for the ideal time.
    """
    now = taiwan_now()
    cutoff_time = now + timedelta(hours=3)
    
    logger.info(f"Starting backfill [Dry Run: {dry_run}]")
    logger.info(f"Current Taiwan Time: {now}")
    logger.info(f"Catch-up cutoff (Appts must be after): {cutoff_time}")

    with get_db_context() as db:
        # 1. Identify missing reminders
        # We query for appointments that should have reminders but don't
        missing_query = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).join(
            AppointmentType, Appointment.appointment_type_id == AppointmentType.id
        ).join(
            Patient, Appointment.patient_id == Patient.id
        ).join(
            Clinic, Patient.clinic_id == Clinic.id
        ).filter(
            Appointment.status == 'confirmed',
            Appointment.is_auto_assigned == False,
            AppointmentType.send_reminder == True,
            # Appointment is at least 3 hours away
            text("(calendar_events.date + calendar_events.start_time) > :cutoff").params(cutoff=cutoff_time)
        )

        appointments = missing_query.all()
        
        to_schedule = []
        for appt in appointments:
            # Check if reminder already exists in scheduled_line_messages
            # We skip if there's an active or already sent reminder
            exists = db.query(ScheduledLineMessage).filter(
                ScheduledLineMessage.message_type == 'appointment_reminder',
                ScheduledLineMessage.status.in_(['pending', 'sent']),
                cast(ScheduledLineMessage.message_context['appointment_id'].astext, String) == str(appt.calendar_event_id)
            ).first()
            
            if exists:
                continue

            # Check if patient has a LINE user
            line_user = appt.patient.line_user
            if not line_user:
                continue
                
            clinic = appt.patient.clinic
            
            # Calculate ideal send time using the service logic
            if clinic.reminder_timing_mode == "previous_day":
                ideal_send_time = ReminderSchedulingService.calculate_previous_day_send_time(appt.calendar_event, clinic)
            else:
                start_dt = datetime.combine(appt.calendar_event.date, appt.calendar_event.start_time)
                start_dt = ensure_taiwan(start_dt)
                ideal_send_time = start_dt - timedelta(hours=clinic.reminder_hours_before)

            # Determine actual send time (catch up if past due)
            is_catchup = False
            if ideal_send_time < now:
                # Catch up: send in 1 minute
                scheduled_time = now + timedelta(minutes=1)
                is_catchup = True
            else:
                scheduled_time = ideal_send_time

            logger.info(
                f"{'[CATCHUP]' if is_catchup else '[NORMAL]'} "
                f"Appt {appt.calendar_event_id} at {appt.calendar_event.date} {appt.calendar_event.start_time} "
                f"-> Schedule at {scheduled_time}"
            )

            if not dry_run:
                msg = ScheduledLineMessage(
                    recipient_type='patient',
                    recipient_line_user_id=line_user.line_user_id,
                    clinic_id=clinic.id,
                    message_type='appointment_reminder',
                    message_template=appt.appointment_type.reminder_message,
                    message_context={'appointment_id': appt.calendar_event_id},
                    scheduled_send_time=scheduled_time,
                    status='pending'
                )
                db.add(msg)
                to_schedule.append(msg)

        if not dry_run:
            db.commit()
            logger.info(f"Successfully scheduled {len(to_schedule)} reminders.")
        else:
            # In dry run, we would have scheduled all appointments that passed the filters
            logger.info(f"Dry run complete. Would have scheduled {len(appointments)} reminders.")

if __name__ == "__main__":
    is_real = len(sys.argv) > 1 and sys.argv[1] == "--real"
    backfill_reminders(dry_run=not is_real)
