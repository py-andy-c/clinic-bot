# pyright: reportMissingTypeStubs=false
"""
Tool for rescheduling appointments.

This tool reschedules existing appointments with optional changes to
therapist, appointment type, and time, including Google Calendar sync.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from agents import function_tool, RunContextWrapper

from models import User
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from services.google_calendar_service import GoogleCalendarService
from services.encryption_service import get_encryption_service
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


async def reschedule_appointment_impl(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int,
    patient_id: int,
    new_start_time: datetime,
    new_therapist_id: Optional[int] = None,
    new_appointment_type_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Core implementation for rescheduling appointments.
    """
    db = wrapper.context.db_session

    try:
        # Find appointment and verify ownership
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id,
            Appointment.patient_id == patient_id,
            Appointment.status.in_(['confirmed', 'pending'])
        ).first()

        if not appointment:
            return {"error": "找不到該預約或您無權限修改"}

        # Load new entities if specified
        new_therapist = None
        new_apt_type = None

        if new_therapist_id:
            # Note: Filter roles in Python because SQLite JSON operations don't work reliably
            new_therapist = db.query(User).filter(
                User.id == new_therapist_id,
                User.is_active == True
            ).first()

            # Verify practitioner role
            if new_therapist and 'practitioner' not in new_therapist.roles:
                new_therapist = None

            if not new_therapist:
                return {"error": "找不到指定的治療師"}

        if new_appointment_type_id:
            new_apt_type = db.get(AppointmentType, new_appointment_type_id)
            if not new_apt_type:
                return {"error": "找不到指定的預約類型"}

        # Use existing entities if not specified
        final_therapist = new_therapist or appointment.calendar_event.user
        final_apt_type = new_apt_type or appointment.appointment_type

        # Calculate new end time
        new_end_time = new_start_time + timedelta(minutes=final_apt_type.duration_minutes)

        # Prevent conflicts: ensure the new window doesn't overlap other appointments for the target therapist
        conflict = db.query(Appointment).join(CalendarEvent).filter(
            CalendarEvent.user_id == (new_therapist.id if new_therapist else appointment.calendar_event.user_id),
            Appointment.calendar_event_id != appointment.calendar_event_id,
            Appointment.status.in_(['confirmed', 'pending']),
            CalendarEvent.start_time < new_end_time.time(),
            CalendarEvent.end_time > new_start_time.time(),
        ).first()
        if conflict is not None:
            return {"error": "預約時間衝突，請選擇其他時段"}

        # Update database FIRST (reschedule should always succeed)
        setattr(appointment.calendar_event, 'start_time', new_start_time.time())
        setattr(appointment.calendar_event, 'end_time', new_end_time.time())
        if new_therapist:
            appointment.calendar_event.user_id = new_therapist.id
        if new_apt_type:
            appointment.appointment_type_id = new_apt_type.id

        # Attempt Google Calendar sync (optional - won't block rescheduling)
        new_gcal_event_id = None
        calendar_sync_warning = None

        if final_therapist.gcal_credentials:
            try:
                gcal_credentials = get_encryption_service().decrypt_data(final_therapist.gcal_credentials)
                gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))

                if appointment.calendar_event.gcal_event_id is not None:
                    # Delete old event if therapist changed
                    if new_therapist and new_therapist.id != appointment.calendar_event.user_id and appointment.calendar_event.user.gcal_credentials:
                        try:
                            old_gcal_credentials = get_encryption_service().decrypt_data(appointment.calendar_event.user.gcal_credentials)
                            old_gcal_service = GoogleCalendarService(json.dumps(old_gcal_credentials))
                            await old_gcal_service.delete_event(appointment.calendar_event.gcal_event_id)
                            logger.info(f"Deleted old Google Calendar event {appointment.calendar_event.gcal_event_id}")
                        except Exception as e:
                            logger.warning(f"Failed to delete old Google Calendar event: {e}", exc_info=True)

                    # Create new event with new therapist or update existing
                    if new_therapist and new_therapist.id != appointment.calendar_event.user_id:
                        # Therapist changed - create new event
                        gcal_event = await gcal_service.create_event(
                            summary=f"{appointment.patient.full_name} - {final_apt_type.name}",
                            start=new_start_time,
                            end=new_end_time,
                            description=f"Patient: {appointment.patient.full_name}\nPhone: {appointment.patient.phone_number}\nType: {final_apt_type.name}\nScheduled Via: LINE Bot",
                            extended_properties={
                                "private": {
                                    "source": "line_bot",
                                    "patient_id": str(appointment.patient_id),
                                    "appointment_db_id": str(appointment.calendar_event_id)
                                }
                            }
                        )
                        new_gcal_event_id = gcal_event['id']
                        logger.info(f"Created new Google Calendar event for rescheduled appointment: {new_gcal_event_id}")
                    else:
                        # Update existing event
                        await gcal_service.update_event(
                            event_id=appointment.calendar_event.gcal_event_id,
                            summary=f"{appointment.patient.full_name} - {final_apt_type.name}",
                            start=new_start_time,
                            end=new_end_time,
                            description=f"Patient: {appointment.patient.full_name}\nPhone: {appointment.patient.phone_number}\nType: {final_apt_type.name}\nScheduled Via: LINE Bot"
                        )
                        new_gcal_event_id = appointment.calendar_event.gcal_event_id
                        logger.info(f"Updated Google Calendar event: {new_gcal_event_id}")
                else:
                    # No existing GCal event, create new one
                    gcal_event = await gcal_service.create_event(
                        summary=f"{appointment.patient.full_name} - {final_apt_type.name}",
                        start=new_start_time,
                        end=new_end_time,
                        description=f"Patient: {appointment.patient.full_name}\nPhone: {appointment.patient.phone_number}\nType: {final_apt_type.name}\nScheduled Via: LINE Bot",
                        extended_properties={
                            "private": {
                                "source": "line_bot",
                                "patient_id": str(appointment.patient_id),
                                "appointment_db_id": str(appointment.calendar_event_id)
                            }
                        }
                    )
                    new_gcal_event_id = gcal_event['id']
                    logger.info(f"Created Google Calendar event for rescheduled appointment: {new_gcal_event_id}")

            except Exception as e:
                # Log error but don't fail rescheduling
                logger.warning(f"Google Calendar sync failed for rescheduled appointment {appointment.calendar_event_id}, but reschedule was successful: {e}", exc_info=True)
                calendar_sync_warning = f"日曆同步失敗：{e}"
        else:
            logger.info(f"Practitioner {final_therapist.full_name} has no Google Calendar credentials - rescheduling without calendar sync")

        # Update calendar event with new GCal event ID (or None if sync failed)
        appointment.calendar_event.gcal_event_id = new_gcal_event_id
        db.commit()

        message = f"預約已更改至 {new_start_time.strftime('%Y-%m-%d %H:%M')} 與 {final_therapist.full_name} 預約 {final_apt_type.name}"
        if calendar_sync_warning:
            message += f"（{calendar_sync_warning}）"

        result = {
            "success": True,
            "appointment_id": appointment.calendar_event_id,
            "new_therapist": final_therapist.full_name,
            "new_appointment_type": final_apt_type.name,
            "new_start_time": new_start_time.isoformat(),
            "new_end_time": new_end_time.isoformat(),
            "message": message,
            "calendar_synced": new_gcal_event_id is not None
        }

        if new_gcal_event_id:
            result["gcal_event_id"] = new_gcal_event_id

        return result

    except Exception as e:
        db.rollback()
        return {"error": f"更改預約時發生錯誤：{e}"}


@function_tool
async def reschedule_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int,
    patient_id: int,
    new_start_time: datetime,
    new_therapist_id: Optional[int] = None,
    new_appointment_type_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Reschedule an existing appointment with optional changes to time, therapist, or type.

    This tool updates an appointment's time slot and optionally changes the assigned
    therapist and/or appointment type. It handles Google Calendar synchronization,
    including creating new events when the therapist changes. The rescheduling will
    succeed even if Google Calendar sync fails.

    Args:
        appointment_id: Database ID of the appointment to reschedule
        patient_id: ID of the patient requesting rescheduling (for ownership verification)
        new_start_time: New date and time for the appointment start (timezone-aware datetime)
        new_therapist_id: Optional new practitioner ID (if changing therapists)
        new_appointment_type_id: Optional new appointment type ID (if changing appointment type)

    Returns:
        Dict containing rescheduling result with the following keys:
            - success (bool): Whether the appointment was rescheduled successfully
            - appointment_id (int): Database ID of the rescheduled appointment
            - new_therapist (str): Full name of the final assigned therapist
            - new_appointment_type (str): Name of the final appointment type
            - new_start_time (str): ISO-formatted new start time string
            - new_end_time (str): ISO-formatted new end time string
            - message (str): Human-readable rescheduling confirmation message
            - calendar_synced (bool): Whether Google Calendar sync was successful
            - gcal_event_id (str, optional): New Google Calendar event ID if sync succeeded
            - error (str, optional): Error message if rescheduling failed
    """
    logger.debug(f"🔄 [reschedule_appointment] Rescheduling appointment {appointment_id} to {new_start_time}")
    result = await reschedule_appointment_impl(
        wrapper=wrapper,
        appointment_id=appointment_id,
        patient_id=patient_id,
        new_start_time=new_start_time,
        new_therapist_id=new_therapist_id,
        new_appointment_type_id=new_appointment_type_id,
    )
    logger.debug(f"✅ [reschedule_appointment] Reschedule result: {result.get('success', False)}")
    return result
