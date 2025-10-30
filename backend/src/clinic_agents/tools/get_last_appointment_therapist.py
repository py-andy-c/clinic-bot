# pyright: reportMissingTypeStubs=false
"""
Tool for getting patient's last appointment therapist.

This tool retrieves information about the therapist from a patient's
most recent past appointment for "same therapist" requests.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any

from agents import function_tool, RunContextWrapper

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


@function_tool
async def get_last_appointment_therapist(
    wrapper: RunContextWrapper[ConversationContext],
    patient_id: int
) -> Dict[str, Any]:
    """
    Retrieve the therapist information from a patient's most recent completed appointment.

    This tool is used to support "same therapist as last time" requests by finding
    the practitioner from the patient's most recent past appointment that was either
    confirmed or completed.

    Args:
        patient_id: Database ID of the patient whose last therapist to find

    Returns:
        Dict containing therapist information with the following keys:
            - therapist_id (int): Database ID of the last therapist
            - therapist_name (str): Full name of the last therapist
            - last_appointment_date (str): Date of the last appointment in YYYY-MM-DD format
            - last_appointment_type (str): Name of the appointment type from the last visit
            - message (str): Human-readable message with therapist and appointment details
            - error (str, optional): Error message if no previous appointments found
    """
    logger.debug(f"👤 [get_last_appointment_therapist] Getting last therapist for patient {patient_id}")
    db = wrapper.context.db_session

    try:
        # Query most recent past appointment
        last_appointment = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id == patient_id,
            CalendarEvent.start_time < datetime.now(timezone.utc),  # Past appointments only
            Appointment.status.in_(['confirmed', 'completed'])  # Successful appointments
        ).order_by(CalendarEvent.start_time.desc()).first()

        if not last_appointment:
            logger.debug(f"❌ [get_last_appointment_therapist] No previous appointments found")
            return {"error": "找不到您之前的預約記錄"}

        practitioner = last_appointment.calendar_event.user
        result = {
            "therapist_id": practitioner.id,
            "therapist_name": practitioner.full_name,
            "last_appointment_date": last_appointment.calendar_event.start_time.strftime('%Y-%m-%d'),
            "last_appointment_type": last_appointment.appointment_type.name,
            "message": f"您上次預約的治療師是 {practitioner.full_name}（{last_appointment.calendar_event.start_time.strftime('%Y-%m-%d')}）"
        }
        logger.debug(f"✅ [get_last_appointment_therapist] Found last therapist: {practitioner.full_name}")
        return result

    except Exception as e:
        logger.debug(f"❌ [get_last_appointment_therapist] Error getting last therapist: {e}")
        return {"error": f"查詢上次治療師時發生錯誤：{e}"}
