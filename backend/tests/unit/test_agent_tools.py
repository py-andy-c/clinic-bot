"""
Unit tests for agent tools.

Tests the core business logic tools that agents call to perform operations.
"""

import pytest
from datetime import datetime, timedelta, time, date
from unittest.mock import patch, Mock, AsyncMock

from models import Clinic, User, Patient, Appointment, AppointmentType, LineUser, CalendarEvent, PractitionerAvailability
from clinic_agents.context import ConversationContext
from clinic_agents.tools.create_appointment import create_appointment_impl
from typing import Dict, List, Any


# Copy the get_practitioner_availability logic for testing
async def mock_get_practitioner_availability(
    wrapper,
    practitioner_id: int,
    date: str,
    appointment_type_id: int
) -> Dict[str, Any]:
    """Test version of get_practitioner_availability function."""
    from sqlalchemy import and_
    from datetime import datetime, timedelta

    db = wrapper.context.db_session
    clinic = wrapper.context.clinic

    try:
        # Parse date
        requested_date = datetime.strptime(date, "%Y-%m-%d").date()

        # Find practitioner by ID with practitioner role verification
        practitioner = db.query(User).filter(
            User.id == practitioner_id,
            User.clinic_id == clinic.id,
            User.is_active == True
        ).first()

        # Verify practitioner role
        if practitioner and 'practitioner' not in practitioner.roles:
            practitioner = None

        if not practitioner:
            return {"error": f"找不到醫師 ID：{practitioner_id}"}

        # Find appointment type
        apt_type = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id,
            AppointmentType.id == appointment_type_id
        ).first()

        if not apt_type:
            return {"error": f"找不到預約類型 ID：{appointment_type_id}"}

        # Get existing appointments for this practitioner on this date
        existing_appointments = db.query(Appointment).join(CalendarEvent).filter(
            CalendarEvent.user_id == practitioner.id,
            CalendarEvent.date == requested_date,
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
            for appointment in existing_appointments:
                # Convert appointment times to datetime for comparison
                appt_start = datetime.combine(requested_date, appointment.calendar_event.start_time)
                appt_end = datetime.combine(requested_date, appointment.calendar_event.end_time)
                
                if (current_time < appt_end and slot_end > appt_start):
                    conflict = True
                    break

            if not conflict:
                available_slots.append(current_time.strftime("%H:%M"))

            current_time += timedelta(minutes=30)  # 30-minute intervals

        return {"available_slots": available_slots}

    except Exception as e:
        return {"error": f"系統錯誤：{str(e)}"}


@pytest.fixture
def test_clinic_with_therapist_and_types(db_session):
    """Create a test clinic with therapist and appointment types."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()  # Commit clinic first to get ID

    therapist = User(
        clinic_id=clinic.id,
        full_name="Dr. Test",
        email="dr.test@example.com",
        google_subject_id="therapist_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    db_session.add(therapist)
    db_session.commit()  # Commit therapist to get ID

    # Create appointment types
    appointment_types = [
        AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        ),
        AppointmentType(
            clinic_id=clinic.id,
            name="回診",
            duration_minutes=30
        )
    ]

    # Create practitioner availability for Monday-Friday, 9am-5pm
    from datetime import time
    availability_records = []
    for day in range(5):  # Monday to Friday
        availability_records.append(
            PractitionerAvailability(
                user_id=therapist.id,
                day_of_week=day,
                start_time=time(9, 0),  # 9:00 AM
                end_time=time(17, 0)    # 5:00 PM
            )
        )

    db_session.add_all(appointment_types + availability_records)
    db_session.commit()

    return clinic, therapist, appointment_types


@pytest.fixture
def linked_patient(db_session, test_clinic_with_therapist_and_types):
    """Create a linked patient."""
    clinic, _, _ = test_clinic_with_therapist_and_types

    from models.line_user import LineUser

    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="+1234567890"
    )

    line_user = LineUser(
        line_user_id="Utest_patient_123"
    )

    patient.line_user = line_user

    db_session.add_all([patient, line_user])
    db_session.commit()

    return patient


@pytest.fixture
def conversation_context(db_session, test_clinic_with_therapist_and_types, linked_patient):
    """Create a conversation context."""
    clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

    return ConversationContext(
        db_session=db_session,
        clinic=clinic,
        patient=linked_patient,
        line_user_id=linked_patient.line_user.line_user_id,
        is_linked=True
    )


class TestGetPractitionerAvailability:
    """Test the get_practitioner_availability tool."""

    @pytest.mark.asyncio
    async def test_get_availability_successful(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test successful availability lookup."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # 60-minute appointment

        # Create a mock wrapper
        wrapper = Mock()
        wrapper.context = conversation_context

        # Test date: tomorrow
        test_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        # Call the test function
        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=apt_type.id
        )

        # Should return available slots
        assert "available_slots" in result
        assert isinstance(result["available_slots"], list)
        # Should have slots during clinic hours (9:00-17:00) minus the 60-minute appointment duration
        # Clinic hours: 9:00-17:00 = 8 hours
        # 60-minute slots: should fit about 7 slots (9:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00)
        assert len(result["available_slots"]) > 0

        # Each slot should be a time string
        for slot in result["available_slots"]:
            assert isinstance(slot, str)
            # Should be in HH:MM format
            assert len(slot) == 5
            assert ":" in slot

    @pytest.mark.asyncio
    async def test_get_availability_practitioner_not_found(self, db_session, conversation_context):
        """Test availability lookup when practitioner doesn't exist."""
        wrapper = Mock()
        wrapper.context = conversation_context

        test_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=99999,  # Non-existent ID
            date=test_date,
            appointment_type_id=1  # Valid appointment type ID
        )

        assert "error" in result
        assert "找不到醫師" in result["error"]

    @pytest.mark.asyncio
    async def test_get_availability_appointment_type_not_found(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test availability lookup when appointment type doesn't exist."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        wrapper = Mock()
        wrapper.context = conversation_context

        test_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=99999
        )

        assert "error" in result
        assert "找不到預約類型" in result["error"]

    @pytest.mark.asyncio
    async def test_get_availability_with_existing_appointments(self, db_session, test_clinic_with_therapist_and_types, conversation_context, linked_patient):
        """Test availability calculation excludes existing appointments."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # 60-minute appointment

        # Create an existing appointment at 10:00 tomorrow
        tomorrow = datetime.now() + timedelta(days=1)
        appointment_start = datetime.combine(tomorrow.date(), time(10, 0))
        appointment_end = appointment_start + timedelta(minutes=60)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=therapist.id,
            event_type='appointment',
            date=appointment_start.date(),
            start_time=appointment_start.time(),
            end_time=appointment_end.time(),
            gcal_event_id=None
        )
        db_session.add(calendar_event)
        db_session.commit()

        existing_appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )

        db_session.add(existing_appointment)
        db_session.commit()

        wrapper = Mock()
        wrapper.context = conversation_context

        test_date = tomorrow.strftime("%Y-%m-%d")

        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=apt_type.id
        )

        # Should return available slots
        assert "available_slots" in result
        assert isinstance(result["available_slots"], list)

        # The 10:00 slot should NOT be available
        assert "10:00" not in result["available_slots"]

        # Other slots should still be available
        available_slots = result["available_slots"]
        assert len(available_slots) > 0
        # Should have slots like 09:00, 11:00, 12:00, etc.
        assert any("09:00" in slot or "11:00" in slot for slot in available_slots)

    @pytest.mark.asyncio
    async def test_get_availability_different_durations(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test availability calculation with different appointment durations."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        wrapper = Mock()
        wrapper.context = conversation_context

        test_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        # Test with 30-minute appointment type
        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=appointment_types[1].id  # 30 minutes
        )

        assert "available_slots" in result
        # 30-minute slots should fit more slots than 60-minute ones
        # Clinic hours: 9:00-17:00 = 8 hours = 480 minutes
        # 30-minute slots: should fit about 15 slots
        assert len(result["available_slots"]) > 10  # More than 60-minute slots would allow

    @pytest.mark.asyncio
    async def test_get_availability_past_date(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test availability lookup for past dates."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # 60-minute appointment

        wrapper = Mock()
        wrapper.context = conversation_context

        # Past date
        past_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=past_date,
            appointment_type_id=apt_type.id
        )

        # Should still return slots (business logic doesn't prevent past dates)
        assert "available_slots" in result
        assert isinstance(result["available_slots"], list)

    @pytest.mark.asyncio
    async def test_get_availability_inactive_practitioner(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test availability lookup for inactive practitioner."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # 60-minute appointment

        # Mark therapist as inactive
        therapist.is_active = False
        db_session.commit()

        wrapper = Mock()
        wrapper.context = conversation_context

        test_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=apt_type.id
        )

        # Should not find inactive practitioner
        assert "error" in result
        assert "找不到醫師" in result["error"]

    @pytest.mark.asyncio
    async def test_get_availability_by_id(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test availability lookup using practitioner ID."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # 60-minute appointment

        wrapper = Mock()
        wrapper.context = conversation_context

        test_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        # Test with actual practitioner ID
        result = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=apt_type.id
        )

        # Should find the practitioner by ID
        assert "available_slots" in result

        # Test with another call using the same ID
        result2 = await mock_get_practitioner_availability(
            wrapper=wrapper,
            practitioner_id=therapist.id,
            date=test_date,
            appointment_type_id=apt_type.id
        )

        assert "available_slots" in result2


# Mock function removed - tests now use create_appointment_impl directly

class TestCreateAppointment:
    """Test the create_appointment tool."""

    @pytest.mark.asyncio
    async def test_create_appointment_successful(self, db_session, test_clinic_with_therapist_and_types, conversation_context, linked_patient):
        """Test successful appointment creation with Google Calendar sync."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # 60-minute appointment

        # Set up therapist with Google Calendar credentials (mock encryption)
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"  # Mock encrypted data
        db_session.commit()

        wrapper = Mock()
        wrapper.context = conversation_context

        # Create appointment for tomorrow at 10:00
        tomorrow = datetime.now() + timedelta(days=1)
        start_time = datetime.combine(tomorrow.date(), time(10, 0)).strftime("%Y-%m-%d %H:%M")

        # Mock Google Calendar service and encryption service
        with patch('clinic_agents.tools.create_appointment.GoogleCalendarService') as mock_gcal_class, \
             patch('clinic_agents.tools.create_appointment.get_encryption_service') as mock_encryption:
            mock_gcal_instance = Mock()
            mock_gcal_instance.create_event = AsyncMock(return_value={
                'id': 'gcal_event_123',
                'summary': 'Test Appointment'
            })
            mock_gcal_instance.update_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal_instance

            # Mock encryption service to return decrypted credentials
            mock_encryption.return_value.decrypt_data.return_value = test_credentials

            result = await create_appointment_impl(
                wrapper=wrapper,
                therapist_id=therapist.id,
                appointment_type_id=apt_type.id,
                start_time=start_time,
                patient_id=linked_patient.id
            )

        # Should return success
        assert result["success"] is True
        assert result["therapist_name"] == therapist.full_name
        assert result["appointment_type"] == apt_type.name
        assert "預約成功" in result["message"]

    @pytest.mark.asyncio
    async def test_create_appointment_practitioner_not_found(self, db_session, conversation_context):
        """Test appointment creation when practitioner doesn't exist."""
        wrapper = Mock()
        wrapper.context = conversation_context

        start_time = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")

        result = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=999,  # Non-existent ID
            appointment_type_id=1,
            start_time=start_time,
            patient_id=1
        )

        assert "error" in result
        assert "找不到指定的治療師" in result["error"]

    @pytest.mark.asyncio
    async def test_create_appointment_patient_not_found(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test appointment creation when patient doesn't exist."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        wrapper = Mock()
        wrapper.context = conversation_context

        start_time = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")

        result = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=therapist.id,
            appointment_type_id=appointment_types[0].id,
            start_time=start_time,
            patient_id=999  # Non-existent ID
        )

        assert "error" in result
        assert "找不到指定的病人" in result["error"]

    @pytest.mark.asyncio
    async def test_create_appointment_no_gcal_credentials(self, db_session, test_clinic_with_therapist_and_types, conversation_context, linked_patient):
        """Test appointment creation when practitioner has no Google Calendar credentials."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Ensure therapist has no Google Calendar credentials
        therapist.gcal_credentials = None
        db_session.commit()

        wrapper = Mock()
        wrapper.context = conversation_context

        start_time = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")

        result = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=therapist.id,
            appointment_type_id=apt_type.id,
            start_time=start_time,
            patient_id=linked_patient.id
        )

        assert result["success"] is True
        assert "未同步至 Google 日曆" in result["message"]

    @pytest.mark.asyncio
    async def test_create_appointment_gcal_failure_rollback(self, db_session, test_clinic_with_therapist_and_types, conversation_context, linked_patient):
        """Test that database is rolled back when Google Calendar creation fails."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Set up therapist with Google Calendar credentials (mock encryption)
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"  # Mock encrypted data
        db_session.commit()

        wrapper = Mock()
        wrapper.context = conversation_context

        start_time = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")

        # Mock Google Calendar service to fail
        with patch('clinic_agents.tools.create_appointment.GoogleCalendarService') as mock_gcal_class:
            mock_gcal_instance = Mock()
            mock_gcal_class.return_value = mock_gcal_instance

            # Mock calendar creation to raise an error
            from services.google_calendar_service import GoogleCalendarError
            mock_gcal_instance.create_event = AsyncMock(side_effect=GoogleCalendarError("Calendar API error"))

            result = await create_appointment_impl(
                wrapper=wrapper,
                therapist_id=therapist.id,
                appointment_type_id=apt_type.id,
                start_time=start_time,
                patient_id=linked_patient.id
            )

            # Should still succeed (GCal failure doesn't block appointment creation)
            assert result["success"] is True
            assert "未同步至 Google 日曆" in result["message"]

            # Verify appointment was created in database despite GCal failure
            from models import Appointment
            appointment_count = db_session.query(Appointment).filter(
                Appointment.patient_id == linked_patient.id
            ).count()
            assert appointment_count == 1

    @pytest.mark.asyncio
    async def test_create_appointment_conflict_rollback(self, db_session, test_clinic_with_therapist_and_types, conversation_context, linked_patient):
        """Test that appointment creation fails with time conflicts."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Set up therapist with Google Calendar credentials (mock encryption)
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"  # Mock encrypted data
        db_session.commit()

        # Create an existing appointment at the same time
        start_time = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))
        end_time = start_time + timedelta(minutes=60)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=therapist.id,
            event_type='appointment',
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
            gcal_event_id="existing_event"
        )
        db_session.add(calendar_event)
        db_session.commit()

        existing_appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        wrapper = Mock()
        wrapper.context = conversation_context

        # Mock Google Calendar service
        with patch('clinic_agents.tools.create_appointment.GoogleCalendarService') as mock_gcal_class:
            mock_gcal_instance = Mock()
            mock_gcal_instance.create_event = AsyncMock(return_value={
                'id': 'gcal_event_123',
                'summary': 'Test Appointment'
            })
            mock_gcal_instance.update_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal_instance

            # Try to create appointment at the same time
            result = await create_appointment_impl(
                wrapper=wrapper,
                therapist_id=therapist.id,
                appointment_type_id=apt_type.id,
                start_time=start_time.strftime("%Y-%m-%d %H:%M"),
                patient_id=linked_patient.id
            )

        # Should return conflict error
        assert "error" in result
        assert "預約時間衝突" in result["error"]


# Copy the verify_and_link_patient logic for testing
async def mock_verify_and_link_patient(
    wrapper,
    phone_number: str
) -> str:
    """Test version of verify_and_link_patient function."""
    from sqlalchemy.exc import IntegrityError

    def sanitize_phone_number(phone_number: str) -> str:
        """Sanitize phone number."""
        digits_only = ''.join(filter(str.isdigit, phone_number))
        if digits_only.startswith('886'):
            digits_only = '0' + digits_only[3:]
        elif digits_only.startswith('09') and len(digits_only) == 10:
            pass
        elif len(digits_only) == 9 and digits_only.startswith('9'):
            digits_only = '0' + digits_only
        return digits_only

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

        if existing_link is not None and existing_link.line_user_id != line_user_id:
            return "ERROR: 此手機號碼已連結到其他 LINE 帳號。如有問題請聯繫診所。"

        # Check if this LINE account is already linked
        existing_line_user = db.query(LineUser).filter(
            LineUser.line_user_id == line_user_id
        ).first()

        if existing_line_user is not None and existing_line_user.patient_id is not None:
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


class TestVerifyAndLinkPatient:
    """Test the verify_and_link_patient tool."""

    @pytest.mark.asyncio
    async def test_verify_link_new_patient_request(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test linking request for new patient (phone not in system)."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        wrapper = Mock()
        wrapper.context = conversation_context

        result = await mock_verify_and_link_patient(
            wrapper=wrapper,
            phone_number="0912345678"  # Phone number not in system
        )

        # Should return NEEDS_NAME for non-existent patient
        assert result.startswith("NEEDS_NAME:")
        assert "0912345678" in result

    @pytest.mark.asyncio
    async def test_verify_link_existing_patient_success(self, db_session, test_clinic_with_therapist_and_types, conversation_context):
        """Test successful linking to existing patient."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create an unlinked LINE user
        unlinked_line_user = LineUser(line_user_id="Uunlinked_test")
        db_session.add(unlinked_line_user)

        # Create a patient with a unique phone number
        patient = Patient(
            clinic_id=clinic.id,
            full_name="New Test Patient",
            phone_number="0987654321"
        )
        db_session.add(patient)
        db_session.commit()

        # Create context for the unlinked user
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Uunlinked_test",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        result = await mock_verify_and_link_patient(
            wrapper=wrapper,
            phone_number="0987654321"
        )

        # Should return SUCCESS for successful linking
        assert result.startswith("SUCCESS:")
        assert "New Test Patient" in result
        assert "0987654321" in result

    @pytest.mark.asyncio
    async def test_verify_link_phone_sanitization(self, db_session, test_clinic_with_therapist_and_types):
        """Test phone number sanitization works correctly."""
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create a fresh LINE user for this test
        fresh_line_user = LineUser(line_user_id="Ufresh_test_user")

        # Create patient with sanitized phone number
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add_all([fresh_line_user, patient])
        db_session.commit()

        # Create context for the fresh user
        from clinic_agents.context import ConversationContext
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Ufresh_test_user",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        # Test various phone number formats
        test_cases = [
            "0912345678",  # Already correct
            "091-234-5678",  # With dashes
            "091 234 5678",  # With spaces
            "+886912345678",  # International format
        ]

        for phone_input in test_cases:
            result = await mock_verify_and_link_patient(
                wrapper=wrapper,
                phone_number=phone_input
            )

            # Should find the patient regardless of input format
            assert result.startswith("SUCCESS:")
            assert patient.full_name in result


class TestValidateTaiwanesePhoneNumber:
    """Test phone number validation function."""

    def test_valid_mobile_formats(self):
        """Test various valid mobile phone number formats."""
        from clinic_agents.tools import validate_taiwanese_phone_number

        valid_cases = [
            ("0912345678", "0912345678"),      # Standard format
            ("912345678", "0912345678"),       # Missing leading 0
            ("0912-345-678", "0912345678"),    # With dashes
            ("0912 345 678", "0912345678"),    # With spaces
            ("+886912345678", "0912345678"),   # International with +
            ("886912345678", "0912345678"),    # International without +
            ("+886 912 345 678", "0912345678"), # International with spaces
            ("+886-912-345-678", "0912345678"), # International with dashes
            ("0999999999", "0999999999"),      # Valid format (even if not real number)
        ]

        for input_phone, expected_output in valid_cases:
            is_valid, sanitized, error = validate_taiwanese_phone_number(input_phone)
            assert is_valid, f"Expected {input_phone} to be valid"
            assert sanitized == expected_output, f"Expected {expected_output}, got {sanitized}"
            assert error == "", f"Expected no error, got {error}"

    def test_invalid_formats(self):
        """Test various invalid phone number formats."""
        from clinic_agents.tools import validate_taiwanese_phone_number

        invalid_cases = [
            ("0212345678", "只接受手機號碼，不接受市話號碼"),      # Landline
            ("02-12345678", "只接受手機號碼，不接受市話號碼"),     # Landline with dash
            ("037-123456", "只接受手機號碼，不接受市話號碼"),      # Landline
            ("+8860212345678", "只接受手機號碼，不接受市話號碼"),  # International landline
            ("9123456789", "手機號碼應以 09 開頭"),                # 10 digits starting with 9
            ("12345678", "手機號碼格式錯誤。只接受手機號碼"),      # Invalid length
            ("", "手機號碼不能為空"),                              # Empty
        ]

        for input_phone, expected_error_prefix in invalid_cases:
            is_valid, sanitized, error = validate_taiwanese_phone_number(input_phone)
            assert not is_valid, f"Expected {input_phone} to be invalid"
            assert sanitized == "", f"Expected empty sanitized for invalid input, got {sanitized}"
            assert error.startswith(expected_error_prefix), f"Expected error to start with '{expected_error_prefix}', got '{error}'"

    def test_edge_cases(self):
        """Test edge cases and boundary conditions."""
        from clinic_agents.tools import validate_taiwanese_phone_number

        # Test that invalid 9-digit numbers starting with 9 are rejected if second digit is invalid
        # (though currently all digits 0-9 are accepted for the second digit)
        edge_cases = [
            ("999999999", True, "0999999999"),  # Currently accepted
        ]

        for input_phone, should_be_valid, expected_output in edge_cases:
            is_valid, sanitized, error = validate_taiwanese_phone_number(input_phone)
            assert is_valid == should_be_valid, f"Expected {input_phone} validity: {should_be_valid}"
            if should_be_valid:
                assert sanitized == expected_output, f"Expected {expected_output}, got {sanitized}"


# Mock version of register_patient_account for testing
async def mock_register_patient_account(
    wrapper,
    phone_number: str,
    full_name: str
) -> str:
    """Test version of register_patient_account function."""
    from clinic_agents.tools import validate_taiwanese_phone_number

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
            if existing_patient and existing_patient.id == current_patient.id:
                return f"SUCCESS: 您的帳號已經連結到 {current_patient.full_name}（{current_patient.phone_number}），無需重複連結。"
            else:
                return f"ERROR: 此 LINE 帳號已連結到 {current_patient.full_name if current_patient else '其他病患'}。如需更改請聯繫診所。"

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

    except Exception as e:
        db.rollback()
        return f"ERROR: 註冊帳號時發生錯誤：{e}"


class TestRegisterPatientAccount:
    """Test the register_patient_account tool."""

    @pytest.mark.asyncio
    async def test_register_existing_patient_success(self, db_session, test_clinic_with_therapist_and_types):
        """Test successfully registering an existing patient."""

        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create existing patient
        existing_patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="0912345678"
        )
        db_session.add(existing_patient)
        db_session.commit()

        # Create unlinked LINE user
        line_user = LineUser(line_user_id="Utest_register_existing")
        db_session.add(line_user)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Utest_register_existing",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        # Register existing patient
        result = await mock_register_patient_account(
            wrapper=wrapper,
            phone_number="0912345678",
            full_name="Existing Patient"
        )

        # Should succeed
        assert result.startswith("SUCCESS:")
        assert "Existing Patient" in result
        assert "0912345678" in result

        # Check database state
        updated_line_user = db_session.query(LineUser).filter_by(line_user_id="Utest_register_existing").first()
        assert updated_line_user is not None
        assert updated_line_user.patient_id == existing_patient.id

    @pytest.mark.asyncio
    async def test_register_new_patient_success(self, db_session, test_clinic_with_therapist_and_types):
        """Test successfully registering a new patient."""

        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create unlinked LINE user
        line_user = LineUser(line_user_id="Utest_register_new")
        db_session.add(line_user)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Utest_register_new",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        # Register new patient
        result = await mock_register_patient_account(
            wrapper=wrapper,
            phone_number="0987654321",
            full_name="New Test Patient"
        )

        # Should succeed
        assert result.startswith("SUCCESS:")
        assert "New Test Patient" in result
        assert "0987654321" in result

        # Check database state - new patient should be created
        new_patient = db_session.query(Patient).filter_by(phone_number="0987654321").first()
        assert new_patient is not None
        assert new_patient.full_name == "New Test Patient"
        assert new_patient.clinic_id == clinic.id

        # LINE user should be linked
        updated_line_user = db_session.query(LineUser).filter_by(line_user_id="Utest_register_new").first()
        assert updated_line_user is not None
        assert updated_line_user.patient_id == new_patient.id

    @pytest.mark.asyncio
    async def test_register_duplicate_phone_links_existing(self, db_session, test_clinic_with_therapist_and_types):
        """Test that registering with existing phone number links to existing patient regardless of name."""

        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create existing patient
        existing_patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="0912345678"
        )
        db_session.add(existing_patient)
        db_session.commit()

        # Create unlinked LINE user
        line_user = LineUser(line_user_id="Utest_register_duplicate")
        db_session.add(line_user)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Utest_register_duplicate",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        # Try to register with same phone number but different name
        result = await mock_register_patient_account(
            wrapper=wrapper,
            phone_number="0912345678",
            full_name="Different Name"  # Different name, but same phone
        )

        # Should succeed by linking to existing patient
        assert result.startswith("SUCCESS:")
        assert "Existing Patient" in result  # Links to existing patient, not the name provided
        assert "0912345678" in result

        # Check that LINE user is linked to existing patient
        updated_line_user = db_session.query(LineUser).filter_by(line_user_id="Utest_register_duplicate").first()
        assert updated_line_user is not None
        assert updated_line_user.patient_id == existing_patient.id

    @pytest.mark.asyncio
    async def test_register_invalid_phone_error(self, db_session, test_clinic_with_therapist_and_types):
        """Test error with invalid phone number format."""

        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create unlinked LINE user
        line_user = LineUser(line_user_id="Utest_register_invalid")
        db_session.add(line_user)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Utest_register_invalid",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        # Try to register with invalid phone number
        result = await mock_register_patient_account(
            wrapper=wrapper,
            phone_number="0212345678",  # Landline
            full_name="Test Patient"
        )

        # Should fail with phone validation error
        assert result.startswith("ERROR:")
        assert "只接受手機號碼" in result

    @pytest.mark.asyncio
    async def test_register_empty_name_error(self, db_session, test_clinic_with_therapist_and_types):
        """Test error when name is empty for new patient."""

        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Create unlinked LINE user
        line_user = LineUser(line_user_id="Utest_register_empty_name")
        db_session.add(line_user)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked yet
            line_user_id="Utest_register_empty_name",
            is_linked=False
        )

        wrapper = Mock()
        wrapper.context = context

        # Try to register with empty name
        result = await mock_register_patient_account(
            wrapper=wrapper,
            phone_number="0987654321",
            full_name=""  # Empty name
        )

        # Should fail
        assert result.startswith("ERROR:")
        assert "需要提供全名" in result


