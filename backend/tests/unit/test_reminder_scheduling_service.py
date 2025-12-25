"""
Unit tests for reminder scheduling service.

Tests reminder scheduling logic when appointments are created/confirmed.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

from models import (
    Appointment, AppointmentType, ScheduledLineMessage,
    Patient, LineUser, Clinic, CalendarEvent
)
from services.reminder_scheduling_service import ReminderSchedulingService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestReminderSchedulingService:
    """Test cases for reminder scheduling service."""

    def test_schedule_reminder_success(self, db_session):
        """Test successfully scheduling a reminder."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            settings={}
        )
        db_session.add(clinic)
        db_session.flush()
        clinic.reminder_hours_before = 24

        admin, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_123",
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
            duration_minutes=60,
            send_reminder=True,
            reminder_message="提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。\n\n請準時前往診所，期待為您服務！"
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_time = taiwan_now() + timedelta(days=2)  # 2 days in future
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
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.flush()
        # Set created_at on calendar_event since appointment.created_at comes from there
        from sqlalchemy import text
        db_session.execute(
            text("UPDATE calendar_events SET created_at = :created_at WHERE id = :event_id"),
            {"created_at": taiwan_now() - timedelta(hours=25), "event_id": calendar_event.id}
        )
        db_session.flush()
        # Refresh appointment to get updated created_at from calendar_event
        db_session.refresh(appointment)
        db_session.refresh(appointment.calendar_event)

        # Schedule reminder
        ReminderSchedulingService.schedule_reminder(db_session, appointment)
        db_session.commit()

        # Verify reminder was scheduled
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'appointment_reminder',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        assert scheduled.recipient_type == 'patient'
        assert scheduled.recipient_line_user_id == 'test_line_user_id'
        assert scheduled.clinic_id == clinic.id
        assert scheduled.message_context['appointment_id'] == appointment.calendar_event_id
        # Reminder should be scheduled 24 hours before appointment
        expected_time = appointment_time - timedelta(hours=24)
        assert abs((scheduled.scheduled_send_time - expected_time).total_seconds()) < 60

    def test_schedule_reminder_skips_auto_assigned(self, db_session):
        """Test that reminders are not scheduled for auto-assigned appointments."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            settings={}
        )
        db_session.add(clinic)
        db_session.flush()
        clinic.reminder_hours_before = 24

        admin, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60,
            send_reminder=True,
            reminder_message="提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。\n\n請準時前往診所，期待為您服務！"
        )
        db_session.add(appointment_type)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        appointment_time = taiwan_now() + timedelta(days=2)
        calendar_event = create_calendar_event_with_clinic(
            db_session, admin, clinic,
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
            status="confirmed",
            is_auto_assigned=True  # Auto-assigned
        )
        db_session.add(appointment)
        db_session.flush()

        # Schedule reminder (should skip)
        ReminderSchedulingService.schedule_reminder(db_session, appointment)
        db_session.commit()

        # Verify no reminder was scheduled
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'appointment_reminder'
        ).first()
        assert scheduled is None

    def test_schedule_reminder_skips_recent_appointment(self, db_session):
        """Test that reminders are not scheduled for recently created appointments."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            settings={}
        )
        db_session.add(clinic)
        db_session.flush()
        clinic.reminder_hours_before = 24

        admin, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_123",
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
            duration_minutes=60,
            send_reminder=True,
            reminder_message="提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。\n\n請準時前往診所，期待為您服務！"
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_time = taiwan_now() + timedelta(days=2)
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
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.flush()
        # Set created_at on calendar_event since appointment.created_at comes from there
        from sqlalchemy import text
        db_session.execute(
            text("UPDATE calendar_events SET created_at = :created_at WHERE id = :event_id"),
            {"created_at": taiwan_now() - timedelta(hours=1), "event_id": calendar_event.id}
        )
        db_session.flush()
        # Refresh appointment to get updated created_at from calendar_event
        db_session.refresh(appointment)
        db_session.refresh(appointment.calendar_event)

        # Schedule reminder (should skip because too recent)
        ReminderSchedulingService.schedule_reminder(db_session, appointment)
        db_session.commit()

        # Verify no reminder was scheduled
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'appointment_reminder'
        ).first()
        assert scheduled is None

    def test_cancel_pending_reminder(self, db_session):
        """Test canceling pending reminders."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='appointment_reminder',
            message_template="Test reminder",
            message_context={'appointment_id': 123},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Cancel reminder
        ReminderSchedulingService.cancel_pending_reminder(db_session, 123)
        db_session.commit()

        # Verify reminder was cancelled
        db_session.refresh(scheduled)
        assert scheduled.status == 'skipped'

    def test_reschedule_reminder(self, db_session):
        """Test rescheduling a reminder."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            settings={}
        )
        db_session.add(clinic)
        db_session.flush()
        clinic.reminder_hours_before = 24

        admin, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )

        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_123",
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
            duration_minutes=60,
            send_reminder=True,
            reminder_message="提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。\n\n請準時前往診所，期待為您服務！"
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create appointment first
        appointment_time = taiwan_now() + timedelta(days=3)  # 3 days in future
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
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.flush()
        # Set created_at on calendar_event since appointment.created_at comes from there
        from sqlalchemy import text
        db_session.execute(
            text("UPDATE calendar_events SET created_at = :created_at WHERE id = :event_id"),
            {"created_at": taiwan_now() - timedelta(hours=25), "event_id": calendar_event.id}
        )
        db_session.flush()

        # Create old scheduled reminder for this appointment
        old_scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='appointment_reminder',
            message_template="Old reminder",
            message_context={'appointment_id': appointment.calendar_event_id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(old_scheduled)
        db_session.flush()

        # Reschedule reminder
        ReminderSchedulingService.reschedule_reminder(db_session, appointment)
        db_session.commit()

        # Verify old reminder was cancelled
        db_session.refresh(old_scheduled)
        assert old_scheduled.status == 'skipped'

        # Verify new reminder was scheduled
        new_scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'appointment_reminder',
            ScheduledLineMessage.status == 'pending',
            ScheduledLineMessage.id != old_scheduled.id
        ).first()
        assert new_scheduled is not None
        assert new_scheduled.message_context['appointment_id'] == appointment.calendar_event_id

