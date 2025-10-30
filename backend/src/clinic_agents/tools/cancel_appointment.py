# pyright: reportMissingTypeStubs=false
"""
Tool for canceling appointments.

This tool cancels appointments and optionally removes them from Google Calendar,
including ownership verification and error handling.
"""

import json
import logging
from typing import Dict, Any

from agents import function_tool, RunContextWrapper

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from services.google_calendar_service import GoogleCalendarService
from services.encryption_service import get_encryption_service
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


async def cancel_appointment_impl(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int,
    patient_id: int
) -> Dict[str, Any]:
    """
    Core implementation for canceling appointments with optional Google Calendar sync.

    Args:
        wrapper: Context wrapper (auto-injected)
        appointment_id: ID of appointment to cancel
        patient_id: ID of patient (for verification)

    Returns:
        Dict with cancellation confirmation or error
    """
    db = wrapper.context.db_session
    appointment = None

    try:
        # Find appointment and verify ownership
        appointment = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.calendar_event_id == appointment_id,
            Appointment.patient_id == patient_id,
            Appointment.status.in_(['confirmed', 'pending'])
        ).first()

        if not appointment:
            return {"error": "找不到該預約或您無權限取消"}

        # Attempt Google Calendar sync (optional - won't block cancellation)
        practitioner = appointment.calendar_event.user
        calendar_sync_warning = None
        calendar_synced = False

        if practitioner.gcal_credentials:
            try:
                gcal_credentials = get_encryption_service().decrypt_data(practitioner.gcal_credentials)
                gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))

                if appointment.gcal_event_id is not None:
                    await gcal_service.delete_event(appointment.gcal_event_id)
                    logger.info(f"Deleted Google Calendar event: {appointment.gcal_event_id}")
                    calendar_synced = True
                else:
                    calendar_synced = True  # No event to delete, but sync attempted successfully

            except Exception as e:
                # Log error but don't fail cancellation
                logger.warning(f"Google Calendar sync failed for appointment cancellation {appointment_id}, but cancellation will proceed: {e}", exc_info=True)
                calendar_sync_warning = f"日曆同步失敗：{e}"
                calendar_synced = False
        else:
            logger.info(f"Practitioner {practitioner.full_name} has no Google Calendar credentials - canceling without calendar sync")
            calendar_synced = False

        # Update database (always succeeds)
        setattr(appointment, 'status', 'canceled_by_patient')
        db.commit()

        # Build response message
        message = f"預約已取消：{appointment.start_time.strftime('%Y-%m-%d %H:%M')} 與 {appointment.calendar_event.user.full_name} 的 {appointment.appointment_type.name}"
        if calendar_sync_warning:
            message += f"（{calendar_sync_warning}）"

        result = {
            "success": True,
            "appointment_id": appointment.calendar_event_id,
            "therapist_name": appointment.calendar_event.user.full_name,
            "start_time": appointment.start_time.isoformat(),
            "message": message,
            "calendar_synced": calendar_synced
        }

        return result

    except Exception as e:
        logger.exception(f"Unexpected error during appointment cancellation: {e}")
        return {"error": f"取消預約時發生錯誤：{e}"}


@function_tool
async def cancel_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int,
    patient_id: int
) -> Dict[str, Any]:
    """
    Cancel an existing appointment and optionally remove it from Google Calendar.

    This tool cancels a patient's appointment by changing its status to 'canceled_by_patient'
    and attempts to remove the corresponding event from the practitioner's Google Calendar.
    The cancellation will succeed even if Google Calendar sync fails.

    Args:
        appointment_id: Database ID of the appointment to cancel
        patient_id: ID of the patient requesting cancellation (for ownership verification)

    Returns:
        Dict containing cancellation result with the following keys:
            - success (bool): Whether the appointment was canceled successfully
            - appointment_id (int): Database ID of the canceled appointment
            - therapist_name (str): Full name of the practitioner
            - start_time (str): ISO-formatted original start time string
            - message (str): Human-readable cancellation confirmation message
            - calendar_synced (bool): Whether Google Calendar sync was successful
            - error (str, optional): Error message if cancellation failed
    """
    logger.debug(f"❌ [cancel_appointment] Canceling appointment {appointment_id}")
    result = await cancel_appointment_impl(
        wrapper=wrapper,
        appointment_id=appointment_id,
        patient_id=patient_id
    )
    logger.debug(f"✅ [cancel_appointment] Cancel result: {result.get('success', False)}")
    return result
