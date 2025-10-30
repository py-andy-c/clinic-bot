# pyright: reportMissingTypeStubs=false
"""
Tool for getting practitioner availability.

This tool finds available time slots for a practitioner on a specific date,
considering their default schedule, availability exceptions, and existing appointments.
"""

import logging
from datetime import datetime, time
from typing import Dict, List, Any

from agents import function_tool, RunContextWrapper

from models import User
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from models.practitioner_availability import PractitionerAvailability
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


async def get_practitioner_availability_impl(
    wrapper: RunContextWrapper[ConversationContext],
    practitioner_name: str,
    date: str,
    appointment_type: str
) -> Dict[str, Any]:
    """
    Core implementation for getting available time slots for a specific practitioner and appointment type.

    This function finds available time slots for a practitioner on a specific date,
    considering their default schedule, availability exceptions, and existing appointments.

    Args:
        wrapper: Context wrapper (auto-injected)
        practitioner_name: Name of the practitioner (from user conversation)
        date: Date string in YYYY-MM-DD format
        appointment_type: Type of appointment (e.g., "初診評估")

    Returns:
        Dict with available slots or error message
    """
    logger.debug(f"🔍 [get_practitioner_availability] Checking availability: {practitioner_name} on {date} for '{appointment_type}'")

    db = wrapper.context.db_session
    clinic = wrapper.context.clinic

    try:
        # Parse date
        requested_date = datetime.strptime(date, "%Y-%m-%d").date()

        # Find practitioner (user with practitioner role)
        # Note: Filter in Python because SQLite JSON operations don't work reliably with contains()
        all_users_in_clinic = db.query(User).filter(
            User.clinic_id == clinic.id,
            User.is_active == True
        ).all()

        # Filter to only practitioners and match by name (case-insensitive, fuzzy matching)
        practitioner = None
        practitioner_name_lower = practitioner_name.lower()
        for user in all_users_in_clinic:
            if 'practitioner' in user.roles and practitioner_name_lower in user.full_name.lower():
                practitioner = user
                break

        if not practitioner:
            return {"error": f"找不到醫師：{practitioner_name}"}

        # Find appointment type
        apt_type = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id,
            AppointmentType.name == appointment_type
        ).first()

        if not apt_type:
            logger.debug(f"❌ [get_practitioner_availability] Appointment type '{appointment_type}' not found")
            return {"error": f"找不到預約類型：{appointment_type}"}

        logger.debug(f"✅ [get_practitioner_availability] Found appointment type: {apt_type.name} ({apt_type.duration_minutes}min)")

        # Get default schedule for this day of week
        day_of_week = requested_date.weekday()
        default_intervals = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == practitioner.id,
            PractitionerAvailability.day_of_week == day_of_week
        ).order_by(PractitionerAvailability.start_time).all()

        if not default_intervals:
            return {"error": f"{practitioner_name}在{requested_date.strftime('%Y年%m月%d日')}沒有預設的可用時間"}

        # Get availability exceptions for this date
        exceptions = db.query(CalendarEvent).filter(
            CalendarEvent.user_id == practitioner.id,
            CalendarEvent.event_type == 'availability_exception',
            CalendarEvent.date == requested_date
        ).all()

        # Get existing appointments for this date
        appointments = db.query(CalendarEvent).filter(
            CalendarEvent.user_id == practitioner.id,
            CalendarEvent.event_type == 'appointment',
            CalendarEvent.date == requested_date
        ).all()

        # Calculate available slots
        available_slots: List[str] = []
        duration_minutes = apt_type.duration_minutes

        for interval in default_intervals:
            # Generate slots within this interval
            current_time = interval.start_time
            while True:
                # Calculate end time for this slot
                slot_end_minutes = (current_time.hour * 60 + current_time.minute + duration_minutes)
                slot_end_hour = slot_end_minutes // 60
                slot_end_minute = slot_end_minutes % 60
                slot_end_time = datetime.strptime(f"{slot_end_hour:02d}:{slot_end_minute:02d}", "%H:%M").time()

                # Check if slot fits within the interval
                if slot_end_time > interval.end_time:
                    break

                # Check if slot conflicts with availability exceptions
                slot_blocked_by_exception = False
                for exception in exceptions:
                    if (exception.start_time and exception.end_time and
                        _check_time_overlap(current_time, slot_end_time,
                                          exception.start_time, exception.end_time)):
                        slot_blocked_by_exception = True
                        break

                if slot_blocked_by_exception:
                    # Move to next slot and continue
                    current_minutes = current_time.hour * 60 + current_time.minute + 15
                    current_time = datetime.strptime(f"{current_minutes // 60:02d}:{current_minutes % 60:02d}", "%H:%M").time()
                    continue

                # Check if slot conflicts with existing appointments
                slot_conflicts = False
                for appointment in appointments:
                    if (appointment.start_time and appointment.end_time and
                        _check_time_overlap(current_time, slot_end_time,
                                          appointment.start_time, appointment.end_time)):
                        slot_conflicts = True
                        break

                if not slot_conflicts:
                    available_slots.append(f"{current_time.strftime('%H:%M')}-{slot_end_time.strftime('%H:%M')}")

                # Move to next slot (15-minute increments)
                current_minutes = current_time.hour * 60 + current_time.minute + 15
                current_time = datetime.strptime(f"{current_minutes // 60:02d}:{current_minutes % 60:02d}", "%H:%M").time()

        if not available_slots:
            logger.debug(f"❌ [get_practitioner_availability] No slots available for {practitioner_name} on {requested_date}")
            return {"error": f"{practitioner_name}在{requested_date.strftime('%Y年%m月%d日')}沒有可用的時段"}

        result = {
            "therapist_id": practitioner.id,
            "therapist_name": practitioner.full_name,
            "date": date,
            "appointment_type": appointment_type,
            "duration_minutes": duration_minutes,
            "available_slots": available_slots
        }

        logger.debug(f"✅ [get_practitioner_availability] Found {len(available_slots)} available slots")
        return result

    except ValueError as e:
        logger.exception(f"Date format error in get_practitioner_availability: {e}")
        return {"error": f"日期格式錯誤：{str(e)}"}
    except Exception as e:
        logger.exception(f"Unexpected error in get_practitioner_availability: {e}")
        return {"error": f"查詢可用時段時發生錯誤：{str(e)}"}


@function_tool
async def get_practitioner_availability(
    wrapper: RunContextWrapper[ConversationContext],
    practitioner_name: str,
    date: str,
    appointment_type: str
) -> Dict[str, Any]:
    """
    Get available time slots for a specific practitioner and appointment type.
    Delegates to get_practitioner_availability_impl for testability.

    Args:
        wrapper: Context wrapper (auto-injected)
        practitioner_name: Name of the practitioner (from user conversation)
        date: Date string in YYYY-MM-DD format
        appointment_type: Type of appointment (e.g., "初診評估")

    Returns:
        Dict with available slots or error message
    """
    return await get_practitioner_availability_impl(
        wrapper=wrapper,
        practitioner_name=practitioner_name,
        date=date,
        appointment_type=appointment_type
    )


def _check_time_overlap(start1: time, end1: time, start2: time, end2: time) -> bool:
    """Check if two time intervals overlap."""
    return start1 < end2 and start2 < end1
