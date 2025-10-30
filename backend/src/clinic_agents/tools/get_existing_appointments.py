# pyright: reportMissingTypeStubs=false
"""
Tool for getting existing appointments.

This tool retrieves a patient's upcoming confirmed appointments
with therapist and appointment type information.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

from agents import function_tool, RunContextWrapper

from models import User
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


async def get_existing_appointments_impl(
    wrapper: RunContextWrapper[ConversationContext],
    patient_id: int
) -> List[Dict[str, Any]]:
    """
    This tool fetches all appointments for a patient that are
    scheduled for today or in the future, ordered by date and time.

    Args:
        patient_id: Database ID of the patient whose appointments to retrieve

    Returns:
        List of appointment dictionaries, each containing:
            - id (int): Database ID of the appointment
            - therapist_name (str): Full name of the assigned practitioner
            - appointment_type (str): Name of the appointment type
            - start_time (str): Local time formatted start datetime (YYYY-MM-DD HH:MM:SS)
            - end_time (str): Local time formatted end datetime (YYYY-MM-DD HH:MM:SS)

        Returns an error dictionary with single "error" key if query fails.
    """
    logger.debug(f"📋 Getting appointments for patient {patient_id}")
    db = wrapper.context.db_session

    try:
        # Get current date in Taiwan timezone
        taiwan_tz = timezone(timedelta(hours=8))
        taiwan_now = datetime.now(taiwan_tz)
        current_date = taiwan_now.date()

        # Query upcoming appointments
        appointments = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id == patient_id,
            CalendarEvent.date >= current_date,
            Appointment.status.in_(['confirmed', 'pending'])
        ).join(User).join(AppointmentType).order_by(CalendarEvent.date, CalendarEvent.start_time).all()

        result = [
            {
                "id": apt.calendar_event_id,
                "therapist_name": apt.calendar_event.user.full_name,
                "appointment_type": apt.appointment_type.name,
                "start_time": datetime.combine(apt.date, apt.start_time).strftime('%Y-%m-%d %H:%M:%S'),
                "end_time": datetime.combine(apt.date, apt.end_time).strftime('%Y-%m-%d %H:%M:%S')
            }
            for apt in appointments
        ]

        logger.debug(f"✅ Found {len(result)} appointments")
        return result

    except Exception as e:
        logger.debug(f"❌ Error getting appointments: {e}")
        return [{"error": f"查詢預約時發生錯誤：{e}"}]


@function_tool
async def get_existing_appointments(
    wrapper: RunContextWrapper[ConversationContext],
    patient_id: int
) -> List[Dict[str, Any]]:
    """
    This tool fetches all appointments for a patient that are
    scheduled for today or in the future, ordered by date and time.

    Args:
        patient_id: Database ID of the patient whose appointments to retrieve

    Returns:
        List of appointment dictionaries, each containing:
            - id (int): Database ID of the appointment
            - therapist_name (str): Full name of the assigned practitioner
            - appointment_type (str): Name of the appointment type
            - start_time (str): Local time formatted start datetime (YYYY-MM-DD HH:MM:SS)
            - end_time (str): Local time formatted end datetime (YYYY-MM-DD HH:MM:SS)

        Returns an error dictionary with single "error" key if query fails.
    """
    logger.debug(f"📋 Getting appointments for patient {patient_id}")
    result = await get_existing_appointments_impl(
        wrapper=wrapper,
        patient_id=patient_id,
    )
    logger.debug(f"✅ Found {len(result)} appointments")
    return result
