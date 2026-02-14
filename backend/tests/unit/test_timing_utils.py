"""
Unit tests for timing calculation utilities.

Tests the shared timing calculation logic used by both follow-up messages
and patient form automation.
"""

import pytest
from datetime import datetime, timedelta, time as time_type

from utils.timing_utils import calculate_scheduled_time, calculate_follow_up_scheduled_time
from utils.datetime_utils import ensure_taiwan, TAIWAN_TZ


class TestTimingUtils:
    """Test cases for timing calculation utilities."""

    # Tests for 'after' timing type

    def test_calculate_scheduled_time_hours_after(self):
        """Test calculating scheduled time for hours after reference time."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='after',
            timing_mode='hours',
            hours=2
        )
        
        expected = reference_time + timedelta(hours=2)
        assert scheduled_time == expected

    def test_calculate_scheduled_time_specific_time_after(self):
        """Test calculating scheduled time for specific time on days after."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='after',
            timing_mode='specific_time',
            days=1,
            time_of_day=time_type(21, 0)
        )
        
        expected_date = reference_time.date() + timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(21, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    def test_calculate_scheduled_time_specific_time_after_auto_adjust(self):
        """Test auto-adjustment when time is in past for 'after' timing."""
        reference_time = datetime(2024, 1, 15, 22, 0, tzinfo=TAIWAN_TZ)  # 10pm
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='after',
            timing_mode='specific_time',
            days=0,  # Same day
            time_of_day=time_type(21, 0)  # 9pm (before 10pm)
        )
        
        # Should auto-adjust to next day at 9pm
        expected_date = reference_time.date() + timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(21, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    # Tests for 'before' timing type

    def test_calculate_scheduled_time_hours_before(self):
        """Test calculating scheduled time for hours before reference time."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='before',
            timing_mode='hours',
            hours=2
        )
        
        expected = reference_time - timedelta(hours=2)
        assert scheduled_time == expected

    def test_calculate_scheduled_time_specific_time_before(self):
        """Test calculating scheduled time for specific time on days before."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='before',
            timing_mode='specific_time',
            days=1,
            time_of_day=time_type(9, 0)
        )
        
        expected_date = reference_time.date() - timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(9, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    def test_calculate_scheduled_time_specific_time_before_auto_adjust(self):
        """Test auto-adjustment when time is in future for 'before' timing."""
        reference_time = datetime(2024, 1, 15, 8, 0, tzinfo=TAIWAN_TZ)  # 8am
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='before',
            timing_mode='specific_time',
            days=0,  # Same day
            time_of_day=time_type(9, 0)  # 9am (after 8am)
        )
        
        # Should auto-adjust to previous day at 9am
        expected_date = reference_time.date() - timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(9, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    # Tests for legacy 'hours_after' mode

    def test_calculate_scheduled_time_legacy_hours_after(self):
        """Test legacy 'hours_after' timing mode (should work as 'hours' with 'after')."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_scheduled_time(
            reference_time,
            timing_type='after',
            timing_mode='hours_after',
            hours=3
        )
        
        expected = reference_time + timedelta(hours=3)
        assert scheduled_time == expected

    # Tests for backward compatibility wrapper

    def test_calculate_follow_up_scheduled_time_hours_after(self):
        """Test backward compatibility wrapper for hours_after mode."""
        appointment_end_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_follow_up_scheduled_time(
            appointment_end_time,
            'hours_after',
            hours_after=2
        )
        
        expected = appointment_end_time + timedelta(hours=2)
        assert scheduled_time == expected

    def test_calculate_follow_up_scheduled_time_specific_time(self):
        """Test backward compatibility wrapper for specific_time mode."""
        appointment_end_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = calculate_follow_up_scheduled_time(
            appointment_end_time,
            'specific_time',
            days_after=1,
            time_of_day=time_type(21, 0)
        )
        
        expected_date = appointment_end_time.date() + timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(21, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    # Error handling tests

    def test_calculate_scheduled_time_missing_hours(self):
        """Test error when hours is missing for hours mode."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        with pytest.raises(ValueError, match="hours is required"):
            calculate_scheduled_time(
                reference_time,
                timing_type='after',
                timing_mode='hours'
            )

    def test_calculate_scheduled_time_missing_days_or_time(self):
        """Test error when days or time_of_day is missing for specific_time mode."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        with pytest.raises(ValueError, match="days and time_of_day are required"):
            calculate_scheduled_time(
                reference_time,
                timing_type='after',
                timing_mode='specific_time',
                days=1
            )

    def test_calculate_scheduled_time_negative_hours(self):
        """Test error when hours is negative."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        with pytest.raises(ValueError, match="hours must be non-negative"):
            calculate_scheduled_time(
                reference_time,
                timing_type='after',
                timing_mode='hours',
                hours=-1
            )

    def test_calculate_scheduled_time_negative_days(self):
        """Test error when days is negative."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        with pytest.raises(ValueError, match="days must be non-negative"):
            calculate_scheduled_time(
                reference_time,
                timing_type='after',
                timing_mode='specific_time',
                days=-1,
                time_of_day=time_type(9, 0)
            )

    def test_calculate_scheduled_time_invalid_mode(self):
        """Test error when timing_mode is invalid."""
        reference_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        with pytest.raises(ValueError, match="Invalid timing_mode"):
            calculate_scheduled_time(
                reference_time,
                timing_type='after',
                timing_mode='invalid_mode',
                hours=1
            )

    def test_calculate_scheduled_time_none_reference_time(self):
        """Test error when reference_time is None."""
        with pytest.raises(ValueError, match="reference_time cannot be None"):
            calculate_scheduled_time(
                None,
                timing_type='after',
                timing_mode='hours',
                hours=1
            )
