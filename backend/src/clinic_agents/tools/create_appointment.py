# pyright: reportMissingTypeStubs=false
"""
Tool for creating appointments.

This tool creates new appointments with Google Calendar synchronization,
including conflict checking and database transaction handling.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any

from agents import function_tool, RunContextWrapper
from sqlalchemy.exc import IntegrityError

from models import User
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from services.google_calendar_service import GoogleCalendarService
from services.encryption_service import get_encryption_service
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


async def create_appointment_impl(
    wrapper: RunContextWrapper[ConversationContext],
    therapist_id: int,
    appointment_type_id: int,
    start_time: datetime,
    patient_id: int
) -> Dict[str, Any]:
    """Core implementation for creating an appointment with GCal sync."""
    db = wrapper.context.db_session

    try:
        # Load related entities
        # Note: Filter roles in Python because SQLite JSON operations don't work reliably
        practitioner = db.query(User).filter(
            User.id == therapist_id,
            User.is_active == True
        ).first()

        # Verify practitioner role
        if practitioner and 'practitioner' not in practitioner.roles:
            practitioner = None
        patient = db.get(Patient, patient_id)
        apt_type = db.get(AppointmentType, appointment_type_id)

        if practitioner is None:
            return {"error": "找不到指定的治療師"}
        if patient is None:
            return {"error": "找不到指定的病人"}
        if apt_type is None:
            return {"error": "找不到指定的預約類型"}

        # Calculate end time
        end_time = start_time + timedelta(minutes=apt_type.duration_minutes)

        # Prevent double-booking: check for overlapping appointments for this practitioner
        conflict = db.query(CalendarEvent).filter(
            CalendarEvent.user_id == therapist_id,
            CalendarEvent.event_type == 'appointment',
            CalendarEvent.date == start_time.date(),
            CalendarEvent.start_time < end_time.time(),
            CalendarEvent.end_time > start_time.time(),
        ).first()
        if conflict is not None:
            return {"error": "預約時間衝突，請選擇其他時段"}

        # Create database records FIRST (appointment should always be created)
        calendar_event = CalendarEvent(
            user_id=therapist_id,
            event_type='appointment',
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
            gcal_event_id=None  # Will be set if Google Calendar sync succeeds
        )
        db.add(calendar_event)
        db.flush()  # Get the calendar_event ID

        # Create appointment record
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient_id,
            appointment_type_id=appointment_type_id,
            status='confirmed'
        )
        db.add(appointment)
        db.commit()  # Commit to get appointment ID

        logger.info(f"Appointment created in database: {appointment.calendar_event_id}")

        # Attempt Google Calendar sync (optional - won't block appointment creation)
        gcal_event_id = None
        if practitioner.gcal_credentials:
            try:
                gcal_credentials = get_encryption_service().decrypt_data(practitioner.gcal_credentials)
                logger.info(f"Decrypting Google Calendar credentials for practitioner {practitioner.full_name} (ID: {practitioner.id})")

                gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))
                logger.info(f"Creating Google Calendar event for appointment: {patient.full_name} with {practitioner.full_name} at {start_time}")

                # Prepare extended properties (avoid None values - Google Calendar API doesn't accept them)
                extended_properties = {
                    "private": {
                        "source": "line_bot",
                        "patient_id": str(patient_id),
                        "appointment_db_id": str(appointment.calendar_event_id)
                    }
                }

                gcal_event = await gcal_service.create_event(
                    summary=f"{patient.full_name} - {apt_type.name}",
                    start=start_time,
                    end=end_time,
                    description=(
                        f"Patient: {patient.full_name}\n"
                        f"Phone: {patient.phone_number}\n"
                        f"Type: {apt_type.name}\n"
                        f"Scheduled Via: LINE Bot"
                    ),
                    color_id="7",  # Blue color for appointments
                    extended_properties=extended_properties
                )
                gcal_event_id = gcal_event.get('id')
                logger.info(f"Google Calendar event created successfully: {gcal_event_id}")

                # Update calendar_event with Google Calendar event ID
                calendar_event.gcal_event_id = gcal_event_id
                db.commit()

            except Exception as e:
                # Log error but don't fail appointment creation
                logger.warning(f"Google Calendar sync failed for appointment {appointment.calendar_event_id}, but appointment was created: {e}", exc_info=True)
                # Appointment remains valid without Google Calendar sync
        else:
            logger.info(f"Practitioner {practitioner.full_name} (ID: {practitioner.id}) has no Google Calendar credentials - creating appointment without calendar sync")

        # Build response message
        message = f"預約成功！{start_time.strftime('%Y-%m-%d %H:%M')} 與 {practitioner.full_name} 預約 {apt_type.name}"
        if gcal_event_id is None:
            message += "（注意：此預約未同步至 Google 日曆）"

        result = {
            "success": True,
            "appointment_id": appointment.calendar_event_id,
            "therapist_name": practitioner.full_name,
            "appointment_type": apt_type.name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "message": message
        }

        # Include gcal_event_id only if sync succeeded
        if gcal_event_id:
            result["gcal_event_id"] = gcal_event_id
            result["calendar_synced"] = True
        else:
            result["calendar_synced"] = False

        return result

    except IntegrityError as e:
        db.rollback()
        logger.exception(f"Database integrity error during appointment creation: {e}")
        return {"error": "預約時間衝突，請選擇其他時段"}

    except Exception as e:
        db.rollback()
        logger.exception(f"Unexpected error during appointment creation: {e}")
        return {"error": f"建立預約時發生錯誤：{e}"}


@function_tool
async def create_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    therapist_id: int,
    appointment_type_id: int,
    start_time: datetime,
    patient_id: int
) -> Dict[str, Any]:
    """
    Create a new appointment with Google Calendar sync.
    Delegates to create_appointment_impl for testability.
    """
    logger.debug(f"📅 [create_appointment] Creating appointment: therapist {therapist_id}, type {appointment_type_id}, time {start_time}")
    result = await create_appointment_impl(
        wrapper=wrapper,
        therapist_id=therapist_id,
        appointment_type_id=appointment_type_id,
        start_time=start_time,
        patient_id=patient_id,
    )
    logger.debug(f"✅ [create_appointment] Appointment result: {result.get('success', False)}")
    return result
