"""
Unit tests for scheduled message service.

Tests message sending logic, label building, and validation.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

from models import (
    Appointment, AppointmentType, FollowUpMessage, ScheduledLineMessage,
    Patient, LineUser, Clinic, CalendarEvent, User
)
from services.scheduled_message_service import ScheduledMessageService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestScheduledMessageService:
    """Test cases for scheduled message service."""

    def test_build_labels_for_message_type_follow_up(self):
        """Test building labels for follow-up messages."""
        labels = ScheduledMessageService.build_labels_for_message_type(
            'follow_up',
            {'recipient_type': 'patient'}
        )
        
        assert labels['recipient_type'] == 'patient'
        assert labels['trigger_source'] == 'system_triggered'
        assert labels['event_type'] == 'appointment_follow_up'

    def test_build_labels_for_message_type_reminder(self):
        """Test building labels for reminder messages."""
        labels = ScheduledMessageService.build_labels_for_message_type(
            'appointment_reminder',
            {'recipient_type': 'patient'}
        )
        
        assert labels['recipient_type'] == 'patient'
        assert labels['trigger_source'] == 'system_triggered'
        assert labels['event_type'] == 'appointment_reminder'

    def test_build_labels_for_message_type_practitioner_daily(self):
        """Test building labels for practitioner daily notifications."""
        labels = ScheduledMessageService.build_labels_for_message_type(
            'practitioner_daily',
            {'recipient_type': 'practitioner'}
        )
        
        assert labels['recipient_type'] == 'practitioner'
        assert labels['trigger_source'] == 'system_triggered'
        assert labels['event_type'] == 'practitioner_daily_notification'

    def test_validate_appointment_for_message_valid(self, db_session):
        """Test validation when appointment is valid."""
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

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="Test message",
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'follow_up_message_id': follow_up.id
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is True

    def test_validate_appointment_for_message_canceled(self, db_session):
        """Test validation when appointment is canceled."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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
            status="canceled_by_patient"  # Canceled
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="Test message",
            message_context={'appointment_id': appointment.calendar_event_id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate (should return False for canceled appointment)
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is False

    def test_validate_appointment_for_message_disabled(self, db_session):
        """Test validation when follow-up message is disabled."""
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
            is_enabled=False,  # Disabled
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

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="Test message",
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'follow_up_message_id': follow_up.id
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate (should return False for disabled follow-up)
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is False

    @patch('services.scheduled_message_service.LINEService')
    @patch('services.scheduled_message_service.MessageTemplateService')
    def test_send_pending_messages_success(self, mock_template_service, mock_line_service_class, db_session):
        """Test successfully sending pending messages."""
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
            message_template="{病患姓名}，感謝您今天的預約！",
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

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="{病患姓名}，感謝您今天的預約！",
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'follow_up_message_id': follow_up.id
            },
            scheduled_send_time=taiwan_now() - timedelta(minutes=1),  # In past, should send
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Mock LINE service
        mock_line_service = Mock()
        mock_line_service_class.return_value = mock_line_service
        mock_line_service.send_text_message.return_value = "test_message_id"

        # Mock template service
        mock_template_service.render_message.return_value = "Test Patient，感謝您今天的預約！"
        mock_template_service.build_confirmation_context.return_value = {
            '病患姓名': 'Test Patient',
            'recipient_type': 'patient'
        }

        # Send pending messages
        ScheduledMessageService.send_pending_messages(db_session, batch_size=10)
        db_session.commit()

        # Verify message was sent
        db_session.refresh(scheduled)
        assert scheduled.status == 'sent'
        assert scheduled.actual_send_time is not None
        mock_line_service.send_text_message.assert_called_once()

    def test_validate_appointment_for_message_reminder_valid(self, db_session):
        """Test validation for reminder messages when appointment is valid."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60,
            send_reminder=True
        )
        db_session.add(appointment_type)
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
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='appointment_reminder',
            message_template="Test reminder",
            message_context={'appointment_id': appointment.calendar_event_id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is True

    def test_validate_appointment_for_message_reminder_auto_assigned(self, db_session):
        """Test validation for reminder messages when appointment is auto-assigned."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create a practitioner user (even though appointment is auto-assigned)
        user, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_subject_123",
            roles=["practitioner"],
            is_active=True
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60,
            send_reminder=True
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
            status="confirmed",
            is_auto_assigned=True  # Auto-assigned
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='appointment_reminder',
            message_template="Test reminder",
            message_context={'appointment_id': appointment.calendar_event_id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate (should return False for auto-assigned)
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is False

    def test_validate_appointment_for_message_practitioner_daily(self, db_session):
        """Test validation for practitioner daily notifications."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        appointment_time = datetime.combine(appointment_date, datetime.min.time())
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
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
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='practitioner',
            recipient_line_user_id='practitioner_line_id',
            clinic_id=clinic.id,
            message_type='practitioner_daily',
            message_template="",
            message_context={
                'practitioner_id': user.id,
                'appointment_date': appointment_date.isoformat(),
                'appointment_ids': [appointment.calendar_event_id]
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is True

    @patch('services.scheduled_message_service.LINEService')
    @patch('services.scheduled_message_service.MessageTemplateService')
    def test_build_message_context_reminder(self, mock_template_service, mock_line_service_class, db_session):
        """Test building message context for reminder messages."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='appointment_reminder',
            message_template="Test reminder",
            message_context={'appointment_id': appointment.calendar_event_id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Mock template service
        mock_template_service.build_reminder_context.return_value = {
            '病患姓名': 'Test Patient',
            'recipient_type': 'patient'
        }

        # Build context
        context = ScheduledMessageService.build_message_context(db_session, scheduled)
        
        assert context['recipient_type'] == 'patient'
        mock_template_service.build_reminder_context.assert_called_once()

    @patch('utils.datetime_utils.format_datetime')
    def test_build_message_context_practitioner_daily(self, mock_format_datetime, db_session):
        """Test building message context for practitioner daily notifications."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        appointment_time = datetime.combine(appointment_date, datetime.min.time())
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
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
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='practitioner',
            recipient_line_user_id='practitioner_line_id',
            clinic_id=clinic.id,
            message_type='practitioner_daily',
            message_template="",
            message_context={
                'practitioner_id': user.id,
                'appointment_date': appointment_date.isoformat(),
                'appointment_ids': [appointment.calendar_event_id]
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        mock_format_datetime.return_value = "2024年1月15日 10:00"

        # Build context
        context = ScheduledMessageService.build_message_context(db_session, scheduled)
        
        assert context['recipient_type'] == 'practitioner'
        assert 'built_message' in context
        assert 'Test Patient' in context['built_message']
        assert 'Test Type' in context['built_message']

    def test_validate_appointment_for_message_deleted_appointment_type_follow_up(self, db_session):
        """Test validation when appointment type is deleted for follow-up messages."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60,
            is_deleted=True  # Deleted appointment type
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

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='follow_up',
            message_template="Test message",
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'follow_up_message_id': follow_up.id
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate (should return False for deleted appointment type)
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is False

    def test_validate_appointment_for_message_deleted_appointment_type_reminder(self, db_session):
        """Test validation when appointment type is deleted for reminder messages."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60,
            send_reminder=True,
            is_deleted=True  # Deleted appointment type
        )
        db_session.add(appointment_type)
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
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='test_line_user_id',
            clinic_id=clinic.id,
            message_type='appointment_reminder',
            message_template="Test reminder",
            message_context={'appointment_id': appointment.calendar_event_id},
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate (should return False for deleted appointment type)
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is False

    def test_validate_appointment_for_message_deleted_appointment_type_practitioner_daily(self, db_session):
        """Test validation when appointment type is deleted for practitioner daily notifications."""
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

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60,
            is_deleted=True  # Deleted appointment type
        )
        db_session.add(appointment_type)
        db_session.flush()

        appointment_date = (taiwan_now() + timedelta(days=1)).date()
        appointment_time = datetime.combine(appointment_date, datetime.min.time())
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
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
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        scheduled = ScheduledLineMessage(
            recipient_type='practitioner',
            recipient_line_user_id='practitioner_line_id',
            clinic_id=clinic.id,
            message_type='practitioner_daily',
            message_template="",
            message_context={
                'practitioner_id': user.id,
                'appointment_date': appointment_date.isoformat(),
                'appointment_ids': [appointment.calendar_event_id]
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.flush()

        # Validate (should return False for deleted appointment type)
        is_valid = ScheduledMessageService.validate_appointment_for_message(
            db_session, scheduled
        )
        
        assert is_valid is False

