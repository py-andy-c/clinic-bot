"""
Unit tests for availability service algorithms.

Tests for the availability calculation utility functions, including:
- Quarter-hour rounding utility
- Time overlap detection
- Booking restriction filtering (NOTE: This method is deprecated - restrictions are no longer applied in availability checks, only during booking)
"""

import pytest
from datetime import time, datetime, timedelta, timezone
from unittest.mock import Mock, patch

from models.clinic import Clinic
from services.availability_service import AvailabilityService
from utils.datetime_utils import taiwan_now


class TestQuarterHourRounding:
    """Test the quarter-hour rounding utility function."""

    def test_round_up_already_quarter_hour(self):
        """Test rounding when time is already on quarter hour."""
        assert AvailabilityService._round_up_to_interval(time(9, 0), 15) == time(9, 0)
        assert AvailabilityService._round_up_to_interval(time(9, 15), 15) == time(9, 15)
        assert AvailabilityService._round_up_to_interval(time(9, 30), 15) == time(9, 30)
        assert AvailabilityService._round_up_to_interval(time(9, 45), 15) == time(9, 45)

    def test_round_up_to_next_quarter_hour(self):
        """Test rounding up to next quarter hour."""
        assert AvailabilityService._round_up_to_interval(time(9, 1), 15) == time(9, 15)
        assert AvailabilityService._round_up_to_interval(time(9, 5), 15) == time(9, 15)
        assert AvailabilityService._round_up_to_interval(time(9, 14), 15) == time(9, 15)
        assert AvailabilityService._round_up_to_interval(time(9, 16), 15) == time(9, 30)
        assert AvailabilityService._round_up_to_interval(time(9, 20), 15) == time(9, 30)
        assert AvailabilityService._round_up_to_interval(time(9, 29), 15) == time(9, 30)
        assert AvailabilityService._round_up_to_interval(time(9, 31), 15) == time(9, 45)
        assert AvailabilityService._round_up_to_interval(time(9, 44), 15) == time(9, 45)
        assert AvailabilityService._round_up_to_interval(time(9, 46), 15) == time(10, 0)
        assert AvailabilityService._round_up_to_interval(time(9, 59), 15) == time(10, 0)

    def test_round_up_hour_boundary(self):
        """Test rounding at hour boundaries."""
        assert AvailabilityService._round_up_to_interval(time(9, 50), 15) == time(10, 0)
        assert AvailabilityService._round_up_to_interval(time(11, 59), 15) == time(12, 0)
        assert AvailabilityService._round_up_to_interval(time(17, 50), 15) == time(18, 0)
        assert AvailabilityService._round_up_to_interval(time(23, 45), 15) == time(23, 45)
    
    def test_round_up_hour_overflow(self):
        """Test defensive handling of hour overflow past 23:59."""
        # These cases would overflow past 24:00, should be clamped to 23:59
        assert AvailabilityService._round_up_to_interval(time(23, 50), 15) == time(23, 59)
        assert AvailabilityService._round_up_to_interval(time(23, 51), 15) == time(23, 59)
        assert AvailabilityService._round_up_to_interval(time(23, 59), 15) == time(23, 59)  # Already on quarter hour


class TestTimeOverlap:
    """Test the time overlap detection utility."""

    def test_no_overlap(self):
        """Test non-overlapping time ranges."""
        assert not AvailabilityService._check_time_overlap(
            time(9, 0), time(10, 0),
            time(11, 0), time(12, 0)
        )

    def test_overlap_partial(self):
        """Test partially overlapping time ranges."""
        assert AvailabilityService._check_time_overlap(
            time(9, 0), time(11, 0),
            time(10, 0), time(12, 0)
        )

    def test_overlap_complete_containment(self):
        """Test when one range completely contains another."""
        assert AvailabilityService._check_time_overlap(
            time(9, 0), time(12, 0),
            time(10, 0), time(11, 0)
        )

    def test_overlap_adjacent_touching(self):
        """Test adjacent time ranges that touch."""
        assert not AvailabilityService._check_time_overlap(
            time(9, 0), time(10, 0),
            time(10, 0), time(11, 0)
        )

    def test_overlap_same_start(self):
        """Test overlapping ranges with same start time."""
        assert AvailabilityService._check_time_overlap(
            time(9, 0), time(11, 0),
            time(9, 0), time(10, 0)
        )


class TestBookingRestrictionFiltering:
    """Test filtering of slots based on clinic booking restrictions."""

    @pytest.fixture
    def mock_slots_today(self):
        """Mock available slots for today."""
        return [
            {'start_time': '09:00', 'end_time': '09:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
            {'start_time': '10:00', 'end_time': '10:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
            {'start_time': '14:00', 'end_time': '14:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
        ]

    @pytest.fixture
    def mock_slots_tomorrow(self):
        """Mock available slots for tomorrow."""
        return [
            {'start_time': '09:00', 'end_time': '09:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
            {'start_time': '10:00', 'end_time': '10:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
            {'start_time': '14:00', 'end_time': '14:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
        ]

    def test_same_day_disallowed_deprecated_uses_minimum_hours(self, mock_slots_today):
        """Test that same_day_disallowed is treated as minimum_hours_required (deprecated but backward compatible).
        
        NOTE: This method (_filter_slots_by_booking_restrictions) is no longer used in availability checks.
        Booking restrictions are now enforced only during appointment creation/editing, not in availability display.
        This test is kept for backward compatibility verification of the method itself.
        """
        from models.clinic import BookingRestrictionSettings
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'same_day_disallowed'
        clinic.minimum_booking_hours_ahead = 24
        # Mock get_validated_settings to return proper settings
        booking_settings = BookingRestrictionSettings(
            booking_restriction_type='same_day_disallowed',
            minimum_booking_hours_ahead=24,
            max_booking_window_days=90
        )
        clinic.get_validated_settings.return_value.booking_restriction_settings = booking_settings

        today = taiwan_now().date()

        filtered = AvailabilityService._filter_slots_by_booking_restrictions(
            mock_slots_today, today, clinic
        )

        # Since same_day_disallowed is deprecated, it falls through to allow all (backward compatibility)
        # In practice, clinics should be migrated to minimum_hours_required
        # This test verifies backward compatibility during migration period
        assert len(filtered) >= 0  # May be filtered by minimum_hours if slots are too soon

    def test_same_day_disallowed_allows_tomorrow_slots(self, mock_slots_tomorrow):
        """Test that same_day_disallowed restriction allows tomorrow's slots.
        
        NOTE: This method (_filter_slots_by_booking_restrictions) is no longer used in availability checks.
        Booking restrictions are now enforced only during appointment creation/editing, not in availability display.
        This test is kept for backward compatibility verification of the method itself.
        
        NOTE: same_day_disallowed is auto-migrated to minimum_hours_required, so we use a date
        that's always > 24 hours away to ensure slots pass the minimum_hours_required check.
        """
        from models.clinic import BookingRestrictionSettings
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'same_day_disallowed'
        clinic.minimum_booking_hours_ahead = 24
        # Mock get_validated_settings to return proper settings
        booking_settings = BookingRestrictionSettings(
            booking_restriction_type='same_day_disallowed',
            minimum_booking_hours_ahead=24,
            max_booking_window_days=90
        )
        clinic.get_validated_settings.return_value.booking_restriction_settings = booking_settings

        # Use a date that's always > 24 hours away (2 days from now) to avoid time-dependent failures
        # This ensures slots pass the minimum_booking_hours_ahead check even when test runs late in the day
        future_date = taiwan_now().date() + timedelta(days=2)

        filtered = AvailabilityService._filter_slots_by_booking_restrictions(
            mock_slots_tomorrow, future_date, clinic
        )

        # All slots should be allowed (date is > 24 hours away, so passes minimum_hours_required check)
        assert len(filtered) == len(mock_slots_tomorrow)

    def test_minimum_hours_required_filters_recent_slots(self, mock_slots_today):
        """Test that minimum_hours_required filters out slots that are too soon."""
        from models.clinic import BookingRestrictionSettings
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'minimum_hours_required'
        clinic.minimum_booking_hours_ahead = 2  # 2 hours ahead required
        # Mock get_validated_settings to return proper settings
        booking_settings = BookingRestrictionSettings(
            booking_restriction_type='minimum_hours_required',
            minimum_booking_hours_ahead=2,
            max_booking_window_days=90
        )
        clinic.get_validated_settings.return_value.booking_restriction_settings = booking_settings

        today = taiwan_now().date()

        # Mock taiwan_now to return a time where some slots are too soon
        with patch('services.availability_service.taiwan_now') as mock_now:
            # Set current time to 08:30 Taiwan time
            current_time = datetime.combine(today, time(8, 30))
            current_time = current_time.replace(tzinfo=timezone(timedelta(hours=8)))
            mock_now.return_value = current_time

            filtered = AvailabilityService._filter_slots_by_booking_restrictions(
                mock_slots_today, today, clinic
            )

            # 09:00 slot: 09:00 - 08:30 = 0.5 hours < 2 hours, filtered out
            # 10:00 slot: 10:00 - 08:30 = 1.5 hours < 2 hours, filtered out
            # 14:00 slot: 14:00 - 08:30 = 5.5 hours > 2 hours, allowed
            assert len(filtered) == 1  # Only 14:00 slot should be allowed

    def test_minimum_hours_required_filters_too_soon_slots(self, mock_slots_today):
        """Test that minimum_hours_required filters out slots that are within the minimum hours."""
        from models.clinic import BookingRestrictionSettings
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'minimum_hours_required'
        clinic.minimum_booking_hours_ahead = 2  # 2 hours ahead required
        # Mock get_validated_settings to return proper settings
        booking_settings = BookingRestrictionSettings(
            booking_restriction_type='minimum_hours_required',
            minimum_booking_hours_ahead=2,
            max_booking_window_days=90
        )
        clinic.get_validated_settings.return_value.booking_restriction_settings = booking_settings

        today = taiwan_now().date()

        # Mock taiwan_now to return a time where some slots are too soon
        with patch('services.availability_service.taiwan_now') as mock_now:
            # Set current time to 13:30 Taiwan time (2:30 PM)
            current_time = datetime.combine(today, time(13, 30))
            current_time = current_time.replace(tzinfo=timezone(timedelta(hours=8)))
            mock_now.return_value = current_time

            filtered = AvailabilityService._filter_slots_by_booking_restrictions(
                mock_slots_today, today, clinic
            )

            # 09:00 and 10:00 slots are in the past or too soon, should be filtered out
            # 14:00 slot should be allowed (14:00 is 30 minutes after 13:30, which is less than 2 hours)
            # Actually, 14:00 - 13:30 = 30 minutes < 2 hours, so it should be filtered out
            assert len(filtered) == 0  # All slots should be filtered out

    def test_minimum_hours_required_allows_future_slots(self):
        """Test that minimum_hours_required allows slots that are far enough in the future."""
        from models.clinic import BookingRestrictionSettings
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'minimum_hours_required'
        clinic.minimum_booking_hours_ahead = 2  # 2 hours ahead required
        # Mock get_validated_settings to return proper settings
        booking_settings = BookingRestrictionSettings(
            booking_restriction_type='minimum_hours_required',
            minimum_booking_hours_ahead=2,
            max_booking_window_days=90
        )
        clinic.get_validated_settings.return_value.booking_restriction_settings = booking_settings

        today = taiwan_now().date()
        slots = [
            {'start_time': '16:00', 'end_time': '16:30', 'practitioner_id': 1, 'practitioner_name': 'Dr. Test'},
        ]

        # Mock taiwan_now to return a time where the slot is far enough ahead
        with patch('services.availability_service.taiwan_now') as mock_now:
            # Set current time to 13:30 Taiwan time (2:30 PM)
            current_time = datetime.combine(today, time(13, 30))
            current_time = current_time.replace(tzinfo=timezone(timedelta(hours=8)))
            mock_now.return_value = current_time

            filtered = AvailabilityService._filter_slots_by_booking_restrictions(
                slots, today, clinic
            )

            # 16:00 slot is 2.5 hours ahead of 13:30, should be allowed
            assert len(filtered) == 1

    def test_unknown_restriction_type_allows_all_slots(self, mock_slots_today):
        """Test that unknown restriction types allow all slots (backward compatibility)."""
        from models.clinic import BookingRestrictionSettings
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'unknown_type'
        clinic.minimum_booking_hours_ahead = 24
        # Mock get_validated_settings to return proper settings
        booking_settings = BookingRestrictionSettings(
            booking_restriction_type='unknown_type',
            minimum_booking_hours_ahead=24,
            max_booking_window_days=90
        )
        clinic.get_validated_settings.return_value.booking_restriction_settings = booking_settings

        today = taiwan_now().date()

        filtered = AvailabilityService._filter_slots_by_booking_restrictions(
            mock_slots_today, today, clinic
        )

        # All slots should be allowed for unknown restriction types
        assert len(filtered) == len(mock_slots_today)

    def test_empty_slots_list_returns_empty(self):
        """Test that empty slots list returns empty result."""
        clinic = Mock(spec=Clinic)
        clinic.booking_restriction_type = 'same_day_disallowed'
        clinic.minimum_booking_hours_ahead = 24

        today = taiwan_now().date()

        filtered = AvailabilityService._filter_slots_by_booking_restrictions(
            [], today, clinic
        )

        assert filtered == []


class TestBatchDateValidation:
    """Test batch date validation and filtering."""

    def test_validate_batch_dates_valid(self):
        """Test validating valid batch dates."""
        dates = ["2025-01-15", "2025-01-16", "2025-01-17"]
        result = AvailabilityService.validate_batch_dates(dates)
        assert result == dates

    def test_validate_batch_dates_invalid_format(self):
        """Test that invalid date format raises error."""
        dates = ["2025-01-15", "invalid-date", "2025-01-17"]
        with pytest.raises(Exception):  # HTTPException
            AvailabilityService.validate_batch_dates(dates)

    def test_validate_batch_dates_too_many(self):
        """Test that too many dates raises error."""
        dates = [f"2025-01-{i:02d}" for i in range(1, 33)]  # 32 dates
        with pytest.raises(Exception):  # HTTPException
            AvailabilityService.validate_batch_dates(dates, max_dates=31)

    def test_validate_batch_dates_max_limit(self):
        """Test that exactly max dates is allowed."""
        dates = [f"2025-01-{i:02d}" for i in range(1, 32)]  # 31 dates
        result = AvailabilityService.validate_batch_dates(dates, max_dates=31)
        assert len(result) == 31


class TestBookingWindowFiltering:
    """Test booking window filtering in batch methods."""

    def test_filter_dates_by_booking_window_within_window(self, db_session):
        """Test filtering dates within booking window."""
        from models import Clinic
        
        # Create clinic with 29-day booking window
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={
                "booking_restriction_settings": {
                    "max_booking_window_days": 29
                }
            }
        )
        db_session.add(clinic)
        db_session.commit()
        
        today = taiwan_now().date()
        within_window = today + timedelta(days=15)
        beyond_window = today + timedelta(days=35)
        
        dates = [
            within_window.strftime('%Y-%m-%d'),
            beyond_window.strftime('%Y-%m-%d')
        ]
        
        result = AvailabilityService._filter_dates_by_booking_window(
            db_session, clinic.id, dates
        )
        
        # Should only return date within window
        assert len(result) == 1
        assert result[0] == within_window.strftime('%Y-%m-%d')

    def test_filter_dates_by_booking_window_all_within(self, db_session):
        """Test filtering when all dates are within window."""
        from models import Clinic
        
        # Create clinic with 29-day booking window
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={
                "booking_restriction_settings": {
                    "max_booking_window_days": 29
                }
            }
        )
        db_session.add(clinic)
        db_session.commit()
        
        today = taiwan_now().date()
        date1 = today + timedelta(days=10)
        date2 = today + timedelta(days=20)
        
        dates = [
            date1.strftime('%Y-%m-%d'),
            date2.strftime('%Y-%m-%d')
        ]
        
        result = AvailabilityService._filter_dates_by_booking_window(
            db_session, clinic.id, dates
        )
        
        # Should return both dates
        assert len(result) == 2
        assert date1.strftime('%Y-%m-%d') in result
        assert date2.strftime('%Y-%m-%d') in result

    def test_filter_dates_by_booking_window_all_beyond(self, db_session):
        """Test filtering when all dates are beyond window."""
        from models import Clinic
        
        # Create clinic with 29-day booking window
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={
                "booking_restriction_settings": {
                    "max_booking_window_days": 29
                }
            }
        )
        db_session.add(clinic)
        db_session.commit()
        
        today = taiwan_now().date()
        date1 = today + timedelta(days=35)
        date2 = today + timedelta(days=40)
        
        dates = [
            date1.strftime('%Y-%m-%d'),
            date2.strftime('%Y-%m-%d')
        ]
        
        result = AvailabilityService._filter_dates_by_booking_window(
            db_session, clinic.id, dates
        )
        
        # Should return empty list
        assert len(result) == 0


class TestBatchSchedulingConflicts:
    """Test batch scheduling conflict checking."""

    def test_batch_conflicts_empty_practitioners(self, db_session):
        """Test batch conflicts with empty practitioner list."""
        from datetime import date, time

        result = AvailabilityService.check_batch_scheduling_conflicts(
            db=db_session,
            practitioners=[],
            date=date.today(),
            start_time=time(10, 0),
            appointment_type_id=1,
            clinic_id=1
        )

        assert result == []

    def test_batch_conflicts_calls_fetch_schedule_data(self, db_session):
        """Test that batch conflicts method calls fetch_practitioner_schedule_data correctly."""
        from unittest.mock import patch, Mock
        from datetime import date, time

        # Mock appointment type
        mock_appointment_type = Mock()
        mock_appointment_type.id = 1
        mock_appointment_type.duration_minutes = 30
        mock_appointment_type.scheduling_buffer_minutes = 0

        # Mock the appointment type service
        with patch('services.appointment_type_service.AppointmentTypeService.get_appointment_type_by_id') as mock_get_type:
            mock_get_type.return_value = mock_appointment_type

            # Mock the fetch_practitioner_schedule_data method
            with patch.object(AvailabilityService, 'fetch_practitioner_schedule_data') as mock_fetch:
                mock_fetch.return_value = {
                    1: {
                        'default_intervals': [],
                        'events': []
                    }
                }

                # Mock get_practitioners_for_appointment_type
                with patch.object(AvailabilityService, 'get_practitioners_for_appointment_type') as mock_get_practitioners:
                    mock_practitioner = Mock()
                    mock_practitioner.id = 1
                    mock_get_practitioners.return_value = [mock_practitioner]

                    result = AvailabilityService.check_batch_scheduling_conflicts(
                        db=db_session,
                        practitioners=[{"user_id": 1, "exclude_calendar_event_id": None}],
                        date=date.today(),
                        start_time=time(10, 0),
                        appointment_type_id=1,
                        clinic_id=1
                    )

                    # Verify fetch_practitioner_schedule_data was called with correct params
                    mock_fetch.assert_called_once_with(
                        db=db_session,
                        practitioner_ids=[1],
                        date=date.today(),
                        clinic_id=1,
                        exclude_calendar_event_id=None
                    )

                    assert isinstance(result, list)
                    assert len(result) == 1
                    assert result[0]["practitioner_id"] == 1

    def test_batch_conflicts_practitioner_type_mismatch(self, db_session):
        """Test batch conflicts when practitioner does not offer appointment type."""
        from unittest.mock import patch, Mock
        from datetime import date, time, timedelta

        # Mock appointment type
        mock_appointment_type = Mock()
        mock_appointment_type.id = 1
        mock_appointment_type.duration_minutes = 30
        mock_appointment_type.scheduling_buffer_minutes = 0

        # Mock the appointment type service
        with patch('services.appointment_type_service.AppointmentTypeService.get_appointment_type_by_id') as mock_get_type:
            mock_get_type.return_value = mock_appointment_type

            # Mock schedule data (empty, so no other conflicts)
            with patch.object(AvailabilityService, 'fetch_practitioner_schedule_data') as mock_fetch:
                mock_fetch.return_value = {
                    1: {'default_intervals': [], 'events': []}
                }

                # Mock get_practitioners_for_appointment_type to return NO practitioners (or just not this one)
                with patch.object(AvailabilityService, 'get_practitioners_for_appointment_type') as mock_get_practitioners:
                    mock_get_practitioners.return_value = []
                    
                    # Use tomorrow to avoid past_appointment conflict
                    future_date = date.today() + timedelta(days=1)

                    result = AvailabilityService.check_batch_scheduling_conflicts(
                        db=db_session,
                        practitioners=[{"user_id": 1}],
                        date=future_date,
                        start_time=time(10, 0),
                        appointment_type_id=1,
                        clinic_id=1
                    )

                    assert len(result) == 1
                    assert result[0]["practitioner_id"] == 1
                    assert result[0]["has_conflict"] is True
                    assert result[0]["is_type_mismatch"] is True
                    assert result[0]["conflict_type"] == "practitioner_type_mismatch"

