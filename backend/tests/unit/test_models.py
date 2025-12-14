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
from models.line_push_message import LinePushMessage
from models.practitioner_appointment_types import PractitionerAppointmentTypes
from models.billing_scenario import BillingScenario
from models.receipt import Receipt
from decimal import Decimal


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
        assert clinic.booking_restriction_type == "minimum_hours_required"
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

        # full_name removed from User model - names are stored in UserClinicAssociation
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


class TestLinePushMessageModel:
    """Test cases for LinePushMessage model."""

    def test_line_push_message_creation(self, db_session, sample_clinic_data):
        """Test LinePushMessage model creation with valid data."""
        # Create clinic first
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        push_message = LinePushMessage(
            line_user_id="U1234567890abcdef",
            clinic_id=clinic.id,
            line_message_id="msg_123456",
            recipient_type="patient",
            event_type="appointment_confirmation",
            trigger_source="clinic_triggered",
            labels={"appointment_context": "new_appointment"}
        )
        db_session.add(push_message)
        db_session.commit()
        db_session.refresh(push_message)

        assert push_message.line_user_id == "U1234567890abcdef"
        assert push_message.clinic_id == clinic.id
        assert push_message.line_message_id == "msg_123456"
        assert push_message.recipient_type == "patient"
        assert push_message.event_type == "appointment_confirmation"
        assert push_message.trigger_source == "clinic_triggered"
        assert push_message.labels == {"appointment_context": "new_appointment"}
        assert push_message.created_at is not None

    def test_line_push_message_default_labels(self, db_session, sample_clinic_data):
        """Test LinePushMessage model defaults labels to empty dict."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        push_message = LinePushMessage(
            line_user_id="U1234567890abcdef",
            clinic_id=clinic.id,
            recipient_type="patient",
            event_type="appointment_confirmation",
            trigger_source="clinic_triggered"
        )
        db_session.add(push_message)
        db_session.commit()
        db_session.refresh(push_message)

        assert push_message.labels == {}
        assert isinstance(push_message.labels, dict)

    def test_line_push_message_optional_line_message_id(self, db_session, sample_clinic_data):
        """Test LinePushMessage model allows None for line_message_id."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        push_message = LinePushMessage(
            line_user_id="U1234567890abcdef",
            clinic_id=clinic.id,
            line_message_id=None,
            recipient_type="practitioner",
            event_type="new_appointment_notification",
            trigger_source="patient_triggered"
        )
        db_session.add(push_message)
        db_session.commit()
        db_session.refresh(push_message)

        assert push_message.line_message_id is None

    def test_line_push_message_recipient_types(self, db_session, sample_clinic_data):
        """Test LinePushMessage model accepts all recipient types."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        recipient_types = ["patient", "practitioner", "admin"]
        for recipient_type in recipient_types:
            push_message = LinePushMessage(
                line_user_id="U1234567890abcdef",
                clinic_id=clinic.id,
                recipient_type=recipient_type,
                event_type="test_event",
                trigger_source="system_triggered"
            )
            db_session.add(push_message)
            db_session.commit()
            db_session.refresh(push_message)
            assert push_message.recipient_type == recipient_type
            db_session.delete(push_message)
            db_session.commit()

    def test_line_push_message_trigger_sources(self, db_session, sample_clinic_data):
        """Test LinePushMessage model accepts all trigger sources."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        trigger_sources = ["clinic_triggered", "patient_triggered", "system_triggered"]
        for trigger_source in trigger_sources:
            push_message = LinePushMessage(
                line_user_id="U1234567890abcdef",
                clinic_id=clinic.id,
                recipient_type="patient",
                event_type="test_event",
                trigger_source=trigger_source
            )
            db_session.add(push_message)
            db_session.commit()
            db_session.refresh(push_message)
            assert push_message.trigger_source == trigger_source
            db_session.delete(push_message)
            db_session.commit()

    def test_line_push_message_flexible_labels(self, db_session, sample_clinic_data):
        """Test LinePushMessage model supports flexible labels in JSONB."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        flexible_labels = {
            "appointment_context": "new_appointment",
            "priority": "high",
            "campaign_id": "summer_2024",
            "message_category": "notification"
        }

        push_message = LinePushMessage(
            line_user_id="U1234567890abcdef",
            clinic_id=clinic.id,
            recipient_type="patient",
            event_type="appointment_confirmation",
            trigger_source="clinic_triggered",
            labels=flexible_labels
        )
        db_session.add(push_message)
        db_session.commit()
        db_session.refresh(push_message)

        assert push_message.labels == flexible_labels
        assert push_message.labels["priority"] == "high"
        assert push_message.labels["campaign_id"] == "summer_2024"

    def test_line_push_message_relationship(self, db_session, sample_clinic_data):
        """Test LinePushMessage model relationship with Clinic."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        push_message = LinePushMessage(
            line_user_id="U1234567890abcdef",
            clinic_id=clinic.id,
            recipient_type="patient",
            event_type="appointment_confirmation",
            trigger_source="clinic_triggered"
        )
        db_session.add(push_message)
        db_session.commit()
        db_session.refresh(push_message)

        # Test relationship
        assert hasattr(push_message, 'clinic')
        assert push_message.clinic.id == clinic.id
        assert push_message.clinic.name == clinic.name

    def test_line_push_message_cascade_delete(self, db_session, sample_clinic_data):
        """Test LinePushMessage is deleted when clinic is deleted (CASCADE)."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)

        push_message = LinePushMessage(
            line_user_id="U1234567890abcdef",
            clinic_id=clinic.id,
            recipient_type="patient",
            event_type="appointment_confirmation",
            trigger_source="clinic_triggered"
        )
        db_session.add(push_message)
        db_session.commit()
        push_message_id = push_message.id

        # Delete clinic - should cascade delete push message
        db_session.delete(clinic)
        db_session.commit()

        # Verify push message is deleted
        deleted_message = db_session.query(LinePushMessage).filter(
            LinePushMessage.id == push_message_id
        ).first()
        assert deleted_message is None


class TestAppointmentTypeBillingFields:
    """Test cases for AppointmentType billing-related fields."""

    def test_appointment_type_with_billing_fields(self, db_session):
        """Test appointment type with new billing fields."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60,
            receipt_name="初診評估收據",
            allow_patient_booking=True,
            description="Initial consultation service",
            scheduling_buffer_minutes=10
        )
        db_session.add(apt_type)
        db_session.commit()

        assert apt_type.receipt_name == "初診評估收據"
        assert apt_type.allow_patient_booking is True
        assert apt_type.description == "Initial consultation service"
        assert apt_type.scheduling_buffer_minutes == 10

    def test_appointment_type_defaults(self, db_session):
        """Test appointment type billing field defaults."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="一般複診",
            duration_minutes=30
        )
        db_session.add(apt_type)
        db_session.commit()

        # Defaults should be set
        assert apt_type.allow_patient_booking is True
        assert apt_type.scheduling_buffer_minutes == 0
        assert apt_type.receipt_name is None  # Can be null
        assert apt_type.description is None  # Can be null


class TestBillingScenarioModel:
    """Test cases for BillingScenario model."""

    def test_billing_scenario_creation(self, db_session):
        """Test billing scenario model creation."""
        from models.user_clinic_association import UserClinicAssociation
        
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_123"
        )
        db_session.add(user)
        db_session.flush()
        
        # Create clinic association
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="Test Practitioner",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        pat = PractitionerAppointmentTypes(
            user_id=user.id,
            appointment_type_id=apt_type.id,
            clinic_id=clinic.id
        )
        db_session.add(pat)
        db_session.commit()

        scenario = BillingScenario(
            practitioner_appointment_type_id=pat.id,
            name="原價",
            amount=Decimal("1000.00"),
            revenue_share=Decimal("300.00"),
            is_default=True
        )
        db_session.add(scenario)
        db_session.commit()

        assert scenario.name == "原價"
        assert scenario.amount == Decimal("1000.00")
        assert scenario.revenue_share == Decimal("300.00")
        assert scenario.is_default is True
        assert scenario.is_deleted is False

    def test_billing_scenario_revenue_share_validation(self, db_session):
        """Test that revenue_share <= amount constraint is enforced."""
        from models.user_clinic_association import UserClinicAssociation
        
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_456"
        )
        db_session.add(user)
        db_session.flush()
        
        # Create clinic association
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="Test Practitioner",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        pat = PractitionerAppointmentTypes(
            user_id=user.id,
            appointment_type_id=apt_type.id,
            clinic_id=clinic.id
        )
        db_session.add(pat)
        db_session.commit()

        # This should work: revenue_share <= amount
        scenario = BillingScenario(
            practitioner_appointment_type_id=pat.id,
            name="原價",
            amount=Decimal("1000.00"),
            revenue_share=Decimal("1000.00"),  # Equal to amount
            is_default=True
        )
        db_session.add(scenario)
        db_session.commit()
        assert scenario.revenue_share == Decimal("1000.00")

        # This should fail: revenue_share > amount (database constraint)
        invalid_scenario = BillingScenario(
            practitioner_appointment_type_id=pat.id,
            name="無效方案",
            amount=Decimal("1000.00"),
            revenue_share=Decimal("1500.00"),  # Greater than amount - should fail
            is_default=False
        )
        db_session.add(invalid_scenario)
        with pytest.raises(Exception):  # Should raise database constraint error
            db_session.commit()
        db_session.rollback()


class TestReceiptModel:
    """Test cases for Receipt model."""

    def test_receipt_creation(self, db_session):
        """Test receipt model creation."""
        from models.user_clinic_association import UserClinicAssociation
        
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            email="admin@test.com",
            google_subject_id="google_admin_123"
        )
        db_session.add(user)
        db_session.flush()
        
        # Create clinic association
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="Admin User",
            roles=["admin"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        from datetime import date, time, timezone as tz
        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date.today(),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        receipt_data = {
            "receipt_number": "2024-00001",
            "issue_date": "2024-01-15T10:30:00+08:00",
            "visit_date": "2024-01-15T09:00:00+08:00",
            "clinic": {"id": clinic.id, "display_name": "Test Clinic"},
            "patient": {"id": patient.id, "name": "Test Patient"},
            "checked_out_by": {"id": user.id, "name": "Admin User"},
            "items": [],
            "totals": {"total_amount": 1000.00, "total_revenue_share": 300.00},
            "payment_method": "cash"
        }

        receipt = Receipt(
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            receipt_number="2024-00001",
            issue_date=datetime.now(timezone.utc),
            total_amount=Decimal("1000.00"),
            total_revenue_share=Decimal("300.00"),
            receipt_data=receipt_data
        )
        db_session.add(receipt)
        db_session.commit()

        assert receipt.receipt_number == "2024-00001"
        assert receipt.total_amount == Decimal("1000.00")
        assert receipt.total_revenue_share == Decimal("300.00")
        assert receipt.is_voided is False
        assert receipt.voided_at is None

    def test_receipt_voiding(self, db_session):
        """Test receipt voiding functionality."""
        from models.user_clinic_association import UserClinicAssociation
        
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            email="admin@test.com",
            google_subject_id="google_admin_456"
        )
        db_session.add(user)
        db_session.flush()
        
        # Create clinic association
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="Admin User",
            roles=["admin"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        from datetime import date, time, timezone
        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date.today(),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        receipt_data = {
            "receipt_number": "2024-00001",
            "issue_date": "2024-01-15T10:30:00+08:00",
            "visit_date": "2024-01-15T09:00:00+08:00",
            "clinic": {"id": clinic.id, "display_name": "Test Clinic"},
            "patient": {"id": patient.id, "name": "Test Patient"},
            "checked_out_by": {"id": user.id, "name": "Admin User"},
            "items": [],
            "totals": {"total_amount": 1000.00, "total_revenue_share": 300.00},
            "payment_method": "cash"
        }

        receipt = Receipt(
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            receipt_number="2024-00001",
            issue_date=datetime.now(timezone.utc),
            total_amount=Decimal("1000.00"),
            total_revenue_share=Decimal("300.00"),
            receipt_data=receipt_data
        )
        db_session.add(receipt)
        db_session.commit()

        # Void the receipt using the service method (proper way)
        from services.receipt_service import ReceiptService
        voided_receipt = ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=user.id,
            reason="Test void reason"
        )
        db_session.commit()

        assert voided_receipt.is_voided is True
        assert voided_receipt.voided_at is not None
        assert voided_receipt.voided_by_user_id == user.id
        assert voided_receipt.void_reason == "Test void reason"
