"""
Unit tests for context date features and month weekdays tool.

Tests the enhanced date information in context and the get_month_weekdays tool.
"""

import pytest
from datetime import datetime, timezone, timedelta, date
from unittest.mock import Mock, patch

from clinic_agents.context import ConversationContext
from clinic_agents.tools.get_month_weekdays import get_month_weekdays_impl


class TestContextDateTimeInfo:
    """Test the enhanced current_date_time_info property."""

    def test_current_date_time_info_basic_format(self, db_session):
        """Test basic formatting of current date time info."""
        # Create a mock clinic
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create context with current time (UTC, as done in orchestrator)
        current_time_utc = datetime(2025, 10, 30, 1, 0, 0, tzinfo=timezone.utc)  # 01:00 UTC = 09:00 Taiwan
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123",
            current_datetime=current_time_utc
        )

        result = context.current_date_time_info
        # Should contain basic date/time info with today's weekday
        assert "今天日期：2025年10月30日（四）" in result  # Thursday in Chinese
        assert "現在時間：9:00 上午" in result  # 09:00 Taiwan time = 9:00 AM
        assert "**日期參考" in result

    def test_current_date_time_info_includes_weekday_calendar(self, db_session):
        """Test that weekday calendar is included for +/- 3 weeks."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create context with current time (October 30, 2025)
        current_time = datetime(2025, 10, 30, 9, 0, 0, tzinfo=timezone(timedelta(hours=8)))
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123",
            current_datetime=current_time
        )

        result = context.current_date_time_info

        # Should include weekday information for dates from today to 21 days ahead
        assert "2025年10月30日(四)" in result  # Today (Thursday)
        assert "2025年11月13日(四)" in result  # 14 days from now
        assert "2025年11月20日(四)" in result  # 21 days from now

        # Should have proper weekday names in Chinese
        weekday_names = ["一", "二", "三", "四", "五", "六", "日"]
        for weekday in weekday_names:
            assert f"({weekday})" in result

    def test_current_date_time_info_fallback_to_utc(self, db_session):
        """Test fallback to UTC when current_datetime is None."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create context without current_datetime
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123",
            current_datetime=None
        )

        # Mock datetime.now to return a predictable time
        with patch('clinic_agents.context.datetime') as mock_datetime:
            mock_now = datetime(2025, 10, 30, 1, 0, 0, tzinfo=timezone.utc)  # UTC time
            mock_datetime.now.return_value = mock_now
            mock_datetime.side_effect = lambda *args, **kw: datetime(*args, **kw)

            result = context.current_date_time_info

            # Should convert UTC to Taiwan time (UTC+8) and include weekday
            assert "今天日期：2025年10月30日（四）" in result  # Thursday in Chinese
            assert "現在時間：9:00 上午" in result  # 01:00 UTC + 8 hours = 9:00 AM Taiwan

    def test_current_date_time_info_correct_weekday_mapping(self, db_session):
        """Test that weekdays are correctly mapped to dates."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Test specific date: October 30, 2025 should be Thursday (四)
        # Let's verify this is correct:
        test_date = date(2025, 10, 30)
        # weekday() returns 0=Monday, 6=Sunday
        # So Thursday = 3, which should map to "四" (index 3 in our list)
        weekday_names = ["一", "二", "三", "四", "五", "六", "日"]
        expected_weekday = weekday_names[test_date.weekday()]  # Thursday = 3 -> "四"

        current_time_utc = datetime(2025, 10, 30, 1, 0, 0, tzinfo=timezone.utc)  # 01:00 UTC = 09:00 Taiwan
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123",
            current_datetime=current_time_utc
        )

        result = context.current_date_time_info

        # October 30, 2025 should be marked as Thursday (四)
        assert "2025年10月30日(四)" in result


class TestGetMonthWeekdays:
    """Test the get_month_weekdays tool."""

    @pytest.mark.asyncio
    async def test_get_month_weekdays_successful(self, db_session):
        """Test successful retrieval of month weekday information."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        # Test November 2025 (the month from the original bug report)
        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2025,
            month=11
        )
        # Should return compact string format
        assert isinstance(result, str)
        assert "2025年11月1日(" in result
        assert "2025年11月30日(" in result

        # Check specific dates from the bug report
        assert "2025年11月6日(四)" in result  # November 6 is Thursday
        assert "2025年11月3日(一)" in result  # November 3 is Monday

        # Should contain all 30 days of November
        assert result.count("2025年11月") == 30

    @pytest.mark.asyncio
    async def test_get_month_weekdays_calendar_view_format(self, db_session):
        """Test that calendar view is properly formatted."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2025,
            month=11
        )

        # Should be a compact string format
        assert isinstance(result, str)

        # Should contain formatted dates with weekdays
        # For example, November 6, 2025 is Thursday
        assert "2025年11月6日(四)" in result

    @pytest.mark.asyncio
    async def test_get_month_weekdays_weekend_detection(self, db_session):
        """Test that weekends are correctly identified."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2025,
            month=11
        )

        # Should contain Saturdays and Sundays with correct weekday indicators
        assert "六)" in result, "Should contain Saturdays (六)"
        assert "日)" in result, "Should contain Sundays (日)"

    @pytest.mark.asyncio
    async def test_get_month_weekdays_week_of_month(self, db_session):
        """Test that week_of_month is correctly calculated."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2025,
            month=11
        )

        # November has 30 days and spans multiple weeks
        assert result.count("2025年11月") == 30
        # Should have dates from 1 to 30
        assert "2025年11月1日(" in result
        assert "2025年11月30日(" in result

    @pytest.mark.asyncio
    async def test_get_month_weekdays_invalid_month(self, db_session):
        """Test error handling for invalid month."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        # Test invalid month
        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2025,
            month=13  # Invalid month
        )

        assert result.startswith("錯誤：")
        assert "月份必須在1-12之間" in result

    @pytest.mark.asyncio
    async def test_get_month_weekdays_invalid_year(self, db_session):
        """Test error handling for invalid year."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        # Test year too far in the past
        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=1800,
            month=1
        )

        assert result.startswith("錯誤：")
        assert "年份必須在1900-2100之間" in result

        # Test year too far in the future
        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2200,
            month=1
        )

        assert result.startswith("錯誤：")
        assert "年份必須在1900-2100之間" in result

    @pytest.mark.asyncio
    async def test_get_month_weekdays_february_leap_year(self, db_session):
        """Test February handling in leap year."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        # Test February 2024 (leap year)
        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2024,
            month=2
        )

        # February 2024 should have 29 days (leap year)
        assert result.count("2024年2月") == 29
        assert "2024年2月29日(" in result

    @pytest.mark.asyncio
    async def test_get_month_weekdays_february_non_leap_year(self, db_session):
        """Test February handling in non-leap year."""
        from models import Clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_line_user_123"
        )

        wrapper = Mock()
        wrapper.context = context

        # Test February 2025 (non-leap year)
        result = await get_month_weekdays_impl(
            wrapper=wrapper,
            year=2025,
            month=2
        )

        # February 2025 should have 28 days (non-leap year)
        assert result.count("2025年2月") == 28
        assert "2025年2月29日(" not in result
