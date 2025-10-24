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
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any
from sqlalchemy.exc import IntegrityError

from agents import function_tool, RunContextWrapper

from models import User
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser
from services.google_calendar_service import GoogleCalendarService, GoogleCalendarError
from clinic_agents.context import ConversationContext


@function_tool
async def get_practitioner_availability(
    wrapper: RunContextWrapper[ConversationContext],
    practitioner_name: str,
    date: str,
    appointment_type: str
) -> Dict[str, Any]:
    """
    Get available time slots for a specific practitioner and appointment type.

    This tool finds available time slots for a practitioner on a specific date,
    considering their existing appointments and the requested appointment duration.

    Args:
        wrapper: Context wrapper (auto-injected)
        practitioner_name: Name of the practitioner (from user conversation)
        date: Date string in YYYY-MM-DD format
        appointment_type: Type of appointment (e.g., "初診評估")

    Returns:
        Dict with available slots or error message
    """
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic

    try:
        # Parse date
        requested_date = datetime.strptime(date, "%Y-%m-%d").date()

        # Find practitioner (user with practitioner role)
        practitioner = db.query(User).filter(
            User.clinic_id == clinic.id,
            User.roles.contains(['practitioner']),
            User.full_name.ilike(f"%{practitioner_name}%"),  # Fuzzy name matching
            User.is_active == True
        ).first()

        if not practitioner:
            return {"error": f"找不到醫師：{practitioner_name}"}

        # Find appointment type
        apt_type = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id,
            AppointmentType.name == appointment_type
        ).first()

        if not apt_type:
            return {"error": f"找不到預約類型：{appointment_type}"}

        # Get existing appointments for this practitioner on this date
        day_start = datetime.combine(requested_date, datetime.min.time())
        day_end = datetime.combine(requested_date, datetime.max.time())

        existing_appointments = db.query(Appointment).filter(
            Appointment.user_id == practitioner.id,
            Appointment.start_time >= day_start,
            Appointment.end_time <= day_end,
            Appointment.status.in_(['confirmed', 'pending'])  # Include confirmed and pending
        ).all()

        # Calculate available slots (assuming clinic hours 9:00-17:00)
        clinic_start = datetime.combine(requested_date, datetime.strptime("09:00", "%H:%M").time())
        clinic_end = datetime.combine(requested_date, datetime.strptime("17:00", "%H:%M").time())
        duration = timedelta(minutes=apt_type.duration_minutes)

        available_slots: List[str] = []
        current_time = clinic_start

        while current_time + duration <= clinic_end:
            slot_end = current_time + duration

            # Check if this slot conflicts with existing appointments
            conflict = False
            for apt in existing_appointments:
                if (current_time < apt.end_time and slot_end > apt.start_time):
                    conflict = True
                    break

            if not conflict:
                available_slots.append(current_time.strftime("%H:%M"))

            # Move to next slot (30-minute intervals)
            current_time += timedelta(minutes=30)

        return {
            "therapist_id": practitioner.id,
            "therapist_name": practitioner.full_name,
            "date": date,
            "appointment_type": appointment_type,
            "duration_minutes": apt_type.duration_minutes,
            "available_slots": available_slots
        }

    except ValueError as e:
        return {"error": f"日期格式錯誤：{e}"}
    except Exception as e:
        return {"error": f"查詢可用時段時發生錯誤：{e}"}


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
        practitioner = db.query(User).filter(
            User.id == therapist_id,
            User.roles.contains(['practitioner']),
            User.is_active == True
        ).first()
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
        conflict = db.query(Appointment).filter(
            Appointment.user_id == therapist_id,
            Appointment.status.in_(['confirmed', 'pending']),
            Appointment.start_time < end_time,
            Appointment.end_time > start_time,
        ).first()
        if conflict is not None:
            return {"error": "預約時間衝突，請選擇其他時段"}

        # Create Google Calendar event FIRST
        if not practitioner.gcal_credentials:
            return {"error": "Practitioner has no Google Calendar credentials"}
        from services.encryption_service import get_encryption_service
        gcal_credentials = get_encryption_service().decrypt_data(practitioner.gcal_credentials)
        gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))
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
            extended_properties={
                "private": {
                    "source": "line_bot",
                    "patient_id": str(patient_id),
                    "appointment_db_id": None  # Will update after DB insert
                }
            }
        )

        # Create database record with gcal_event_id
        appointment = Appointment(
            patient_id=patient_id,
            user_id=therapist_id,
            appointment_type_id=appointment_type_id,
            start_time=start_time,
            end_time=end_time,
            status='confirmed',
            gcal_event_id=gcal_event['id']  # Store sync key
        )

        db.add(appointment)
        db.commit()  # Commit to get appointment ID

        # Update Google Calendar event with database ID
        await gcal_service.update_event(
            event_id=gcal_event['id'],
            extended_properties={
                "private": {
                    "source": "line_bot",
                    "patient_id": str(patient_id),
                    "appointment_db_id": str(appointment.id)
                }
            }
        )

        return {
            "success": True,
            "appointment_id": appointment.id,
            "therapist_name": practitioner.full_name,
            "appointment_type": apt_type.name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "gcal_event_id": gcal_event['id'],
            "message": f"預約成功！{start_time.strftime('%Y-%m-%d %H:%M')} 與 {practitioner.full_name} 預約 {apt_type.name}"
        }

    except GoogleCalendarError as e:
        db.rollback()
        return {"error": f"日曆同步失敗：{e}"}

    except IntegrityError as e:
        db.rollback()
        return {"error": "預約時間衝突，請選擇其他時段"}

    except Exception as e:
        db.rollback()
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
    return await create_appointment_impl(
        wrapper=wrapper,
        therapist_id=therapist_id,
        appointment_type_id=appointment_type_id,
        start_time=start_time,
        patient_id=patient_id,
    )


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
    db = wrapper.context.db_session

    try:
        # Query upcoming appointments
        appointments = db.query(Appointment).filter(
            Appointment.patient_id == patient_id,
            Appointment.start_time >= datetime.now(timezone.utc),
            Appointment.status.in_(['confirmed', 'pending'])
        ).join(User).join(AppointmentType).order_by(Appointment.start_time).all()

        return [
            {
                "id": apt.id,
                "therapist_name": apt.user.full_name,
                "appointment_type": apt.appointment_type.name,
                "start_time": apt.start_time.isoformat(),
                "end_time": apt.end_time.isoformat(),
                "status": apt.status,
                "gcal_event_id": apt.gcal_event_id
            }
            for apt in appointments
        ]

    except Exception as e:
        return [{"error": f"查詢預約時發生錯誤：{e}"}]


@function_tool
async def cancel_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    appointment_id: int,
    patient_id: int
) -> Dict[str, Any]:
    """
    Cancel appointment and remove from Google Calendar.

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
        appointment = db.query(Appointment).filter(
            Appointment.id == appointment_id,
            Appointment.patient_id == patient_id,
            Appointment.status.in_(['confirmed', 'pending'])
        ).first()

        if not appointment:
            return {"error": "找不到該預約或您無權限取消"}

        # Cancel in Google Calendar first
        practitioner = appointment.user
        if practitioner.gcal_credentials:
            from services.encryption_service import get_encryption_service
            gcal_credentials = get_encryption_service().decrypt_data(practitioner.gcal_credentials)
            gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))
        else:
            gcal_service = None

        if appointment.gcal_event_id is not None and gcal_service is not None:
            await gcal_service.delete_event(appointment.gcal_event_id)

        # Update database
        setattr(appointment, 'status', 'canceled_by_patient')
        db.commit()

        return {
            "success": True,
            "appointment_id": appointment.id,
            "therapist_name": appointment.user.full_name,
            "start_time": appointment.start_time.isoformat(),
            "message": f"預約已取消：{appointment.start_time.strftime('%Y-%m-%d %H:%M')} 與 {appointment.user.full_name} 的 {appointment.appointment_type.name}"
        }

    except GoogleCalendarError as e:
        # Still update database even if GCal fails
        if appointment is not None:
            setattr(appointment, 'status', 'canceled_by_patient')
            db.commit()
            return {
                "success": True,
                "warning": f"預約已取消，但日曆同步失敗：{e}",
                "appointment_id": appointment.id
            }
        else:
            return {"error": f"取消預約時發生錯誤：{e}"}

    except Exception as e:
        return {"error": f"取消預約時發生錯誤：{e}"}


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
            Appointment.id == appointment_id,
            Appointment.patient_id == patient_id,
            Appointment.status.in_(['confirmed', 'pending'])
        ).first()

        if not appointment:
            return {"error": "找不到該預約或您無權限修改"}

        # Load new entities if specified
        new_therapist = None
        new_apt_type = None

        if new_therapist_id:
            new_therapist = db.query(User).filter(
                User.id == new_therapist_id,
                User.roles.contains(['practitioner']),
                User.is_active == True
            ).first()
            if not new_therapist:
                return {"error": "找不到指定的治療師"}

        if new_appointment_type_id:
            new_apt_type = db.get(AppointmentType, new_appointment_type_id)
            if not new_apt_type:
                return {"error": "找不到指定的預約類型"}

        # Use existing entities if not specified
        final_therapist = new_therapist or appointment.user
        final_apt_type = new_apt_type or appointment.appointment_type

        # Calculate new end time
        new_end_time = new_start_time + timedelta(minutes=final_apt_type.duration_minutes)

        # Prevent conflicts: ensure the new window doesn't overlap other appointments for the target therapist
        conflict = db.query(Appointment).filter(
            Appointment.user_id == (new_therapist.id if new_therapist else appointment.user_id),
            Appointment.id != appointment.id,
            Appointment.status.in_(['confirmed', 'pending']),
            Appointment.start_time < new_end_time,
            Appointment.end_time > new_start_time,
        ).first()
        if conflict is not None:
            return {"error": "預約時間衝突，請選擇其他時段"}

        # Update Google Calendar event
        if final_therapist.gcal_credentials:
            from services.encryption_service import get_encryption_service
            gcal_credentials = get_encryption_service().decrypt_data(final_therapist.gcal_credentials)
            gcal_service = GoogleCalendarService(json.dumps(gcal_credentials))
        else:
            gcal_service = None

        if appointment.gcal_event_id is not None:
            # Delete old event if therapist changed
            if new_therapist and new_therapist.id != appointment.user_id and appointment.user.gcal_credentials:
                from services.encryption_service import get_encryption_service
                old_gcal_credentials = get_encryption_service().decrypt_data(appointment.user.gcal_credentials)
                old_gcal_service = GoogleCalendarService(json.dumps(old_gcal_credentials))
                await old_gcal_service.delete_event(appointment.gcal_event_id)

                # Create new event with new therapist
                new_gcal_event_id = None
                if gcal_service is not None:
                    gcal_event = await gcal_service.create_event(
                    summary=f"{appointment.patient.full_name} - {final_apt_type.name}",
                    start=new_start_time,
                    end=new_end_time,
                    description=f"Patient: {appointment.patient.full_name}\nPhone: {appointment.patient.phone_number}\nType: {final_apt_type.name}\nScheduled Via: LINE Bot",
                    extended_properties={
                        "private": {
                            "source": "line_bot",
                            "patient_id": str(appointment.patient_id),
                            "appointment_db_id": str(appointment.id)
                        }
                    }
                )
                    new_gcal_event_id = gcal_event['id']
            elif gcal_service is not None:
                # Update existing event
                await gcal_service.update_event(
                    event_id=appointment.gcal_event_id,
                    summary=f"{appointment.patient.full_name} - {final_apt_type.name}",
                    start=new_start_time,
                    end=new_end_time,
                    description=f"Patient: {appointment.patient.full_name}\nPhone: {appointment.patient.phone_number}\nType: {final_apt_type.name}\nScheduled Via: LINE Bot"
                )
                new_gcal_event_id = appointment.gcal_event_id
            else:
                new_gcal_event_id = None
        elif gcal_service is not None:
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
                        "appointment_db_id": str(appointment.id)
                    }
                }
            )
            new_gcal_event_id = gcal_event['id']
        else:
            new_gcal_event_id = None

        # Update database
        setattr(appointment, 'start_time', new_start_time)
        setattr(appointment, 'end_time', new_end_time)
        if new_therapist:
            appointment.user_id = new_therapist.id
        if new_apt_type:
            appointment.appointment_type_id = new_apt_type.id
        appointment.gcal_event_id = new_gcal_event_id

        db.commit()

        return {
            "success": True,
            "appointment_id": appointment.id,
            "new_therapist": final_therapist.full_name,
            "new_appointment_type": final_apt_type.name,
            "new_start_time": new_start_time.isoformat(),
            "new_end_time": new_end_time.isoformat(),
            "message": f"預約已更改至 {new_start_time.strftime('%Y-%m-%d %H:%M')} 與 {final_therapist.full_name} 預約 {final_apt_type.name}"
        }

    except GoogleCalendarError as e:
        db.rollback()
        return {"error": f"日曆同步失敗：{e}"}

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
    return await reschedule_appointment_impl(
        wrapper=wrapper,
        appointment_id=appointment_id,
        patient_id=patient_id,
        new_start_time=new_start_time,
        new_therapist_id=new_therapist_id,
        new_appointment_type_id=new_appointment_type_id,
    )


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
    db = wrapper.context.db_session

    try:
        # Query most recent past appointment
        last_appointment = db.query(Appointment).filter(
            Appointment.patient_id == patient_id,
            Appointment.start_time < datetime.now(timezone.utc),  # Past appointments only
            Appointment.status.in_(['confirmed', 'completed'])  # Successful appointments
        ).join(User).order_by(Appointment.start_time.desc()).first()

        if not last_appointment:
            return {"error": "找不到您之前的預約記錄"}

        practitioner = last_appointment.user
        return {
            "therapist_id": practitioner.id,
            "therapist_name": practitioner.full_name,
            "last_appointment_date": last_appointment.start_time.strftime('%Y-%m-%d'),
            "last_appointment_type": last_appointment.appointment_type.name,
            "message": f"您上次預約的治療師是 {practitioner.full_name}（{last_appointment.start_time.strftime('%Y-%m-%d')}）"
        }

    except Exception as e:
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
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic
    line_user_id = wrapper.context.line_user_id

    try:
        # Validate and sanitize phone number
        is_valid, sanitized_phone, phone_error = validate_taiwanese_phone_number(phone_number)
        if not is_valid:
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
                return f"SUCCESS: 您的帳號已經連結到 {current_patient.full_name}（{current_patient.phone_number}），無需重複連結。"
            else:
                patient_name = current_patient.full_name if current_patient else '其他病患'
                return f"ERROR: 此 LINE 帳號已連結到 {patient_name}。如需更改請聯繫診所。"

        if existing_patient:
            # Existing patient - verify not linked to another LINE account
            existing_link = db.query(LineUser).filter(
                LineUser.patient_id == existing_patient.id
            ).first()

            if existing_link is not None and existing_link.line_user_id != line_user_id:
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
            return f"SUCCESS: 帳號連結成功！歡迎 {existing_patient.full_name}（{existing_patient.phone_number}），您現在可以開始預約了。"

        else:
            # New patient - validate full name
            if not full_name or not full_name.strip():
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
            return f"SUCCESS: 歡迎 {new_patient.full_name}！您的病患記錄已建立，手機號碼 {new_patient.phone_number} 已連結到 LINE 帳號。您現在可以開始預約了。"

    except IntegrityError as e:
        db.rollback()
        return "ERROR: 資料庫錯誤，可能是手機號碼或姓名重複。請聯繫診所協助。"

    except Exception as e:
        db.rollback()
        return f"ERROR: 註冊帳號時發生錯誤：{e}"
