"""
Comprehensive tests for appointment agent scenarios.

Tests the appointment agent's ability to handle practitioner availability,
exceptions, and appointments correctly.
"""

import pytest
from datetime import datetime, date, time, timedelta
from unittest.mock import AsyncMock, patch

from clinic_agents.tools import get_practitioner_availability_impl, create_appointment_impl
from clinic_agents.context import ConversationContext
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, Appointment


class TestAppointmentAgentScenarios:
    """Test appointment agent scenarios with real availability logic."""

    @pytest.fixture
    def test_clinic_with_practitioners(self, db_session):
        """Create a test clinic with multiple practitioners."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Practitioner with availability configured
        practitioner_with_availability = User(
            clinic_id=clinic.id,
            email="available@example.com",
            google_subject_id="available_subject",
            full_name="Dr. Available",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner_with_availability)
        db_session.flush()

        # Practitioner without availability configured
        practitioner_without_availability = User(
            clinic_id=clinic.id,
            email="unavailable@example.com",
            google_subject_id="unavailable_subject",
            full_name="Dr. Unavailable",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner_without_availability)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability for practitioner_with_availability (Wednesday)
        availability = PractitionerAvailability(
            user_id=practitioner_with_availability.id,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)
        db_session.commit()

        return {
            "clinic": clinic,
            "practitioner_with_availability": practitioner_with_availability,
            "practitioner_without_availability": practitioner_without_availability,
            "appointment_type": appointment_type
        }

    @pytest.fixture
    def conversation_context(self, db_session, test_clinic_with_practitioners):
        """Create conversation context for testing."""
        clinic = test_clinic_with_practitioners["clinic"]
        
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )
        return context

    def test_therapists_list_only_includes_practitioners_with_availability(self, conversation_context):
        """Test that therapists_list only includes practitioners with default availability."""
        therapists_list = conversation_context.therapists_list
        
        # Should only include the practitioner with availability
        assert "Dr. Available" in therapists_list
        assert "Dr. Unavailable" not in therapists_list

    @pytest.mark.asyncio
    async def test_availability_with_default_schedule(self, conversation_context, test_clinic_with_practitioners):
        """Test availability calculation with default schedule only."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "available_slots" in result
        assert len(result["available_slots"]) > 0
        assert result["therapist_name"] == "Dr. Available"
        assert result["appointment_type"] == "Test Appointment"
        assert result["duration_minutes"] == 60

        # Should have slots from 9:00 to 17:00 with 60-minute duration
        # Expected slots: 9:00-10:00, 10:00-11:00, 11:00-12:00, 12:00-13:00, 13:00-14:00, 14:00-15:00, 15:00-16:00
        expected_slots = [
            "09:00-10:00", "10:00-11:00", "11:00-12:00", "12:00-13:00",
            "13:00-14:00", "14:00-15:00", "15:00-16:00"
        ]
        for slot in expected_slots:
            assert slot in result["available_slots"]

    @pytest.mark.asyncio
    async def test_availability_with_exceptions(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test availability calculation with availability exceptions."""
        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]
        
        # Create availability exception blocking 10:00-12:00
        exception_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(12, 0)
        )
        db_session.add(exception_event)
        db_session.flush()

        # Create the availability exception record
        from models.availability_exception import AvailabilityException
        exception = AvailabilityException(
            calendar_event_id=exception_event.id
        )
        db_session.add(exception)
        db_session.commit()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "available_slots" in result
        assert len(result["available_slots"]) > 0

        # Should NOT have slots during the exception period
        blocked_slots = ["10:00-11:00", "11:00-12:00"]
        for slot in blocked_slots:
            assert slot not in result["available_slots"]

        # Should still have slots outside the exception period
        available_slots = ["09:00-10:00", "12:00-13:00", "13:00-14:00"]
        for slot in available_slots:
            assert slot in result["available_slots"]

    @pytest.mark.asyncio
    async def test_availability_with_existing_appointments(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test availability calculation with existing appointments."""
        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]

        # Create existing appointment at 10:00-11:00
        appointment_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(appointment_event)
        db_session.flush()

        # Create patient for the appointment
        patient = Patient(
            clinic_id=test_clinic_with_practitioners["clinic"].id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=appointment_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "available_slots" in result
        assert len(result["available_slots"]) > 0

        # Should NOT have the slot that conflicts with existing appointment
        assert "10:00-11:00" not in result["available_slots"]

        # Should still have other available slots
        available_slots = ["09:00-10:00", "11:00-12:00", "12:00-13:00"]
        for slot in available_slots:
            assert slot in result["available_slots"]

    @pytest.mark.asyncio
    async def test_availability_with_overlapping_exceptions_and_appointments(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test availability calculation with both exceptions and appointments."""
        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]

        # Create availability exception blocking 10:00-12:00
        exception_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(12, 0)
        )
        db_session.add(exception_event)
        db_session.flush()

        # Create the availability exception record
        from models.availability_exception import AvailabilityException
        exception = AvailabilityException(
            calendar_event_id=exception_event.id
        )
        db_session.add(exception)
        db_session.flush()

        # Create existing appointment at 13:00-14:00
        appointment_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(13, 0),
            end_time=time(14, 0)
        )
        db_session.add(appointment_event)
        db_session.flush()

        # Create patient for the appointment
        patient = Patient(
            clinic_id=test_clinic_with_practitioners["clinic"].id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=appointment_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "available_slots" in result
        assert len(result["available_slots"]) > 0

        # Should NOT have slots during exception period
        exception_blocked_slots = ["10:00-11:00", "11:00-12:00"]
        for slot in exception_blocked_slots:
            assert slot not in result["available_slots"]

        # Should NOT have slots during existing appointment
        appointment_blocked_slots = ["13:00-14:00"]
        for slot in appointment_blocked_slots:
            assert slot not in result["available_slots"]

        # Should still have available slots
        available_slots = ["09:00-10:00", "12:00-13:00", "14:00-15:00", "15:00-16:00"]
        for slot in available_slots:
            assert slot in result["available_slots"]

    @pytest.mark.asyncio
    async def test_availability_practitioner_without_default_schedule(self, conversation_context, test_clinic_with_practitioners):
        """Test that practitioners without default availability return error."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_without_availability"]

        # Try to get availability for practitioner without default schedule
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        # Should return error because no default availability
        assert "error" in result
        assert "沒有可用時間" in result["error"]

    @pytest.mark.asyncio
    async def test_availability_practitioner_not_found(self, conversation_context, test_clinic_with_practitioners):
        """Test error handling for non-existent practitioner."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=99999,  # Non-existent ID
            date="2025-01-15",
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "error" in result
        assert "找不到醫師" in result["error"]

    @pytest.mark.asyncio
    async def test_availability_appointment_type_not_found(self, conversation_context, test_clinic_with_practitioners):
        """Test error handling for non-existent appointment type."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",
            appointment_type_id=99999  # Non-existent ID
        )

        assert "error" in result
        assert "找不到預約類型" in result["error"]

    @pytest.mark.asyncio
    async def test_availability_no_slots_available(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test scenario where no slots are available due to full booking."""
        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]

        # Create appointments that fill the entire day
        for hour in range(9, 17):
            appointment_event = CalendarEvent(
                user_id=practitioner.id,
                event_type="appointment",
                date=date(2025, 1, 15),
                start_time=time(hour, 0),
                end_time=time(hour + 1, 0)
            )
            db_session.add(appointment_event)
            db_session.flush()

            # Create patient for each appointment
            patient = Patient(
                clinic_id=test_clinic_with_practitioners["clinic"].id,
                full_name=f"Patient {hour}",
                phone_number=f"123456789{hour}"
            )
            db_session.add(patient)
            db_session.flush()

            existing_appointment = Appointment(
                calendar_event_id=appointment_event.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                status="confirmed"
            )
            db_session.add(existing_appointment)

        db_session.commit()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-15",  # Wednesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "error" in result
        assert "沒有可用的時段" in result["error"]

    @pytest.mark.asyncio
    async def test_availability_different_days_of_week(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test availability for different days of the week."""
        practitioner = test_clinic_with_practitioners["practitioner_with_availability"]

        # Add availability for Monday (day 0)
        monday_availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=0,  # Monday
            start_time=time(10, 0),
            end_time=time(14, 0)
        )
        db_session.add(monday_availability)
        db_session.commit()

        wrapper = AsyncMock()
        wrapper.context = conversation_context

        # Test Monday availability
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-13",  # Monday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "available_slots" in result
        assert len(result["available_slots"]) > 0

        # Should have slots from 10:00 to 14:00
        expected_slots = ["10:00-11:00", "11:00-12:00", "12:00-13:00", "13:00-14:00"]
        for slot in expected_slots:
            assert slot in result["available_slots"]

        # Test Tuesday (no availability)
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_id=practitioner.id,
            date="2025-01-14",  # Tuesday
            appointment_type_id=test_clinic_with_practitioners["appointment_type"].id
        )

        assert "error" in result
        assert "沒有可用時間" in result["error"]
