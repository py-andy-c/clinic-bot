"""
Unit tests for practitioner notification scheduling service.

Tests practitioner daily notification scheduling logic when appointments are created/confirmed.
"""

import pytest
from datetime import datetime, timedelta, date, time

from models import (
    Appointment, AppointmentType, ScheduledLineMessage,
    Patient, Clinic, CalendarEvent
)
from models.user_clinic_association import UserClinicAssociation
from services.practitioner_notification_scheduling_service import PractitionerNotificationSchedulingService
from utils.datetime_utils import taiwan_now
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestPractitionerNotificationSchedulingService:
    """Test cases for practitioner notification scheduling service."""

    def test_schedule_notification_success(self, db_session):
        """Test successfully scheduling a practitioner notification."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        admin, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )

        practitioner, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_123",
            roles=["practitioner"],
            is_active=True
        )
        # Set notification time
        from models.user_clinic_association import PractitionerSettings
        settings = PractitionerSettings()
        settings.next_day_notification_time = "21:00"
        association.set_validated_settings(settings)
        association.line_user_id = "practitioner_line_id"
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

        # Appointment is tomorrow
        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        appointment_time = datetime.combine(appointment_date, time(14, 0))
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
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

        # Schedule notification
        PractitionerNotificationSchedulingService.schedule_notification_for_appointment(
            db_session, appointment
        )
        db_session.commit()

        # Verify notification was scheduled
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'practitioner_daily',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        assert scheduled.recipient_type == 'practitioner'
        assert scheduled.recipient_line_user_id == 'practitioner_line_id'
        assert scheduled.clinic_id == clinic.id
        assert scheduled.message_context['practitioner_id'] == practitioner.id
        assert scheduled.message_context['appointment_date'] == appointment_date.isoformat()
        assert scheduled.message_context['appointment_ids'] == [appointment.calendar_event_id]
        # Notification should be scheduled for today at 21:00 (day before appointment)
        from utils.datetime_utils import ensure_taiwan
        expected_date = appointment_date - timedelta(days=1)
        expected_time = datetime.combine(expected_date, time(21, 0))
        expected_time = ensure_taiwan(expected_time)
        assert expected_time is not None
        assert abs((scheduled.scheduled_send_time - expected_time).total_seconds()) < 3600  # Within 1 hour

    def test_schedule_notification_skips_auto_assigned(self, db_session):
        """Test that notifications are not scheduled for auto-assigned appointments."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

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
            duration_minutes=60
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

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        appointment_time = datetime.combine(appointment_date, time(14, 0))
        calendar_event = create_calendar_event_with_clinic(
            db_session, admin, clinic,
            event_type="appointment",
            event_date=appointment_date,
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

        # Schedule notification (should skip)
        PractitionerNotificationSchedulingService.schedule_notification_for_appointment(
            db_session, appointment
        )
        db_session.commit()

        # Verify no notification was scheduled
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'practitioner_daily'
        ).first()
        assert scheduled is None

    def test_schedule_notification_groups_appointments(self, db_session):
        """Test that multiple appointments on same day are grouped into one notification."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        admin, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Admin",
            email="admin@test.com",
            google_subject_id="admin_123",
            roles=["admin"],
            is_active=True
        )

        practitioner, association = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_123",
            roles=["practitioner"],
            is_active=True
        )
        from models.user_clinic_association import PractitionerSettings
        settings = PractitionerSettings()
        settings.next_day_notification_time = "21:00"
        association.set_validated_settings(settings)
        association.line_user_id = "practitioner_line_id"
        db_session.flush()

        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 1",
            phone_number="1234567890"
        )
        db_session.add(patient1)
        db_session.flush()

        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 2",
            phone_number="1234567891"
        )
        db_session.add(patient2)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Both appointments on same day
        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        
        # First appointment
        appointment_time1 = datetime.combine(appointment_date, time(10, 0))
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=appointment_time1.time(),
            end_time=(appointment_time1 + timedelta(minutes=60)).time()
        )
        db_session.flush()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment1)
        db_session.flush()

        # Schedule first notification
        PractitionerNotificationSchedulingService.schedule_notification_for_appointment(
            db_session, appointment1
        )
        db_session.commit()

        # Second appointment
        appointment_time2 = datetime.combine(appointment_date, time(14, 0))
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_date,
            start_time=appointment_time2.time(),
            end_time=(appointment_time2 + timedelta(minutes=60)).time()
        )
        db_session.flush()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment2)
        db_session.flush()

        # Schedule second notification (should update existing)
        PractitionerNotificationSchedulingService.schedule_notification_for_appointment(
            db_session, appointment2
        )
        db_session.commit()

        # Verify only one notification exists with both appointments
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'practitioner_daily',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        appointment_ids = scheduled.message_context['appointment_ids']
        assert len(appointment_ids) == 2
        assert appointment1.calendar_event_id in appointment_ids
        assert appointment2.calendar_event_id in appointment_ids

    def test_cancel_pending_notifications(self, db_session):
        """Test canceling pending notifications."""
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
            recipient_type='practitioner',
            recipient_line_user_id='practitioner_line_id',
            clinic_id=clinic.id,
            message_type='practitioner_daily',
            message_template="",
            message_context={
                'practitioner_id': 1,
                'appointment_date': '2024-01-15',
                'appointment_ids': [123, 456]
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Cancel notification for appointment 123
        PractitionerNotificationSchedulingService.cancel_pending_notifications(
            db_session, 123
        )
        db_session.commit()

        # Verify notification was updated (appointment 123 removed)
        db_session.refresh(scheduled)
        assert 123 not in scheduled.message_context['appointment_ids']
        assert 456 in scheduled.message_context['appointment_ids']
        assert scheduled.status == 'pending'  # Still pending because 456 remains

        # Cancel notification for appointment 456 (last one)
        PractitionerNotificationSchedulingService.cancel_pending_notifications(
            db_session, 456
        )
        db_session.commit()

        # Verify notification was cancelled
        db_session.refresh(scheduled)
        assert scheduled.status == 'skipped'

