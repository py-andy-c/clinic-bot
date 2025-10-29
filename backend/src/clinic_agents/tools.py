# pyright: reportMissingTypeStubs=false
"""
Agent tools for database operations and external service integrations.

This module contains all the tools that agents can call to perform actions:
- Database operations (appointments, patients, practitioners)
- Google Calendar synchronization
- Account linking operations

All tools follow the OpenAI Agent SDK pattern using RunContextWrapper[ConversationContext].
"""

import json
import logging
from datetime import datetime, timedelta, timezone, time
from typing import Dict, List, Optional, Any
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

from agents import function_tool, RunContextWrapper

from models import User
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser
from models.calendar_event import CalendarEvent
from models.practitioner_availability import PractitionerAvailability
from services.google_calendar_service import GoogleCalendarService
from clinic_agents.context import ConversationContext


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
        logger.error(f"Date format error in get_practitioner_availability: {e}", exc_info=True)
        return {"error": f"日期格式錯誤：{str(e)}"}
    except Exception as e:
        logger.error(f"Unexpected error in get_practitioner_availability: {e}", exc_info=True)
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
            from services.encryption_service import get_encryption_service
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
        logger.error(f"Database integrity error during appointment creation: {e}", exc_info=True)
        return {"error": "預約時間衝突，請選擇其他時段"}

    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error during appointment creation: {e}", exc_info=True)
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
            from services.encryption_service import get_encryption_service
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
        logger.error(f"Unexpected error during appointment cancellation: {e}", exc_info=True)
        return {"error": f"取消預約時發生錯誤：{e}"}


@function_tool
async def cancel_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int,
    patient_id: int
) -> Dict[str, Any]:
    """
    Cancel appointment and remove from Google Calendar.
    Delegates to cancel_appointment_impl for testability.

    Args:
        wrapper: Context wrapper (auto-injected)
        appointment_id: ID of appointment to cancel
        patient_id: ID of patient (for verification)

    Returns:
        Dict with cancellation confirmation or error
    """
    logger.debug(f"❌ [cancel_appointment] Canceling appointment {appointment_id}")
    result = await cancel_appointment_impl(
        wrapper=wrapper,
        appointment_id=appointment_id,
        patient_id=patient_id
    )
    logger.debug(f"✅ [cancel_appointment] Cancel result: {result.get('success', False)}")
    return result


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
            from services.encryption_service import get_encryption_service
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
    Reschedule an existing appointment to a new time/therapist/type.
    Delegates to reschedule_appointment_impl to keep logic testable.
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


@function_tool
async def get_last_appointment_therapist(
    wrapper: RunContextWrapper[ConversationContext],
    patient_id: int
) -> Dict[str, Any]:
    """
    Get the therapist from patient's most recent appointment.

    This tool helps with "same therapist as last time" requests.

    Args:
        wrapper: Context wrapper (auto-injected)
        patient_id: ID of the patient

    Returns:
        Dict with therapist info or error if no previous appointments
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


def validate_taiwanese_phone_number(phone_number: str) -> tuple[bool, str, str]:
    """
    Validate and sanitize Taiwanese mobile phone number.

    Accepts mobile phone numbers in various formats:
    - Local: 0912345678, 912345678
    - International: +886912345678, 886912345678
    - With separators: +886-912-345-678, 0912 345 678

    Only accepts mobile phone numbers (starting with 09). Landline numbers are rejected.

    Args:
        phone_number: Raw phone number string

    Returns:
        Tuple of (is_valid, sanitized_number, error_message)
        If valid: (True, sanitized_number, "")
        If invalid: (False, "", error_message)
    """
    # Handle international format first (before removing non-digits)
    clean_number = phone_number.strip()
    if clean_number.startswith('+886'):
        # Convert +886xxxxxxxxxx to 0xxxxxxxxxx
        digits_only = '0' + clean_number[4:]
        # Remove any remaining non-digits
        digits_only = ''.join(filter(str.isdigit, digits_only))
    elif clean_number.startswith('886'):
        # Convert 886xxxxxxxxxx to 0xxxxxxxxxx
        digits_only = '0' + clean_number[3:]
        # Remove any remaining non-digits
        digits_only = ''.join(filter(str.isdigit, digits_only))
    else:
        # Remove all non-digit characters for regular formats
        digits_only = ''.join(filter(str.isdigit, phone_number))

    if not digits_only:
        return False, "", "手機號碼不能為空。請提供有效的手機號碼。"

    # Validate Taiwanese phone number formats - MOBILE PHONES ONLY
    if digits_only.startswith('09'):
        # Mobile phone format: 09xxxxxxxx (10 digits)
        if len(digits_only) == 10:
            return True, digits_only, ""
        elif len(digits_only) == 9:
            # Missing leading 0 for mobile
            return True, '0' + digits_only, ""
        else:
            return False, "", f"手機號碼格式錯誤。行動電話應為 10 位數字，例如：0912345678 或 912345678"
    elif digits_only.startswith('0'):
        # Reject landline numbers
        return False, "", "只接受手機號碼，不接受市話號碼。請提供以 09 開頭的手機號碼，例如：0912345678"
    else:
        # Handle edge cases for mobile numbers
        if len(digits_only) == 9 and digits_only.startswith('9'):
            # Could be mobile missing leading 0, validate the number looks reasonable
            # Taiwanese mobile numbers: 09xxxxxxxx where second digit is typically 0-9
            # Reject obviously invalid patterns like 999999999
            second_digit = digits_only[1]
            if second_digit in '0123456789':
                return True, '0' + digits_only, ""
            else:
                return False, "", "手機號碼格式錯誤。行動電話應以 09 開頭，例如：0912345678"
        elif len(digits_only) == 10 and digits_only.startswith('9'):
            return False, "", "手機號碼應以 09 開頭，例如：0912345678"
        else:
            return False, "", "手機號碼格式錯誤。只接受手機號碼，請提供以 09 開頭的 10 位數字，例如：0912345678"


@function_tool
async def register_patient_account(
    wrapper: RunContextWrapper[ConversationContext],
    phone_number: str,
    full_name: str
) -> str:
    """
    Register or link a patient account with LINE.

    This tool handles both existing patient linking and new patient registration.
    It will link an existing patient if the phone number matches, or create a new
    patient record if the phone number doesn't exist.

    Args:
        wrapper: Context wrapper (auto-injected)
        phone_number: Phone number for patient lookup/registration
        full_name: Full name of the patient (required for new patients)

    Returns:
        Success message or error description
    """
    logger.debug(f"👤 [register_patient_account] Registering patient: {full_name} ({phone_number})")
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic
    line_user_id = wrapper.context.line_user_id

    try:
        # Validate and sanitize phone number
        is_valid, sanitized_phone, phone_error = validate_taiwanese_phone_number(phone_number)
        if not is_valid:
            logger.debug(f"❌ [register_patient_account] Phone validation failed: {phone_error}")
            return f"ERROR: {phone_error}"

        # Check if phone number already exists in this clinic
        existing_patient = db.query(Patient).filter(
            Patient.clinic_id == clinic.id,
            Patient.phone_number == sanitized_phone
        ).first()

        # Check if this LINE account is already linked to any patient
        existing_line_user = db.query(LineUser).filter(
            LineUser.line_user_id == line_user_id
        ).first()

        if existing_line_user is not None and existing_line_user.patient_id is not None:
            current_patient = db.query(Patient).filter(Patient.id == existing_line_user.patient_id).first()
            if current_patient and existing_patient and existing_patient.id == current_patient.id:
                logger.debug(f"✅ [register_patient_account] Account already linked to {current_patient.full_name}")
                return f"SUCCESS: 您的帳號已經連結到 {current_patient.full_name}（{current_patient.phone_number}），無需重複連結。"
            else:
                patient_name = current_patient.full_name if current_patient else '其他病患'
                logger.debug(f"❌ [register_patient_account] LINE account already linked to different patient: {patient_name}")
                return f"ERROR: 此 LINE 帳號已連結到 {patient_name}。如需更改請聯繫診所。"

        if existing_patient:
            # Existing patient - verify not linked to another LINE account
            existing_link = db.query(LineUser).filter(
                LineUser.patient_id == existing_patient.id
            ).first()

            if existing_link is not None and existing_link.line_user_id != line_user_id:
                logger.debug(f"❌ [register_patient_account] Phone already linked to different LINE account")
                return "ERROR: 此手機號碼已連結到其他 LINE 帳號。如有問題請聯繫診所。"

            # Link existing patient to this LINE account
            if existing_line_user:
                existing_line_user.patient_id = existing_patient.id
            else:
                line_user = LineUser(
                    line_user_id=line_user_id,
                    patient_id=existing_patient.id
                )
                db.add(line_user)

            db.commit()
            logger.debug(f"✅ [register_patient_account] Linked existing patient: {existing_patient.full_name}")
            return f"SUCCESS: 帳號連結成功！歡迎 {existing_patient.full_name}（{existing_patient.phone_number}），您現在可以開始預約了。"

        else:
            # New patient - validate full name
            if not full_name or not full_name.strip():
                logger.debug(f"❌ [register_patient_account] Full name validation failed")
                return "ERROR: 建立新病患記錄需要提供全名。"

            # Create new patient
            new_patient = Patient(
                clinic_id=clinic.id,
                full_name=full_name.strip(),
                phone_number=sanitized_phone
            )
            db.add(new_patient)
            db.flush()  # Get the patient ID

            # Link LINE account to new patient
            if existing_line_user:
                existing_line_user.patient_id = new_patient.id
            else:
                line_user = LineUser(
                    line_user_id=line_user_id,
                    patient_id=new_patient.id
                )
                db.add(line_user)

            db.commit()
            logger.debug(f"✅ [register_patient_account] Created new patient: {new_patient.full_name}")
            return f"SUCCESS: 歡迎 {new_patient.full_name}！您的病患記錄已建立，手機號碼 {new_patient.phone_number} 已連結到 LINE 帳號。您現在可以開始預約了。"

    except IntegrityError as e:
        db.rollback()
        logger.debug(f"❌ [register_patient_account] Database integrity error: {e}")
        return "ERROR: 資料庫錯誤，可能是手機號碼或姓名重複。請聯繫診所協助。"

    except Exception as e:
        db.rollback()
        logger.debug(f"❌ [register_patient_account] Registration error: {e}")
        return f"ERROR: 註冊帳號時發生錯誤：{e}"
