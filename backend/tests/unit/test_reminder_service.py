"""
Unit tests for reminder service.

Tests duplicate reminder prevention using reminder_sent_at field.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

from core.constants import REMINDER_WINDOW_SIZE_MINUTES
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
        reminder_service = ReminderService()

        # Calculate reminder window (24 hours before appointment)
        # Using REMINDER_WINDOW_SIZE_MINUTES to ensure overlap between hourly runs
        reminder_time = current_time + timedelta(hours=24)
        window_start = reminder_time - timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES)
        window_end = reminder_time + timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES)

        # Get appointments needing reminders
        appointments = reminder_service._get_appointments_needing_reminders(
            db_session, clinic.id, window_start, window_end
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
        reminder_service = ReminderService()

        # Send reminder
        result = await reminder_service._send_reminder_for_appointment(db_session, appointment)

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
        reminder_service = ReminderService()

        # Send reminder (should fail)
        result = await reminder_service._send_reminder_for_appointment(db_session, appointment)

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
        # We need to patch the commit method on the db session
        reminder_service = ReminderService()
        
        # Store original commit method
        original_commit = db_session.commit
        commit_called = False
        
        def failing_commit():
            nonlocal commit_called
            commit_called = True
            raise Exception("Database commit failed")
        
        # Patch the commit method
        db_session.commit = failing_commit

        # Send reminder (should fail on commit)
        result = await reminder_service._send_reminder_for_appointment(db_session, appointment)

        # Verify reminder sending failed
        assert result is False
        assert commit_called is True

        # Verify reminder was sent (LINE send succeeded)
        mock_line_service.send_text_message.assert_called_once()

        # Verify reminder_sent_at was NOT updated (commit failed)
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is None

        # Restore original commit
        db_session.commit = original_commit

class TestReminderServiceWindowBoundaries:
    """Test cases for reminder window boundary handling and overlap."""

    def test_appointments_at_window_boundaries_are_included(self, db_session):
        """Test that appointments at exact window boundaries are included."""
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

        # Set reminder_hours_before to 24 hours
        clinic.settings = {
            "notification_settings": {
                "reminder_hours_before": 24
            }
        }
        db_session.flush()

        current_time = taiwan_now()
        reminder_time = current_time + timedelta(hours=24)
        
        # Create appointments at window boundaries (using REMINDER_WINDOW_SIZE_MINUTES)
        # Appointment 1: At exact start boundary (reminder_time - REMINDER_WINDOW_SIZE_MINUTES)
        boundary_start_time = reminder_time - timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES)
        calendar_event1 = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=boundary_start_time.date(),
            start_time=boundary_start_time.time(),
            end_time=(boundary_start_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event1)
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None
        )
        db_session.add(appointment1)
        db_session.flush()

        # Appointment 2: At exact end boundary (reminder_time + REMINDER_WINDOW_SIZE_MINUTES)
        boundary_end_time = reminder_time + timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES)
        calendar_event2 = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=boundary_end_time.date(),
            start_time=boundary_end_time.time(),
            end_time=(boundary_end_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event2)
        db_session.flush()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None
        )
        db_session.add(appointment2)
        db_session.flush()

        # Appointment 3: Just outside start boundary (reminder_time - REMINDER_WINDOW_SIZE_MINUTES - 1)
        outside_start_time = reminder_time - timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES + 1)
        calendar_event3 = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=outside_start_time.date(),
            start_time=outside_start_time.time(),
            end_time=(outside_start_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event3)
        db_session.flush()

        appointment3 = Appointment(
            calendar_event_id=calendar_event3.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None
        )
        db_session.add(appointment3)
        db_session.flush()

        # Appointment 4: Just outside end boundary (reminder_time + REMINDER_WINDOW_SIZE_MINUTES + 1)
        outside_end_time = reminder_time + timedelta(minutes=REMINDER_WINDOW_SIZE_MINUTES + 1)
        calendar_event4 = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=outside_end_time.date(),
            start_time=outside_end_time.time(),
            end_time=(outside_end_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event4)
        db_session.flush()

        appointment4 = Appointment(
            calendar_event_id=calendar_event4.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None
        )
        db_session.add(appointment4)
        db_session.flush()

        db_session.commit()

        # Create reminder service
        reminder_service = ReminderService()

        # Calculate reminder window using new logic: current_time to current_time + reminder_hours_before + window_size
        window_start = current_time
        window_end = current_time + timedelta(hours=24, minutes=REMINDER_WINDOW_SIZE_MINUTES)

        # Get appointments needing reminders
        appointments = reminder_service._get_appointments_needing_reminders(
            db_session, clinic.id, window_start, window_end
        )

        # With new window logic:
        # - Window: current_time to current_time + 24h + 35min
        # - Appointment 1: at (reminder_time - 35min) = (current_time + 24h - 35min) - IN WINDOW
        # - Appointment 2: at (reminder_time + 35min) = (current_time + 24h + 35min) - AT BOUNDARY (included)
        # - Appointment 3: at (reminder_time - 36min) = (current_time + 24h - 36min) - IN WINDOW (earlier than appointment 1)
        # - Appointment 4: at (reminder_time + 36min) = (current_time + 24h + 36min) - OUT OF WINDOW
        # Should include appointments 1, 2, and 3 (all within window)
        # Should exclude appointment 4 (outside window)
        assert len(appointments) == 3
        appointment_ids = {app.calendar_event_id for app in appointments}
        assert calendar_event1.id in appointment_ids
        assert calendar_event2.id in appointment_ids
        assert calendar_event3.id in appointment_ids
        assert calendar_event4.id not in appointment_ids

    @pytest.mark.asyncio
    async def test_overlap_prevents_duplicate_reminders(self, db_session):
        """Test that overlap between hourly runs doesn't cause duplicate reminders."""
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

        # Set reminder_hours_before to 24 hours
        clinic.settings = {
            "notification_settings": {
                "reminder_hours_before": 24
            }
        }
        db_session.flush()

        current_time = taiwan_now()
        reminder_time = current_time + timedelta(hours=24)
        
        # Create appointment in the overlap zone between two hourly runs
        # Window width = 2 * REMINDER_WINDOW_SIZE_MINUTES = 70 minutes
        # Time between runs = 60 minutes
        # Overlap = 70 - 60 = 10 minutes
        # 
        # Example: If reminder_hours_before = 24 hours
        # - Run at 2:00 PM: checks appointments at 2:00 PM next day ± 35min
        #   Window: 1:25 PM - 2:35 PM next day
        # - Run at 3:00 PM: checks appointments at 3:00 PM next day ± 35min
        #   Window: 2:25 PM - 3:35 PM next day
        # - Overlap: 2:25 PM - 2:35 PM next day (10 minutes)
        # 
        # An appointment at 2:30 PM next day would be in the overlap zone and could
        # theoretically be caught by both runs. However, reminder_sent_at prevents
        # duplicate reminders. This test verifies that once a reminder is sent, it
        # won't be sent again even if the appointment falls in multiple windows.
        overlap_time = reminder_time - timedelta(minutes=30)  # In overlap zone
        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=overlap_time.date(),
            start_time=overlap_time.time(),
            end_time=(overlap_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=None
        )
        db_session.add(appointment)
        db_session.commit()

        # Create reminder service
        reminder_service = ReminderService()

        # Simulate first run (at hour H)
        # New window logic: current_time to current_time + reminder_hours_before + window_size
        window_start_run1 = current_time
        window_end_run1 = current_time + timedelta(hours=24, minutes=REMINDER_WINDOW_SIZE_MINUTES)
        appointments_run1 = reminder_service._get_appointments_needing_reminders(
            db_session, clinic.id, window_start_run1, window_end_run1
        )
        
        # Appointment should be found in first run (it's 24 hours away, within window)
        assert len(appointments_run1) == 1
        assert appointments_run1[0].calendar_event_id == calendar_event.id

        # Mock LINE service and send reminder
        with patch('services.reminder_service.LINEService') as mock_line_service_class:
            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service

            # Send reminder
            result = await reminder_service._send_reminder_for_appointment(db_session, appointment)
            assert result is True

        # Refresh appointment to get updated reminder_sent_at
        db_session.refresh(appointment)

        # Simulate second run (at hour H+1) - 1 hour later
        # New window logic: current_time + 1h to current_time + 1h + reminder_hours_before + window_size
        current_time_run2 = current_time + timedelta(hours=1)  # 1 hour later
        window_start_run2 = current_time_run2
        window_end_run2 = current_time_run2 + timedelta(hours=24, minutes=REMINDER_WINDOW_SIZE_MINUTES)
        appointments_run2 = reminder_service._get_appointments_needing_reminders(
            db_session, clinic.id, window_start_run2, window_end_run2
        )

        # Appointment should NOT be found in second run because:
        # 1. reminder_sent_at is set (prevents duplicates)
        # 2. Even if reminder_sent_at wasn't set, the appointment is now 25 hours away,
        #    which is outside the window (current_time + 1h to current_time + 1h + 24h + 35min)
        assert len(appointments_run2) == 0

        # Verify reminder_sent_at was set
        assert appointment.reminder_sent_at is not None


class TestReminderServiceCatchUp:
    """Test cases for catch-up logic (downtime recovery and setting changes).
    
    Note: Catch-up logic is now integrated into _send_pending_reminders
    using the new window logic (current_time to current_time + reminder_hours_before + window_size).
    """

    @pytest.mark.asyncio
    async def test_catch_up_missed_reminders_during_downtime(self, db_session):
        """Test that _send_pending_reminders catches up on missed reminders during downtime."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        clinic.settings = {
            "notification_settings": {
                "reminder_hours_before": 24
            }
        }
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

        # Create appointment that should have been reminded but wasn't
        # Appointment is in 12 hours (should have been reminded 12 hours ago with 24h setting)
        current_time = taiwan_now()
        appointment_time = current_time + timedelta(hours=12)
        
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
            reminder_sent_at=None  # No reminder sent yet (missed during downtime)
        )
        db_session.add(appointment)
        db_session.commit()

        # Create reminder service
        reminder_service = ReminderService()

        # Mock LINE service and get_db_context
        with patch('services.reminder_service.LINEService') as mock_line_service_class, \
             patch('services.reminder_service.get_db_context') as mock_get_db_context:
            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service
            
            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Run reminder check (now includes catch-up logic)
            await reminder_service._send_pending_reminders()

            # Verify reminder was sent
            mock_line_service.send_text_message.assert_called_once()
            
            # Verify reminder_sent_at was updated
            db_session.refresh(appointment)
            assert appointment.reminder_sent_at is not None

    @pytest.mark.asyncio
    async def test_catch_up_skips_past_appointments(self, db_session):
        """Test that _send_pending_reminders skips past appointments."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        clinic.settings = {
            "notification_settings": {
                "reminder_hours_before": 24
            }
        }
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

        # Create past appointment (should not receive catch-up reminder)
        current_time = taiwan_now()
        appointment_time = current_time - timedelta(hours=1)  # Past appointment
        
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
            reminder_sent_at=None
        )
        db_session.add(appointment)
        db_session.commit()

        # Create reminder service
        reminder_service = ReminderService()

        # Mock LINE service and get_db_context
        with patch('services.reminder_service.LINEService') as mock_line_service_class, \
             patch('services.reminder_service.get_db_context') as mock_get_db_context:
            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service
            
            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Run reminder check (now includes catch-up logic)
            await reminder_service._send_pending_reminders()

            # Verify reminder was NOT sent (past appointment)
            mock_line_service.send_text_message.assert_not_called()
            
            # Verify reminder_sent_at was NOT updated
            db_session.refresh(appointment)
            assert appointment.reminder_sent_at is None

    @pytest.mark.asyncio
    async def test_catch_up_handles_setting_increase(self, db_session):
        """Test that _send_pending_reminders handles reminder_hours_before setting increases."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        # Setting was increased from 24 to 48 hours
        clinic.settings = {
            "notification_settings": {
                "reminder_hours_before": 48
            }
        }
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

        # Create appointment that should have been reminded with new 48h setting
        # Appointment is in 36 hours (should have been reminded 12 hours ago with 48h setting)
        current_time = taiwan_now()
        appointment_time = current_time + timedelta(hours=36)
        
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
            reminder_sent_at=None  # No reminder sent yet (would have been sent with old 24h setting)
        )
        db_session.add(appointment)
        db_session.commit()

        # Create reminder service
        reminder_service = ReminderService()

        # Mock LINE service and get_db_context
        with patch('services.reminder_service.LINEService') as mock_line_service_class, \
             patch('services.reminder_service.get_db_context') as mock_get_db_context:
            mock_line_service = Mock()
            mock_line_service.send_text_message.return_value = None
            mock_line_service_class.return_value = mock_line_service
            
            # Mock get_db_context to return the test session
            from contextlib import contextmanager
            @contextmanager
            def mock_db_context():
                yield db_session
            mock_get_db_context.return_value = mock_db_context()

            # Run reminder check (now includes catch-up logic)
            await reminder_service._send_pending_reminders()

            # Verify reminder was sent (caught up with new setting)
            mock_line_service.send_text_message.assert_called_once()
            
            # Verify reminder_sent_at was updated
            db_session.refresh(appointment)
            assert appointment.reminder_sent_at is not None

    def test_scheduler_timezone_is_taiwan(self, db_session):
        """Test that scheduler is configured with Taiwan timezone."""
        reminder_service = ReminderService()
        
        # Verify scheduler timezone is set to Taiwan timezone
        assert reminder_service.scheduler.timezone is not None
        # The scheduler timezone should be TAIWAN_TZ
        from utils.datetime_utils import TAIWAN_TZ
        assert reminder_service.scheduler.timezone == TAIWAN_TZ


class TestReminderServiceRescheduling:
    """Test cases for appointment rescheduling handling."""

    @pytest.mark.asyncio
    async def test_reminder_sent_at_reset_on_appointment_reschedule(self, db_session):
        """Test that reminder_sent_at is reset when appointment time changes."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        clinic.settings = {"reminder_hours_before": 24}
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="test_google_subject_id"
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

        # Create original appointment
        current_time = taiwan_now()
        original_appointment_time = current_time + timedelta(hours=48)
        
        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=original_appointment_time.date(),
            start_time=original_appointment_time.time(),
            end_time=(original_appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=current_time  # Reminder was already sent
        )
        db_session.add(appointment)
        db_session.commit()

        # Verify reminder_sent_at is set
        assert appointment.reminder_sent_at is not None

        # Reschedule appointment (change date and start_time)
        new_appointment_time = current_time + timedelta(hours=72)
        calendar_event.date = new_appointment_time.date()
        calendar_event.start_time = new_appointment_time.time()
        calendar_event.end_time = (new_appointment_time + timedelta(minutes=60)).time()
        db_session.flush()  # Flush to ensure event listener fires
        db_session.commit()

        # Verify reminder_sent_at was reset to None
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is None, "reminder_sent_at should be reset when appointment is rescheduled"

    @pytest.mark.asyncio
    async def test_reminder_sent_at_reset_on_date_only_change(self, db_session):
        """Test that reminder_sent_at is reset when only appointment date changes."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        clinic.settings = {"reminder_hours_before": 24}
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="test_google_subject_id"
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

        # Create original appointment
        current_time = taiwan_now()
        original_appointment_time = current_time + timedelta(hours=48)
        
        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=original_appointment_time.date(),
            start_time=original_appointment_time.time(),
            end_time=(original_appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=current_time  # Reminder was already sent
        )
        db_session.add(appointment)
        db_session.commit()

        # Verify reminder_sent_at is set
        assert appointment.reminder_sent_at is not None

        # Reschedule appointment (change only date, keep same time)
        new_appointment_time = current_time + timedelta(days=3, hours=48)
        calendar_event.date = new_appointment_time.date()
        # Keep start_time the same
        db_session.flush()  # Flush to ensure event listener fires
        db_session.commit()

        # Verify reminder_sent_at was reset to None
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is None, "reminder_sent_at should be reset when appointment date changes"

    @pytest.mark.asyncio
    async def test_reminder_sent_at_reset_on_time_only_change(self, db_session):
        """Test that reminder_sent_at is reset when only appointment start_time changes."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        clinic.settings = {"reminder_hours_before": 24}
        db_session.add(clinic)
        db_session.flush()

        user = User(
            clinic_id=clinic.id,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="test_google_subject_id"
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

        # Create original appointment
        current_time = taiwan_now()
        original_appointment_time = current_time + timedelta(hours=48)
        
        calendar_event = CalendarEvent(
            user_id=user.id,
            event_type="appointment",
            date=original_appointment_time.date(),
            start_time=original_appointment_time.time(),
            end_time=(original_appointment_time + timedelta(minutes=60)).time()
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            reminder_sent_at=current_time  # Reminder was already sent
        )
        db_session.add(appointment)
        db_session.commit()

        # Verify reminder_sent_at is set
        assert appointment.reminder_sent_at is not None

        # Reschedule appointment (change only start_time, keep same date)
        new_start_time = (original_appointment_time + timedelta(hours=2)).time()
        calendar_event.start_time = new_start_time
        calendar_event.end_time = (datetime.combine(original_appointment_time.date(), new_start_time) + timedelta(minutes=60)).time()
        db_session.flush()  # Flush to ensure event listener fires
        db_session.commit()

        # Verify reminder_sent_at was reset to None
        db_session.refresh(appointment)
        assert appointment.reminder_sent_at is None, "reminder_sent_at should be reset when appointment start_time changes"

