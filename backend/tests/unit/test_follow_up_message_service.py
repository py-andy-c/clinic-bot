"""
Unit tests for follow-up message service.

Tests scheduling logic, timing calculations, and appointment lifecycle handling.
"""

import pytest
from datetime import datetime, timedelta, time as time_type
from unittest.mock import Mock, patch

from models import Appointment, AppointmentType, FollowUpMessage, ScheduledLineMessage, Patient, LineUser, Clinic, CalendarEvent, User
from services.follow_up_message_service import FollowUpMessageService
from utils.datetime_utils import taiwan_now, ensure_taiwan, TAIWAN_TZ
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestFollowUpMessageService:
    """Test cases for follow-up message service."""

    def test_calculate_scheduled_time_hours_after(self):
        """Test calculating scheduled time for Mode A (hours after)."""
        appointment_end_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = FollowUpMessageService.calculate_scheduled_time(
            appointment_end_time,
            'hours_after',
            hours_after=2
        )
        
        expected = appointment_end_time + timedelta(hours=2)
        assert scheduled_time == expected

    def test_calculate_scheduled_time_specific_time(self):
        """Test calculating scheduled time for Mode B (specific time on days after)."""
        appointment_end_time = datetime(2024, 1, 15, 14, 30, tzinfo=TAIWAN_TZ)
        scheduled_time = FollowUpMessageService.calculate_scheduled_time(
            appointment_end_time,
            'specific_time',
            days_after=1,
            time_of_day=time_type(21, 0)
        )
        
        expected_date = appointment_end_time.date() + timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(21, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    def test_calculate_scheduled_time_specific_time_auto_adjust(self):
        """Test auto-adjustment when time is in past for Mode B."""
        appointment_end_time = datetime(2024, 1, 15, 22, 0, tzinfo=TAIWAN_TZ)  # 10pm
        scheduled_time = FollowUpMessageService.calculate_scheduled_time(
            appointment_end_time,
            'specific_time',
            days_after=0,  # Same day
            time_of_day=time_type(21, 0)  # 9pm (before 10pm)
        )
        
        # Should auto-adjust to next day at 9pm
        expected_date = appointment_end_time.date() + timedelta(days=1)
        expected = datetime.combine(expected_date, time_type(21, 0))
        expected = ensure_taiwan(expected)
        assert scheduled_time == expected

    def test_schedule_follow_up_messages(self, db_session):
        """Test scheduling follow-up messages when appointment is created."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
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

        line_user = LineUser(
            clinic_id=clinic.id,
            line_user_id="test_line_user_id",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        patient.line_user = line_user
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create follow-up message
        follow_up = FollowUpMessage(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            timing_mode='hours_after',
            hours_after=2,
            message_template="{病患姓名}，感謝您今天的預約！",
            is_enabled=True,
            display_order=0
        )
        db_session.add(follow_up)
        db_session.flush()

        # Create appointment
        appointment_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        # Schedule follow-up messages
        FollowUpMessageService.schedule_follow_up_messages(db_session, appointment)
        db_session.commit()

        # Verify scheduled message was created
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'follow_up',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        assert scheduled.recipient_type == 'patient'
        assert scheduled.recipient_line_user_id == line_user.line_user_id
        assert scheduled.message_type == 'follow_up'
        assert scheduled.message_template == follow_up.message_template
        assert scheduled.message_context['appointment_id'] == appointment.calendar_event_id
        assert scheduled.message_context['follow_up_message_id'] == follow_up.id

    def test_schedule_follow_up_messages_no_line_user(self, db_session):
        """Test that scheduling is skipped if patient has no LINE user."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
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
        # No LINE user

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        follow_up = FollowUpMessage(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            timing_mode='hours_after',
            hours_after=2,
            message_template="Test message",
            is_enabled=True,
            display_order=0
        )
        db_session.add(follow_up)
        db_session.flush()

        appointment_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        # Schedule follow-up messages (should skip)
        FollowUpMessageService.schedule_follow_up_messages(db_session, appointment)
        db_session.commit()

        # Verify no scheduled message was created
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'follow_up'
        ).first()

        assert scheduled is None

    def test_cancel_pending_follow_up_messages(self, db_session):
        """Test canceling pending follow-up messages."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create scheduled message
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="Test message",
            message_context={'appointment_id': 123, 'follow_up_message_id': 1},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Cancel pending messages
        FollowUpMessageService.cancel_pending_follow_up_messages(db_session, 123)
        db_session.commit()

        # Verify status changed
        db_session.refresh(scheduled)
        assert scheduled.status == 'skipped'

    def test_reschedule_follow_up_messages(self, db_session):
        """Test rescheduling follow-up messages when appointment is edited."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
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

        line_user = LineUser(
            clinic_id=clinic.id,
            line_user_id="test_line_user_id",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        patient.line_user = line_user
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        follow_up = FollowUpMessage(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            timing_mode='hours_after',
            hours_after=2,
            message_template="Test message",
            is_enabled=True,
            display_order=0
        )
        db_session.add(follow_up)
        db_session.flush()

        # Create appointment first
        appointment_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        # Create old scheduled message with correct appointment_id
        old_scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="Test message",
            message_context={'appointment_id': appointment.calendar_event_id, 'follow_up_message_id': follow_up.id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(old_scheduled)
        db_session.flush()

        # Reschedule (should cancel old and create new)
        FollowUpMessageService.reschedule_follow_up_messages(db_session, appointment)
        db_session.commit()

        # Verify old message is skipped
        db_session.refresh(old_scheduled)
        assert old_scheduled.status == 'skipped'

        # Verify new message is created
        new_scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'follow_up',
            ScheduledLineMessage.status == 'pending',
            ScheduledLineMessage.id != old_scheduled.id
        ).first()

        assert new_scheduled is not None
        assert new_scheduled.message_context['appointment_id'] == appointment.calendar_event_id

