"""
Unit tests for datetime utilities.
"""

import pytest
from datetime import datetime, timezone, timedelta
from utils.datetime_utils import utc_now, ensure_utc, safe_datetime_diff, is_within_hours


class TestDatetimeUtils:
    """Test datetime utility functions."""
    
    def test_utc_now_returns_timezone_aware(self):
        """Test that utc_now returns timezone-aware datetime."""
        now = utc_now()
        assert now.tzinfo is not None
        assert now.tzinfo.utcoffset(None).total_seconds() == 0  # UTC offset is 0
    
    def test_ensure_utc_with_naive_datetime(self):
        """Test ensure_utc with naive datetime."""
        naive_dt = datetime(2023, 1, 1, 12, 0, 0)
        utc_dt = ensure_utc(naive_dt)
        
        assert utc_dt.tzinfo is not None
        assert utc_dt.tzinfo.utcoffset(None).total_seconds() == 0
        assert utc_dt.year == 2023
        assert utc_dt.month == 1
        assert utc_dt.day == 1
    
    def test_ensure_utc_with_timezone_aware_datetime(self):
        """Test ensure_utc with timezone-aware datetime."""
        # Create a timezone-aware datetime in a different timezone
        dt_with_tz = datetime(2023, 1, 1, 12, 0, 0, tzinfo=timezone(timedelta(hours=8)))
        utc_dt = ensure_utc(dt_with_tz)
        
        assert utc_dt.tzinfo is not None
        assert utc_dt.tzinfo.utcoffset(None).total_seconds() == 0  # Should be UTC
        # The time should be adjusted to UTC (8 hours earlier)
        assert utc_dt.hour == 4  # 12 - 8 = 4
    
    def test_ensure_utc_with_none(self):
        """Test ensure_utc with None input."""
        result = ensure_utc(None)
        assert result is None
    
    def test_safe_datetime_diff_with_naive_datetimes(self):
        """Test safe_datetime_diff with naive datetimes."""
        dt1 = datetime(2023, 1, 1, 12, 0, 0)
        dt2 = datetime(2023, 1, 1, 10, 0, 0)
        
        diff = safe_datetime_diff(dt1, dt2)
        assert diff == timedelta(hours=2)
    
    def test_safe_datetime_diff_with_mixed_timezones(self):
        """Test safe_datetime_diff with mixed timezone-aware and naive datetimes."""
        dt1 = datetime(2023, 1, 1, 12, 0, 0, tzinfo=timezone.utc)  # UTC
        dt2 = datetime(2023, 1, 1, 10, 0, 0)  # Naive (assumed UTC)
        
        diff = safe_datetime_diff(dt1, dt2)
        assert diff == timedelta(hours=2)
    
    def test_safe_datetime_diff_with_none_raises_error(self):
        """Test safe_datetime_diff raises error with None datetimes."""
        dt1 = datetime(2023, 1, 1, 12, 0, 0)
        
        with pytest.raises(ValueError, match="Cannot calculate difference with None datetimes"):
            safe_datetime_diff(dt1, None)
        
        with pytest.raises(ValueError, match="Cannot calculate difference with None datetimes"):
            safe_datetime_diff(None, dt1)
    
    def test_is_within_hours_true(self):
        """Test is_within_hours returns True when within hours."""
        dt1 = datetime(2023, 1, 1, 12, 0, 0)
        dt2 = datetime(2023, 1, 1, 10, 0, 0)
        
        assert is_within_hours(dt1, dt2, 3) is True
        assert is_within_hours(dt1, dt2, 2) is True
    
    def test_is_within_hours_false(self):
        """Test is_within_hours returns False when outside hours."""
        dt1 = datetime(2023, 1, 1, 12, 0, 0)
        dt2 = datetime(2023, 1, 1, 10, 0, 0)
        
        assert is_within_hours(dt1, dt2, 1) is False
    
    def test_is_within_hours_with_timezone_aware(self):
        """Test is_within_hours with timezone-aware datetimes."""
        dt1 = datetime(2023, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        dt2 = datetime(2023, 1, 1, 10, 0, 0)  # Naive
        
        assert is_within_hours(dt1, dt2, 3) is True
        assert is_within_hours(dt1, dt2, 1) is False
