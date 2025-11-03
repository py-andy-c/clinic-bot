"""
Unit tests for availability service algorithms.

Comprehensive tests for the availability calculation logic, including:
- Basic slot generation
- Edge cases with exceptions and appointments
- Quarter-hour alignment
- Multiple intervals
- Various duration scenarios
"""

import pytest
from datetime import time

from models.practitioner_availability import PractitionerAvailability
from models.calendar_event import CalendarEvent
from services.availability_service import AvailabilityService


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


class TestBasicSlotGeneration:
    """Test basic slot generation from default intervals."""

    def test_simple_interval_no_conflicts(self):
        """Test generating slots from a simple interval with no conflicts."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            60
        )

        # Should generate slots: 9:00, 9:15, 9:30, 9:45, 10:00, 10:15, 10:30, 10:45, 11:00
        assert len(slots) == 9
        assert slots[0]['start_time'] == '09:00'
        assert slots[-1]['start_time'] == '11:00'
        
        # Verify all start times are quarter hours
        for slot in slots:
            minutes = int(slot['start_time'].split(':')[1])
            assert minutes in [0, 15, 30, 45]

    def test_interval_with_non_quarter_hour_start(self):
        """Test interval that doesn't start on quarter hour."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 5),  # Starts at 9:05
            end_time=time(12, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            60
        )

        # Should round up to 9:15 and generate slots from there
        assert len(slots) == 8
        assert slots[0]['start_time'] == '09:15'
        assert slots[-1]['start_time'] == '11:00'

    def test_interval_with_non_quarter_hour_end(self):
        """Test interval that doesn't end on quarter hour."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 10)  # Ends at 12:10
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            60
        )

        # Should only include slots that fit completely (slot end <= 12:10)
        # Last 60-min slot would be 11:00-12:00, not 11:15-12:15
        assert len(slots) == 9
        assert slots[-1]['start_time'] == '11:00'
        assert slots[-1]['end_time'] == '12:00'

    def test_short_duration_slots(self):
        """Test generating slots with short duration."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            30  # 30-minute duration
        )

        # Should generate more slots with shorter duration
        assert len(slots) > 9
        assert slots[0]['start_time'] == '09:00'
        assert slots[-1]['end_time'] == '12:00'

    def test_long_duration_slots(self):
        """Test generating slots with long duration."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            120  # 2-hour duration
        )

        # Should generate slots: 9:00-11:00, 9:15-11:15, 9:30-11:30, 9:45-11:45, 10:00-12:00
        # All fit within the 9:00-12:00 interval
        assert len(slots) == 5
        assert slots[0]['start_time'] == '09:00'
        assert slots[0]['end_time'] == '11:00'
        assert slots[-1]['start_time'] == '10:00'
        assert slots[-1]['end_time'] == '12:00'

    def test_interval_too_short_for_duration(self):
        """Test interval that's too short for the appointment duration."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(9, 30)  # Only 30 minutes
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            60  # Needs 60 minutes
        )

        # Should not generate any slots
        assert len(slots) == 0


class TestExceptionsHandling:
    """Test handling of availability exceptions."""

    def test_exception_at_start_of_interval(self):
        """Test exception that blocks the start of interval."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        exception = CalendarEvent()
        exception.start_time = time(9, 0)
        exception.end_time = time(10, 0)
        exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [],
            60
        )

        # Should skip slots that overlap with exception (9:00-10:00)
        # First available slot should start at 10:00
        assert len(slots) > 0
        assert slots[0]['start_time'] >= '10:00'

    def test_exception_at_end_of_interval(self):
        """Test exception that blocks the end of interval."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        exception = CalendarEvent()
        exception.start_time = time(11, 0)
        exception.end_time = time(12, 0)
        exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [],
            60
        )

        # Last slot should end before exception starts
        assert len(slots) > 0
        for slot in slots:
            assert slot['end_time'] <= '11:00'

    def test_exception_in_middle_of_interval(self):
        """Test exception that blocks the middle of interval."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        exception = CalendarEvent()
        exception.start_time = time(10, 30)
        exception.end_time = time(11, 30)
        exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [],
            60
        )

        # Should have slots before and after exception
        assert len(slots) > 0
        # No slots should overlap with exception
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # Check no overlap with 10:30-11:30
            assert not (
                slot_start < '11:30' and slot_end > '10:30'
            )

    def test_exception_completely_covers_interval(self):
        """Test exception that completely covers the interval."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        exception = CalendarEvent()
        exception.start_time = time(8, 0)
        exception.end_time = time(13, 0)
        exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [],
            60
        )

        # Should not generate any slots
        assert len(slots) == 0

    def test_multiple_exceptions(self):
        """Test multiple exceptions blocking different parts."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        exception1 = CalendarEvent()
        exception1.start_time = time(10, 0)
        exception1.end_time = time(11, 0)
        exception1.event_type = 'availability_exception'

        exception2 = CalendarEvent()
        exception2.start_time = time(14, 0)
        exception2.end_time = time(15, 0)
        exception2.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception1, exception2],
            [],
            60
        )

        # Should have slots before, between, and after exceptions
        assert len(slots) > 0
        # Verify no slots overlap with either exception
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # No overlap with 10:00-11:00
            assert not (slot_start < '11:00' and slot_end > '10:00')
            # No overlap with 14:00-15:00
            assert not (slot_start < '15:00' and slot_end > '14:00')

    def test_overlapping_exceptions(self):
        """Test overlapping exceptions."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        exception1 = CalendarEvent()
        exception1.start_time = time(10, 0)
        exception1.end_time = time(12, 0)
        exception1.event_type = 'availability_exception'

        exception2 = CalendarEvent()
        exception2.start_time = time(11, 0)
        exception2.end_time = time(13, 0)
        exception2.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception1, exception2],
            [],
            60
        )

        # Should filter out all slots that overlap with either exception
        assert len(slots) >= 0
        # Verify no slots overlap with the combined exception range (10:00-13:00)
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            assert not (slot_start < '13:00' and slot_end > '10:00')


class TestAppointmentsHandling:
    """Test handling of existing appointments."""

    def test_appointment_blocks_slot(self):
        """Test that existing appointment blocks overlapping slots."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        appointment = CalendarEvent()
        appointment.start_time = time(10, 0)
        appointment.end_time = time(11, 0)
        appointment.event_type = 'appointment'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [appointment],
            60
        )

        # Should not include slots that overlap with appointment
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # Check no overlap with 10:00-11:00
            assert not (slot_start < '11:00' and slot_end > '10:00')

    def test_multiple_appointments(self):
        """Test multiple appointments blocking different slots."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        appointment1 = CalendarEvent()
        appointment1.start_time = time(10, 0)
        appointment1.end_time = time(11, 0)
        appointment1.event_type = 'appointment'

        appointment2 = CalendarEvent()
        appointment2.start_time = time(14, 0)
        appointment2.end_time = time(15, 0)
        appointment2.event_type = 'appointment'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [appointment1, appointment2],
            60
        )

        # Should filter out slots overlapping with either appointment
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # No overlap with 10:00-11:00
            assert not (slot_start < '11:00' and slot_end > '10:00')
            # No overlap with 14:00-15:00
            assert not (slot_start < '15:00' and slot_end > '14:00')

    def test_appointment_and_exception_together(self):
        """Test both exceptions and appointments filtering slots."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        exception = CalendarEvent()
        exception.start_time = time(10, 0)
        exception.end_time = time(11, 0)
        exception.event_type = 'availability_exception'

        appointment = CalendarEvent()
        appointment.start_time = time(14, 0)
        appointment.end_time = time(15, 0)
        appointment.event_type = 'appointment'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [appointment],
            60
        )

        # Should filter out slots overlapping with either
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # No overlap with exception 10:00-11:00
            assert not (slot_start < '11:00' and slot_end > '10:00')
            # No overlap with appointment 14:00-15:00
            assert not (slot_start < '15:00' and slot_end > '14:00')


class TestMultipleIntervals:
    """Test handling of multiple default intervals."""

    def test_two_separate_intervals(self):
        """Test two separate intervals in the same day."""
        interval1 = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        interval2 = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(14, 0),
            end_time=time(17, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval1, interval2],
            [],
            [],
            60
        )

        # Should generate slots from both intervals
        assert len(slots) > 0
        # All slots should be in one of the two intervals
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # Either in first interval (9:00-12:00) or second (14:00-17:00)
            in_first = slot_start >= '09:00' and slot_end <= '12:00'
            in_second = slot_start >= '14:00' and slot_end <= '17:00'
            assert in_first or in_second

    def test_overlapping_intervals(self):
        """Test overlapping default intervals."""
        interval1 = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(13, 0)
        )

        interval2 = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(11, 0),
            end_time=time(15, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval1, interval2],
            [],
            [],
            60
        )

        # Should generate slots from both intervals (including overlap area)
        assert len(slots) > 0

    def test_gap_between_intervals(self):
        """Test intervals with a gap between them."""
        interval1 = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        interval2 = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(14, 0),
            end_time=time(17, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval1, interval2],
            [],
            [],
            60
        )

        # Should have slots in both intervals, but none in the gap (12:00-14:00)
        assert len(slots) > 0
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # No slots should span the gap
            in_gap = slot_start < '14:00' and slot_end > '12:00'
            assert not in_gap


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_empty_intervals(self):
        """Test with no default intervals."""
        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [],
            [],
            [],
            60
        )
        assert len(slots) == 0

    def test_no_valid_slots_after_filtering(self):
        """Test when all slots are filtered out by exceptions/appointments."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        exception = CalendarEvent()
        exception.start_time = time(8, 0)
        exception.end_time = time(13, 0)
        exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [],
            60
        )
        assert len(slots) == 0

    def test_exception_with_null_times(self):
        """Test exception with null start or end time (should be skipped)."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        exception = CalendarEvent()
        exception.start_time = None
        exception.end_time = None
        exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [exception],
            [],
            60
        )

        # Should generate slots normally (null times ignored)
        assert len(slots) > 0

    def test_appointment_with_null_times(self):
        """Test appointment with null start or end time (should be skipped)."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        appointment = CalendarEvent()
        appointment.start_time = None
        appointment.end_time = None
        appointment.event_type = 'appointment'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [appointment],
            60
        )

        # Should generate slots normally (null times ignored)
        assert len(slots) > 0

    def test_very_long_duration(self):
        """Test with very long appointment duration."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            240  # 4 hours
        )

        # Should not generate any slots (interval is only 3 hours)
        assert len(slots) == 0

    def test_very_short_interval(self):
        """Test with very short interval."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(9, 20)  # Only 20 minutes
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            15  # 15-minute duration
        )

        # Should potentially generate one slot if it fits
        if len(slots) > 0:
            assert slots[0]['start_time'] >= '09:00'
            assert slots[0]['end_time'] <= '09:20'

    def test_slot_at_exact_boundary(self):
        """Test slot that ends exactly at interval end."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(10, 0)
        )

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [],
            60  # 1-hour duration
        )

        # Should generate one slot: 9:00-10:00
        assert len(slots) == 1
        assert slots[0]['start_time'] == '09:00'
        assert slots[0]['end_time'] == '10:00'


class TestRealWorldScenarios:
    """Test realistic scenarios that might occur in production."""

    def test_lunch_break_exception(self):
        """Test scenario with lunch break exception."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        lunch_exception = CalendarEvent()
        lunch_exception.start_time = time(12, 0)
        lunch_exception.end_time = time(13, 0)
        lunch_exception.event_type = 'availability_exception'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [lunch_exception],
            [],
            60
        )

        # Should have slots before and after lunch
        assert len(slots) > 0
        # Verify no slots during lunch break
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            assert not (slot_start < '13:00' and slot_end > '12:00')

    def test_morning_and_afternoon_appointments(self):
        """Test with appointments in morning and afternoon."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        morning_apt = CalendarEvent()
        morning_apt.start_time = time(9, 30)
        morning_apt.end_time = time(10, 30)
        morning_apt.event_type = 'appointment'

        afternoon_apt = CalendarEvent()
        afternoon_apt.start_time = time(14, 30)
        afternoon_apt.end_time = time(15, 30)
        afternoon_apt.event_type = 'appointment'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            [],
            [morning_apt, afternoon_apt],
            60
        )

        # Should have slots available around the appointments
        assert len(slots) > 0
        # Verify slots don't overlap with appointments
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            # No overlap with morning appointment
            assert not (slot_start < '10:30' and slot_end > '09:30')
            # No overlap with afternoon appointment
            assert not (slot_start < '15:30' and slot_end > '14:30')

    def test_busy_day_with_multiple_conflicts(self):
        """Test a busy day with multiple appointments and exceptions."""
        interval = PractitionerAvailability(
            user_id=1,
            day_of_week=3,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        exceptions = [
            CalendarEvent() for _ in range(2)
        ]
        exceptions[0].start_time = time(12, 0)
        exceptions[0].end_time = time(13, 0)
        exceptions[0].event_type = 'availability_exception'
        
        exceptions[1].start_time = time(16, 0)
        exceptions[1].end_time = time(17, 0)
        exceptions[1].event_type = 'availability_exception'

        appointments = [
            CalendarEvent() for _ in range(3)
        ]
        appointments[0].start_time = time(10, 0)
        appointments[0].end_time = time(11, 0)
        appointments[0].event_type = 'appointment'
        
        appointments[1].start_time = time(14, 0)
        appointments[1].end_time = time(15, 0)
        appointments[1].event_type = 'appointment'
        
        appointments[2].start_time = time(15, 15)
        appointments[2].end_time = time(15, 45)
        appointments[2].event_type = 'appointment'

        pytest.skip("Old internal implementation - use integration tests")
        slots = AvailabilityService._calculate_slots_from_schedule(
            [interval],
            exceptions,
            appointments,
            60
        )

        # Should still have some available slots
        assert len(slots) >= 0  # Could be zero if very busy
        
        # Verify all slots don't conflict
        for slot in slots:
            slot_start = slot['start_time']
            slot_end = slot['end_time']
            
            # No overlap with exceptions
            assert not (slot_start < '13:00' and slot_end > '12:00')  # Lunch
            assert not (slot_start < '17:00' and slot_end > '16:00')  # End of day
            
            # No overlap with appointments
            assert not (slot_start < '11:00' and slot_end > '10:00')  # Morning apt
            assert not (slot_start < '15:00' and slot_end > '14:00')  # Afternoon apt 1
            assert not (slot_start < '15:45' and slot_end > '15:15')  # Afternoon apt 2

