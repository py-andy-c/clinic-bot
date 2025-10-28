"""
Unit tests for updated agent tools with new calendar schema.

Tests the updated get_practitioner_availability and create_appointment
tools that now use the CalendarEvent schema.
"""

import pytest
from datetime import datetime, date, time
from unittest.mock import AsyncMock, patch

from clinic_agents.tools import create_appointment_impl, get_practitioner_availability_impl, _check_time_overlap
from clinic_agents.context import ConversationContext
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, Appointment, AvailabilityException


class TestAgentToolsWithCalendarSchema:
    """Test agent tools with new calendar schema."""

    async def test_get_practitioner_availability_with_default_schedule(self, db_session):
        """Test getting availability with default schedule."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability (Wednesday)
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.add(availability)
        
        availability2 = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=2,  # Wednesday
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.add(availability2)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )

        # Mock wrapper
        wrapper = AsyncMock()
        wrapper.context = context

        # Test getting availability
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_name="Dr. Test",
            date="2025-01-15",  # Wednesday
            appointment_type="Test Appointment"
        )

        assert "available_slots" in result
        assert len(result["available_slots"]) > 0
        assert result["therapist_name"] == "Dr. Test"
        assert result["appointment_type"] == "Test Appointment"

    async def test_get_practitioner_availability_with_exceptions(self, db_session):
        """Test getting availability with availability exceptions."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability (Wednesday)
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(18, 0)
        )
        db_session.add(availability)
        db_session.flush()

        # Create availability exception (outside the main interval to avoid blocking)
        exception_calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(19, 0),
            end_time=time(20, 0)
        )
        db_session.add(exception_calendar_event)
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=exception_calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )

        # Mock wrapper
        wrapper = AsyncMock()
        wrapper.context = context

        # Test getting availability
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_name="Dr. Test",
            date="2025-01-15",  # Wednesday
            appointment_type="Test Appointment"
        )

        assert "available_slots" in result
        slots = result["available_slots"]
        
        # Should not have slots during exception time (19:00-20:00)
        exception_slots = [s for s in slots if "19:00" in s or "20:00" in s]
        assert len(exception_slots) == 0

    async def test_get_practitioner_availability_with_appointments(self, db_session):
        """Test getting availability with existing appointments."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create default availability (Wednesday)
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(18, 0)
        )
        db_session.add(availability)
        db_session.flush()

        # Create existing appointment
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,  # Use actual patient ID
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )

        # Mock wrapper
        wrapper = AsyncMock()
        wrapper.context = context

        # Test getting availability
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_name="Dr. Test",
            date="2025-01-15",  # Wednesday
            appointment_type="Test Appointment"
        )

        assert "available_slots" in result
        slots = result["available_slots"]
        
        # Should not have slots that overlap with appointment time (10:00-11:00)
        # The appointment is 10:00-11:00, so we shouldn't have slots that start at 10:00 or 10:30
        # But 09:00-10:00 and 11:00-12:00 are fine as they don't overlap
        conflicting_slots = [s for s in slots if s.startswith("10:") or s.startswith("10:30")]
        assert len(conflicting_slots) == 0

    async def test_get_practitioner_availability_no_default_schedule(self, db_session):
        """Test getting availability when practitioner has no default schedule."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )

        # Mock wrapper
        wrapper = AsyncMock()
        wrapper.context = context

        # Test getting availability
        result = await get_practitioner_availability_impl(
            wrapper=wrapper,
            practitioner_name="Dr. Test",
            date="2025-01-15",  # Wednesday
            appointment_type="Test Appointment"
        )

        assert "error" in result
        assert "沒有預設的工作時間" in result["error"]

    async def test_create_appointment_with_calendar_event(self, db_session):
        """Test creating appointment with new calendar event schema."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"],
            gcal_credentials="encrypted_credentials"
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=patient,
            line_user_id="test_line_user",
            is_linked=True
        )

        # Mock wrapper
        wrapper = AsyncMock()
        wrapper.context = context

        # Mock Google Calendar service
        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_service:
            mock_service_instance = AsyncMock()
            mock_gcal_service.return_value = mock_service_instance
            mock_service_instance.create_event.return_value = {"id": "test_gcal_id"}
            mock_service_instance.update_event.return_value = {}

            # Mock encryption service
            with patch('services.encryption_service.get_encryption_service') as mock_encryption:
                mock_encryption.return_value.decrypt_data.return_value = {"credentials": "test"}

                # Test creating appointment
                start_time = datetime(2025, 1, 15, 10, 0)
                result = await create_appointment_impl(
                    wrapper=wrapper,
                    therapist_id=practitioner.id,
                    appointment_type_id=appointment_type.id,
                    start_time=start_time,
                    patient_id=patient.id
                )

                assert result["success"] is True
                assert "appointment_id" in result
                assert result["therapist_name"] == "Dr. Test"
                assert result["appointment_type"] == "Test Appointment"

                # Verify calendar event was created
                calendar_event = db_session.query(CalendarEvent).filter(
                    CalendarEvent.user_id == practitioner.id,
                    CalendarEvent.event_type == "appointment",
                    CalendarEvent.date == date(2025, 1, 15)
                ).first()
                assert calendar_event is not None
                assert calendar_event.start_time == time(10, 0)
                assert calendar_event.end_time == time(11, 0)
                assert calendar_event.gcal_event_id == "test_gcal_id"

                # Verify appointment was created
                appointment = db_session.query(Appointment).filter(
                    Appointment.calendar_event_id == calendar_event.id
                ).first()
                assert appointment is not None
                assert appointment.patient_id == patient.id
                assert appointment.appointment_type_id == appointment_type.id
                assert appointment.status == "confirmed"

    async def test_create_appointment_conflict_detection(self, db_session):
        """Test appointment conflict detection with new schema."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create existing appointment
        existing_calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(existing_calendar_event)
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Create context
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=patient,
            line_user_id="test_line_user",
            is_linked=True
        )

        # Mock wrapper
        wrapper = AsyncMock()
        wrapper.context = context

        # Test creating conflicting appointment
        start_time = datetime(2025, 1, 15, 10, 30)  # Overlaps with existing appointment
        result = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=practitioner.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            patient_id=patient.id
        )

        assert "error" in result
        assert "預約時間衝突" in result["error"]

    def test_time_overlap_function(self):
        """Test the _check_time_overlap helper function."""
        # Test overlapping times
        assert _check_time_overlap(time(10, 0), time(11, 0), time(10, 30), time(11, 30)) is True
        assert _check_time_overlap(time(10, 0), time(11, 0), time(9, 30), time(10, 30)) is True
        assert _check_time_overlap(time(10, 0), time(11, 0), time(9, 0), time(12, 0)) is True

        # Test non-overlapping times
        assert _check_time_overlap(time(10, 0), time(11, 0), time(11, 0), time(12, 0)) is False
        assert _check_time_overlap(time(10, 0), time(11, 0), time(9, 0), time(10, 0)) is False
        assert _check_time_overlap(time(10, 0), time(11, 0), time(12, 0), time(13, 0)) is False

        # Test edge cases
        assert _check_time_overlap(time(10, 0), time(11, 0), time(10, 0), time(11, 0)) is True
        assert _check_time_overlap(time(10, 0), time(11, 0), time(10, 59), time(11, 1)) is True
