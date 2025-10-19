"""
Unit tests for Google Calendar webhook functionality.
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock, MagicMock
from sqlalchemy.orm import Session

from api.webhooks import _handle_calendar_changes, _send_cancellation_notification
from models.appointment import Appointment
from models.therapist import Therapist
from models.patient import Patient
from models.line_user import LineUser
from models.clinic import Clinic


class TestGoogleCalendarWebhook:
    """Test cases for Google Calendar webhook functionality."""

    @pytest.fixture
    def db_session(self):
        """Mock database session."""
        return MagicMock(spec=Session)

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_no_therapist(self, db_session):
        """Test handling calendar changes when therapist not found."""
        resource_id = "test_resource_id"

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.logger') as mock_logger:

            mock_query.return_value.filter_by.return_value.first.return_value = None

            await _handle_calendar_changes(db_session, resource_id)

            mock_logger.warning.assert_called_once_with(f"No therapist found for resource ID: {resource_id}")

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_no_credentials(self, db_session):
        """Test handling calendar changes when therapist has no credentials."""
        resource_id = "test_resource_id"
        mock_therapist = MagicMock(spec=Therapist)
        mock_therapist.gcal_credentials = None

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.logger') as mock_logger:

            mock_query.return_value.filter_by.return_value.first.return_value = mock_therapist

            await _handle_calendar_changes(db_session, resource_id)

            mock_logger.warning.assert_called_once_with(f"Therapist {mock_therapist.id} has no Google Calendar credentials")

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_gcal_service_error(self, db_session):
        """Test handling calendar changes when Google Calendar service fails to initialize."""
        resource_id = "test_resource_id"
        mock_therapist = MagicMock(spec=Therapist)
        mock_therapist.gcal_credentials = '{"credentials": "test"}'

        from services.google_calendar_service import GoogleCalendarError

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.GoogleCalendarService') as mock_gcal_class, \
             patch('api.webhooks.logger') as mock_logger:

            mock_query.return_value.filter_by.return_value.first.return_value = mock_therapist
            mock_gcal_class.side_effect = GoogleCalendarError("GCal init failed")

            await _handle_calendar_changes(db_session, resource_id)

            mock_logger.error.assert_called_once_with(f"Failed to initialize Google Calendar service for therapist {mock_therapist.id}: GCal init failed")

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_no_appointments(self, db_session):
        """Test handling calendar changes when therapist has no appointments."""
        resource_id = "test_resource_id"
        mock_therapist = MagicMock(spec=Therapist)
        mock_therapist.id = 1
        mock_therapist.name = "Dr. Smith"
        mock_therapist.gcal_credentials = '{"credentials": "test"}'
        mock_gcal_service = MagicMock()

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.GoogleCalendarService') as mock_gcal_class, \
             patch('api.webhooks.logger') as mock_logger:

            # Setup therapist query
            therapist_query = MagicMock()
            therapist_query.filter_by.return_value.first.return_value = mock_therapist
            mock_query.return_value = therapist_query

            # Setup appointments query
            appointments_query = MagicMock()
            appointments_query.filter.return_value.all.return_value = []
            mock_query.side_effect = [therapist_query, appointments_query]

            mock_gcal_class.return_value = mock_gcal_service

            await _handle_calendar_changes(db_session, resource_id)

            mock_logger.info.assert_any_call(f"No appointments with Google Calendar events found for therapist {mock_therapist.id}")

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_no_deleted_appointments(self, db_session):
        """Test handling calendar changes when no appointments were deleted."""
        resource_id = "test_resource_id"
        mock_therapist = MagicMock(spec=Therapist)
        mock_therapist.id = 1
        mock_therapist.name = "Dr. Smith"
        mock_therapist.gcal_credentials = '{"credentials": "test"}'

        mock_appointment = MagicMock(spec=Appointment)
        mock_appointment.gcal_event_id = "event_123"

        mock_gcal_service = MagicMock()
        # Mock events list to include the appointment's event
        mock_events_result = {'items': [{'id': 'event_123'}]}

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.GoogleCalendarService') as mock_gcal_class, \
             patch('api.webhooks.logger') as mock_logger:

            # Setup queries
            therapist_query = MagicMock()
            therapist_query.filter_by.return_value.first.return_value = mock_therapist

            appointments_query = MagicMock()
            appointments_query.filter.return_value.all.return_value = [mock_appointment]

            mock_query.side_effect = [therapist_query, appointments_query]

            mock_gcal_service.service.events.return_value.list.return_value.execute.return_value = mock_events_result
            mock_gcal_class.return_value = mock_gcal_service

            await _handle_calendar_changes(db_session, resource_id)

            mock_logger.info.assert_any_call(f"No deleted appointments found for therapist {mock_therapist.id}")

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_with_deleted_appointments(self, db_session):
        """Test handling calendar changes with deleted appointments."""
        resource_id = "test_resource_id"
        mock_therapist = MagicMock(spec=Therapist)
        mock_therapist.id = 1
        mock_therapist.name = "Dr. Smith"
        mock_therapist.gcal_credentials = '{"credentials": "test"}'

        mock_appointment = MagicMock(spec=Appointment)
        mock_appointment.id = 100
        mock_appointment.gcal_event_id = "event_123"

        mock_gcal_service = MagicMock()
        # Mock events list to NOT include the appointment's event (deleted)
        mock_events_result = {'items': [{'id': 'event_456'}]}

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.GoogleCalendarService') as mock_gcal_class, \
             patch('api.webhooks._send_cancellation_notification') as mock_send_notification, \
             patch('api.webhooks.logger') as mock_logger:

            # Setup queries
            therapist_query = MagicMock()
            therapist_query.filter_by.return_value.first.return_value = mock_therapist

            appointments_query = MagicMock()
            appointments_query.filter.return_value.all.return_value = [mock_appointment]

            mock_query.side_effect = [therapist_query, appointments_query]

            mock_gcal_service.service.events.return_value.list.return_value.execute.return_value = mock_events_result
            mock_gcal_class.return_value = mock_gcal_service

            await _handle_calendar_changes(db_session, resource_id)

            # Check that appointment status was updated
            mock_appointment.status = "canceled_by_clinic"
            db_session.commit.assert_called_once()

            # Check that notification was sent
            mock_send_notification.assert_called_once_with(db_session, mock_appointment)

            mock_logger.info.assert_any_call(f"Appointment {mock_appointment.id} was cancelled by therapist via Google Calendar")

    @pytest.mark.asyncio
    async def test_handle_calendar_changes_gcal_api_error(self, db_session):
        """Test handling calendar changes when Google Calendar API fails."""
        resource_id = "test_resource_id"
        mock_therapist = MagicMock(spec=Therapist)
        mock_therapist.id = 1
        mock_therapist.gcal_credentials = '{"credentials": "test"}'

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.GoogleCalendarService') as mock_gcal_class, \
             patch('api.webhooks.logger') as mock_logger:

            therapist_query = MagicMock()
            therapist_query.filter_by.return_value.first.return_value = mock_therapist
            mock_query.return_value = therapist_query

            mock_gcal_service = MagicMock()
            mock_gcal_service.service.events.return_value.list.return_value.execute.side_effect = Exception("GCal API error")
            mock_gcal_class.return_value = mock_gcal_service

            await _handle_calendar_changes(db_session, resource_id)

            mock_logger.error.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_cancellation_notification_success(self, db_session):
        """Test successful cancellation notification sending."""
        mock_appointment = MagicMock(spec=Appointment)
        mock_patient = MagicMock(spec=Patient)
        mock_clinic = MagicMock(spec=Clinic)
        mock_therapist = MagicMock(spec=Therapist)
        mock_line_user = MagicMock(spec=LineUser)

        mock_appointment.patient = mock_patient
        mock_patient.clinic = mock_clinic
        mock_appointment.therapist = mock_therapist
        mock_therapist.name = "Dr. Smith"
        mock_appointment.start_time = datetime(2024, 1, 15, 14, 30, tzinfo=timezone.utc)

        with patch('api.webhooks.LINEService') as mock_line_service_class, \
             patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.logger') as mock_logger:

            mock_line_service = MagicMock()
            mock_line_service_class.return_value = mock_line_service
            mock_query.return_value.filter_by.return_value.first.return_value = mock_line_user

            await _send_cancellation_notification(db_session, mock_appointment)

            mock_line_service.send_text_message.assert_called_once()
            mock_logger.info.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_cancellation_notification_no_line_user(self, db_session):
        """Test cancellation notification when no LINE user found."""
        mock_appointment = MagicMock(spec=Appointment)
        mock_patient = MagicMock(spec=Patient)
        mock_appointment.patient = mock_patient

        with patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.logger') as mock_logger:

            mock_query.return_value.filter_by.return_value.first.return_value = None

            await _send_cancellation_notification(db_session, mock_appointment)

            mock_logger.warning.assert_called_once()
            # Should not raise exception

    @pytest.mark.asyncio
    async def test_send_cancellation_notification_line_error(self, db_session):
        """Test cancellation notification with LINE service error."""
        mock_appointment = MagicMock(spec=Appointment)
        mock_patient = MagicMock(spec=Patient)
        mock_clinic = MagicMock(spec=Clinic)
        mock_line_user = MagicMock(spec=LineUser)

        mock_appointment.patient = mock_patient
        mock_patient.clinic = mock_clinic

        with patch('api.webhooks.LINEService') as mock_line_service_class, \
             patch.object(db_session, 'query') as mock_query, \
             patch('api.webhooks.logger') as mock_logger:

            mock_line_service = MagicMock()
            mock_line_service.send_text_message.side_effect = Exception("LINE API error")
            mock_line_service_class.return_value = mock_line_service
            mock_query.return_value.filter_by.return_value.first.return_value = mock_line_user

            await _send_cancellation_notification(db_session, mock_appointment)

            mock_logger.error.assert_called_once()
            # Should not raise exception
