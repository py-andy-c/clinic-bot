"""
Unit tests for Google Calendar service.
"""

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch, MagicMock

from src.services.google_calendar_service import GoogleCalendarService, GoogleCalendarError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.errors import HttpError


class TestGoogleCalendarService:
    """Test Google Calendar service functionality."""

    @pytest.fixture
    def mock_credentials(self):
        """Create mock Google OAuth2 credentials."""
        creds = Mock(spec=Credentials)
        creds.expired = False
        creds.refresh_token = None
        return creds

    @pytest.fixture
    def calendar_service(self, mock_credentials):
        """Create a Google Calendar service instance for testing."""
        with patch('src.services.google_calendar_service.build') as mock_build, \
             patch('src.services.google_calendar_service.Credentials') as mock_creds_class:
            mock_service = Mock()
            mock_build.return_value = mock_service
            mock_creds_class.from_authorized_user_info.return_value = mock_credentials

            service = GoogleCalendarService(
                credentials_json='{"client_id": "test", "client_secret": "test", "refresh_token": "test"}',
                calendar_id='test_calendar'
            )

            return service

    def test_init_valid_credentials(self):
        """Test service initialization with valid credentials."""
        with patch('src.services.google_calendar_service.build') as mock_build, \
             patch('src.services.google_calendar_service.Credentials') as mock_creds_class:
            mock_service = Mock()
            mock_build.return_value = mock_service
            mock_creds = Mock()
            mock_creds_class.from_authorized_user_info.return_value = mock_creds

            service = GoogleCalendarService('{"client_id": "test", "client_secret": "test", "refresh_token": "test"}', 'primary')

            assert service.calendar_id == 'primary'
            assert service.service == mock_service

    def test_init_invalid_json_credentials(self):
        """Test service initialization with invalid JSON credentials."""
        with pytest.raises(GoogleCalendarError, match="Invalid credentials JSON"):
            GoogleCalendarService('invalid json', 'primary')

    def test_init_missing_credentials(self):
        """Test service initialization with missing credentials."""
        with pytest.raises(GoogleCalendarError):
            GoogleCalendarService('', 'primary')

    @pytest.mark.asyncio
    async def test_create_event_success(self, calendar_service):
        """Test successful event creation."""
        # Mock the service response
        mock_event = {
            'id': 'event123',
            'summary': 'Test Event',
            'status': 'confirmed'
        }
        calendar_service.service.events.return_value.insert.return_value.execute.return_value = mock_event

        start_time = datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc)
        end_time = datetime(2024, 1, 1, 11, 0, tzinfo=timezone.utc)

        result = await calendar_service.create_event(
            summary="Test Event",
            start=start_time,
            end=end_time,
            description="Test description",
            location="Test Location",
            color_id="7"
        )

        assert result == mock_event

        # Verify the API call
        calendar_service.service.events.return_value.insert.assert_called_once()
        call_args = calendar_service.service.events.return_value.insert.call_args
        event_body = call_args[1]['body']

        assert event_body['summary'] == "Test Event"
        assert event_body['description'] == "Test description"
        assert event_body['location'] == "Test Location"
        assert event_body['colorId'] == "7"

    @pytest.mark.asyncio
    async def test_create_event_with_timezone_conversion(self, calendar_service):
        """Test event creation with timezone conversion for naive datetimes."""
        mock_event = {'id': 'event123'}
        calendar_service.service.events.return_value.insert.return_value.execute.return_value = mock_event

        # Naive datetime (no timezone)
        start_time = datetime(2024, 1, 1, 10, 0)
        end_time = datetime(2024, 1, 1, 11, 0)

        await calendar_service.create_event(
            summary="Test Event",
            start=start_time,
            end=end_time
        )

        # Verify timezone was added
        call_args = calendar_service.service.events.return_value.insert.call_args
        event_body = call_args[1]['body']

        # Should have UTC timezone (either +00:00 or Z format)
        assert '+00:00' in event_body['start']['dateTime'] or 'Z' in event_body['start']['dateTime']
        assert '+00:00' in event_body['end']['dateTime'] or 'Z' in event_body['end']['dateTime']

    @pytest.mark.asyncio
    async def test_create_event_api_error(self, calendar_service):
        """Test event creation with API error."""
        # Mock HTTP error
        error_response = Mock()
        error_response.status = 400
        error_content = {'error': {'message': 'Invalid request'}}
        error_response.content = json.dumps(error_content)

        calendar_service.service.events.return_value.insert.return_value.execute.side_effect = HttpError(
            error_response, json.dumps(error_content).encode()
        )

        start_time = datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc)
        end_time = datetime(2024, 1, 1, 11, 0, tzinfo=timezone.utc)

        with pytest.raises(GoogleCalendarError, match="Failed to create calendar event"):
            await calendar_service.create_event(
                summary="Test Event",
                start=start_time,
                end=end_time
            )

    @pytest.mark.asyncio
    async def test_update_event_success(self, calendar_service):
        """Test successful event update."""
        # Mock get and update responses
        current_event = {
            'id': 'event123',
            'summary': 'Old Summary',
            'description': 'Old Description'
        }
        updated_event = {
            'id': 'event123',
            'summary': 'New Summary',
            'description': 'New Description'
        }

        calendar_service.service.events.return_value.get.return_value.execute.return_value = current_event
        calendar_service.service.events.return_value.update.return_value.execute.return_value = updated_event

        result = await calendar_service.update_event(
            event_id='event123',
            summary='New Summary',
            description='New Description'
        )

        assert result == updated_event

    @pytest.mark.asyncio
    async def test_update_event_not_found(self, calendar_service):
        """Test event update when event doesn't exist."""
        error_response = Mock()
        error_response.status = 404

        calendar_service.service.events.return_value.get.return_value.execute.side_effect = HttpError(
            error_response, b'{"error": {"message": "Not found"}}'
        )

        with pytest.raises(GoogleCalendarError, match="Event event123 not found"):
            await calendar_service.update_event('event123', summary='New Summary')

    @pytest.mark.asyncio
    async def test_delete_event_success(self, calendar_service):
        """Test successful event deletion."""
        calendar_service.service.events.return_value.delete.return_value.execute.return_value = None

        # Should not raise any exception
        await calendar_service.delete_event('event123')

        calendar_service.service.events.return_value.delete.assert_called_once_with(
            calendarId='test_calendar',
            eventId='event123'
        )

    @pytest.mark.asyncio
    async def test_delete_event_not_found(self, calendar_service):
        """Test event deletion when event doesn't exist (should succeed)."""
        error_response = Mock()
        error_response.status = 404

        calendar_service.service.events.return_value.delete.return_value.execute.side_effect = HttpError(
            error_response, b'{"error": {"message": "Not found"}}'
        )

        # Should not raise exception for 404 on delete
        await calendar_service.delete_event('event123')

    @pytest.mark.asyncio
    async def test_get_event_success(self, calendar_service):
        """Test successful event retrieval."""
        mock_event = {
            'id': 'event123',
            'summary': 'Test Event',
            'status': 'confirmed'
        }

        calendar_service.service.events.return_value.get.return_value.execute.return_value = mock_event

        result = await calendar_service.get_event('event123')
        assert result == mock_event

    @pytest.mark.asyncio
    async def test_get_event_not_found(self, calendar_service):
        """Test event retrieval when event doesn't exist."""
        error_response = Mock()
        error_response.status = 404

        calendar_service.service.events.return_value.get.return_value.execute.side_effect = HttpError(
            error_response, b'{"error": {"message": "Not found"}}'
        )

        with pytest.raises(GoogleCalendarError, match="Event event123 not found"):
            await calendar_service.get_event('event123')

    def test_expired_credentials_refresh(self):
        """Test credential refresh for expired tokens."""
        with patch('src.services.google_calendar_service.build') as mock_build, \
             patch('src.services.google_calendar_service.Credentials') as mock_creds_class:

            # Mock expired credentials with refresh token
            mock_creds = Mock()
            mock_creds.expired = True
            mock_creds.refresh_token = "refresh_token_123"
            mock_creds_class.from_authorized_user_info.return_value = mock_creds

            mock_service = Mock()
            mock_build.return_value = mock_service

            service = GoogleCalendarService('{"credentials": "data"}')

            # Verify refresh was called
            mock_creds.refresh.assert_called_once()

    def test_expired_credentials_no_refresh_token(self):
        """Test handling of expired credentials without refresh token."""
        with patch('src.services.google_calendar_service.build') as mock_build, \
             patch('src.services.google_calendar_service.Credentials') as mock_creds_class:

            # Mock expired credentials without refresh token
            mock_creds = Mock()
            mock_creds.expired = True
            mock_creds.refresh_token = None
            mock_creds_class.from_authorized_user_info.return_value = mock_creds

            mock_service = Mock()
            mock_build.return_value = mock_service

            # Should still work (credentials used as-is)
            service = GoogleCalendarService('{"credentials": "data"}')

            # Verify refresh was not called
            mock_creds.refresh.assert_not_called()

