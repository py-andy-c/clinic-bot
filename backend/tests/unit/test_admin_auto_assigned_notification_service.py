"""
Unit tests for admin auto-assigned appointment notification service.

Tests daily notifications sent to clinic admins about pending auto-assigned appointments.
"""

import pytest
from datetime import datetime, date, time, timedelta
from unittest.mock import Mock, patch

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.appointment_type import AppointmentType
from models.user_clinic_association import UserClinicAssociation, PractitionerSettings
from services.admin_auto_assigned_notification_service import AdminAutoAssignedNotificationService
from utils.datetime_utils import taiwan_now
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestAdminAutoAssignedNotificationService:
    """Test cases for admin auto-assigned notification service."""

    @pytest.mark.asyncio
    async def test_sends_notification_at_configured_time(self, db_session):
        """Test that notifications are sent at the clinic's configured time."""
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

        # Create admin user with LINE account
        admin_user, admin_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin User",
            email="admin@test.com",
            google_subject_id="admin_subject_123",
            roles=["admin"],
            is_active=True
        )
        admin_user.line_user_id = "test_admin_line_user_id"
        # Set admin's notification time to 09:00 (9 AM)
        from models.user_clinic_association import PractitionerSettings
        admin_settings = PractitionerSettings(auto_assigned_notification_time="09:00")
        admin_association.set_validated_settings(admin_settings)
        db_session.flush()

        # Create practitioner for the auto-assigned appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
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

        # Create auto-assigned appointment for future
        current_time = taiwan_now()
        future_time = current_time + timedelta(days=2, hours=10)
        next_day = future_time.date()

        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
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
            status="confirmed",
            is_auto_assigned=True
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.admin_auto_assigned_notification_service.LINEService') as mock_line_service_class, \
             patch('services.admin_auto_assigned_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.admin_auto_assigned_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 09:00 (notification time)
            mock_time = datetime.combine(current_time.date(), time(9, 0))
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
            service = AdminAutoAssignedNotificationService()
            await service._send_admin_notifications()

            # Verify notification was sent
            mock_line_service.send_text_message.assert_called_once()
            call_args = mock_line_service.send_text_message.call_args
            assert call_args[0][0] == "test_admin_line_user_id"
            message = call_args[0][1]
            assert "待審核預約提醒" in message
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

        # Create admin user with LINE account
        admin_user, admin_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin User",
            email="admin@test.com",
            google_subject_id="admin_subject_123",
            roles=["admin"],
            is_active=True
        )
        admin_user.line_user_id = "test_admin_line_user_id"
        # Use default notification time (09:00)
        db_session.flush()

        # Create auto-assigned appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
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

        current_time = taiwan_now()
        future_time = current_time + timedelta(days=2, hours=10)

        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_time.date(),
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.admin_auto_assigned_notification_service.LINEService') as mock_line_service_class, \
             patch('services.admin_auto_assigned_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.admin_auto_assigned_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 10:00 (not notification time)
            mock_time = datetime.combine(current_time.date(), time(10, 0))
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
            service = AdminAutoAssignedNotificationService()
            await service._send_admin_notifications()

            # Verify notification was NOT sent (wrong hour)
            mock_line_service.send_text_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_notification_when_no_pending_appointments(self, db_session):
        """Test that notifications are not sent when there are no pending auto-assigned appointments."""
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

        # Create admin user with LINE account
        admin_user, admin_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin User",
            email="admin@test.com",
            google_subject_id="admin_subject_123",
            roles=["admin"],
            is_active=True
        )
        admin_user.line_user_id = "test_admin_line_user_id"
        # Set admin's notification time to 09:00 (9 AM)
        admin_settings = PractitionerSettings(auto_assigned_notification_time="09:00")
        admin_association.set_validated_settings(admin_settings)
        db_session.flush()

        # No appointments created

        # Mock LINE service
        with patch('services.admin_auto_assigned_notification_service.LINEService') as mock_line_service_class, \
             patch('services.admin_auto_assigned_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.admin_auto_assigned_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 09:00 (notification time)
            current_time = taiwan_now()
            mock_time = datetime.combine(current_time.date(), time(9, 0))
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
            service = AdminAutoAssignedNotificationService()
            await service._send_admin_notifications()

            # Verify notification was NOT sent (no appointments)
            mock_line_service.send_text_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_notification_when_no_admin_line_account(self, db_session):
        """Test that notifications are skipped when admins have no LINE accounts linked."""
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

        # Create admin user WITHOUT LINE account
        admin_user, admin_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin User",
            email="admin@test.com",
            google_subject_id="admin_subject_123",
            roles=["admin"],
            is_active=True
        )
        # No LINE account linked (admin_user.line_user_id is None)
        # Set admin's notification time
        admin_settings = PractitionerSettings(auto_assigned_notification_time="09:00")
        admin_association.set_validated_settings(admin_settings)
        db_session.flush()

        # Create auto-assigned appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
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

        current_time = taiwan_now()
        future_time = current_time + timedelta(days=2, hours=10)

        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_time.date(),
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.admin_auto_assigned_notification_service.LINEService') as mock_line_service_class, \
             patch('services.admin_auto_assigned_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.admin_auto_assigned_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 09:00 (notification time)
            mock_time = datetime.combine(current_time.date(), time(9, 0))
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
            service = AdminAutoAssignedNotificationService()
            await service._send_admin_notifications()

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

        # Create admin user with LINE account
        admin_user, admin_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin User",
            email="admin@test.com",
            google_subject_id="admin_subject_123",
            roles=["admin"],
            is_active=True
        )
        admin_user.line_user_id = "test_admin_line_user_id"
        # Don't set notification time (will use default 21:00)
        db_session.flush()

        # Create auto-assigned appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
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

        current_time = taiwan_now()
        future_time = current_time + timedelta(days=2, hours=10)

        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_time.date(),
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        with patch('services.admin_auto_assigned_notification_service.LINEService') as mock_line_service_class, \
             patch('services.admin_auto_assigned_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.admin_auto_assigned_notification_service.taiwan_now') as mock_taiwan_now:
            
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
            service = AdminAutoAssignedNotificationService()
            await service._send_admin_notifications()

            # Verify notification was sent (using default time)
            mock_line_service.send_text_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_sends_multiple_appointments_in_one_message(self, db_session):
        """Test that multiple pending appointments are included in a single notification message."""
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

        # Create admin user with LINE account
        admin_user, admin_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin User",
            email="admin@test.com",
            google_subject_id="admin_subject_123",
            roles=["admin"],
            is_active=True
        )
        admin_user.line_user_id = "test_admin_line_user_id"
        # Set admin's notification time to 09:00 (9 AM)
        admin_settings = PractitionerSettings(auto_assigned_notification_time="09:00")
        admin_association.set_validated_settings(admin_settings)
        db_session.flush()

        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
            roles=["practitioner"],
            is_active=True
        )

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

        # Create two auto-assigned appointments for future
        current_time = taiwan_now()
        future_time1 = current_time + timedelta(days=2, hours=10)
        future_time2 = current_time + timedelta(days=2, hours=14)

        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_time1.date(),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_time2.date(),
            start_time=time(14, 30),
            end_time=time(15, 30)
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        db_session.add(appointment1)
        db_session.add(appointment2)
        db_session.commit()

        # Mock LINE service
        with patch('services.admin_auto_assigned_notification_service.LINEService') as mock_line_service_class, \
             patch('services.admin_auto_assigned_notification_service.get_db_context') as mock_get_db_context, \
             patch('services.admin_auto_assigned_notification_service.taiwan_now') as mock_taiwan_now:
            
            # Set current time to 09:00 (notification time)
            mock_time = datetime.combine(current_time.date(), time(9, 0))
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
            service = AdminAutoAssignedNotificationService()
            await service._send_admin_notifications()

            # Verify notification was sent once with both appointments
            mock_line_service.send_text_message.assert_called_once()
            call_args = mock_line_service.send_text_message.call_args
            message = call_args[0][1]
            assert "2 個待審核的預約" in message
            assert "Patient One" in message
            assert "Patient Two" in message

    def test_get_pending_auto_assigned_appointments(self, db_session):
        """Test that pending auto-assigned appointments are correctly retrieved."""
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

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
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
        future_date = (current_time + timedelta(days=2)).date()
        past_date = (current_time - timedelta(days=1)).date()

        # Auto-assigned appointment in future (should be included)
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        # Auto-assigned appointment in past (should be excluded)
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=past_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        # Non-auto-assigned appointment (should be excluded)
        calendar_event3 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(16, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True
        )
        appointment3 = Appointment(
            calendar_event_id=calendar_event3.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False  # Not auto-assigned
        )
        db_session.add(appointment1)
        db_session.add(appointment2)
        db_session.add(appointment3)
        db_session.commit()

        # Test the method
        service = AdminAutoAssignedNotificationService()
        appointments = service._get_pending_auto_assigned_appointments(
            db_session, clinic.id
        )

        # Should only return future auto-assigned appointment
        assert len(appointments) == 1
        assert appointments[0].calendar_event_id == calendar_event1.id
        assert appointments[0].is_auto_assigned is True

    def test_get_clinic_admins_with_line(self, db_session):
        """Test that clinic admins with LINE accounts are correctly retrieved."""
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

        # Create admin with LINE account
        admin1, admin1_association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin One",
            email="admin1@test.com",
            google_subject_id="admin1_subject_123",
            roles=["admin"],
            is_active=True
        )
        admin1.line_user_id = "admin1_line_id"
        db_session.flush()

        # Create admin without LINE account
        admin2, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin Two",
            email="admin2@test.com",
            google_subject_id="admin2_subject_123",
            roles=["admin"],
            is_active=True
        )
        # No LINE account linked
        db_session.flush()

        # Create non-admin user with LINE account
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_subject_123",
            roles=["practitioner"],
            is_active=True
        )
        practitioner.line_user_id = "practitioner_line_id"
        db_session.flush()

        # Test the method
        service = AdminAutoAssignedNotificationService()
        admin_associations = service._get_clinic_admins_with_line(
            db_session, clinic.id
        )

        # Should only return admin with LINE account
        assert len(admin_associations) == 1
        assert admin_associations[0].user_id == admin1.id
        assert admin_associations[0].clinic_id == clinic.id

    def test_scheduler_timezone_is_taiwan(self):
        """Test that scheduler is configured with Taiwan timezone."""
        service = AdminAutoAssignedNotificationService()
        
        # Verify scheduler timezone is set to Taiwan timezone
        assert service.scheduler.timezone is not None
        from utils.datetime_utils import TAIWAN_TZ
        assert service.scheduler.timezone == TAIWAN_TZ

