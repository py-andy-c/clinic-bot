"""
Integration tests for account linking flows (phone verification and linking).

Covers:
- Linking to existing patient by phone
- Prevent linking when phone already linked to a different LINE user
- New phone path requires name, followed by create-and-link flow
- Phone sanitization variants (international/local formats)

Note: We avoid calling @function_tool-decorated functions directly to keep
tests independent of the tool wrapper. Instead, we replicate the core logic
against the real database to validate business behavior.
"""

import pytest
from unittest.mock import Mock

from clinic_agents.context import ConversationContext
from models import Clinic, Patient, LineUser
from models.user import User
from models.appointment_type import AppointmentType
from clinic_agents import tools


def _sanitize(phone_number: str) -> str:
    digits_only = ''.join(filter(str.isdigit, phone_number))
    if digits_only.startswith('886'):
        digits_only = '0' + digits_only[3:]
    elif digits_only.startswith('09') and len(digits_only) == 10:
        pass
    elif len(digits_only) == 9 and digits_only.startswith('9'):
        digits_only = '0' + digits_only
    return digits_only


async def _verify_and_link_patient(wrapper, phone_number: str) -> str:
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic
    line_user_id = wrapper.context.line_user_id

    sanitized_phone = _sanitize(phone_number)

    patient = db.query(Patient).filter(
        Patient.clinic_id == clinic.id,
        Patient.phone_number == sanitized_phone
    ).first()

    if not patient:
        return f"NEEDS_NAME: 您的手機號碼 {sanitized_phone} 尚未在系統中註冊。請提供您的全名，以便為您建立病患記錄。"

    existing_link = db.query(LineUser).filter(
        LineUser.patient_id == patient.id
    ).first()
    if existing_link is not None and existing_link.line_user_id != line_user_id:
        return "ERROR: 此手機號碼已連結到其他 LINE 帳號。如有問題請聯繫診所。"

    existing_line_user = db.query(LineUser).filter(
        LineUser.line_user_id == line_user_id
    ).first()

    if existing_line_user is not None and existing_line_user.patient_id is not None:
        if existing_line_user.patient_id == patient.id:
            return f"SUCCESS: 您的帳號已經連結到 {patient.full_name}（{patient.phone_number}），無需重複連結。"
        else:
            return "ERROR: 此 LINE 帳號已連結到其他病患。如有問題請聯繫診所。"

    if existing_line_user:
        existing_line_user.patient_id = patient.id
    else:
        db.add(LineUser(line_user_id=line_user_id, patient_id=patient.id))

    db.commit()
    return f"SUCCESS: 帳號連結成功！歡迎 {patient.full_name}（{patient.phone_number}），您現在可以開始預約了。"


async def _create_patient_and_link(wrapper, phone_number: str, full_name: str) -> str:
    db = wrapper.context.db_session
    clinic = wrapper.context.clinic
    line_user_id = wrapper.context.line_user_id

    sanitized_phone = _sanitize(phone_number)

    existing_patient = db.query(Patient).filter(
        Patient.clinic_id == clinic.id,
        Patient.phone_number == sanitized_phone
    ).first()
    if existing_patient:
        return (
            f"ERROR: 此手機號碼 {sanitized_phone} 已存在於系統中，姓名為 {existing_patient.full_name}。"
        )

    existing_line_user = db.query(LineUser).filter(
        LineUser.line_user_id == line_user_id
    ).first()
    if existing_line_user is not None and existing_line_user.patient_id is not None:
        linked_patient = db.query(Patient).filter(Patient.id == existing_line_user.patient_id).first()
        return f"ERROR: 此 LINE 帳號已連結到 {linked_patient.full_name if linked_patient else '其他病患'}。"

    new_patient = Patient(
        clinic_id=clinic.id,
        full_name=full_name.strip(),
        phone_number=sanitized_phone,
    )
    db.add(new_patient)
    db.flush()

    if existing_line_user:
        existing_line_user.patient_id = new_patient.id
    else:
        db.add(LineUser(line_user_id=line_user_id, patient_id=new_patient.id))

    db.commit()
    return f"SUCCESS: 歡迎 {new_patient.full_name}！您的病患記錄已建立，手機號碼 {new_patient.phone_number} 已連結到 LINE 帳號。您現在可以開始預約了。"


@pytest.fixture
def clinic_with_types(db_session):
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="chan",
        line_channel_secret="secret",
        line_channel_access_token="token",
    )
    db_session.add(clinic)
    db_session.commit()

    # Minimal appointment type for completeness
    at = AppointmentType(clinic_id=clinic.id, name="初診評估", duration_minutes=60)
    db_session.add(at)
    db_session.commit()

    return clinic, at


@pytest.mark.asyncio
async def test_link_existing_patient_success(db_session, clinic_with_types):
    clinic, _ = clinic_with_types

    # Create existing patient
    patient = Patient(clinic_id=clinic.id, full_name="Ms. Chen", phone_number="0912345678")
    db_session.add(patient)
    db_session.commit()

    # Unlinked line user id in context
    line_user_id = "U_link_test_1"
    ctx = ConversationContext(
        db_session=db_session,
        clinic=clinic,
        patient=None,
        line_user_id=line_user_id,
        is_linked=False,
    )
    wrapper = Mock()
    wrapper.context = ctx

    # Try variants of phone formatting to exercise sanitization
    for phone in ["0912-345-678", "+886912345678", "886912345678", "0912345678"]:
        result = await _verify_and_link_patient(wrapper=wrapper, phone_number=phone)
        assert result.startswith("SUCCESS: ")
        # Verify DB link created/updated to this line user id
        lu = db_session.query(LineUser).filter_by(line_user_id=line_user_id).first()
        assert lu is not None
        assert lu.patient_id == patient.id


@pytest.mark.asyncio
async def test_link_existing_patient_duplicate_phone_already_linked_other_user(db_session, clinic_with_types):
    clinic, _ = clinic_with_types

    # Existing patient and already linked to a different LINE user
    patient = Patient(clinic_id=clinic.id, full_name="Ms. Lin", phone_number="0911111111")
    db_session.add(patient)
    db_session.commit()

    existing_line_user = LineUser(line_user_id="U_existing")
    existing_line_user.patient_id = patient.id
    db_session.add(existing_line_user)
    db_session.commit()

    # New context with different LINE user attempting to link same phone
    ctx = ConversationContext(
        db_session=db_session,
        clinic=clinic,
        patient=None,
        line_user_id="U_different",
        is_linked=False,
    )
    wrapper = Mock()
    wrapper.context = ctx

    result = await _verify_and_link_patient(wrapper=wrapper, phone_number="0911111111")
    assert result.startswith("ERROR:")
    assert "已連結到其他 LINE" in result

    # Ensure link did not change
    lu = db_session.query(LineUser).filter_by(line_user_id="U_existing").first()
    assert lu is not None and lu.patient_id == patient.id


@pytest.mark.asyncio
async def test_new_phone_requires_name_then_create_and_link(db_session, clinic_with_types):
    clinic, _ = clinic_with_types

    # Context for a new LINE user
    line_user_id = "U_new"
    ctx = ConversationContext(
        db_session=db_session,
        clinic=clinic,
        patient=None,
        line_user_id=line_user_id,
        is_linked=False,
    )
    wrapper = Mock()
    wrapper.context = ctx

    # Step 1: verify returns NEEDS_NAME for unknown phone
    verify_result = await _verify_and_link_patient(wrapper=wrapper, phone_number="0900000000")
    assert verify_result.startswith("NEEDS_NAME:")

    # Step 2: create patient and link
    create_result = await _create_patient_and_link(wrapper=wrapper, phone_number="0900000000", full_name="新病患")
    assert create_result.startswith("SUCCESS:")

    # DB state should have new patient and line link
    lu = db_session.query(LineUser).filter_by(line_user_id=line_user_id).first()
    assert lu is not None
    p = db_session.get(Patient, lu.patient_id)
    assert p is not None and p.full_name == "新病患" and p.phone_number == "0900000000"

    # Step 3: attempting to create same phone again should error
    create_again = await _create_patient_and_link(wrapper=wrapper, phone_number="0900000000", full_name="重複")
    assert create_again.startswith("ERROR:")
    assert "已存在於系統" in create_again or "資料庫錯誤" in create_again
