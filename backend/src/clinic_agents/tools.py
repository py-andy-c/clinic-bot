"""
Agent tools for database operations and external service integrations.

This module contains all the tools that agents can call to perform actions:
- Database operations (appointments, patients, therapists)
- Google Calendar synchronization
- Account linking operations

All tools follow the OpenAI Agent SDK pattern using RunContextWrapper[ConversationContext].
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from sqlalchemy.exc import IntegrityError

from agents import function_tool, RunContextWrapper  # type: ignore[import]

from models.therapist import Therapist
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser
from services.google_calendar_service import GoogleCalendarService, GoogleCalendarError
from clinic_agents.context import ConversationContext


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
async def get_therapist_availability(
    wrapper: RunContextWrapper[ConversationContext],
    therapist_name: str,
    date: str,
    appointment_type: str
) -> Dict[str, Any]:
    """
    Get available time slots for a specific therapist and appointment type.

    This tool finds available time slots for a therapist on a specific date,
    considering their existing appointments and the requested appointment duration.

    Args:
        wrapper: Context wrapper (auto-injected)
        therapist_name: Name of the therapist (from user conversation)
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

        # Find therapist
        therapist = db.query(Therapist).filter(
            Therapist.clinic_id == clinic.id,
            Therapist.name.ilike(f"%{therapist_name}%")  # Fuzzy name matching
        ).first()

        if not therapist:
            return {"error": f"找不到治療師：{therapist_name}"}

        # Find appointment type
        apt_type = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id,
            AppointmentType.name == appointment_type
        ).first()

        if not apt_type:
            return {"error": f"找不到預約類型：{appointment_type}"}

        # Get existing appointments for this therapist on this date
        day_start = datetime.combine(requested_date, datetime.min.time())
        day_end = datetime.combine(requested_date, datetime.max.time())

        existing_appointments = db.query(Appointment).filter(
            Appointment.therapist_id == therapist.id,
            Appointment.start_time >= day_start,
            Appointment.end_time <= day_end,
            Appointment.status.in_(['confirmed', 'pending'])  # type: ignore[reportGeneralTypeIssues]  # type: ignore[reportGeneralTypeIssues] # Include confirmed and pending
        ).all()

        # Calculate available slots (assuming clinic hours 9:00-17:00)
        clinic_start = datetime.combine(requested_date, datetime.strptime("09:00", "%H:%M").time())
        clinic_end = datetime.combine(requested_date, datetime.strptime("17:00", "%H:%M").time())
        duration = timedelta(minutes=apt_type.duration_minutes)

        available_slots = []
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
            "therapist_id": therapist.id,
            "therapist_name": therapist.name,
            "date": date,
            "appointment_type": appointment_type,
            "duration_minutes": apt_type.duration_minutes,
            "available_slots": available_slots
        }

    except ValueError as e:
        return {"error": f"日期格式錯誤：{e}"}
    except Exception as e:
        return {"error": f"查詢可用時段時發生錯誤：{e}"}


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
async def create_appointment(
    wrapper: RunContextWrapper[ConversationContext],
    therapist_id: int,
    appointment_type_id: int,
    start_time: datetime,
    patient_id: int
) -> Dict[str, Any]:
    """
    Create a new appointment with Google Calendar sync.

    This tool creates a new appointment in the database and synchronizes it
    with the therapist's Google Calendar. Uses transactional approach with rollback
    on Google Calendar failure.

    Args:
        wrapper: Context wrapper (auto-injected)
        therapist_id: ID of the therapist
        appointment_type_id: ID of the appointment type
        start_time: Appointment start time
        patient_id: ID of the patient

    Returns:
        Dict with appointment details or error message
    """
    db = wrapper.context.db_session

    try:
        # Load related entities
        therapist = db.query(Therapist).get(therapist_id)
        patient = db.query(Patient).get(patient_id)
        apt_type = db.query(AppointmentType).get(appointment_type_id)

        if not all([therapist, patient, apt_type]):
            return {"error": "找不到指定的治療師、病人或預約類型"}

        # Calculate end time
        end_time = start_time + timedelta(minutes=apt_type.duration_minutes)

        # Create Google Calendar event FIRST
        gcal_service = GoogleCalendarService(therapist.gcal_credentials)
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
            therapist_id=therapist_id,
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
            "therapist_name": therapist.name,
            "appointment_type": apt_type.name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "gcal_event_id": gcal_event['id'],
            "message": f"預約成功！{start_time.strftime('%Y-%m-%d %H:%M')} 與 {therapist.name} 預約 {apt_type.name}"
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


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
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
            Appointment.start_time >= datetime.now(),
            Appointment.status.in_(['confirmed', 'pending'])  # type: ignore[reportGeneralTypeIssues]
        ).join(Therapist).join(AppointmentType).order_by(Appointment.start_time).all()

        return [
            {
                "id": apt.id,
                "therapist_name": apt.therapist.name,
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


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
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
            Appointment.status.in_(['confirmed', 'pending'])  # type: ignore[reportGeneralTypeIssues]
        ).first()

        if not appointment:
            return {"error": "找不到該預約或您無權限取消"}

        # Cancel in Google Calendar first
        therapist = appointment.therapist
        gcal_service = GoogleCalendarService(therapist.gcal_credentials)

        if appointment.gcal_event_id:
            await gcal_service.delete_event(appointment.gcal_event_id)

        # Update database
        appointment.status = 'canceled_by_patient'
        db.commit()

        return {
            "success": True,
            "appointment_id": appointment.id,
            "therapist_name": appointment.therapist.name,
            "start_time": appointment.start_time.isoformat(),
            "message": f"預約已取消：{appointment.start_time.strftime('%Y-%m-%d %H:%M')} 與 {appointment.therapist.name} 的 {appointment.appointment_type.name}"
        }

    except GoogleCalendarError as e:
        # Still update database even if GCal fails
        appointment.status = 'canceled_by_patient'  # type: ignore[reportOptionalMemberAccess]
        db.commit()
        return {
            "success": True,
            "warning": f"預約已取消，但日曆同步失敗：{e}",
            "appointment_id": appointment.id  # type: ignore[reportOptionalMemberAccess]
        }

    except Exception as e:
        return {"error": f"取消預約時發生錯誤：{e}"}


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
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

    Args:
        wrapper: Context wrapper (auto-injected)
        appointment_id: ID of appointment to reschedule
        patient_id: ID of patient (for verification)
        new_start_time: New appointment start time
        new_therapist_id: Optional new therapist ID
        new_appointment_type_id: Optional new appointment type ID

    Returns:
        Dict with updated appointment details or error
    """
    db = wrapper.context.db_session

    try:
        # Find appointment and verify ownership
        appointment = db.query(Appointment).filter(
            Appointment.id == appointment_id,
            Appointment.patient_id == patient_id,
            Appointment.status.in_(['confirmed', 'pending'])  # type: ignore[reportGeneralTypeIssues]
        ).first()

        if not appointment:
            return {"error": "找不到該預約或您無權限修改"}

        # Load new entities if specified
        new_therapist = None
        new_apt_type = None

        if new_therapist_id:
            new_therapist = db.query(Therapist).get(new_therapist_id)
            if not new_therapist:
                return {"error": "找不到指定的治療師"}

        if new_appointment_type_id:
            new_apt_type = db.query(AppointmentType).get(new_appointment_type_id)
            if not new_apt_type:
                return {"error": "找不到指定的預約類型"}

        # Use existing entities if not specified
        final_therapist = new_therapist or appointment.therapist
        final_apt_type = new_apt_type or appointment.appointment_type

        # Calculate new end time
        new_end_time = new_start_time + timedelta(minutes=final_apt_type.duration_minutes)

        # Update Google Calendar event
        gcal_service = GoogleCalendarService(final_therapist.gcal_credentials)

        if appointment.gcal_event_id:
            # Delete old event if therapist changed
            if new_therapist and new_therapist.id != appointment.therapist_id:
                old_gcal_service = GoogleCalendarService(appointment.therapist.gcal_credentials)
                await old_gcal_service.delete_event(appointment.gcal_event_id)

                # Create new event with new therapist
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

        # Update database
        appointment.start_time = new_start_time
        appointment.end_time = new_end_time
        if new_therapist:
            appointment.therapist_id = new_therapist.id
        if new_apt_type:
            appointment.appointment_type_id = new_apt_type.id
        appointment.gcal_event_id = new_gcal_event_id

        db.commit()

        return {
            "success": True,
            "appointment_id": appointment.id,
            "new_therapist": final_therapist.name,
            "new_appointment_type": final_apt_type.name,
            "new_start_time": new_start_time.isoformat(),
            "new_end_time": new_end_time.isoformat(),
            "message": f"預約已更改至 {new_start_time.strftime('%Y-%m-%d %H:%M')} 與 {final_therapist.name} 預約 {final_apt_type.name}"
        }

    except GoogleCalendarError as e:
        db.rollback()
        return {"error": f"日曆同步失敗：{e}"}

    except Exception as e:
        db.rollback()
        return {"error": f"更改預約時發生錯誤：{e}"}


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
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
            Appointment.start_time < datetime.now(),  # Past appointments only
            Appointment.status.in_(['confirmed', 'completed'])  # type: ignore[reportGeneralTypeIssues] # Successful appointments
        ).join(Therapist).order_by(Appointment.start_time.desc()).first()

        if not last_appointment:
            return {"error": "找不到您之前的預約記錄"}

        therapist = last_appointment.therapist
        return {
            "therapist_id": therapist.id,
            "therapist_name": therapist.name,
            "last_appointment_date": last_appointment.start_time.strftime('%Y-%m-%d'),
            "last_appointment_type": last_appointment.appointment_type.name,
            "message": f"您上次預約的治療師是 {therapist.name}（{last_appointment.start_time.strftime('%Y-%m-%d')}）"
        }

    except Exception as e:
        return {"error": f"查詢上次治療師時發生錯誤：{e}"}


def sanitize_phone_number(phone_number: str) -> str:
    """
    Sanitize and standardize phone number.

    Removes spaces, dashes, and ensures proper format.
    Assumes Taiwanese phone numbers.

    Args:
        phone_number: Raw phone number string

    Returns:
        Sanitized phone number
    """
    # Remove all non-digit characters
    digits_only = ''.join(filter(str.isdigit, phone_number))

    # Handle Taiwanese phone numbers
    if digits_only.startswith('886'):  # International format
        digits_only = '0' + digits_only[3:]  # Convert to local format
    elif digits_only.startswith('09') and len(digits_only) == 10:  # Mobile format
        pass  # Already correct
    elif len(digits_only) == 9 and digits_only.startswith('9'):  # Missing leading 0
        digits_only = '0' + digits_only

    return digits_only


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
async def verify_and_link_patient(
    wrapper: RunContextWrapper[ConversationContext],
    phone_number: str
) -> str:
    """
    Verify phone number and link LINE account to patient record.

    This tool performs the actual linking operation, not just checking status.
    For new patients, it will ask for additional information (name) to create a patient record.

    Args:
        wrapper: Context wrapper (auto-injected)
        phone_number: Phone number provided by user

    Returns:
        Success or error message as string, or request for more info
    """
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic
    line_user_id = wrapper.context.line_user_id

    try:
        # Sanitize phone number
        sanitized_phone = sanitize_phone_number(phone_number)

        # Query patient by phone number in this clinic
        patient = db.query(Patient).filter(
            Patient.clinic_id == clinic.id,
            Patient.phone_number == sanitized_phone
        ).first()

        if not patient:
            # For new patients, we need more information
            return f"NEEDS_NAME: 您的手機號碼 {sanitized_phone} 尚未在系統中註冊。請提供您的全名，以便為您建立病患記錄。"

        # Check if already linked to another LINE account
        existing_link = db.query(LineUser).filter(
            LineUser.patient_id == patient.id
        ).first()

        if existing_link and existing_link.line_user_id != line_user_id:
            return "ERROR: 此手機號碼已連結到其他 LINE 帳號。如有問題請聯繫診所。"

        # Check if this LINE account is already linked
        existing_line_user = db.query(LineUser).filter(
            LineUser.line_user_id == line_user_id
        ).first()

        if existing_line_user and existing_line_user.patient_id:
            if existing_line_user.patient_id == patient.id:
                return f"SUCCESS: 您的帳號已經連結到 {patient.full_name}（{patient.phone_number}），無需重複連結。"
            else:
                return "ERROR: 此 LINE 帳號已連結到其他病患。如有問題請聯繫診所。"

        # Create or update LINE user link
        if existing_line_user:
            existing_line_user.patient_id = patient.id
        else:
            line_user = LineUser(
                line_user_id=line_user_id,
                patient_id=patient.id
            )
            db.add(line_user)

        db.commit()

        return f"SUCCESS: 帳號連結成功！歡迎 {patient.full_name}（{patient.phone_number}），您現在可以開始預約了。"

    except IntegrityError as e:
        db.rollback()
        return "ERROR: 資料庫錯誤，請稍後再試。"

    except Exception as e:
        db.rollback()
        return f"ERROR: 連結帳號時發生錯誤：{e}"


@function_tool  # type: ignore[reportUntypedFunctionDecorator]
async def create_patient_and_link(
    wrapper: RunContextWrapper[ConversationContext],
    phone_number: str,
    full_name: str
) -> str:
    """
    Create a new patient record and link LINE account.

    This tool creates a new patient record with the provided information
    and links the LINE account to it.

    Args:
        wrapper: Context wrapper (auto-injected)
        phone_number: Phone number for the new patient
        full_name: Full name of the new patient

    Returns:
        Success or error message as string
    """
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic
    line_user_id = wrapper.context.line_user_id

    try:
        # Sanitize phone number
        sanitized_phone = sanitize_phone_number(phone_number)

        # Check if phone number already exists
        existing_patient = db.query(Patient).filter(
            Patient.clinic_id == clinic.id,
            Patient.phone_number == sanitized_phone
        ).first()

        if existing_patient:
            return f"ERROR: 此手機號碼 {sanitized_phone} 已存在於系統中，姓名為 {existing_patient.full_name}。請使用正確的資訊，或聯繫診所協助。"

        # Check if this LINE account is already linked
        existing_line_user = db.query(LineUser).filter(
            LineUser.line_user_id == line_user_id
        ).first()

        if existing_line_user and existing_line_user.patient_id:
            existing_patient = db.query(Patient).filter(Patient.id == existing_line_user.patient_id).first()
            return f"ERROR: 此 LINE 帳號已連結到 {existing_patient.full_name if existing_patient else '其他病患'}。"

        # Create new patient
        new_patient = Patient(
            clinic_id=clinic.id,
            full_name=full_name.strip(),
            phone_number=sanitized_phone
        )
        db.add(new_patient)
        db.flush()  # Get the patient ID

        # Link LINE account to patient
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
        return f"ERROR: 建立病患記錄時發生錯誤：{e}"
