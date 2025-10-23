"""
Unit tests for Google Calendar service.
"""

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch, MagicMock

from services.google_calendar_service import GoogleCalendarService, GoogleCalendarError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.errors import HttpError


class TestGoogleCalendarService:
    """Test Google Calendar service functionality."""

    @pytest.fixture
    def mock_credentials(self):
        """Create mock Google OAuth2 credentials."""
        creds = Mock()
        creds.expired = False
        creds.refresh_token = None
        creds.valid = True
        return creds

    @pytest.fixture
    def calendar_service(self, mock_credentials):
        """Create a Google Calendar service instance for testing."""
        with patch('services.google_calendar_service.build', autospec=True) as mock_build, \
             patch('services.google_calendar_service.Credentials', autospec=True) as mock_creds_class:
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
        with patch('services.google_calendar_service.build', autospec=True) as mock_build, \
             patch('services.google_calendar_service.Credentials', autospec=True) as mock_creds_class:
            mock_service = Mock()
            mock_build.return_value = mock_service
            mock_creds = Mock()
            mock_creds.expired = False
            mock_creds.refresh_token = "test_refresh_token"
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
        error_response.content = json.dumps(error_content).encode('utf-8')

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
        with patch('services.google_calendar_service.build', autospec=True) as mock_build, \
             patch('services.google_calendar_service.Credentials', autospec=True) as mock_creds_class:

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
        with patch('services.google_calendar_service.build', autospec=True) as mock_build, \
             patch('services.google_calendar_service.Credentials', autospec=True) as mock_creds_class:

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

    @pytest.mark.asyncio
    async def test_create_event_with_naive_datetime_conversion(self, calendar_service):
        """Test event creation converts naive datetimes to UTC."""
        import datetime

        # Create naive datetimes (no timezone info)
        naive_start = datetime.datetime(2024, 1, 15, 10, 0, 0)
        naive_end = datetime.datetime(2024, 1, 15, 11, 0, 0)

        mock_event_result = {
            'id': 'test_event_id',
            'summary': 'Test Event',
            'start': {'dateTime': '2024-01-15T10:00:00Z'},
            'end': {'dateTime': '2024-01-15T11:00:00Z'}
        }

        calendar_service.service.events.return_value.insert.return_value.execute.return_value = mock_event_result

        result = await calendar_service.create_event(
            summary="Test Event",
            start=naive_start,
            end=naive_end,
            description="Test description"
        )

        assert result['id'] == 'test_event_id'

        # Verify the execute was called
        calendar_service.service.events.return_value.insert.return_value.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_event_with_extended_properties(self, calendar_service):
        """Test event creation with extended properties for sync."""
        mock_event_result = {
            'id': 'test_event_id',
            'summary': 'Test Event',
            'extendedProperties': {
                'private': {
                    'source': 'line_bot',
                    'patient_id': '123'
                }
            }
        }

        calendar_service.service.events.return_value.insert.return_value.execute.return_value = mock_event_result

        extended_props = {
            'private': {
                'source': 'line_bot',
                'patient_id': '123'
            }
        }

        result = await calendar_service.create_event(
            summary="Test Event",
            start=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
            end=datetime(2024, 1, 15, 11, 0, tzinfo=timezone.utc),
            extended_properties=extended_props
        )

        assert result['id'] == 'test_event_id'

        # Verify extended properties were included in the API call
        call_args = calendar_service.service.events.return_value.insert.call_args
        event_body = call_args[1]['body']
        assert 'extendedProperties' in event_body
        assert event_body['extendedProperties'] == extended_props

    @pytest.mark.asyncio
    async def test_create_event_with_location_and_color(self, calendar_service):
        """Test event creation with location and custom color."""
        mock_event_result = {'id': 'test_event_id'}

        calendar_service.service.events.return_value.insert.return_value.execute.return_value = mock_event_result

        result = await calendar_service.create_event(
            summary="Test Event",
            start=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
            end=datetime(2024, 1, 15, 11, 0, tzinfo=timezone.utc),
            location="Clinic Address",
            color_id="5"
        )

        assert result['id'] == 'test_event_id'

        # Verify location and color were set
        call_args = calendar_service.service.events.return_value.insert.call_args
        event_body = call_args[1]['body']
        assert event_body['location'] == "Clinic Address"
        assert event_body['colorId'] == "5"

    @pytest.mark.asyncio
    async def test_create_event_http_error_with_details(self, calendar_service):
        """Test event creation with HTTP error that includes error details."""
        from googleapiclient.errors import HttpError
        import json

        error_content = {
            'error': {
                'message': 'Invalid request'
            }
        }

        mock_response = Mock()
        mock_response.status = 400
        http_error = HttpError(mock_response, json.dumps(error_content).encode('utf-8'))

        calendar_service.service.events.return_value.insert.return_value.execute.side_effect = http_error

        with pytest.raises(GoogleCalendarError) as exc_info:
            await calendar_service.create_event(
                summary="Test Event",
                start=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
                end=datetime(2024, 1, 15, 11, 0, tzinfo=timezone.utc)
            )

        assert "Invalid request" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_event_http_error_without_content(self, calendar_service):
        """Test event creation with HTTP error that has no content."""
        from googleapiclient.errors import HttpError

        mock_response = Mock()
        mock_response.status = 500
        http_error = HttpError(mock_response, b'{"error": {"message": "Server error"}}')

        calendar_service.service.events.return_value.insert.return_value.execute.side_effect = http_error

        with pytest.raises(GoogleCalendarError) as exc_info:
            await calendar_service.create_event(
                summary="Test Event",
                start=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
                end=datetime(2024, 1, 15, 11, 0, tzinfo=timezone.utc)
            )

        assert "Failed to create calendar event" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_event_unexpected_error(self, calendar_service):
        """Test event creation with unexpected error."""
        calendar_service.service.events.return_value.insert.return_value.execute.side_effect = Exception("Network error")

        with pytest.raises(GoogleCalendarError) as exc_info:
            await calendar_service.create_event(
                summary="Test Event",
                start=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
                end=datetime(2024, 1, 15, 11, 0, tzinfo=timezone.utc)
            )

        assert "Unexpected error creating calendar event: Network error" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_update_event_partial_update(self, calendar_service):
        """Test event update with only some fields."""
        mock_event_result = {'id': 'test_event_id', 'summary': 'Updated Event'}

        # Mock the get_event call first
        calendar_service.service.events.return_value.get.return_value.execute.return_value = {
            'id': 'test_event_id',
            'summary': 'Original Event',
            'start': {'dateTime': '2024-01-15T10:00:00Z'},
            'end': {'dateTime': '2024-01-15T11:00:00Z'}
        }

        calendar_service.service.events.return_value.update.return_value.execute.return_value = mock_event_result

        result = await calendar_service.update_event(
            event_id="test_event_id",
            summary="Updated Event"
            # Only updating summary, not start/end
        )

        assert result['id'] == 'test_event_id'
        assert result['summary'] == 'Updated Event'

    @pytest.mark.asyncio
    async def test_update_event_full_update(self, calendar_service):
        """Test event update with all fields."""
        mock_event_result = {'id': 'test_event_id'}

        # Mock the get_event call first
        calendar_service.service.events.return_value.get.return_value.execute.return_value = {
            'id': 'test_event_id',
            'summary': 'Original Event',
            'start': {'dateTime': '2024-01-15T10:00:00Z'},
            'end': {'dateTime': '2024-01-15T11:00:00Z'}
        }

        calendar_service.service.events.return_value.update.return_value.execute.return_value = mock_event_result

        new_start = datetime(2024, 1, 15, 14, 0, tzinfo=timezone.utc)
        new_end = datetime(2024, 1, 15, 15, 0, tzinfo=timezone.utc)

        result = await calendar_service.update_event(
            event_id="test_event_id",
            summary="Updated Event",
            start=new_start,
            end=new_end
        )

        assert result['id'] == 'test_event_id'

        # Verify the update call was made with correct body
        update_call = calendar_service.service.events.return_value.update.call_args
        update_body = update_call[1]['body']
        assert update_body['summary'] == 'Updated Event'
        assert update_body['start']['dateTime'] == new_start.isoformat()
        assert update_body['end']['dateTime'] == new_end.isoformat()

    @pytest.mark.asyncio
    async def test_get_event_with_full_details(self, calendar_service):
        """Test getting event with all details."""
        mock_event = {
            'id': 'test_event_id',
            'summary': 'Test Event',
            'description': 'Test Description',
            'location': 'Test Location',
            'start': {'dateTime': '2024-01-15T10:00:00Z'},
            'end': {'dateTime': '2024-01-15T11:00:00Z'},
            'extendedProperties': {
                'private': {'source': 'line_bot'}
            }
        }

        calendar_service.service.events.return_value.get.return_value.execute.return_value = mock_event

        result = await calendar_service.get_event("test_event_id")

        assert result['id'] == 'test_event_id'
        assert result['summary'] == 'Test Event'
        assert result['description'] == 'Test Description'
        assert result['location'] == 'Test Location'

    @pytest.mark.asyncio
    async def test_delete_event_success_with_event_id(self, calendar_service):
        """Test successful event deletion with specific event ID."""
        calendar_service.service.events.return_value.delete.return_value.execute.return_value = None

        # Should not raise any exception
        await calendar_service.delete_event("specific_event_id")

        # Verify the delete call was made with correct event ID
        delete_call = calendar_service.service.events.return_value.delete.call_args
        assert delete_call[1]['eventId'] == 'specific_event_id'
        assert delete_call[1]['calendarId'] == 'test_calendar'

    @pytest.mark.asyncio
    async def test_init_with_custom_calendar_id(self):
        """Test service initialization with custom calendar ID."""
        with patch('services.google_calendar_service.build', autospec=True) as mock_build, \
             patch('services.google_calendar_service.Credentials', autospec=True) as mock_creds_class:
            mock_service = Mock()
            mock_build.return_value = mock_service
            mock_creds = Mock()
            mock_creds_class.from_authorized_user_info.return_value = mock_creds

            service = GoogleCalendarService(
                credentials_json='{"client_id": "test", "client_secret": "test", "refresh_token": "test"}',
                calendar_id='custom_calendar_id'
            )

            assert service.calendar_id == 'custom_calendar_id'

    @pytest.mark.asyncio
    async def test_init_with_default_calendar_id(self):
        """Test service initialization with default calendar ID."""
        with patch('services.google_calendar_service.build', autospec=True) as mock_build, \
             patch('services.google_calendar_service.Credentials', autospec=True) as mock_creds_class:
            mock_service = Mock()
            mock_build.return_value = mock_service
            mock_creds = Mock()
            mock_creds_class.from_authorized_user_info.return_value = mock_creds

            service = GoogleCalendarService(
                credentials_json='{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'
                # No calendar_id provided, should use default
            )

            assert service.calendar_id == 'primary'

