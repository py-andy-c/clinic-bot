"""
Unit tests for database models.
"""

import pytest
from datetime import datetime, timezone

from src.models.clinic import Clinic
from src.models.therapist import Therapist
from src.models.patient import Patient
from src.models.appointment_type import AppointmentType
from src.models.appointment import Appointment


class TestClinicModel:
    """Test cases for Clinic model."""

    def test_clinic_creation(self, sample_clinic_data):
        """Test clinic model creation with valid data."""
        clinic = Clinic(**sample_clinic_data)

        assert clinic.name == "Test Clinic"
        assert clinic.line_channel_id == "test_channel_123"
        assert clinic.line_channel_secret == "test_secret_456"
        assert clinic.subscription_status == "trial"
        assert clinic.stripe_customer_id is None
        # Note: created_at/updated_at are server defaults and may be None in tests

    def test_clinic_relationships(self, sample_clinic_data):
        """Test clinic model relationships are properly defined."""
        clinic = Clinic(**sample_clinic_data)

        # Test that relationship attributes exist (they will be None until loaded)
        assert hasattr(clinic, 'admins')
        assert hasattr(clinic, 'therapists')
        assert hasattr(clinic, 'patients')
        assert hasattr(clinic, 'appointment_types')

    def test_clinic_default_values(self, sample_clinic_data):
        """Test clinic model default values."""
        clinic = Clinic(**sample_clinic_data)

        assert clinic.subscription_status == "trial"
        # Note: created_at/updated_at are server defaults and may be None in tests

    def test_clinic_string_fields(self, sample_clinic_data):
        """Test clinic model string field constraints."""
        # Test with very long name
        long_name_data = sample_clinic_data.copy()
        long_name_data["name"] = "A" * 300  # Very long name

        clinic = Clinic(**long_name_data)
        assert len(clinic.name) == 300

        # Test with special characters
        special_name_data = sample_clinic_data.copy()
        special_name_data["name"] = "Test Clinic & Co. - 測試診所"

        clinic = Clinic(**special_name_data)
        assert "測試診所" in clinic.name


class TestTherapistModel:
    """Test cases for Therapist model."""

    def test_therapist_creation(self, sample_therapist_data):
        """Test therapist model creation."""
        therapist = Therapist(
            clinic_id=1,
            **sample_therapist_data
        )

        assert therapist.name == "Dr. Test"
        assert therapist.email == "dr.test@example.com"
        assert therapist.clinic_id == 1
        assert therapist.gcal_sync_enabled is None  # Default value (None in tests)
        # Note: created_at is a server default and may be None in tests

    def test_therapist_google_calendar_fields(self, sample_therapist_data):
        """Test therapist Google Calendar related fields."""
        therapist = Therapist(
            clinic_id=1,
            gcal_credentials={"access_token": "token123"},
            gcal_sync_enabled=True,
            gcal_watch_resource_id="resource_123",
            **sample_therapist_data
        )

        assert therapist.gcal_credentials == {"access_token": "token123"}
        assert therapist.gcal_sync_enabled is True
        assert therapist.gcal_watch_resource_id == "resource_123"

    def test_therapist_relationships(self, sample_therapist_data):
        """Test therapist model relationships."""
        therapist = Therapist(clinic_id=1, **sample_therapist_data)

        assert hasattr(therapist, 'clinic')
        assert hasattr(therapist, 'appointments')


class TestPatientModel:
    """Test cases for Patient model."""

    def test_patient_creation(self, sample_patient_data):
        """Test patient model creation."""
        patient = Patient(
            clinic_id=1,
            **sample_patient_data
        )

        assert patient.full_name == "Test Patient"
        assert patient.phone_number == "+1234567890"
        assert patient.clinic_id == 1

    def test_patient_relationships(self, sample_patient_data):
        """Test patient model relationships."""
        patient = Patient(clinic_id=1, **sample_patient_data)

        assert hasattr(patient, 'clinic')
        assert hasattr(patient, 'appointments')
        assert hasattr(patient, 'line_user')

    def test_patient_phone_formats(self, sample_patient_data):
        """Test various phone number formats."""
        test_cases = [
            "+1234567890",
            "0912345678",  # Taiwan format
            "+886912345678",  # Taiwan international
            "02-1234-5678",  # With dashes
        ]

        for phone in test_cases:
            patient_data = sample_patient_data.copy()
            patient_data["phone_number"] = phone

            patient = Patient(clinic_id=1, **patient_data)
            assert patient.phone_number == phone


class TestAppointmentTypeModel:
    """Test cases for AppointmentType model."""

    def test_appointment_type_creation(self):
        """Test appointment type model creation."""
        apt_type = AppointmentType(
            clinic_id=1,
            name="初診評估",
            duration_minutes=60
        )

        assert apt_type.clinic_id == 1
        assert apt_type.name == "初診評估"
        assert apt_type.duration_minutes == 60

    def test_appointment_type_durations(self):
        """Test various appointment durations."""
        test_cases = [
            ("初診評估", 60),
            ("一般複診", 30),
            ("徒手治療", 45),
            ("運動訓練", 90),
        ]

        for name, duration in test_cases:
            apt_type = AppointmentType(
                clinic_id=1,
                name=name,
                duration_minutes=duration
            )
            assert apt_type.name == name
            assert apt_type.duration_minutes == duration

    def test_appointment_type_relationships(self):
        """Test appointment type relationships."""
        apt_type = AppointmentType(
            clinic_id=1,
            name="Test Type",
            duration_minutes=30
        )

        assert hasattr(apt_type, 'clinic')
        assert hasattr(apt_type, 'appointments')


class TestAppointmentModel:
    """Test cases for Appointment model."""

    def test_appointment_creation(self):
        """Test appointment model creation."""
        start_time = datetime.now(timezone.utc)
        end_time = start_time.replace(hour=start_time.hour + 1)

        appointment = Appointment(
            patient_id=1,
            therapist_id=2,
            appointment_type_id=3,
            start_time=start_time,
            end_time=end_time,
            status="confirmed"
        )

        assert appointment.patient_id == 1
        assert appointment.therapist_id == 2
        assert appointment.appointment_type_id == 3
        assert appointment.start_time == start_time
        assert appointment.end_time == end_time
        assert appointment.status == "confirmed"
        assert appointment.gcal_event_id is None

    def test_appointment_statuses(self):
        """Test different appointment statuses."""
        statuses = ["confirmed", "canceled_by_patient", "canceled_by_clinic"]

        for status in statuses:
            appointment = Appointment(
                patient_id=1,
                therapist_id=2,
                appointment_type_id=3,
                start_time=datetime.now(timezone.utc),
                end_time=datetime.now(timezone.utc),
                status=status
            )
            assert appointment.status == status

    def test_appointment_with_google_calendar(self):
        """Test appointment with Google Calendar integration."""
        appointment = Appointment(
            patient_id=1,
            therapist_id=2,
            appointment_type_id=3,
            start_time=datetime.now(timezone.utc),
            end_time=datetime.now(timezone.utc),
            status="confirmed",
            gcal_event_id="gcal_event_12345"
        )

        assert appointment.gcal_event_id == "gcal_event_12345"

    def test_appointment_relationships(self):
        """Test appointment model relationships."""
        appointment = Appointment(
            patient_id=1,
            therapist_id=2,
            appointment_type_id=3,
            start_time=datetime.now(timezone.utc),
            end_time=datetime.now(timezone.utc),
            status="confirmed"
        )

        assert hasattr(appointment, 'patient')
        assert hasattr(appointment, 'therapist')
        assert hasattr(appointment, 'appointment_type')
