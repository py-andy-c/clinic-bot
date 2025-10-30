# pyright: reportMissingTypeStubs=false
"""
Tool for getting existing appointments.

This tool retrieves a patient's upcoming confirmed appointments
with therapist and appointment type information.
"""

import logging
from datetime import datetime, timezone
from typing import List, Dict, Any

from agents import function_tool, RunContextWrapper

from models import User
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


@function_tool
async def get_existing_appointments(
    wrapper: RunContextWrapper[ConversationContext],
    patient_id: int
) -> List[Dict[str, Any]]:
    """
    Get patient's upcoming appointments.

    Args:
        wrapper: Context wrapper (auto-injected)
        patient_id: ID of the patient

    Returns:
        List of appointment dictionaries
    """
    logger.debug(f"📋 [get_existing_appointments] Getting appointments for patient {patient_id}")
    db = wrapper.context.db_session

    try:
        # Query upcoming appointments
        appointments = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id == patient_id,
            CalendarEvent.date >= datetime.now(timezone.utc).date(),
            Appointment.status.in_(['confirmed', 'pending'])
        ).join(User).join(AppointmentType).order_by(CalendarEvent.date, CalendarEvent.start_time).all()

        result = [
            {
                "id": apt.calendar_event_id,
                "therapist_name": apt.calendar_event.user.full_name,
                "appointment_type": apt.appointment_type.name,
                "start_time": apt.start_time.isoformat(),
                "end_time": apt.end_time.isoformat(),
                "status": apt.status,
                "gcal_event_id": apt.gcal_event_id
            }
            for apt in appointments
        ]

        logger.debug(f"✅ [get_existing_appointments] Found {len(result)} appointments")
        return result

    except Exception as e:
        logger.debug(f"❌ [get_existing_appointments] Error getting appointments: {e}")
        return [{"error": f"查詢預約時發生錯誤：{e}"}]
