from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from models.clinic import AIWeeklySchedule, TimePeriod
from api.line_webhook import is_ai_active_now

# Constants for testing
TAIWAN_TZ = timezone(timedelta(hours=8))

class TestAISchedule:
    def test_no_schedule(self):
        """Test that AI is active when no schedule is provided."""
        assert is_ai_active_now(None) is True

    @patch('api.line_webhook.taiwan_now')
    def test_schedule_match(self, mock_now):
        """Test that AI is active when current time is within a scheduled period."""
        # Setup: Monday 10:00 (within 09:00-12:00)
        mock_now.return_value = datetime(2023, 10, 23, 10, 0, tzinfo=TAIWAN_TZ) # Oct 23 2023 is Monday
        
        schedule = AIWeeklySchedule(
            mon=[TimePeriod(start_time="09:00", end_time="12:00")]
        )
        
        assert is_ai_active_now(schedule) is True

    @patch('api.line_webhook.taiwan_now')
    def test_schedule_no_match_time(self, mock_now):
        """Test that AI is inactive when time is outside scheduled periods."""
        # Setup: Monday 13:00 (outside 09:00-12:00)
        mock_now.return_value = datetime(2023, 10, 23, 13, 0, tzinfo=TAIWAN_TZ) # Oct 23 2023 is Monday
        
        schedule = AIWeeklySchedule(
            mon=[TimePeriod(start_time="09:00", end_time="12:00")]
        )
        
        assert is_ai_active_now(schedule) is False

    @patch('api.line_webhook.taiwan_now')
    def test_schedule_no_match_day(self, mock_now):
        """Test that AI is inactive on days with no scheduled periods."""
        # Setup: Tuesday 10:00 (schedule only for Monday)
        mock_now.return_value = datetime(2023, 10, 24, 10, 0, tzinfo=TAIWAN_TZ) # Oct 24 2023 is Tuesday
        
        schedule = AIWeeklySchedule(
            mon=[TimePeriod(start_time="09:00", end_time="12:00")],
            tue=[] # Empty schedule for Tuesday
        )
        
        assert is_ai_active_now(schedule) is False

    @patch('api.line_webhook.taiwan_now')
    def test_schedule_multiple_periods(self, mock_now):
        """Test that AI handles multiple periods correctly."""
        # Setup: Monday 15:00 (within second period 13:00-17:00)
        mock_now.return_value = datetime(2023, 10, 23, 15, 0, tzinfo=TAIWAN_TZ) 
        
        schedule = AIWeeklySchedule(
            mon=[
                TimePeriod(start_time="09:00", end_time="12:00"),
                TimePeriod(start_time="13:00", end_time="17:00")
            ]
        )
        
        assert is_ai_active_now(schedule) is True

    @patch('api.line_webhook.taiwan_now')
    def test_schedule_boundary_start(self, mock_now):
        """Test exact start time matches."""
        # Setup: Monday 09:00
        mock_now.return_value = datetime(2023, 10, 23, 9, 0, tzinfo=TAIWAN_TZ)
        
        schedule = AIWeeklySchedule(
            mon=[TimePeriod(start_time="09:00", end_time="12:00")]
        )
        
        assert is_ai_active_now(schedule) is True

    @patch('api.line_webhook.taiwan_now')
    def test_schedule_boundary_end(self, mock_now):
        """Test exact end time does not match (exclusive)."""
        # Setup: Monday 12:00
        mock_now.return_value = datetime(2023, 10, 23, 12, 0, tzinfo=TAIWAN_TZ)
        
        schedule = AIWeeklySchedule(
            mon=[TimePeriod(start_time="09:00", end_time="12:00")]
        )
        
        assert is_ai_active_now(schedule) is False

    def test_schedule_overlap_validation(self):
        """Test that overlapping schedules raise ValueError in the model."""
        from pydantic import ValidationError
        import pytest
        
        with pytest.raises(ValidationError) as excinfo:
             AIWeeklySchedule(
                mon=[
                    TimePeriod(start_time="09:00", end_time="12:00"),
                    TimePeriod(start_time="11:00", end_time="14:00")
                ]
            )
        assert "Overlapping time periods detected" in str(excinfo.value)
