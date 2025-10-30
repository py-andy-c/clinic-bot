"""
Integration tests for appointment agent with real database operations.

Tests the complete appointment flow from agent prompt generation to appointment creation.
"""

import pytest
from datetime import datetime, date, time, timedelta
from unittest.mock import AsyncMock, patch

from clinic_agents.agents import get_appointment_instructions
from clinic_agents.context import ConversationContext
from clinic_agents.tools import get_practitioner_availability_impl, create_appointment_impl
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, Appointment


class TestAppointmentAgentIntegration:
    """Integration tests for appointment agent."""

    @pytest.fixture
    def test_clinic_setup(self, db_session):
        """Create a complete test clinic setup."""
        clinic = Clinic(
            name="Integration Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create practitioners with different availability configurations
        practitioner_with_full_availability = User(
            clinic_id=clinic.id,
            email="full@example.com",
            google_subject_id="full_subject",
            full_name="Dr. Full Availability",
            roles=["practitioner"],
            is_active=True,
            gcal_credentials='{"access_token": "test_token"}'  # Mock credentials
        )
        db_session.add(practitioner_with_full_availability)
        db_session.flush()

        practitioner_with_partial_availability = User(
            clinic_id=clinic.id,
            email="partial@example.com",
            google_subject_id="partial_subject",
            full_name="Dr. Partial Availability",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner_with_partial_availability)
        db_session.flush()

        practitioner_without_availability = User(
            clinic_id=clinic.id,
            email="none@example.com",
            google_subject_id="none_subject",
            full_name="Dr. No Availability",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner_without_availability)
        db_session.flush()

        # Create appointment types
        appointment_types = [
            AppointmentType(
                clinic_id=clinic.id,
                name="初診評估",
                duration_minutes=60
            ),
            AppointmentType(
                clinic_id=clinic.id,
                name="一般複診",
                duration_minutes=30
            )
        ]
        for apt_type in appointment_types:
            db_session.add(apt_type)
        db_session.flush()

        # Create default availability for practitioners
        # Dr. Full Availability: Monday-Friday 9:00-17:00
        for day in range(5):  # Monday to Friday
            availability = PractitionerAvailability(
                user_id=practitioner_with_full_availability.id,
                day_of_week=day,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.add(availability)

        # Dr. Partial Availability: Monday, Wednesday, Friday 10:00-14:00
        for day in [0, 2, 4]:  # Monday, Wednesday, Friday
            availability = PractitionerAvailability(
                user_id=practitioner_with_partial_availability.id,
                day_of_week=day,
                start_time=time(10, 0),
                end_time=time(14, 0)
            )
            db_session.add(availability)

        db_session.commit()

        return {
            "clinic": clinic,
            "practitioner_with_full_availability": practitioner_with_full_availability,
            "practitioner_with_partial_availability": practitioner_with_partial_availability,
            "practitioner_without_availability": practitioner_without_availability,
            "appointment_types": appointment_types
        }

    @pytest.fixture
    def conversation_context(self, db_session, test_clinic_setup):
        """Create conversation context."""
        clinic = test_clinic_setup["clinic"]
        
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )
        return context

    def test_agent_instructions_only_include_practitioners_with_availability(self, conversation_context):
        """Test that agent instructions only include practitioners with availability."""
        instructions = get_appointment_instructions(
            wrapper=AsyncMock(context=conversation_context),
            agent=None
        )

        # Should include practitioners with availability
        assert "Dr. Full Availability" in instructions
        assert "Dr. Partial Availability" in instructions
        
        # Should NOT include practitioner without availability
        assert "Dr. No Availability" not in instructions

        # Should include appointment types with IDs
        assert "初診評估(60min, ID:1)" in instructions
        assert "一般複診(30min, ID:2)" in instructions

    @pytest.mark.asyncio
    async def test_complete_appointment_flow(self, conversation_context, test_clinic_setup, db_session):
        """Test complete appointment flow from availability check to creation."""
        practitioner = test_clinic_setup["practitioner_with_full_availability"]
        appointment_type = test_clinic_setup["appointment_types"][0]  # 初診評估

        # Create patient
        patient = Patient(
            clinic_id=test_clinic_setup["clinic"].id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        # Step 1: Check availability
        availability_result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_setup["appointment_types"][0].id
        )

        assert "available_slots" in availability_result
        assert len(availability_result["available_slots"]) > 0

        # Step 2: Create appointment (mock Google Calendar)
        with patch('clinic_agents.tools.create_appointment.GoogleCalendarService') as mock_gcal_class:
            # Create a mock instance
            mock_gcal_instance = AsyncMock()
            mock_gcal_instance.create_event = AsyncMock(return_value={"id": "gcal_event_123"})
            mock_gcal_class.return_value = mock_gcal_instance
            
            # Mock encryption service
            with patch('clinic_agents.tools.create_appointment.get_encryption_service') as mock_encryption:
                mock_encryption.return_value.decrypt_data.return_value = {"access_token": "test_token"}

                appointment_result = await create_appointment_impl(
                    wrapper=wrapper,
                    therapist_id=practitioner.id,
                    appointment_type_id=appointment_type.id,
                    start_time="2025-01-15 09:00",  # 9:00 AM
                    patient_id=patient.id
                )

                assert appointment_result["success"] == True

        # Step 3: Verify appointment was created in database
        created_appointment = db_session.query(Appointment).filter(
            Appointment.patient_id == patient.id
        ).first()

        assert created_appointment is not None
        assert created_appointment.status == "confirmed"
        assert created_appointment.appointment_type_id == appointment_type.id

        # Verify calendar event was created
        calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == created_appointment.calendar_event_id
        ).first()

        assert calendar_event is not None
        assert calendar_event.user_id == practitioner.id
        assert calendar_event.event_type == "appointment"
        assert calendar_event.date == date(2025, 1, 15)
        assert calendar_event.start_time == time(9, 0)
        assert calendar_event.end_time == time(10, 0)  # 60 minutes later

    @pytest.mark.asyncio
    async def test_appointment_flow_with_exceptions_and_conflicts(self, conversation_context, test_clinic_setup, db_session):
        """Test appointment flow with availability exceptions and conflicts."""
        practitioner = test_clinic_setup["practitioner_with_full_availability"]
        appointment_type = test_clinic_setup["appointment_types"][0]  # 初診評估

        # Create availability exception blocking 9:00-11:00
        exception_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(9, 0),
            end_time=time(11, 0)
        )
        db_session.add(exception_event)
        db_session.flush()

        # Create existing appointment at 13:00-14:00
        existing_appointment_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(13, 0),
            end_time=time(14, 0)
        )
        db_session.add(existing_appointment_event)
        db_session.flush()

        # Create patient for existing appointment
        existing_patient = Patient(
            clinic_id=test_clinic_setup["clinic"].id,
            full_name="Existing Patient",
            phone_number="9876543210"
        )
        db_session.add(existing_patient)
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_appointment_event.id,
            patient_id=existing_patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        # Check availability - should exclude blocked periods
        availability_result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_setup["appointment_types"][0].id
        )

        assert "available_slots" in availability_result
        available_slots = availability_result["available_slots"]

        # Should NOT have slots during exception period
        blocked_slots = ["09:00-10:00", "10:00-11:00"]
        for slot in blocked_slots:
            assert slot not in available_slots

        # Should NOT have slots during existing appointment
        appointment_blocked_slots = ["13:00-14:00"]
        for slot in appointment_blocked_slots:
            assert slot not in available_slots

        # Should have available slots
        assert len(available_slots) > 0
        # Should have slots like 11:00-12:00, 12:00-13:00, 14:00-15:00, etc.
        expected_available_slots = ["11:00-12:00", "12:00-13:00", "14:00-15:00"]
        for slot in expected_available_slots:
            assert slot in available_slots

    @pytest.mark.asyncio
    async def test_appointment_creation_conflict_detection(self, conversation_context, test_clinic_setup, db_session):
        """Test that appointment creation properly detects conflicts."""
        practitioner = test_clinic_setup["practitioner_with_full_availability"]
        appointment_type = test_clinic_setup["appointment_types"][0]  # 初診評估

        # Create existing appointment at 9:00-10:00
        existing_appointment_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(9, 0),
            end_time=time(10, 0)
        )
        db_session.add(existing_appointment_event)
        db_session.flush()

        # Create patient for existing appointment
        existing_patient = Patient(
            clinic_id=test_clinic_setup["clinic"].id,
            full_name="Existing Patient",
            phone_number="9876543210"
        )
        db_session.add(existing_patient)
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_appointment_event.id,
            patient_id=existing_patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Create new patient
        new_patient = Patient(
            clinic_id=test_clinic_setup["clinic"].id,
            full_name="New Patient",
            phone_number="1234567890"
        )
        db_session.add(new_patient)
        db_session.flush()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        # Try to create appointment at conflicting time
        appointment_result = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=practitioner.id,
            appointment_type_id=appointment_type.id,
            start_time="2025-01-15 09:30",  # 9:30 AM - conflicts with 9:00-10:00
            patient_id=new_patient.id
        )

        # Should return error due to conflict
        assert "error" in appointment_result
        assert "預約時間衝突" in appointment_result["error"]

    def test_agent_instructions_format(self, conversation_context):
        """Test that agent instructions are properly formatted."""
        instructions = get_appointment_instructions(
            wrapper=AsyncMock(context=conversation_context),
            agent=None
        )

        # Should contain key sections
        assert "診所資訊：" in instructions
        assert "治療師：" in instructions
        assert "預約類型：" in instructions
        assert "用戶資訊：" in instructions
        assert "任務說明：" in instructions
        assert "預約建立" in instructions
        assert "預約查詢" in instructions
        assert "預約取消" in instructions
        assert "預約更改" in instructions
        assert "對話原則：" in instructions
        assert "重要限制：" in instructions

        # Should be in Traditional Chinese
        assert "你是一個友好的預約助手" in instructions
        assert "使用繁體中文與用戶對話" in instructions

