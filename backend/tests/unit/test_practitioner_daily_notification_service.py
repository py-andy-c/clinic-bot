"""
Unit tests for practitioner daily notification service.

Tests daily appointment notifications sent to practitioners about their next-day appointments.
"""

import pytest
from datetime import datetime, date, time, timedelta
from unittest.mock import Mock, patch, MagicMock

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.appointment_type import AppointmentType
from models.user_clinic_association import UserClinicAssociation, PractitionerSettings
from services.practitioner_daily_notification_service import PractitionerDailyNotificationService
from utils.datetime_utils import taiwan_now
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestPractitionerDailyNotificationService:
    """Test cases for practitioner daily notification service."""

    @pytest.mark.asyncio
    async def test_sends_notification_at_configured_time(self, db_session):
        """Test that notifications are sent at the practitioner's configured time."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        # Set notification time to 21:00 (9 PM)
        settings = PractitionerSettings(next_day_notification_time="21:00")
        association.set_validated_settings(settings)
        db_session.flush()

        # Link LINE account (association.line_user_id is the LINE user ID string per clinic)
        association.line_user_id = "test_line_user_id"
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment for next day
        current_time = taiwan_now()
        next_day = (current_time + timedelta(days=1)).date()
        appointment_time = datetime.combine(next_day, time(14, 30))

        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=next_day,
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.practitioner_daily_notification_service.LINEService') as mock_line_service_class, \
             patch('services.practitioner_daily_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.practitioner_daily_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 21:00 (notification time)
            mock_time = datetime.combine(current_time.date(), time(21, 0))
            mock_taiwan_now.return_value = mock_time

            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service

            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Create service and run notification check
            service = PractitionerDailyNotificationService()
            await service._send_daily_notifications()

            # Verify notification was sent
            mock_line_service.send_text_message.assert_called_once()
            call_args = mock_line_service.send_text_message.call_args
            assert call_args[0][0] == "test_line_user_id"
            message = call_args[0][1]
            assert "明日預約提醒" in message
            assert "Test Patient" in message
            assert "Test Type" in message

    @pytest.mark.asyncio
    async def test_skips_notification_when_not_at_configured_time(self, db_session):
        """Test that notifications are not sent when current hour doesn't match configured time."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        # Set notification time to 21:00 (9 PM)
        settings = PractitionerSettings(next_day_notification_time="21:00")
        association.set_validated_settings(settings)
        db_session.flush()

        # Link LINE account (association.line_user_id is the LINE user ID string per clinic)
        association.line_user_id = "test_line_user_id"
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment for next day
        current_time = taiwan_now()
        next_day = (current_time + timedelta(days=1)).date()

        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=next_day,
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.practitioner_daily_notification_service.LINEService') as mock_line_service_class, \
             patch('services.practitioner_daily_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.practitioner_daily_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 20:00 (not notification time)
            mock_time = datetime.combine(current_time.date(), time(20, 0))
            mock_taiwan_now.return_value = mock_time

            mock_line_service = Mock()
            mock_line_service_class.return_value = mock_line_service

            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Create service and run notification check
            service = PractitionerDailyNotificationService()
            await service._send_daily_notifications()

            # Verify notification was NOT sent (wrong hour)
            mock_line_service.send_text_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_notification_when_no_appointments(self, db_session):
        """Test that notifications are not sent when practitioner has no appointments for next day."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        # Set notification time to 21:00 (9 PM)
        settings = PractitionerSettings(next_day_notification_time="21:00")
        association.set_validated_settings(settings)
        db_session.flush()

        # Link LINE account (association.line_user_id is the LINE user ID string per clinic)
        association.line_user_id = "test_line_user_id"
        db_session.flush()

        # No appointments created

        # Mock LINE service
        with patch('services.practitioner_daily_notification_service.LINEService') as mock_line_service_class, \
             patch('services.practitioner_daily_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.practitioner_daily_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 21:00 (notification time)
            current_time = taiwan_now()
            mock_time = datetime.combine(current_time.date(), time(21, 0))
            mock_taiwan_now.return_value = mock_time

            mock_line_service = Mock()
            mock_line_service_class.return_value = mock_line_service

            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Create service and run notification check
            service = PractitionerDailyNotificationService()
            await service._send_daily_notifications()

            # Verify notification was NOT sent (no appointments)
            mock_line_service.send_text_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_notification_when_no_line_account(self, db_session):
        """Test that notifications are skipped when practitioner has no LINE account linked."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        # Set notification time to 21:00 (9 PM)
        settings = PractitionerSettings(next_day_notification_time="21:00")
        association.set_validated_settings(settings)
        db_session.flush()

        # No LINE account linked (association.line_user_id is None)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment for next day
        current_time = taiwan_now()
        next_day = (current_time + timedelta(days=1)).date()

        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=next_day,
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.practitioner_daily_notification_service.LINEService') as mock_line_service_class, \
             patch('services.practitioner_daily_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.practitioner_daily_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 21:00 (notification time)
            mock_time = datetime.combine(current_time.date(), time(21, 0))
            mock_taiwan_now.return_value = mock_time

            mock_line_service = Mock()
            mock_line_service_class.return_value = mock_line_service

            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Create service and run notification check
            service = PractitionerDailyNotificationService()
            await service._send_daily_notifications()

            # Verify notification was NOT sent (no LINE account)
            mock_line_service.send_text_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_uses_default_time_when_setting_missing(self, db_session):
        """Test that default time (21:00) is used when setting is missing."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        # Don't set notification time (will use default 21:00)
        # Just use default settings
        settings = PractitionerSettings()
        association.set_validated_settings(settings)
        db_session.flush()

        # Link LINE account (association.line_user_id is the LINE user ID string per clinic)
        association.line_user_id = "test_line_user_id"
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment for next day
        current_time = taiwan_now()
        next_day = (current_time + timedelta(days=1)).date()

        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=next_day,
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.practitioner_daily_notification_service.LINEService') as mock_line_service_class, \
             patch('services.practitioner_daily_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.practitioner_daily_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 21:00 (default notification time)
            mock_time = datetime.combine(current_time.date(), time(21, 0))
            mock_taiwan_now.return_value = mock_time

            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service

            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Create service and run notification check
            service = PractitionerDailyNotificationService()
            await service._send_daily_notifications()

            # Verify notification was sent (using default time)
            mock_line_service.send_text_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_sends_multiple_appointments_in_one_message(self, db_session):
        """Test that multiple appointments are included in a single notification message."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        # Set notification time to 21:00 (9 PM)
        settings = PractitionerSettings(next_day_notification_time="21:00")
        association.set_validated_settings(settings)
        db_session.flush()

        # Link LINE account (association.line_user_id is the LINE user ID string per clinic)
        association.line_user_id = "test_line_user_id"
        db_session.flush()

        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient One",
            phone_number="1234567890"
        )
        db_session.add(patient1)
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Two",
            phone_number="0987654321"
        )
        db_session.add(patient2)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create two appointments for next day
        current_time = taiwan_now()
        next_day = (current_time + timedelta(days=1)).date()

        calendar_event1 = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=next_day,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=next_day,
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.add(appointment2)
        db_session.commit()

        # Mock LINE service
        with patch('services.practitioner_daily_notification_service.LINEService') as mock_line_service_class, \
             patch('services.practitioner_daily_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.practitioner_daily_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 21:00 (notification time)
            mock_time = datetime.combine(current_time.date(), time(21, 0))
            mock_taiwan_now.return_value = mock_time

            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service

            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Create service and run notification check
            service = PractitionerDailyNotificationService()
            await service._send_daily_notifications()

            # Verify notification was sent once with both appointments
            mock_line_service.send_text_message.assert_called_once()
            call_args = mock_line_service.send_text_message.call_args
            message = call_args[0][1]
            assert "2 個預約" in message
            assert "Patient One" in message
            assert "Patient Two" in message

    def test_get_practitioner_appointments_for_date(self, db_session):
        """Test that appointments are correctly retrieved for a specific date."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointments for different dates
        current_time = taiwan_now()
        target_date = (current_time + timedelta(days=1)).date()
        other_date = (current_time + timedelta(days=2)).date()

        # Appointment on target date
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=target_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        # Appointment on different date
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=other_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.add(appointment2)
        db_session.commit()

        # Test the method
        service = PractitionerDailyNotificationService()
        appointments = service._get_practitioner_appointments_for_date(
            db_session, user.id, clinic.id, target_date
        )

        # Should only return appointment on target date
        assert len(appointments) == 1
        assert appointments[0].calendar_event_id == calendar_event1.id

    def test_scheduler_timezone_is_taiwan(self):
        """Test that scheduler is configured with Taiwan timezone."""
        service = PractitionerDailyNotificationService()
        
        # Verify scheduler timezone is set to Taiwan timezone
        assert service.scheduler.timezone is not None
        from utils.datetime_utils import TAIWAN_TZ
        assert service.scheduler.timezone == TAIWAN_TZ

