"""
Unit tests for database models.
"""

import pytest
from datetime import datetime, timezone

from models.clinic import Clinic
from models.user import User
from models.patient import Patient
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.calendar_event import CalendarEvent


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
        assert hasattr(clinic, 'user_associations')  # Multi-clinic support via associations
        assert hasattr(clinic, 'patients')
        assert hasattr(clinic, 'appointment_types')
        assert hasattr(clinic, 'signup_tokens')

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

    def test_clinic_settings_initialization(self, sample_clinic_data):
        """Test clinic settings are properly initialized."""
        clinic = Clinic(**sample_clinic_data)

        # Settings should be initialized as empty dict when provided
        assert clinic.settings == {}
        assert isinstance(clinic.settings, dict)

    def test_clinic_settings_properties_with_empty_settings(self, sample_clinic_data):
        """Test settings properties return defaults when settings is empty."""
        clinic = Clinic(**sample_clinic_data)

        # Test default values
        assert clinic.reminder_hours_before == 24
        assert clinic.booking_restriction_type == "same_day_disallowed"
        assert clinic.minimum_booking_hours_ahead == 24
        assert clinic.display_name is None
        assert clinic.address is None
        assert clinic.phone_number is None

    def test_clinic_settings_properties_with_populated_settings(self, sample_clinic_data):
        """Test settings properties work with populated settings."""
        # Set up clinic with populated settings
        sample_clinic_data['settings'] = {
            "notification_settings": {
                "reminder_hours_before": 48
            },
            "booking_restriction_settings": {
                "booking_restriction_type": "minimum_hours_required",
                "minimum_booking_hours_ahead": 12
            },
            "clinic_info_settings": {
                "display_name": "Test Display Name",
                "address": "123 Test Street",
                "phone_number": "02-1234-5678"
            }
        }
        clinic = Clinic(**sample_clinic_data)

        # Test that properties return the configured values
        assert clinic.reminder_hours_before == 48
        assert clinic.booking_restriction_type == "minimum_hours_required"
        assert clinic.minimum_booking_hours_ahead == 12
        assert clinic.display_name == "Test Display Name"
        assert clinic.address == "123 Test Street"
        assert clinic.phone_number == "02-1234-5678"

    def test_clinic_settings_property_setters(self, sample_clinic_data):
        """Test settings property setters modify the underlying JSON."""
        clinic = Clinic(**sample_clinic_data)

        # Test setting notification properties
        clinic.reminder_hours_before = 36
        assert clinic.settings["notification_settings"]["reminder_hours_before"] == 36
        assert clinic.reminder_hours_before == 36

        # Test setting booking restriction properties
        clinic.booking_restriction_type = "minimum_hours_required"
        clinic.minimum_booking_hours_ahead = 8
        assert clinic.settings["booking_restriction_settings"]["booking_restriction_type"] == "minimum_hours_required"
        assert clinic.settings["booking_restriction_settings"]["minimum_booking_hours_ahead"] == 8

        # Test setting clinic info properties
        clinic.display_name = "Updated Clinic Name"
        clinic.address = "456 Updated Street"
        clinic.phone_number = "03-9876-5432"
        assert clinic.settings["clinic_info_settings"]["display_name"] == "Updated Clinic Name"
        assert clinic.settings["clinic_info_settings"]["address"] == "456 Updated Street"
        assert clinic.settings["clinic_info_settings"]["phone_number"] == "03-9876-5432"

    def test_clinic_effective_display_name(self, sample_clinic_data):
        """Test effective_display_name property."""
        clinic = Clinic(**sample_clinic_data)

        # Without display_name set, should fall back to clinic name
        assert clinic.effective_display_name == "Test Clinic"

        # With display_name set, should use display_name
        clinic.display_name = "Custom Display Name"
        assert clinic.effective_display_name == "Custom Display Name"


class TestUserModel:
    """Test cases for User model."""

    def test_user_creation(self, sample_user_data):
        """Test user model creation."""
        user = User(
            google_subject_id="google_123",
            **sample_user_data
        )

        assert user.full_name == "Dr. Test"
        assert user.email == "dr.test@example.com"
        assert user.google_subject_id == "google_123"
        # is_active has default=True, but defaults aren't applied in memory-only objects
        # Note: created_at is a server default and may be None in tests
        # Note: clinic_id and roles are now in UserClinicAssociation, not User model

    def test_user_google_calendar_fields(self, sample_user_data):
        """Test user fields (Google Calendar fields removed)."""
        user = User(
            google_subject_id="google_123",
            **sample_user_data
        )

        # Google Calendar fields have been removed
        assert user.google_subject_id == "google_123"

    def test_user_relationships(self, sample_user_data):
        """Test user model relationships."""
        user = User(google_subject_id="google_123", **sample_user_data)

        assert hasattr(user, 'clinic_associations')  # Multi-clinic support via associations
        assert hasattr(user, 'calendar_events')
        assert hasattr(user, 'refresh_tokens')
        assert hasattr(user, 'availability')
        assert hasattr(user, 'practitioner_appointment_types')


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
        from datetime import timedelta
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=2,
            event_type='appointment',
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
        )

        appointment = Appointment(
            calendar_event_id=1,  # Mock ID for testing
            patient_id=1,
            appointment_type_id=3,
            status="confirmed"
        )
        
        # Set the relationship manually for testing
        appointment.calendar_event = calendar_event

        assert appointment.patient_id == 1
        assert appointment.user_id == 2
        assert appointment.appointment_type_id == 3
        assert appointment.start_time == start_time.time()
        assert appointment.end_time == end_time.time()
        assert appointment.status == "confirmed"

    def test_appointment_statuses(self):
        """Test different appointment statuses."""
        statuses = ["confirmed", "canceled_by_patient", "canceled_by_clinic"]

        for status in statuses:
            # Create CalendarEvent first
            calendar_event = CalendarEvent(
                user_id=2,
                event_type='appointment',
                date=datetime.now(timezone.utc).date(),
                start_time=datetime.now(timezone.utc).time(),
                end_time=datetime.now(timezone.utc).time(),
            )

            appointment = Appointment(
                calendar_event_id=1,  # Mock ID for testing
                patient_id=1,
                appointment_type_id=3,
                status=status
            )
            
            # Set the relationship manually for testing
            appointment.calendar_event = calendar_event
            assert appointment.status == status

    def test_appointment_with_google_calendar(self):
        """Test appointment (Google Calendar integration removed)."""
        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=2,
            event_type='appointment',
            date=datetime.now(timezone.utc).date(),
            start_time=datetime.now(timezone.utc).time(),
            end_time=datetime.now(timezone.utc).time()
        )

        appointment = Appointment(
            calendar_event_id=1,  # Mock ID for testing
            patient_id=1,
            appointment_type_id=3,
            status="confirmed"
        )
        
        # Set the relationship manually for testing
        appointment.calendar_event = calendar_event

        # Google Calendar integration has been removed
        assert appointment.status == "confirmed"

    def test_appointment_relationships(self):
        """Test appointment model relationships."""
        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=2,
            event_type='appointment',
            date=datetime.now(timezone.utc).date(),
            start_time=datetime.now(timezone.utc).time(),
            end_time=datetime.now(timezone.utc).time(),
        )

        appointment = Appointment(
            calendar_event_id=1,  # Mock ID for testing
            patient_id=1,
            appointment_type_id=3,
            status="confirmed"
        )
        
        # Set the relationship manually for testing
        appointment.calendar_event = calendar_event

        assert hasattr(appointment, 'patient')
        assert hasattr(appointment, 'calendar_event')
        assert hasattr(appointment, 'appointment_type')
