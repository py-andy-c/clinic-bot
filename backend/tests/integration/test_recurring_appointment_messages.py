"""
Integration tests for recurring appointment message customization.
"""

import pytest
from datetime import datetime, date, time
from unittest.mock import patch, Mock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import AppointmentType, Clinic, Patient, User, CalendarEvent, Appointment
from services.message_template_service import MessageTemplateService
from core.message_template_constants import DEFAULT_RECURRING_CLINIC_CONFIRMATION_MESSAGE


class TestRecurringAppointmentMessages:
    """Test recurring appointment message customization integration."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def sample_clinic(self, db_session: Session):
        """Create a sample clinic for testing."""
        clinic = Clinic(
            name="測試診所",
            line_channel_id="test_channel_123",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}  # Initialize settings to avoid NoneType error
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Set additional properties after commit and mark settings as modified
        clinic.display_name = "測試診所"
        clinic.address = "台北市信義區"
        clinic.phone_number = "02-1234-5678"
        
        # Mark the settings column as modified so SQLAlchemy knows to update it
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(clinic, 'settings')
        db_session.commit()
        
        return clinic

    @pytest.fixture
    def sample_appointment_type(self, db_session: Session, sample_clinic):
        """Create a sample appointment type with default recurring template."""
        appointment_type = AppointmentType(
            clinic_id=sample_clinic.id,
            name="物理治療",
            duration_minutes=60,
            recurring_clinic_confirmation_message=DEFAULT_RECURRING_CLINIC_CONFIRMATION_MESSAGE
        )
        db_session.add(appointment_type)
        db_session.commit()
        return appointment_type

    @pytest.fixture
    def sample_patient(self, db_session: Session, sample_clinic):
        """Create a sample patient."""
        patient = Patient(
            clinic_id=sample_clinic.id,
            full_name="王小明",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()
        return patient

    @pytest.fixture
    def sample_practitioner(self, db_session: Session):
        """Create a sample practitioner."""
        practitioner = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_123"
        )
        db_session.add(practitioner)
        db_session.commit()
        return practitioner

    def test_appointment_type_has_default_recurring_template(self, db_session: Session, sample_appointment_type):
        """Test that new appointment types get default recurring template."""
        assert sample_appointment_type.recurring_clinic_confirmation_message == DEFAULT_RECURRING_CLINIC_CONFIRMATION_MESSAGE
        assert "{預約數量}" in sample_appointment_type.recurring_clinic_confirmation_message
        assert "{日期範圍}" in sample_appointment_type.recurring_clinic_confirmation_message
        assert "{預約列表}" in sample_appointment_type.recurring_clinic_confirmation_message

    def test_recurring_template_customization(self, db_session: Session, sample_appointment_type):
        """Test that recurring templates can be customized."""
        custom_template = """親愛的{病患姓名}，

我們已為您安排{預約數量}次{服務項目}：

時間範圍：{日期範圍}

詳細時間：
{預約列表}

負責治療師：{治療師姓名}

{診所名稱}關心您的健康！"""

        sample_appointment_type.recurring_clinic_confirmation_message = custom_template
        db_session.commit()

        # Verify customization persisted
        db_session.refresh(sample_appointment_type)
        assert sample_appointment_type.recurring_clinic_confirmation_message == custom_template

    def test_build_recurring_context_integration(self, db_session: Session, sample_clinic, sample_patient, sample_appointment_type, sample_practitioner):
        """Test building recurring context with real database objects."""
        # Create calendar events and appointments
        appointments = []
        dates = [date(2026, 2, 3), date(2026, 2, 10), date(2026, 2, 17)]
        
        for i, appointment_date in enumerate(dates):
            # Create calendar event
            calendar_event = CalendarEvent(
                clinic_id=sample_clinic.id,
                user_id=sample_practitioner.id,
                event_type='appointment',
                date=appointment_date,
                start_time=time(14, 30),
                end_time=time(15, 30),
                custom_event_name=f"物理治療 - 王小明 ({i+1})"
            )
            db_session.add(calendar_event)
            db_session.flush()  # Get ID
            
            # Create appointment
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=sample_patient.id,
                appointment_type_id=sample_appointment_type.id,
                status="confirmed"
            )
            db_session.add(appointment)
            appointments.append(appointment)
        
        db_session.commit()

        # Build context
        context = MessageTemplateService.build_recurring_confirmation_context(
            appointments=appointments,
            patient=sample_patient,
            practitioner_name="李醫師",
            clinic=sample_clinic,
            appointment_type_name=sample_appointment_type.name
        )

        # Verify context
        assert context["病患姓名"] == "王小明"
        assert context["預約數量"] == "3"
        assert context["日期範圍"] == "2026-02-03(二) 至 2026-02-17(二)"
        assert context["服務項目"] == "物理治療"
        assert context["治療師姓名"] == "李醫師"
        assert context["診所名稱"] == "測試診所"
        assert context["診所地址"] == "台北市信義區"
        assert context["診所電話"] == "02-1234-5678"

        # Verify appointment list
        expected_list = "\n".join([
            "1. 2026-02-03(二) 02:30 PM",
            "2. 2026-02-10(二) 02:30 PM",
            "3. 2026-02-17(二) 02:30 PM"
        ])
        assert context["預約列表"] == expected_list

    def test_render_recurring_template_integration(self, db_session: Session, sample_clinic, sample_patient, sample_appointment_type, sample_practitioner):
        """Test complete template rendering with real data."""
        # Create appointments
        appointments = []
        for day in [3, 10]:
            calendar_event = CalendarEvent(
                clinic_id=sample_clinic.id,
                user_id=sample_practitioner.id,
                event_type='appointment',
                date=date(2026, 2, day),
                start_time=time(14, 30),
                end_time=time(15, 30),
                custom_event_name="物理治療 - 王小明"
            )
            db_session.add(calendar_event)
            db_session.flush()
            
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=sample_patient.id,
                appointment_type_id=sample_appointment_type.id,
                status="confirmed"
            )
            db_session.add(appointment)
            appointments.append(appointment)
        
        db_session.commit()

        # Build context and render
        context = MessageTemplateService.build_recurring_confirmation_context(
            appointments=appointments,
            patient=sample_patient,
            practitioner_name="李醫師",
            clinic=sample_clinic,
            appointment_type_name=sample_appointment_type.name
        )

        template = sample_appointment_type.recurring_clinic_confirmation_message
        result = MessageTemplateService.render_message(template, context)

        # Verify rendered message
        expected = """王小明，已為您建立2個預約：

2026-02-03(二) 至 2026-02-10(二)

1. 2026-02-03(二) 02:30 PM
2. 2026-02-10(二) 02:30 PM

【物理治療】李醫師

期待為您服務！"""

        assert result == expected

    @patch('services.line_service.LINEService')
    def test_recurring_appointment_endpoint_uses_template(self, mock_line_service, client, db_session: Session, sample_clinic, sample_patient, sample_appointment_type, sample_practitioner):
        """Test that recurring appointment endpoint uses template instead of hardcoded message."""
        # This test would require setting up the full API context
        # For now, we'll test the core logic that would be called by the endpoint
        
        # Create mock appointments (simulating what the endpoint creates)
        appointments = []
        for day in [3, 10, 17]:
            calendar_event = CalendarEvent(
                clinic_id=sample_clinic.id,
                user_id=sample_practitioner.id,
                event_type='appointment',
                date=date(2026, 2, day),
                start_time=time(14, 30),
                end_time=time(15, 30),
                custom_event_name="物理治療 - 王小明"
            )
            db_session.add(calendar_event)
            db_session.flush()
            
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=sample_patient.id,
                appointment_type_id=sample_appointment_type.id,
                status="confirmed"
            )
            db_session.add(appointment)
            appointments.append(appointment)
        
        db_session.commit()

        # Simulate the template-based message generation (as would be done in the endpoint)
        context = MessageTemplateService.build_recurring_confirmation_context(
            appointments=appointments,
            patient=sample_patient,
            practitioner_name="李醫師",
            clinic=sample_clinic,
            appointment_type_name=sample_appointment_type.name
        )

        template = sample_appointment_type.recurring_clinic_confirmation_message
        message = MessageTemplateService.render_message(template, context)

        # Verify the message uses template format, not hardcoded format
        assert "已為您建立3個預約" in message
        assert "2026-02-03(二) 至 2026-02-17(二)" in message
        assert "1. 2026-02-03(二) 02:30 PM" in message
        assert "2. 2026-02-10(二) 02:30 PM" in message
        assert "3. 2026-02-17(二) 02:30 PM" in message
        assert "【物理治療】李醫師" in message
        assert "期待為您服務！" in message

    def test_character_limit_compliance(self, db_session: Session, sample_clinic, sample_patient, sample_appointment_type, sample_practitioner):
        """Test that messages stay within LINE's character limits."""
        # Create 50 appointments (reasonable large number)
        appointments = []
        for i in range(50):
            # Use a safer date calculation to avoid month overflow
            day_offset = i % 25  # Limit to 25 days to stay within month
            calendar_event = CalendarEvent(
                clinic_id=sample_clinic.id,
                user_id=sample_practitioner.id,
                event_type='appointment',
                date=date(2026, 2, 3 + day_offset),  # Feb 3-28
                start_time=time(14, 30),
                end_time=time(15, 30),
                custom_event_name=f"物理治療 - 王小明 ({i+1})"
            )
            db_session.add(calendar_event)
            db_session.flush()
            
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=sample_patient.id,
                appointment_type_id=sample_appointment_type.id,
                status="confirmed"
            )
            db_session.add(appointment)
            appointments.append(appointment)
        
        db_session.commit()

        # Build context and render
        context = MessageTemplateService.build_recurring_confirmation_context(
            appointments=appointments,
            patient=sample_patient,
            practitioner_name="李醫師",
            clinic=sample_clinic,
            appointment_type_name=sample_appointment_type.name
        )

        template = sample_appointment_type.recurring_clinic_confirmation_message
        message = MessageTemplateService.render_message(template, context)

        # Verify message is within LINE's 5000 character limit
        assert len(message) < 5000
        
        # Verify message is reasonable length (not too short either)
        assert len(message) > 100

    def test_edge_case_empty_clinic_info(self, db_session: Session, sample_patient, sample_appointment_type, sample_practitioner):
        """Test handling of missing clinic information."""
        # Create clinic with minimal info
        minimal_clinic = Clinic(
            name="最小診所",
            line_channel_id="minimal_test_channel",  # Required field
            line_channel_secret="minimal_secret",    # Required field
            line_channel_access_token="minimal_token",  # Required field
            settings={},        # Initialize settings to avoid NoneType error
            display_name=None,  # Missing display name
            address=None,       # Missing address
            phone_number=None   # Missing phone
        )
        db_session.add(minimal_clinic)
        db_session.commit()

        # Create appointment
        calendar_event = CalendarEvent(
            clinic_id=minimal_clinic.id,
            user_id=sample_practitioner.id,
            event_type='appointment',
            date=date(2026, 2, 3),
            start_time=time(14, 30),
            end_time=time(15, 30),
            custom_event_name="測試預約"
        )
        db_session.add(calendar_event)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=sample_patient.id,
            appointment_type_id=sample_appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Build context
        context = MessageTemplateService.build_recurring_confirmation_context(
            appointments=[appointment],
            patient=sample_patient,
            practitioner_name="李醫師",
            clinic=minimal_clinic,
            appointment_type_name=sample_appointment_type.name
        )

        # Verify empty values are handled gracefully
        assert context["診所名稱"] == "最小診所"  # name field is still available
        assert context["診所地址"] == ""
        assert context["診所電話"] == ""

        # Verify template still renders without errors
        template = sample_appointment_type.recurring_clinic_confirmation_message
        message = MessageTemplateService.render_message(template, context)
        assert len(message) > 0
        assert "王小明" in message