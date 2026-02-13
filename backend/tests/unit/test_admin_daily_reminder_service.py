"""
Unit tests for admin daily appointment reminder service.

Tests daily notifications sent to clinic admins about all appointments for the next day.
"""

import pytest
from datetime import datetime, date, time, timedelta
from unittest.mock import Mock, patch, AsyncMock
from typing import Dict, Optional, List

from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.clinic import Clinic
from core.database import get_db_context
from models.patient import Patient
from models.user import User
from models.appointment_type import AppointmentType
from models.user_clinic_association import UserClinicAssociation, PractitionerSettings
from services.admin_daily_reminder_service import (
    AdminDailyNotificationService,
    LINE_MESSAGE_MAX_CHARS,
    LINE_MESSAGE_TARGET_CHARS
)
from utils.datetime_utils import taiwan_now
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestAdminDailyNotificationService:
    """Test cases for admin daily reminder service."""

    def test_get_clinic_admins_with_daily_reminder(self, db_session):
        """Test that all admins with LINE accounts are returned (no opt-in check)."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create admin with LINE account
        admin1, admin1_assoc = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin 1",
            email="admin1@test.com",
            google_subject_id="admin1_123",
            roles=["admin"],
            is_active=True
        )
        admin1_assoc.line_user_id = "admin1_line_id"
        db_session.flush()

        # Create admin without LINE account (should be excluded)
        admin2, admin2_assoc = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin 2",
            email="admin2@test.com",
            google_subject_id="admin2_123",
            roles=["admin"],
            is_active=True
        )
        # No line_user_id set
        db_session.flush()

        # Create non-admin user (should be excluded)
        user3, user3_assoc = create_user_with_clinic_association(
            db_session, clinic,
            full_name="User 3",
            email="user3@test.com",
            google_subject_id="user3_123",
            roles=["practitioner"],
            is_active=True
        )
        user3_assoc.line_user_id = "user3_line_id"
        db_session.flush()

        service = AdminDailyNotificationService()
        admins = service._get_clinic_admins_with_daily_reminder(db_session, clinic.id)

        # Should only return admin1 (has LINE account)
        assert len(admins) == 1
        assert admins[0].user_id == admin1.id
        assert admins[0].line_user_id == "admin1_line_id"

    def test_group_appointments_by_practitioner(self, db_session):
        """Test grouping appointments by practitioner ID."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 1",
            email="p1@test.com",
            google_subject_id="p1_123",
            roles=["practitioner"],
            is_active=True
        )

        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 2",
            email="p2@test.com",
            google_subject_id="p2_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        # Create appointments for practitioner1
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner1, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment1)
        db_session.flush()

        # Create appointment for practitioner2
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner2, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.flush()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment2)
        db_session.flush()

        # Create auto-assigned appointment
        # Auto-assigned appointments are grouped by their calendar_event.user_id (assigned practitioner)
        # But in the message, they should appear under "不指定" if originally_auto_assigned=True
        # For testing grouping, we'll create an appointment assigned to a practitioner
        # but marked as originally_auto_assigned
        calendar_event3 = create_calendar_event_with_clinic(
            db_session, practitioner1, clinic,  # Assigned to practitioner1
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(16, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        appointment3 = Appointment(
            calendar_event_id=calendar_event3.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False,  # Currently assigned, but originally was auto-assigned
            originally_auto_assigned=True
        )
        db_session.add(appointment3)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments = [appointment1, appointment2, appointment3]
        grouped = service._group_appointments_by_practitioner(appointments)

        # Should have 2 groups: practitioner1 (with 2 appointments), practitioner2 (with 1)
        # Note: Grouping is by calendar_event.user_id, not by originally_auto_assigned
        assert len(grouped) == 2
        assert practitioner1.id in grouped
        assert practitioner2.id in grouped
        assert len(grouped[practitioner1.id]) == 2  # appointment1 and appointment3
        assert len(grouped[practitioner2.id]) == 1

    def test_build_clinic_wide_message_single_practitioner(self, db_session):
        """Test building message for single practitioner with few appointments."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="p@test.com",
            google_subject_id="p_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="物理治療",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False,
            notes="初次評估"
        )
        db_session.add(appointment)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: [appointment]}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # Should return single message
        assert len(messages) == 1
        message = messages[0]
        
        # Check message format
        assert "預約總覽" in message
        assert "治療師：" in message
        assert "共有 1 個預約" in message
        assert "Test Patient" in message or "病患：" in message
        assert "物理治療" in message
        assert "初次評估" in message
        
        # Check message length
        assert len(message) <= LINE_MESSAGE_MAX_CHARS

    def test_build_clinic_wide_message_multiple_practitioners(self, db_session):
        """Test building message for multiple practitioners."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 1",
            email="p1@test.com",
            google_subject_id="p1_123",
            roles=["practitioner"],
            is_active=True
        )

        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 2",
            email="p2@test.com",
            google_subject_id="p2_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        # Create appointment for practitioner1
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner1, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment1)
        db_session.flush()

        # Create appointment for practitioner2
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner2, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.flush()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment2)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: [appointment1, appointment2]}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # Should return single message (both practitioners fit)
        assert len(messages) == 1
        message = messages[0]
        
        # Should contain both practitioners
        assert "治療師：" in message
        assert len(message) <= LINE_MESSAGE_MAX_CHARS

    def test_build_clinic_wide_message_splits_when_exceeds_target(self, db_session):
        """Test that messages are split when they exceed 4500 chars."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 1",
            email="p1@test.com",
            google_subject_id="p1_123",
            roles=["practitioner"],
            is_active=True
        )

        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 2",
            email="p2@test.com",
            google_subject_id="p2_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        # Create many appointments for practitioner1 to exceed target
        appointments1 = []
        for i in range(50):  # Create 50 appointments
            hour = 9 + (i % 14)  # Cycle through hours 9-22
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner1, clinic,
                event_type="appointment",
                event_date=appointment_date,
                start_time=time(hour, 0),
                end_time=time(hour + 1, 0)
            )
            db_session.flush()

            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                status="confirmed",
                is_auto_assigned=False,
                notes=f"Note {i} " * 20  # Long notes (but within 500 char limit)
            )
            db_session.add(appointment)
            appointments1.append(appointment)
        db_session.flush()

        # Create appointment for practitioner2
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner2, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.flush()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment2)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: appointments1}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # Should split into multiple messages
        assert len(messages) > 1
        
        # All messages should be under limit
        for i, msg in enumerate(messages, 1):
            assert len(msg) <= LINE_MESSAGE_MAX_CHARS, f"Message {i} exceeds limit: {len(msg)} chars"
            # Multi-part messages should have part indicator
            if len(messages) > 1:
                assert f"第 {i}/{len(messages)} 部分" in msg

    def test_build_clinic_wide_message_single_practitioner_exceeds_limit(self, db_session):
        """Test fallback split when single practitioner exceeds 4500 chars."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner",
            email="p@test.com",
            google_subject_id="p_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        # Create many appointments with long notes to exceed limit
        appointments = []
        for i in range(100):  # Create 100 appointments with long notes
            hour = 9 + (i % 14)  # Cycle through hours 9-22
            minute = (i * 5) % 60
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                event_type="appointment",
                event_date=appointment_date,
                start_time=time(hour, minute),
                end_time=time(hour + 1 if hour < 23 else 23, minute)
            )
            db_session.flush()

            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                status="confirmed",
                is_auto_assigned=False,
                notes=f"Note {i} " * 30  # Long notes (but within 500 char limit)
            )
            db_session.add(appointment)
            appointments.append(appointment)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: appointments}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # Should split into multiple messages (fallback: mid-practitioner split)
        assert len(messages) > 1
        
        # Check for continuation format
        found_continuation = False
        for msg in messages[1:]:  # Check messages after first
            if "(續上頁)" in msg:
                found_continuation = True
                break
        assert found_continuation, "Should have continuation format for mid-practitioner split"
        
        # All messages should be under limit
        for i, msg in enumerate(messages, 1):
            assert len(msg) <= LINE_MESSAGE_MAX_CHARS, f"Message {i} exceeds limit: {len(msg)} chars"

    def test_build_clinic_wide_message_auto_assigned(self, db_session):
        """Test that auto-assigned appointments are included (grouped under '不指定')."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        # Create appointment that was originally auto-assigned
        # In the admin reminder, appointments with originally_auto_assigned=True
        # are grouped under "不指定" in the message
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner",
            email="p@test.com",
            google_subject_id="p_123",
            roles=["practitioner"],
            is_active=True
        )
        
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False,
            originally_auto_assigned=True  # Originally was auto-assigned
        )
        db_session.add(appointment)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: [appointment]}
        # We need to make sure the practitioner_id is None for the appointment
        appointment.calendar_event.user_id = None
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        assert len(messages) == 1
        message = messages[0]
        
        # Should include appointments under "不指定" when practitioner_id is None
        assert "不指定" in message
        assert len(message) <= LINE_MESSAGE_MAX_CHARS

    def test_build_clinic_wide_message_empty_appointments(self, db_session):
        """Test that empty appointments list returns empty messages list."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        service = AdminDailyNotificationService()
        appointments_by_date: Dict[date, List[Appointment]] = {}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # Should return empty list
        assert len(messages) == 0

    def test_build_clinic_wide_message_very_long_names(self, db_session):
        """Test handling of very long patient names and notes."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner",
            email="p@test.com",
            google_subject_id="p_123",
            roles=["practitioner"],
            is_active=True
        )

        # Create patient with very long name
        patient = Patient(
            clinic_id=clinic.id,
            full_name="A" * 200,  # Very long name
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="B" * 100,  # Very long type name
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False,
            notes="C" * 500  # Very long notes
        )
        db_session.add(appointment)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: [appointment]}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # Should still work and stay under limit
        assert len(messages) >= 1
        for msg in messages:
            assert len(msg) <= LINE_MESSAGE_MAX_CHARS

    @pytest.mark.asyncio
    async def test_send_admin_reminders_skips_empty_next_day(self, db_session):
        """Test that reminders are skipped when there are no appointments for next day."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        admin, admin_assoc = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )
        admin_assoc.line_user_id = "admin_line_id"
        settings = PractitionerSettings(next_day_notification_time="21:00")
        admin_assoc.set_validated_settings(settings)
        db_session.flush()

        service = AdminDailyNotificationService()
        
        # Mock current time to be 21:00
        with patch('services.admin_daily_reminder_service.taiwan_now') as mock_now:
            current_time = taiwan_now().replace(hour=21, minute=0, second=0, microsecond=0)
            mock_now.return_value = current_time
            
            # Mock NotificationService to track calls
            with patch('services.admin_daily_reminder_service.NotificationService._send_notification_to_recipients') as mock_send:
                # Mock get_db_context to return our session
                from contextlib import contextmanager
                
                @contextmanager
                def mock_db_context():
                    yield db_session
                
                with patch('services.admin_daily_reminder_service.get_db_context', mock_db_context):
                    await service._send_admin_reminders()
                    
                    # Should not send any messages (no appointments)
                    mock_send.assert_not_called()

    @pytest.mark.asyncio
    async def test_send_admin_reminders_groups_by_time(self, db_session):
        """Test that admins are grouped by their reminder time setting."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create admin with 21:00 time
        admin1, admin1_assoc = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin 1",
            email="admin1@test.com",
            google_subject_id="admin1_123",
            roles=["admin"],
            is_active=True
        )
        admin1_assoc.line_user_id = "admin1_line_id"
        settings1 = PractitionerSettings(next_day_notification_time="21:00")
        admin1_assoc.set_validated_settings(settings1)
        db_session.flush()

        # Create admin with 20:00 time
        admin2, admin2_assoc = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin 2",
            email="admin2@test.com",
            google_subject_id="admin2_123",
            roles=["admin"],
            is_active=True
        )
        admin2_assoc.line_user_id = "admin2_line_id"
        settings2 = PractitionerSettings(next_day_notification_time="20:00")
        admin2_assoc.set_validated_settings(settings2)
        db_session.flush()

        # Create appointments for next day
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner",
            email="p@test.com",
            google_subject_id="p_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.flush()

        service = AdminDailyNotificationService()
        
        # Mock current time to be 21:00
        with patch('services.admin_daily_reminder_service.taiwan_now') as mock_now:
            current_time = taiwan_now().replace(hour=21, minute=0, second=0, microsecond=0)
            mock_now.return_value = current_time
            
            # Mock NotificationService to track calls
            with patch('services.admin_daily_reminder_service.NotificationService._send_notification_to_recipients') as mock_send:
                mock_send.return_value = 1  # Success count
                
                # Mock get_db_context to return our session
                from contextlib import contextmanager
                
                @contextmanager
                def mock_db_context():
                    yield db_session
                
                with patch('services.admin_daily_reminder_service.get_db_context', mock_db_context):
                    await service._send_admin_reminders()
                    
                    # Should only send to admin1 (21:00), not admin2 (20:00)
                    assert mock_send.called
                    # Check that admin1 was in the recipients
                    call_args = mock_send.call_args
                    recipients = call_args[0][3]  # recipients is 4th positional arg
                    assert len(recipients) == 1
                    assert recipients[0].user_id == admin1.id

    def test_message_length_validation(self, db_session):
        """Test that final messages with headers stay under 5000 chars."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner",
            email="p@test.com",
            google_subject_id="p_123",
            roles=["practitioner"],
            is_active=True
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()

        # Create enough appointments to trigger splitting
        appointments = []
        for i in range(80):  # Create many appointments
            hour = 9 + (i % 14)  # Cycle through hours 9-22
            minute = (i * 5) % 60
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                event_type="appointment",
                event_date=appointment_date,
                start_time=time(hour, minute),
                end_time=time(hour + 1 if hour < 23 else 23, minute)
            )
            db_session.flush()

            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                status="confirmed",
                is_auto_assigned=False,
                notes=f"Note {i} " * 30  # Long notes (but within 500 char limit)
            )
            db_session.add(appointment)
            appointments.append(appointment)
        db_session.flush()

        service = AdminDailyNotificationService()
        appointments_by_date = {appointment_date: appointments}
        messages = service._build_clinic_wide_message_for_range(
            db_session, appointments_by_date, appointment_date, appointment_date, clinic.id
        )

        # All messages should be under 5000 chars (including headers)
        for i, msg in enumerate(messages, 1):
            assert len(msg) <= LINE_MESSAGE_MAX_CHARS, \
                f"Message {i}/{len(messages)} exceeds limit: {len(msg)} chars (limit: {LINE_MESSAGE_MAX_CHARS})"

