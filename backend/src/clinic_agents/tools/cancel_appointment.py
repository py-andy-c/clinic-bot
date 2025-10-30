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
    appointment_id: int
) -> Dict[str, Any]:
    """
    Core implementation for canceling appointments with optional Google Calendar sync.

    Args:
        wrapper: Context wrapper (auto-injected)
        appointment_id: ID of appointment to cancel

    Returns:
        Dict with cancellation confirmation or error
    """
    db = wrapper.context.db_session
    appointment = None

    try:
        # Find appointment
        appointment = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.calendar_event_id == appointment_id,
            Appointment.status.in_(['confirmed', 'pending'])
        ).first()

        if not appointment:
            return {"error": "找不到該預約"}

        # Attempt Google Calendar sync (optional - won't block cancellation)
        practitioner = appointment.calendar_event.user
        calendar_sync_warning = None

        if practitioner.gcal_credentials:
            try:
                gcal_credentials = get_encryption_service().decrypt_data(practitioner.gcal_credentials)
                gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))

                if appointment.gcal_event_id is not None:
                    await gcal_service.delete_event(appointment.gcal_event_id)
                    logger.info(f"Deleted Google Calendar event: {appointment.gcal_event_id}")

            except Exception as e:
                # Log error but don't fail cancellation
                logger.warning(f"Google Calendar sync failed for appointment cancellation {appointment_id}, but cancellation will proceed: {e}", exc_info=True)
                calendar_sync_warning = f"日曆同步失敗：{e}"
        else:
            logger.info(f"Practitioner {practitioner.full_name} has no Google Calendar credentials - canceling without calendar sync")

        # Update database (always succeeds)
        setattr(appointment, 'status', 'canceled_by_patient')
        db.commit()

        # Build response message
        message = f"預約已取消：{appointment.start_time.strftime('%Y-%m-%d %H:%M')} 與 {appointment.calendar_event.user.full_name} 的 {appointment.appointment_type.name}"
        if calendar_sync_warning:
            message += f"（{calendar_sync_warning}）"

        result = {
            "success": True,
            "message": message
        }

        return result

    except Exception as e:
        logger.exception(f"Unexpected error during appointment cancellation: {e}")
        return {"error": f"取消預約時發生錯誤：{e}"}


@function_tool
async def cancel_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int
) -> Dict[str, Any]:
    """
    Cancel an existing appointment.

    Args:
        appointment_id: Database ID of the appointment to cancel

    Returns:
        Dict containing cancellation result with the following keys:
            - success (bool): Whether the appointment was canceled successfully
            - message (str): Human-readable cancellation confirmation message
            - error (str, optional): Error message if cancellation failed
    """
    logger.debug(f"❌ [cancel_appointment] Canceling appointment {appointment_id}")
    result = await cancel_appointment_impl(
        wrapper=wrapper,
        appointment_id=appointment_id
    )
    logger.debug(f"✅ [cancel_appointment] Cancel result: {result.get('success', False)}")
    return result
