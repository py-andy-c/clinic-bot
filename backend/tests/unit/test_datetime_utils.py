"""
Unit tests for datetime utilities.

Tests Taiwan timezone handling and datetime utility functions.
"""

import pytest
from datetime import datetime, timezone, timedelta

from utils.datetime_utils import taiwan_now, TAIWAN_TZ, ensure_taiwan


class TestTaiwanTimezone:
    """Test Taiwan timezone utilities."""

    def test_taiwan_now_returns_timezone_aware_datetime(self):
        """Test that taiwan_now returns timezone-aware datetime."""
        now = taiwan_now()
        
        assert now.tzinfo is not None
        assert now.tzinfo == TAIWAN_TZ
        
    def test_taiwan_tz_is_utc_plus_8(self):
        """Test that Taiwan timezone is UTC+8."""
        assert TAIWAN_TZ.utcoffset(None).total_seconds() == 8 * 3600
        
    def test_taiwan_now_uses_correct_offset(self):
        """Test that taiwan_now returns datetime with correct UTC offset."""
        taiwan_time = taiwan_now()
        
        # Verify the timezone offset is correct
        assert taiwan_time.tzinfo == TAIWAN_TZ
        assert taiwan_time.tzinfo.utcoffset(None).total_seconds() == 8 * 3600
        
        # Verify converting to UTC maintains correct offset
        taiwan_as_utc = taiwan_time.astimezone(timezone.utc)
        # Taiwan time should be 8 hours ahead of UTC
        # So when converted to UTC, the hour component should decrease by 8
        original_hour = taiwan_time.hour
        utc_hour = taiwan_as_utc.hour
        
        # Account for day rollover (hour can wrap around)
        hour_diff = (original_hour - utc_hour) % 24
        assert hour_diff == 8 or (hour_diff == 0 and original_hour < 8)


class TestEnsureTaiwan:
    """Test ensure_taiwan function."""

    def test_ensure_taiwan_with_naive_datetime(self):
        """Test ensure_taiwan with naive datetime."""
        naive_dt = datetime(2024, 1, 1, 10, 0, 0)
        
        result = ensure_taiwan(naive_dt)
        
        assert result.tzinfo == TAIWAN_TZ
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 1
        assert result.hour == 10
        assert result.minute == 0

    def test_ensure_taiwan_with_timezone_aware_datetime(self):
        """Test ensure_taiwan with timezone-aware datetime."""
        utc_dt = datetime(2024, 1, 1, 2, 0, 0, tzinfo=timezone.utc)
        
        result = ensure_taiwan(utc_dt)
        
        assert result.tzinfo == TAIWAN_TZ
        # UTC 02:00 should convert to Taiwan 10:00 (UTC+8)
        assert result.hour == 10

    def test_ensure_taiwan_with_none(self):
        """Test ensure_taiwan with None returns None."""
        result = ensure_taiwan(None)
        assert result is None

    def test_ensure_taiwan_converts_other_timezone(self):
        """Test ensure_taiwan converts from other timezone to Taiwan."""
        # Create datetime in EST (UTC-5)
        est_tz = timezone(timedelta(hours=-5))
        est_dt = datetime(2024, 1, 1, 12, 0, 0, tzinfo=est_tz)
        
        result = ensure_taiwan(est_dt)
        
        assert result.tzinfo == TAIWAN_TZ
        # EST 12:00 should convert to Taiwan 01:00 (next day) (12 + 5 + 8 = 25 mod 24 = 1)
        assert result.day == 2  # Next day
        assert result.hour == 1

