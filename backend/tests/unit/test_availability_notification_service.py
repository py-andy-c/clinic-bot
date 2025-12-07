"""
Unit tests for availability notification service.

Tests the core logic of the notification service including:
- Time window filtering
- Message formatting
- URL generation
- Deduplication logic
"""

import pytest
from datetime import date, datetime
from unittest.mock import Mock, AsyncMock, patch

from services.availability_notification_service import (
    AvailabilityNotificationService,
    TimeWindowEntry,
    AvailabilityCacheKey,
    NotificationProcessingResult,
)
from shared_types.availability import SlotData
from models.availability_notification import AvailabilityNotification
from models.clinic import Clinic
from models.appointment_type import AppointmentType


class TestTimeWindowFiltering:
    """Test time window filtering logic."""

    def test_filter_morning_slots(self):
        """Test filtering slots for morning time window."""
        service = AvailabilityNotificationService()
        slots = [
            SlotData("08:00", "09:00", 1, "Dr. A"),
            SlotData("09:30", "10:30", 1, "Dr. A"),
            SlotData("11:00", "12:00", 1, "Dr. A"),
            SlotData("12:00", "13:00", 1, "Dr. A"),  # Boundary: should not include
            SlotData("14:00", "15:00", 1, "Dr. A"),  # Afternoon: should not include
        ]

        filtered = service._filter_slots_by_time_window(slots, "morning")

        assert len(filtered) == 3
        assert all(slot.start_time in ["08:00", "09:30", "11:00"] for slot in filtered)

    def test_filter_afternoon_slots(self):
        """Test filtering slots for afternoon time window."""
        service = AvailabilityNotificationService()
        slots = [
            SlotData("11:00", "12:00", 1, "Dr. A"),  # Before: should not include
            SlotData("12:00", "13:00", 1, "Dr. A"),  # Boundary: should include
            SlotData("14:00", "15:00", 1, "Dr. A"),
            SlotData("17:00", "18:00", 1, "Dr. A"),
            SlotData("18:00", "19:00", 1, "Dr. A"),  # Boundary: should not include
        ]

        filtered = service._filter_slots_by_time_window(slots, "afternoon")

        assert len(filtered) == 3
        assert all(slot.start_time in ["12:00", "14:00", "17:00"] for slot in filtered)

    def test_filter_evening_slots(self):
        """Test filtering slots for evening time window."""
        service = AvailabilityNotificationService()
        slots = [
            SlotData("17:00", "18:00", 1, "Dr. A"),  # Before: should not include
            SlotData("18:00", "19:00", 1, "Dr. A"),  # Boundary: should include
            SlotData("20:00", "21:00", 1, "Dr. A"),
            SlotData("21:30", "22:00", 1, "Dr. A"),
            SlotData("22:00", "23:00", 1, "Dr. A"),  # Boundary: should not include
        ]

        filtered = service._filter_slots_by_time_window(slots, "evening")

        assert len(filtered) == 3
        assert all(slot.start_time in ["18:00", "20:00", "21:30"] for slot in filtered)


class TestMessageFormatting:
    """Test notification message formatting."""

    def test_format_date_for_display(self):
        """Test date formatting."""
        service = AvailabilityNotificationService()

        # Monday
        date_obj = date(2024, 1, 15)  # Monday
        formatted = service._format_date_for_display(date_obj)
        assert formatted == "01/15 (一)"

        # Sunday
        date_obj = date(2024, 1, 14)  # Sunday
        formatted = service._format_date_for_display(date_obj)
        assert formatted == "01/14 (日)"

    def test_format_slots(self):
        """Test slot time formatting."""
        service = AvailabilityNotificationService()

        slots = ["09:00", "10:30", "14:00", "18:30"]
        formatted = service._format_slots(slots)

        assert formatted == "9:00 AM, 10:30 AM, 2:00 PM, 6:30 PM"

    def test_format_notification_message(self, monkeypatch):
        """Test full notification message formatting."""
        service = AvailabilityNotificationService()

        # Create mock notification
        notification = Mock(spec=AvailabilityNotification)
        notification.id = 1
        notification.appointment_type = Mock()
        notification.appointment_type.name = "物理治療"
        notification.practitioner = None  # "不指定"
        notification.appointment_type_id = 1
        notification.practitioner_id = None
        notification.clinic_id = 1

        # Create mock clinic
        clinic = Mock(spec=Clinic)
        clinic.id = 1

        # Create mock db
        db = Mock()
        db.query.return_value.filter.return_value.first.return_value = None

        # Mock LIFF_ID to match test expectation
        monkeypatch.setattr("core.config.LIFF_ID", "1234567890")
        import services.availability_notification_service
        services.availability_notification_service.LIFF_ID = "1234567890"

        slots_by_date = {
            "2024-01-15": ["09:00", "10:00", "14:00"],
            "2024-01-16": ["09:00", "11:00"],
        }

        message = service._format_notification_message(notification, slots_by_date, clinic, db)

        assert "【空位提醒】" in message
        assert "預約類型：物理治療" in message
        assert "治療師：不指定" in message
        assert "01/15 (一)" in message
        assert "01/16 (二)" in message
        assert "9:00 AM" in message
        # URL is no longer in message text (it's in a button)
        assert "https://liff.line.me" not in message
        assert "立即預約" not in message

    def test_format_notification_message_with_practitioner(self):
        """Test message formatting with specific practitioner."""
        service = AvailabilityNotificationService()

        notification = Mock(spec=AvailabilityNotification)
        notification.id = 1
        notification.appointment_type = Mock()
        notification.appointment_type.name = "物理治療"
        notification.practitioner = Mock()
        notification.practitioner.id = 2
        notification.practitioner.email = "practitioner@test.com"
        notification.appointment_type_id = 1
        notification.practitioner_id = 2
        notification.clinic_id = 1

        # Create mock association
        association = Mock()
        association.full_name = "王醫師"

        clinic = Mock(spec=Clinic)
        clinic.id = 1
        clinic.liff_id = "1234567890"

        # Create mock db
        db = Mock()
        db.query.return_value.filter.return_value.first.return_value = association

        slots_by_date = {"2024-01-15": ["09:00"]}

        message = service._format_notification_message(notification, slots_by_date, clinic, db)

        assert "治療師：王醫師" in message
        # URL is no longer in message text (it's in a button)
        assert "https://liff.line.me" not in message
        assert "立即預約" not in message


class TestURLGeneration:
    """Test LIFF URL generation."""

    def test_generate_liff_url_without_practitioner(self, monkeypatch):
        """Test URL generation without practitioner."""
        service = AvailabilityNotificationService()

        notification = Mock(spec=AvailabilityNotification)
        notification.appointment_type_id = 1
        notification.practitioner_id = None
        notification.clinic_id = 2

        clinic = Mock(spec=Clinic)
        clinic.id = 1
        clinic.liff_id = None  # Shared LIFF app
        clinic.liff_access_token = "test_token_12345"  # Mock token

        # Mock LIFF_ID in both modules
        monkeypatch.setattr("core.config.LIFF_ID", "1234567890")
        monkeypatch.setattr("utils.liff_token.LIFF_ID", "1234567890")

        url = service._generate_liff_url(notification, clinic)

        assert "https://liff.line.me/1234567890" in url
        assert "mode=book" in url
        assert "clinic_token=test_token_12345" in url
        assert "clinic_id" not in url  # Should use token, not id
        assert "appointment_type_id" not in url
        assert "practitioner_id" not in url

    def test_generate_liff_url_with_practitioner(self, monkeypatch):
        """Test URL generation with practitioner."""
        service = AvailabilityNotificationService()

        notification = Mock(spec=AvailabilityNotification)
        notification.appointment_type_id = 1
        notification.practitioner_id = 2
        notification.clinic_id = 3

        clinic = Mock(spec=Clinic)
        clinic.id = 1
        clinic.liff_id = None  # Shared LIFF app
        clinic.liff_access_token = "test_token_67890"  # Mock token

        # Mock LIFF_ID in both modules
        monkeypatch.setattr("core.config.LIFF_ID", "1234567890")
        monkeypatch.setattr("utils.liff_token.LIFF_ID", "1234567890")

        url = service._generate_liff_url(notification, clinic)

        assert "https://liff.line.me/1234567890" in url
        assert "mode=book" in url
        assert "clinic_token=test_token_67890" in url
        assert "clinic_id" not in url  # Should use token, not id
        assert "appointment_type_id" not in url
        assert "practitioner_id" not in url

    def test_generate_liff_url_missing_token_raises_error(self, monkeypatch):
        """Test URL generation raises error when clinic_token is missing for shared LIFF."""
        from utils.liff_token import generate_liff_url

        clinic = Mock(spec=Clinic)
        clinic.id = 1
        clinic.liff_id = None  # No liff_id - uses shared LIFF
        clinic.liff_access_token = None  # No token - should raise error

        # Mock LIFF_ID as empty string in both modules
        monkeypatch.setattr("core.config.LIFF_ID", "")
        monkeypatch.setattr("utils.liff_token.LIFF_ID", "")

        # Should raise ValueError when token is missing (for shared LIFF)
        with pytest.raises(ValueError, match="missing liff_access_token"):
            generate_liff_url(clinic, mode="book")

    def test_generate_liff_url_with_liff_id(self, monkeypatch):
        """Test URL generation for clinic-specific LIFF app (uses liff_id)."""
        from utils.liff_token import generate_liff_url

        clinic = Mock(spec=Clinic)
        clinic.id = 1
        clinic.liff_id = "1234567890-abcdefgh"  # Clinic-specific LIFF
        clinic.liff_access_token = None  # Not needed for clinic-specific LIFF

        url = generate_liff_url(clinic, mode="book")

        assert "https://liff.line.me/1234567890-abcdefgh" in url
        assert "mode=book" in url
        assert "clinic_token" not in url  # Should not have clinic_token
        assert "clinic_id" not in url

    def test_generate_liff_url_prefers_liff_id_over_token(self, monkeypatch):
        """Test that liff_id takes priority over clinic_token when both are present."""
        from utils.liff_token import generate_liff_url

        clinic = Mock(spec=Clinic)
        clinic.id = 1
        clinic.liff_id = "1234567890-xyzabc"  # Clinic-specific LIFF
        clinic.liff_access_token = "test_token_12345"  # Has token but should use liff_id

        url = generate_liff_url(clinic, mode="book")

        assert "https://liff.line.me/1234567890-xyzabc" in url
        assert "mode=book" in url
        assert "clinic_token" not in url  # Should not have clinic_token when liff_id is present


class TestDeduplication:
    """Test deduplication logic."""

    def test_has_future_dates(self):
        """Test checking if notification has future dates."""
        service = AvailabilityNotificationService()

        today = date(2024, 1, 15)

        notification = Mock(spec=AvailabilityNotification)
        notification.time_windows = [
            {"date": "2024-01-14", "time_window": "morning"},  # Past
            {"date": "2024-01-15", "time_window": "afternoon"},  # Today
            {"date": "2024-01-16", "time_window": "evening"},  # Future
        ]

        assert service._has_future_dates(notification, today) is True

    def test_has_future_dates_all_past(self):
        """Test when all dates are in the past."""
        service = AvailabilityNotificationService()

        today = date(2024, 1, 15)

        notification = Mock(spec=AvailabilityNotification)
        notification.time_windows = [
            {"date": "2024-01-13", "time_window": "morning"},
            {"date": "2024-01-14", "time_window": "afternoon"},
        ]

        assert service._has_future_dates(notification, today) is False

    def test_has_future_dates_today_included(self):
        """Test when today is included (should count as future)."""
        service = AvailabilityNotificationService()

        today = date(2024, 1, 15)

        notification = Mock(spec=AvailabilityNotification)
        notification.time_windows = [
            {"date": "2024-01-15", "time_window": "morning"},  # Today
        ]

        assert service._has_future_dates(notification, today) is True


class TestAvailabilityCacheKey:
    """Test availability cache key."""

    def test_cache_key_hashable(self):
        """Test that cache key is hashable."""
        key1 = AvailabilityCacheKey(1, 2, 3, "2024-01-15")
        key2 = AvailabilityCacheKey(1, 2, 3, "2024-01-15")
        key3 = AvailabilityCacheKey(1, 2, None, "2024-01-15")

        assert hash(key1) == hash(key2)
        assert hash(key1) != hash(key3)

        # Can use as dict key
        cache = {key1: [SlotData("09:00", "10:00", 1, "Dr. A")]}
        assert key2 in cache
        assert key3 not in cache

