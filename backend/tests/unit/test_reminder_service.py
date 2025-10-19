"""
Unit tests for appointment reminder service.
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock, MagicMock
from sqlalchemy.orm import Session

from services.reminder_service import ReminderService, get_reminder_service
from models.appointment import Appointment
from models.therapist import Therapist
from models.patient import Patient
from models.line_user import LineUser
from models.clinic import Clinic


class TestReminderService:
    """Test cases for ReminderService class."""

    @pytest.fixture
    def db_session(self):
        """Mock database session."""
        return MagicMock(spec=Session)

    @pytest.fixture
    def reminder_service(self, db_session):
        """Create ReminderService instance."""
        return ReminderService(db_session)

    def test_init(self, db_session):
        """Test ReminderService initialization."""
        service = ReminderService(db_session)
        assert service.db == db_session
        assert service._is_started == False
        assert hasattr(service, 'scheduler')

    def test_get_reminder_service_singleton(self, db_session):
        """Test get_reminder_service returns singleton instance."""
        service1 = get_reminder_service(db_session)
        service2 = get_reminder_service(db_session)
        assert service1 is service2
        assert isinstance(service1, ReminderService)

    @pytest.mark.asyncio
    async def test_start_scheduler_already_started(self, reminder_service):
        """Test starting scheduler when already started."""
        reminder_service._is_started = True
        with patch('services.reminder_service.logger') as mock_logger:
            await reminder_service.start_scheduler()
            mock_logger.warning.assert_called_with("Reminder scheduler is already started")

    @pytest.mark.asyncio
    async def test_start_scheduler_success(self, reminder_service):
        """Test successful scheduler start."""
        with patch.object(reminder_service.scheduler, 'add_job') as mock_add_job, \
             patch.object(reminder_service.scheduler, 'start') as mock_start, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_add_job.return_value = MagicMock()

            await reminder_service.start_scheduler()

            assert reminder_service._is_started == True
            mock_add_job.assert_called_once()
            mock_start.assert_called_once()
            mock_logger.info.assert_called_with("Appointment reminder scheduler started")

    @pytest.mark.asyncio
    async def test_stop_scheduler_not_started(self, reminder_service):
        """Test stopping scheduler when not started."""
        with patch('services.reminder_service.logger') as mock_logger:
            await reminder_service.stop_scheduler()
            # Should not raise any errors
            mock_logger.warning.assert_not_called()

    @pytest.mark.asyncio
    async def test_stop_scheduler_success(self, reminder_service):
        """Test successful scheduler stop."""
        reminder_service._is_started = True
        with patch.object(reminder_service.scheduler, 'shutdown') as mock_shutdown, \
             patch('services.reminder_service.logger') as mock_logger:

            await reminder_service.stop_scheduler()

            assert reminder_service._is_started == False
            mock_shutdown.assert_called_once_with(wait=True)
            mock_logger.info.assert_called_with("Appointment reminder scheduler stopped")

    @pytest.mark.asyncio
    async def test_send_pending_reminders_no_appointments(self, reminder_service, db_session):
        """Test sending reminders when no appointments found."""
        with patch.object(reminder_service, '_get_appointments_needing_reminders') as mock_get_appts, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_get_appts.return_value = []

            await reminder_service._send_pending_reminders()

            mock_logger.info.assert_any_call("Checking for appointments needing reminders...")
            mock_logger.info.assert_any_call("No appointments found that need reminders")

    @pytest.mark.asyncio
    async def test_send_pending_reminders_success(self, reminder_service):
        """Test successful sending of reminders."""
        mock_appointment = MagicMock(spec=Appointment)
        appointments = [mock_appointment]

        with patch.object(reminder_service, '_get_appointments_needing_reminders') as mock_get_appts, \
             patch.object(reminder_service, '_send_reminder_for_appointment') as mock_send, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_get_appts.return_value = appointments
            mock_send.return_value = True

            await reminder_service._send_pending_reminders()

            mock_logger.info.assert_any_call("Found 1 appointments needing reminders")
            mock_logger.info.assert_any_call("Successfully sent 1 appointment reminders")
            mock_send.assert_called_once_with(mock_appointment)

    @pytest.mark.asyncio
    async def test_send_pending_reminders_partial_failure(self, reminder_service):
        """Test sending reminders with some failures."""
        mock_appointment1 = MagicMock(spec=Appointment)
        mock_appointment2 = MagicMock(spec=Appointment)
        appointments = [mock_appointment1, mock_appointment2]

        with patch.object(reminder_service, '_get_appointments_needing_reminders') as mock_get_appts, \
             patch.object(reminder_service, '_send_reminder_for_appointment') as mock_send, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_get_appts.return_value = appointments
            mock_send.side_effect = [True, False]  # First succeeds, second fails

            await reminder_service._send_pending_reminders()

            mock_logger.info.assert_any_call("Found 2 appointments needing reminders")
            mock_logger.info.assert_any_call("Successfully sent 1 appointment reminders")
            assert mock_send.call_count == 2

    @pytest.mark.asyncio
    async def test_send_pending_reminders_exception(self, reminder_service):
        """Test sending reminders with exception."""
        with patch.object(reminder_service, '_get_appointments_needing_reminders') as mock_get_appts, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_get_appts.side_effect = Exception("Database error")

            await reminder_service._send_pending_reminders()

            mock_logger.error.assert_called_once()

    def test_get_appointments_needing_reminders(self, reminder_service, db_session):
        """Test getting appointments that need reminders."""
        reminder_time = datetime.now(timezone.utc) + timedelta(hours=24)
        window_start = reminder_time - timedelta(minutes=30)
        window_end = reminder_time + timedelta(minutes=30)

        mock_appointments = [MagicMock(spec=Appointment), MagicMock(spec=Appointment)]

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = MagicMock()
            mock_filter.filter.return_value = mock_filter
            mock_filter.all.return_value = mock_appointments
            mock_query.return_value = mock_filter

            result = reminder_service._get_appointments_needing_reminders(window_start, window_end)

            assert result == mock_appointments
            mock_query.assert_called_once_with(Appointment)

    @pytest.mark.asyncio
    async def test_send_reminder_for_appointment_success(self, reminder_service):
        """Test successful reminder sending for an appointment."""
        mock_appointment = MagicMock(spec=Appointment)
        mock_patient = MagicMock(spec=Patient)
        mock_clinic = MagicMock(spec=Clinic)
        mock_line_user = MagicMock(spec=LineUser)

        mock_appointment.patient = mock_patient
        mock_patient.clinic = mock_clinic
        mock_appointment.therapist.name = "Dr. Smith"
        mock_appointment.appointment_type.name = "Regular Checkup"
        mock_appointment.start_time = datetime(2024, 1, 15, 14, 30, tzinfo=timezone.utc)

        with patch('services.reminder_service.LINEService') as mock_line_service_class, \
             patch.object(reminder_service.db, 'query') as mock_query, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_line_service = MagicMock()
            mock_line_service_class.return_value = mock_line_service
            mock_query.return_value.filter_by.return_value.first.return_value = mock_line_user

            result = await reminder_service._send_reminder_for_appointment(mock_appointment)

            assert result == True
            mock_line_service.send_text_message.assert_called_once()
            mock_logger.info.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_reminder_for_appointment_no_line_user(self, reminder_service):
        """Test reminder sending when no LINE user found."""
        mock_appointment = MagicMock(spec=Appointment)
        mock_patient = MagicMock(spec=Patient)

        mock_appointment.patient = mock_patient

        with patch.object(reminder_service.db, 'query') as mock_query, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_query.return_value.filter_by.return_value.first.return_value = None

            result = await reminder_service._send_reminder_for_appointment(mock_appointment)

            assert result == False
            mock_logger.warning.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_reminder_for_appointment_exception(self, reminder_service):
        """Test reminder sending with exception."""
        mock_appointment = MagicMock(spec=Appointment)

        with patch.object(reminder_service.db, 'query') as mock_query, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_query.side_effect = Exception("Database error")

            result = await reminder_service._send_reminder_for_appointment(mock_appointment)

            assert result == False
            mock_logger.error.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_immediate_reminder_success(self, reminder_service, db_session):
        """Test sending immediate reminder."""
        appointment_id = 123
        mock_appointment = MagicMock(spec=Appointment)

        with patch.object(db_session, 'query') as mock_query, \
             patch.object(reminder_service, '_send_reminder_for_appointment') as mock_send:

            mock_query.return_value.filter_by.return_value.first.return_value = mock_appointment
            mock_send.return_value = True

            result = await reminder_service.send_immediate_reminder(appointment_id)

            assert result == True
            mock_send.assert_called_once_with(mock_appointment)

    @pytest.mark.asyncio
    async def test_send_immediate_reminder_not_found(self, reminder_service, db_session):
        """Test sending immediate reminder for non-existent appointment."""
        appointment_id = 123

        with patch.object(db_session, 'query') as mock_query, \
             patch('services.reminder_service.logger') as mock_logger:

            mock_query.return_value.filter_by.return_value.first.return_value = None

            result = await reminder_service.send_immediate_reminder(appointment_id)

            assert result == False
            mock_logger.warning.assert_called_once_with(f"Appointment {appointment_id} not found")
