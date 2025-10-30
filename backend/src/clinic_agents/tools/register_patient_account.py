# pyright: reportMissingTypeStubs=false
"""
Tool for registering and linking patient accounts.

This tool handles patient account registration and LINE account linking,
including validation of Taiwanese phone numbers and duplicate checking.
"""

import logging
from typing import Tuple

from agents import function_tool, RunContextWrapper
from sqlalchemy.exc import IntegrityError

from models.patient import Patient
from models.line_user import LineUser
from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


def validate_taiwanese_phone_number(phone_number: str) -> Tuple[bool, str, str]:
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
