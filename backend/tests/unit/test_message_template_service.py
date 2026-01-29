"""
Unit tests for MessageTemplateService, focusing on recurring appointment message functionality.
"""

import pytest
from datetime import datetime, date, time
from unittest.mock import Mock, patch

from services.message_template_service import MessageTemplateService
from models import Appointment, Patient, Clinic, CalendarEvent, AppointmentType


class TestMessageTemplateService:
    """Test MessageTemplateService functionality."""

    def test_render_message_basic(self):
        """Test basic message rendering with placeholders."""
        template = "{病患姓名}，您的預約已建立：{預約時間}"
        context = {
            "病患姓名": "王小明",
            "預約時間": "2026-02-03(二) 2:00 PM"
        }
        
        result = MessageTemplateService.render_message(template, context)
        expected = "王小明，您的預約已建立：2026-02-03(二) 2:00 PM"
        assert result == expected

    def test_render_message_longest_first(self):
        """Test that longest placeholders are replaced first to avoid substring conflicts."""
        template = "{預約時間} - {預約日期}"
        context = {
            "預約時間": "2026-02-03(二) 2:00 PM",
            "預約日期": "2026-02-03"
        }
        
        result = MessageTemplateService.render_message(template, context)
        expected = "2026-02-03(二) 2:00 PM - 2026-02-03"
        assert result == expected

    def test_build_date_range_with_weekdays_single_date(self):
        """Test date range formatting for single date."""
        dates = [date(2026, 2, 3)]  # Tuesday
        
        result = MessageTemplateService._build_date_range_with_weekdays(dates)
        expected = "2026-02-03(二)"
        assert result == expected

    def test_build_date_range_with_weekdays_multiple_dates(self):
        """Test date range formatting for multiple dates."""
        dates = [
            date(2026, 2, 3),   # Tuesday
            date(2026, 2, 10),  # Tuesday
            date(2026, 2, 17),  # Tuesday
        ]
        
        result = MessageTemplateService._build_date_range_with_weekdays(dates)
        expected = "2026-02-03(二) 至 2026-02-17(二)"
        assert result == expected

    def test_build_date_range_with_weekdays_all_weekdays(self):
        """Test date range formatting covers all weekdays correctly."""
        test_cases = [
            (date(2026, 2, 2), "2026-02-02(一)"),   # Monday
            (date(2026, 2, 3), "2026-02-03(二)"),   # Tuesday
            (date(2026, 2, 4), "2026-02-04(三)"),   # Wednesday
            (date(2026, 2, 5), "2026-02-05(四)"),   # Thursday
            (date(2026, 2, 6), "2026-02-06(五)"),   # Friday
            (date(2026, 2, 7), "2026-02-07(六)"),   # Saturday
            (date(2026, 2, 8), "2026-02-08(日)"),   # Sunday
        ]
        
        for test_date, expected in test_cases:
            result = MessageTemplateService._build_date_range_with_weekdays([test_date])
            assert result == expected

    def test_format_datetime_with_weekday(self):
        """Test datetime formatting with weekday."""
        dt = datetime(2026, 2, 3, 14, 30)  # Tuesday 2:30 PM
        
        result = MessageTemplateService._format_datetime_with_weekday(dt)
        expected = "2026-02-03(二) 02:30 PM"
        assert result == expected

    def test_build_numbered_appointment_list_few_appointments(self):
        """Test numbered appointment list with few appointments."""
        # Create mock appointments
        appointments = []
        for i, day in enumerate([3, 10, 17], 1):
            appointment = Mock(spec=Appointment)
            calendar_event = Mock(spec=CalendarEvent)
            calendar_event.date = date(2026, 2, day)
            calendar_event.start_time = time(14, 30)
            appointment.calendar_event = calendar_event
            appointments.append(appointment)
        
        result = MessageTemplateService._build_numbered_appointment_list(appointments)
        expected_lines = [
            "1. 2026-02-03(二) 02:30 PM",
            "2. 2026-02-10(二) 02:30 PM", 
            "3. 2026-02-17(二) 02:30 PM"
        ]
        expected = "\n".join(expected_lines)
        assert result == expected

    def test_build_numbered_appointment_list_over_limit(self):
        """Test numbered appointment list with over 100 appointments."""
        # Create 105 mock appointments
        appointments = []
        for i in range(105):
            appointment = Mock(spec=Appointment)
            calendar_event = Mock(spec=CalendarEvent)
            calendar_event.date = date(2026, 2, 3)
            calendar_event.start_time = time(14, 30)
            appointment.calendar_event = calendar_event
            appointments.append(appointment)
        
        result = MessageTemplateService._build_numbered_appointment_list(appointments)
        lines = result.split('\n')
        
        # Should have 100 numbered appointments + overflow message
        assert len(lines) == 101
        assert lines[0] == "1. 2026-02-03(二) 02:30 PM"
        assert lines[99] == "100. 2026-02-03(二) 02:30 PM"
        assert lines[100] == "... 還有 5 個"

    def test_build_numbered_appointment_list_sorting(self):
        """Test that appointments are sorted by date and time."""
        # Create appointments in random order
        appointments = []
        dates_times = [
            (date(2026, 2, 17), time(14, 30)),  # Latest
            (date(2026, 2, 3), time(16, 0)),    # Earliest date, later time
            (date(2026, 2, 3), time(14, 30)),   # Earliest
            (date(2026, 2, 10), time(14, 30)),  # Middle
        ]
        
        for d, t in dates_times:
            appointment = Mock(spec=Appointment)
            calendar_event = Mock(spec=CalendarEvent)
            calendar_event.date = d
            calendar_event.start_time = t
            appointment.calendar_event = calendar_event
            appointments.append(appointment)
        
        result = MessageTemplateService._build_numbered_appointment_list(appointments)
        lines = result.split('\n')
        
        # Should be sorted chronologically
        assert lines[0] == "1. 2026-02-03(二) 02:30 PM"  # Earliest
        assert lines[1] == "2. 2026-02-03(二) 04:00 PM"  # Same date, later time
        assert lines[2] == "3. 2026-02-10(二) 02:30 PM"  # Middle
        assert lines[3] == "4. 2026-02-17(二) 02:30 PM"  # Latest

    def test_build_recurring_confirmation_context(self):
        """Test building context for recurring confirmation messages."""
        # Create mock objects
        patient = Mock(spec=Patient)
        patient.full_name = "王小明"
        
        clinic = Mock(spec=Clinic)
        clinic.effective_display_name = "測試診所"
        clinic.address = "台北市信義區"
        clinic.phone_number = "02-1234-5678"
        
        # Create mock appointments
        appointments = []
        for day in [3, 10, 17]:
            appointment = Mock(spec=Appointment)
            calendar_event = Mock(spec=CalendarEvent)
            calendar_event.date = date(2026, 2, day)
            calendar_event.start_time = time(14, 30)
            appointment.calendar_event = calendar_event
            appointments.append(appointment)
        
        practitioner_name = "李醫師"
        appointment_type_name = "物理治療"
        
        result = MessageTemplateService.build_recurring_confirmation_context(
            appointments=appointments,
            patient=patient,
            practitioner_name=practitioner_name,
            clinic=clinic,
            appointment_type_name=appointment_type_name
        )
        
        # Verify all expected keys are present
        expected_keys = {
            "病患姓名", "預約數量", "日期範圍", "預約列表", 
            "服務項目", "治療師姓名", "診所名稱", "診所地址", "診所電話"
        }
        assert set(result.keys()) == expected_keys
        
        # Verify values
        assert result["病患姓名"] == "王小明"
        assert result["預約數量"] == "3"
        assert result["日期範圍"] == "2026-02-03(二) 至 2026-02-17(二)"
        assert result["服務項目"] == "物理治療"
        assert result["治療師姓名"] == "李醫師"
        assert result["診所名稱"] == "測試診所"
        assert result["診所地址"] == "台北市信義區"
        assert result["診所電話"] == "02-1234-5678"
        
        # Verify appointment list format
        expected_list = "\n".join([
            "1. 2026-02-03(二) 02:30 PM",
            "2. 2026-02-10(二) 02:30 PM",
            "3. 2026-02-17(二) 02:30 PM"
        ])
        assert result["預約列表"] == expected_list

    def test_build_recurring_confirmation_context_single_appointment(self):
        """Test context building for single appointment (edge case)."""
        patient = Mock(spec=Patient)
        patient.full_name = "王小明"
        
        clinic = Mock(spec=Clinic)
        clinic.effective_display_name = "測試診所"
        clinic.address = None  # Test missing address
        clinic.phone_number = None  # Test missing phone
        
        # Single appointment
        appointment = Mock(spec=Appointment)
        calendar_event = Mock(spec=CalendarEvent)
        calendar_event.date = date(2026, 2, 3)
        calendar_event.start_time = time(14, 30)
        appointment.calendar_event = calendar_event
        
        result = MessageTemplateService.build_recurring_confirmation_context(
            appointments=[appointment],
            patient=patient,
            practitioner_name="李醫師",
            clinic=clinic,
            appointment_type_name="物理治療"
        )
        
        assert result["預約數量"] == "1"
        assert result["日期範圍"] == "2026-02-03(二)"  # Single date format
        assert result["預約列表"] == "1. 2026-02-03(二) 02:30 PM"
        assert result["診所地址"] == ""  # Empty for missing data
        assert result["診所電話"] == ""  # Empty for missing data

    def test_full_recurring_template_rendering(self):
        """Test complete recurring template rendering end-to-end."""
        template = """{病患姓名}，已為您建立{預約數量}個預約：

{日期範圍}

{預約列表}

【{服務項目}】{治療師姓名}

期待為您服務！"""
        
        # Create context
        patient = Mock(spec=Patient)
        patient.full_name = "王小明"
        
        clinic = Mock(spec=Clinic)
        clinic.effective_display_name = "測試診所"
        clinic.address = "台北市信義區"
        clinic.phone_number = "02-1234-5678"
        
        appointments = []
        for day in [3, 10]:
            appointment = Mock(spec=Appointment)
            calendar_event = Mock(spec=CalendarEvent)
            calendar_event.date = date(2026, 2, day)
            calendar_event.start_time = time(14, 30)
            appointment.calendar_event = calendar_event
            appointments.append(appointment)
        
        context = MessageTemplateService.build_recurring_confirmation_context(
            appointments=appointments,
            patient=patient,
            practitioner_name="李醫師",
            clinic=clinic,
            appointment_type_name="物理治療"
        )
        
        result = MessageTemplateService.render_message(template, context)
        
        expected = """王小明，已為您建立2個預約：

2026-02-03(二) 至 2026-02-10(二)

1. 2026-02-03(二) 02:30 PM
2. 2026-02-10(二) 02:30 PM

【物理治療】李醫師

期待為您服務！"""
        
        assert result == expected

    def test_extract_used_placeholders(self):
        """Test extracting used placeholders from template."""
        template = "{病患姓名}的{預約數量}個預約已建立"
        context = {
            "病患姓名": "王小明",
            "預約數量": "3",
            "未使用": "不會出現"
        }
        
        result = MessageTemplateService.extract_used_placeholders(template, context)
        expected = {
            "病患姓名": "王小明",
            "預約數量": "3"
        }
        assert result == expected

    def test_validate_placeholder_completeness(self):
        """Test placeholder completeness validation."""
        template = "診所地址：{診所地址}，電話：{診所電話}"
        context = {}
        
        # Clinic with missing data
        clinic = Mock(spec=Clinic)
        clinic.address = None
        clinic.phone_number = ""
        
        warnings = MessageTemplateService.validate_placeholder_completeness(
            template, context, clinic
        )
        
        expected_warnings = [
            "使用了 {診所地址} 但診所尚未設定地址",
            "使用了 {診所電話} 但診所尚未設定電話"
        ]
        assert warnings == expected_warnings

    def test_validate_placeholder_completeness_no_warnings(self):
        """Test placeholder completeness validation with complete data."""
        template = "診所地址：{診所地址}，電話：{診所電話}"
        context = {}
        
        # Clinic with complete data
        clinic = Mock(spec=Clinic)
        clinic.address = "台北市信義區"
        clinic.phone_number = "02-1234-5678"
        
        warnings = MessageTemplateService.validate_placeholder_completeness(
            template, context, clinic
        )
        
        assert warnings == []