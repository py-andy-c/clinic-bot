"""
Unit tests for patient form scheduler service.

Tests scheduling logic, timing calculations, and appointment lifecycle handling.
"""

import pytest
from datetime import datetime, timedelta, time as time_type
from unittest.mock import Mock, patch

from models import (
    Appointment, AppointmentType, AppointmentTypePatientFormConfig,
    ScheduledLineMessage, Patient, LineUser, Clinic, CalendarEvent,
    User, MedicalRecordTemplate
)
from services.patient_form_scheduler_service import PatientFormSchedulerService
from utils.datetime_utils import taiwan_now, ensure_taiwan, TAIWAN_TZ
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestPatientFormSchedulerService:
    """Test cases for patient form scheduler service."""

    def test_schedule_patient_forms_hours_before(self, db_session):
        """Test scheduling patient forms with hours before mode."""
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True,
            message_template="{病患姓名}，請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create patient form config (2 hours before)
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='send_immediately',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.flush()

        # Create appointment (2 days in future)
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
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        # Schedule patient forms
        PatientFormSchedulerService.schedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify scheduled message was created
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        assert scheduled.recipient_type == 'patient'
        assert scheduled.recipient_line_user_id == line_user.line_user_id
        assert scheduled.message_type == 'patient_form'
        assert scheduled.message_context['appointment_id'] == appointment.calendar_event_id
        assert scheduled.message_context['patient_form_config_id'] == config.id
        assert scheduled.message_context['medical_record_template_id'] == template.id
        
        # Verify scheduled time is 2 hours before appointment
        expected_time = appointment_time - timedelta(hours=2)
        assert abs((scheduled.scheduled_send_time - expected_time).total_seconds()) < 60

    def test_schedule_patient_forms_specific_time_after(self, db_session):
        """Test scheduling patient forms with specific time after mode."""
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Satisfaction Survey",
            fields=[],
            is_patient_form=True,
            message_template="請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create patient form config (1 day after at 21:00)
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='after',
            timing_mode='specific_time',
            days=1,
            time_of_day=time_type(21, 0),
            on_impossible=None,
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
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

        # Schedule patient forms
        PatientFormSchedulerService.schedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify scheduled message was created
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        assert scheduled.message_context['patient_form_config_id'] == config.id
        
        # Verify scheduled time is 1 day after appointment at 21:00
        appointment_end = appointment_time + timedelta(minutes=60)
        expected_date = appointment_end.date() + timedelta(days=1)
        expected_time = datetime.combine(expected_date, time_type(21, 0))
        expected_time = ensure_taiwan(expected_time)
        assert abs((scheduled.scheduled_send_time - expected_time).total_seconds()) < 60

    def test_schedule_patient_forms_late_booking_send_immediately(self, db_session):
        """Test late booking with send_immediately option."""
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True,
            message_template="請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create patient form config (2 hours before, send_immediately)
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='send_immediately',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.flush()

        # Create appointment in 1 hour (less than 2 hours before)
        appointment_time = taiwan_now() + timedelta(hours=1)
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

        # Schedule patient forms
        PatientFormSchedulerService.schedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify scheduled message was created with immediate send time
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form',
            ScheduledLineMessage.status == 'pending'
        ).first()

        assert scheduled is not None
        # Should be scheduled for ~1 minute from now (immediate send)
        current_time = taiwan_now()
        assert scheduled.scheduled_send_time > current_time
        assert (scheduled.scheduled_send_time - current_time).total_seconds() < 120  # Within 2 minutes

    def test_schedule_patient_forms_late_booking_skip(self, db_session):
        """Test late booking with skip option."""
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True,
            message_template="請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create patient form config (2 hours before, skip)
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='skip',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.flush()

        # Create appointment in 1 hour (less than 2 hours before)
        appointment_time = taiwan_now() + timedelta(hours=1)
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

        # Schedule patient forms
        PatientFormSchedulerService.schedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify no scheduled message was created (skipped)
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form'
        ).first()

        assert scheduled is None

    def test_schedule_patient_forms_past_appointment_skip(self, db_session):
        """Test that past appointments (recorded walk-ins) skip sending even with send_immediately."""
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True,
            message_template="請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create patient form config (2 hours before, send_immediately)
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='send_immediately',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.flush()

        # Create appointment in the past (recorded walk-in)
        appointment_time = taiwan_now() - timedelta(hours=1)
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

        # Schedule patient forms
        PatientFormSchedulerService.schedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify no scheduled message was created (past appointment)
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form'
        ).first()

        assert scheduled is None

    def test_schedule_patient_forms_no_line_user(self, db_session):
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='send_immediately',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
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

        # Schedule patient forms (should skip)
        PatientFormSchedulerService.schedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify no scheduled message was created
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form'
        ).first()

        assert scheduled is None

    def test_cancel_pending_patient_forms(self, db_session):
        """Test canceling pending patient forms."""
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
            message_type='patient_form',
            message_template="Test message",
            message_context={
                'appointment_id': 123,
                'patient_form_config_id': 1,
                'medical_record_template_id': 1
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Cancel pending messages
        PatientFormSchedulerService.cancel_pending_patient_forms(db_session, 123)
        db_session.commit()

        # Verify status changed
        db_session.refresh(scheduled)
        assert scheduled.status == 'skipped'

    def test_reschedule_patient_forms(self, db_session):
        """Test rescheduling patient forms when appointment is edited."""
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

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='send_immediately',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
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
            message_type='patient_form',
            message_template="Test message",
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'patient_form_config_id': config.id,
                'medical_record_template_id': template.id
            },
            scheduled_send_time=taiwan_now() + timedelta(hours=1),
            status='pending'
        )
        db_session.add(old_scheduled)
        db_session.flush()

        # Reschedule (should cancel old and create new)
        PatientFormSchedulerService.reschedule_patient_forms(db_session, appointment)
        db_session.commit()

        # Verify old message is skipped
        db_session.refresh(old_scheduled)
        assert old_scheduled.status == 'skipped'

        # Verify new message is created
        new_scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'patient_form',
            ScheduledLineMessage.status == 'pending',
            ScheduledLineMessage.id != old_scheduled.id
        ).first()

        assert new_scheduled is not None
        assert new_scheduled.message_context['appointment_id'] == appointment.calendar_event_id
