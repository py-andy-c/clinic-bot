"""
Unit tests for calendar event models.

Tests the CalendarEvent and AvailabilityException models,
including relationships, constraints, and properties.
"""

import pytest
from datetime import date, time, datetime
from sqlalchemy.exc import IntegrityError

from models import CalendarEvent, AvailabilityException, Appointment, User, Clinic, AppointmentType, Patient
from tests.conftest import create_calendar_event_with_clinic


class TestCalendarEvent:
    """Test CalendarEvent model functionality."""

    def test_calendar_event_creation(self, db_session):
        """Test basic calendar event creation."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Create calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.commit()

        assert calendar_event.id is not None
        assert calendar_event.user_id == user.id
        assert calendar_event.event_type == "appointment"
        assert calendar_event.date == date(2025, 1, 15)
        assert calendar_event.start_time == time(10, 0)
        assert calendar_event.end_time == time(11, 0)

    def test_calendar_event_all_day(self, db_session):
        """Test all-day calendar event creation."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Create all-day calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="availability_exception",
            event_date=date(2025, 1, 15),
            start_time=None,
            end_time=None
        )
        db_session.commit()

        assert calendar_event.is_all_day is True
        assert calendar_event.duration_minutes is None

    def test_calendar_event_duration_calculation(self, db_session):
        """Test duration calculation for calendar events."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Create calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 30)
        )
        db_session.commit()

        assert calendar_event.duration_minutes == 90

    def test_calendar_event_invalid_event_type(self, db_session):
        """Test that invalid event types are rejected."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Try to create calendar event with invalid event type
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="invalid_type",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )

        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_calendar_event_zero_duration_invalid(self, db_session):
        """Test that calendar events with zero duration (start = end) raise IntegrityError."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Try to create calendar event with zero duration (start = end)
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(11, 0),
            end_time=time(11, 0)  # Same as start time
        )

        with pytest.raises(IntegrityError):
            db_session.commit()


class TestAvailabilityException:
    """Test AvailabilityException model functionality."""

    def test_availability_exception_creation(self, db_session):
        """Test basic availability exception creation."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Create calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="availability_exception",
            event_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.flush()

        # Create availability exception
        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        assert exception.id is not None
        assert exception.calendar_event_id == calendar_event.id
        assert exception.user_id == user.id
        assert exception.date == date(2025, 1, 15)
        assert exception.start_time == time(14, 0)
        assert exception.end_time == time(18, 0)

    def test_availability_exception_cascade_delete(self, db_session):
        """Test that availability exception is deleted when calendar event is deleted."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
        db_session.flush()

        # Create calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="availability_exception",
            event_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.flush()

        # Create availability exception
        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        exception_id = exception.id

        # Delete calendar event
        db_session.delete(calendar_event)
        db_session.commit()

        # Check that exception is also deleted
        deleted_exception = db_session.query(AvailabilityException).filter(
            AvailabilityException.id == exception_id
        ).first()
        assert deleted_exception is None


class TestAppointmentWithCalendarEvent:
    """Test Appointment model with new CalendarEvent relationship."""

    def test_appointment_creation_with_calendar_event(self, db_session):
        """Test appointment creation using new calendar event schema."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
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

        # Create calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        # Create appointment
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        assert appointment.calendar_event_id == calendar_event.id
        assert appointment.patient_id == patient.id
        assert appointment.appointment_type_id == appointment_type.id
        assert appointment.status == "confirmed"

        # Test convenience properties
        assert appointment.user_id == user.id
        assert appointment.start_time == time(10, 0)
        assert appointment.end_time == time(11, 0)
        assert appointment.date == date(2025, 1, 15)

    def test_appointment_relationships(self, db_session):
        """Test appointment relationships work correctly."""
        # Create test clinic and user
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            email="test@example.com",
            google_subject_id="test_subject",
            full_name="Test User",
            roles=["practitioner"]
        )
        db_session.add(user)
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

        # Create calendar event
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        # Create appointment
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Test relationships
        assert appointment.calendar_event == calendar_event
        assert appointment.patient == patient
        assert appointment.appointment_type == appointment_type
        assert calendar_event.appointment == appointment
