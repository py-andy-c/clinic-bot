# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportMissingTypeStubs=false
"""
Google Calendar service for appointment synchronization.

This module handles all Google Calendar API interactions for appointment management,
including creating, updating, and deleting calendar events to keep appointments
synchronized between the database and therapists' Google Calendars.
"""

import json
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


class GoogleCalendarError(Exception):
    """Custom exception for Google Calendar API errors."""
    pass


class GoogleCalendarService:
    """
    Service for Google Calendar API operations.

    This service handles all interactions with Google Calendar for appointment synchronization,
    including creating events, updating them, and managing the sync between database
    and calendar events.

    Attributes:
        credentials: Google OAuth2 credentials for API access
        calendar_id: Google Calendar ID (defaults to primary calendar)
        service: Google Calendar API service client
    """

    # Default calendar ID (primary calendar)
    DEFAULT_CALENDAR_ID = 'primary'

    def __init__(self, credentials_json: str, calendar_id: str = DEFAULT_CALENDAR_ID) -> None:
        """
        Initialize Google Calendar service.

        Args:
            credentials_json: JSON string containing Google OAuth2 credentials
            calendar_id: Google Calendar ID to operate on (defaults to primary)

        Raises:
            GoogleCalendarError: If credentials are invalid or service initialization fails
        """
        try:
            # Parse credentials from JSON string
            creds_data = json.loads(credentials_json)
            self.credentials = Credentials.from_authorized_user_info(creds_data)

            # Refresh token if expired
            if self.credentials.expired and self.credentials.refresh_token:
                self.credentials.refresh(Request())

            # Build Calendar API service
            self.service = build('calendar', 'v3', credentials=self.credentials)
            self.calendar_id = calendar_id

        except json.JSONDecodeError as e:
            raise GoogleCalendarError(f"Invalid credentials JSON: {e}")
        except Exception as e:
            raise GoogleCalendarError(f"Failed to initialize Google Calendar service: {e}")

    async def create_event(
        self,
        summary: str,
        start: datetime,
        end: datetime,
        description: str = "",
        location: str = "",
        color_id: str = "7",  # Default color for appointments
        extended_properties: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a new Google Calendar event.

        Args:
            summary: Event title/summary
            start: Event start datetime
            end: Event end datetime
            description: Event description
            location: Event location (optional)
            color_id: Calendar color ID (1-11)
            extended_properties: Additional metadata for sync

        Returns:
            Google Calendar event data including event ID

        Raises:
            GoogleCalendarError: If event creation fails
        """
        try:
            # Ensure datetimes are timezone-aware
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)

            event_body = {
                'summary': summary,
                'description': description,
                'location': location,
                'colorId': color_id,
                'start': {
                    'dateTime': start.isoformat(),
                    'timeZone': 'UTC',
                },
                'end': {
                    'dateTime': end.isoformat(),
                    'timeZone': 'UTC',
                },
            }

            # Add extended properties for synchronization
            if extended_properties:
                event_body['extendedProperties'] = extended_properties

            # Create the event
            event = self.service.events().insert(
                calendarId=self.calendar_id,
                body=event_body
            ).execute()

            return event

        except HttpError as e:
            error_details = json.loads(e.content) if e.content else {}
            raise GoogleCalendarError(f"Failed to create calendar event: {error_details.get('error', {}).get('message', str(e))}")
        except Exception as e:
            raise GoogleCalendarError(f"Unexpected error creating calendar event: {e}")

    async def update_event(
        self,
        event_id: str,
        summary: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        description: Optional[str] = None,
        extended_properties: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update an existing Google Calendar event.

        Args:
            event_id: Google Calendar event ID
            summary: New event title (optional)
            start: New start datetime (optional)
            end: New end datetime (optional)
            description: New description (optional)
            extended_properties: Updated extended properties (optional)

        Returns:
            Updated event data

        Raises:
            GoogleCalendarError: If event update fails
        """
        try:
            # Get current event
            event = self.service.events().get(
                calendarId=self.calendar_id,
                eventId=event_id
            ).execute()

            # Update fields if provided
            if summary is not None:
                event['summary'] = summary
            if description is not None:
                event['description'] = description

            if start is not None:
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                event['start'] = {
                    'dateTime': start.isoformat(),
                    'timeZone': 'UTC',
                }

            if end is not None:
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                event['end'] = {
                    'dateTime': end.isoformat(),
                    'timeZone': 'UTC',
                }

            # Update extended properties
            if extended_properties:
                event['extendedProperties'] = extended_properties

            # Update the event
            updated_event = self.service.events().update(
                calendarId=self.calendar_id,
                eventId=event_id,
                body=event
            ).execute()

            return updated_event

        except HttpError as e:
            error_details = json.loads(e.content) if e.content else {}
            if e.resp.status == 404:
                raise GoogleCalendarError(f"Event {event_id} not found")
            raise GoogleCalendarError(f"Failed to update calendar event: {error_details.get('error', {}).get('message', str(e))}")
        except Exception as e:
            raise GoogleCalendarError(f"Unexpected error updating calendar event: {e}")

    async def delete_event(self, event_id: str) -> None:
        """
        Delete a Google Calendar event.

        Args:
            event_id: Google Calendar event ID to delete

        Raises:
            GoogleCalendarError: If event deletion fails
        """
        try:
            self.service.events().delete(
                calendarId=self.calendar_id,
                eventId=event_id
            ).execute()

        except HttpError as e:
            error_details = json.loads(e.content) if e.content else {}
            if e.resp.status == 404:
                # Event already deleted, treat as success
                return
            raise GoogleCalendarError(f"Failed to delete calendar event: {error_details.get('error', {}).get('message', str(e))}")
        except Exception as e:
            raise GoogleCalendarError(f"Unexpected error deleting calendar event: {e}")

    async def get_event(self, event_id: str) -> Dict[str, Any]:
        """
        Get details of a Google Calendar event.

        Args:
            event_id: Google Calendar event ID

        Returns:
            Event data from Google Calendar

        Raises:
            GoogleCalendarError: If event retrieval fails
        """
        try:
            event = self.service.events().get(
                calendarId=self.calendar_id,
                eventId=event_id
            ).execute()

            return event

        except HttpError as e:
            error_details = json.loads(e.content) if e.content else {}
            if e.resp.status == 404:
                raise GoogleCalendarError(f"Event {event_id} not found")
            raise GoogleCalendarError(f"Failed to get calendar event: {error_details.get('error', {}).get('message', str(e))}")
        except Exception as e:
            raise GoogleCalendarError(f"Unexpected error getting calendar event: {e}")
