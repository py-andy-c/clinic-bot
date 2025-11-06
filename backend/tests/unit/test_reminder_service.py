"""
Unit tests for reminder service.

Tests duplicate reminder prevention using reminder_sent_at field.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.appointment_type import AppointmentType
from services.reminder_service import ReminderService
from utils.datetime_utils import taiwan_now, ensure_taiwan


class TestReminderServiceDuplicatePrevention:
    """Test cases for duplicate reminder prevention."""

    def test_appointments_with_reminder_sent_at_are_excluded(self, db_session):
        """Test that appointments with reminder_sent_at set are not included in reminder list."""
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

        user = User(
            clinic_id=clinic.id,
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            full_name="Test Therapist",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(user)
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

        # Create two appointments: one with reminder_sent_at, one without
        current_time = taiwan_now()
        appointment_time = current_time + timedelta(hours=24)

        # Appointment 1: Already has reminder sent
        calendar_event1 = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event1)
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=current_time - timedelta(hours=1)  # Reminder already sent
        )
        db_session.add(appointment1)
        db_session.flush()

        # Appointment 2: No reminder sent yet
        calendar_event2 = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event2)
        db_session.flush()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None  # No reminder sent yet
        )
        db_session.add(appointment2)
        db_session.flush()

        db_session.commit()

        # Create reminder service
        reminder_service = ReminderService(db_session)

        # Calculate reminder window (24 hours before appointment)
        reminder_time = current_time + timedelta(hours=24)
        window_start = reminder_time - timedelta(minutes=30)
        window_end = reminder_time + timedelta(minutes=30)

        # Get appointments needing reminders
        appointments = reminder_service._get_appointments_needing_reminders(
            clinic.id, window_start, window_end
        )

        # Should only include appointment2 (no reminder sent)
        assert len(appointments) == 1
        assert appointments[0].calendar_event_id == appointment2.calendar_event_id
        assert appointments[0].reminder_sent_at is None

    @patch('services.reminder_service.LINEService')
    @pytest.mark.asyncio
    async def test_reminder_sent_at_is_updated_after_successful_send(
        self, mock_line_service_class, db_session
    ):
        """Test that reminder_sent_at is updated after successfully sending a reminder."""
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

        user = User(
            clinic_id=clinic.id,
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            full_name="Test Therapist",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(user)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        from models.line_user import LineUser
        line_user = LineUser(
            line_user_id="test_line_user_id",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()
        patient.line_user_id = line_user.id
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment
        current_time = taiwan_now()
        appointment_time = current_time + timedelta(hours=24)

        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None  # No reminder sent yet
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service
        mock_line_service = Mock()
        mock_line_service_class.return_value = mock_line_service

        # Create reminder service
        reminder_service = ReminderService(db_session)

        # Send reminder
        result = await reminder_service._send_reminder_for_appointment(appointment)

        # Verify reminder was sent
        assert result is True
        mock_line_service.send_text_message.assert_called_once()

        # Verify reminder_sent_at was updated
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is not None

    @patch('services.reminder_service.LINEService')
    @pytest.mark.asyncio
    async def test_reminder_sent_at_not_updated_on_failure(
        self, mock_line_service_class, db_session
    ):
        """Test that reminder_sent_at is not updated if reminder sending fails."""
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

        user = User(
            clinic_id=clinic.id,
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            full_name="Test Therapist",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(user)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        from models.line_user import LineUser
        line_user = LineUser(
            line_user_id="test_line_user_id",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()
        patient.line_user_id = line_user.id
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment
        current_time = taiwan_now()
        appointment_time = current_time + timedelta(hours=24)

        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None  # No reminder sent yet
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service to raise an exception
        mock_line_service = Mock()
        mock_line_service.send_text_message.side_effect = Exception("LINE API error")
        mock_line_service_class.return_value = mock_line_service

        # Create reminder service
        reminder_service = ReminderService(db_session)

        # Send reminder (should fail)
        result = await reminder_service._send_reminder_for_appointment(appointment)

        # Verify reminder sending failed
        assert result is False

        # Verify reminder_sent_at was NOT updated
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is None

    @patch('services.reminder_service.LINEService')
    @pytest.mark.asyncio
    async def test_reminder_sent_at_not_updated_on_commit_failure(
        self, mock_line_service_class, db_session
    ):
        """Test that reminder_sent_at is not updated if commit fails after LINE send succeeds."""
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

        user = User(
            clinic_id=clinic.id,
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            full_name="Test Therapist",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(user)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        from models.line_user import LineUser
        line_user = LineUser(
            line_user_id="test_line_user_id",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()
        patient.line_user_id = line_user.id
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment
        current_time = taiwan_now()
        appointment_time = current_time + timedelta(hours=24)

        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None  # No reminder sent yet
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock LINE service to succeed
        mock_line_service = Mock()
        mock_line_service.send_text_message.return_value = None
        mock_line_service_class.return_value = mock_line_service

        # Mock db.commit() to raise an exception (simulating commit failure)
        # We need to patch the commit method on the reminder service's db session
        reminder_service = ReminderService(db_session)
        
        # Store original commit method
        original_commit = reminder_service.db.commit
        commit_called = False
        
        def failing_commit():
            nonlocal commit_called
            commit_called = True
            raise Exception("Database commit failed")
        
        # Patch the commit method
        reminder_service.db.commit = failing_commit

        # Send reminder (should fail on commit)
        result = await reminder_service._send_reminder_for_appointment(appointment)

        # Verify reminder sending failed
        assert result is False
        assert commit_called is True

        # Verify reminder was sent (LINE send succeeded)
        mock_line_service.send_text_message.assert_called_once()

        # Verify reminder_sent_at was NOT updated (commit failed)
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is None

        # Restore original commit
        reminder_service.db.commit = original_commit

