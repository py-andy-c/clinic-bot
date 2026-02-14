"""
Unit tests for ScheduledMessageService patient form processing.

Tests the Commit-Before-Send flow, de-duplication, and audit trail for patient forms.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

from models import (
    Appointment, AppointmentType, ScheduledLineMessage,
    Patient, LineUser, Clinic, CalendarEvent, User,
    MedicalRecordTemplate, MedicalRecord
)
from services.scheduled_message_service import ScheduledMessageService
from utils.datetime_utils import taiwan_now, ensure_taiwan, TAIWAN_TZ
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestScheduledMessageServicePatientForm:
    """Test cases for patient form message processing."""

    def test_process_patient_form_creates_record_and_sends(self, db_session):
        """Test that patient form processing creates medical record before sending."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            liff_id="test_liff_id"
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

        # Create scheduled message
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
            clinic_id=clinic.id,
            message_type='patient_form',
            message_template=template.message_template,
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'patient_form_config_id': 1,
                'medical_record_template_id': template.id
            },
            scheduled_send_time=taiwan_now() - timedelta(minutes=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Mock LINE service
        with patch('services.scheduled_message_service.LINEService') as mock_line_service:
            mock_instance = MagicMock()
            mock_line_service.return_value = mock_instance
            
            # Process the message
            success = ScheduledMessageService._process_patient_form_message(
                db_session, scheduled
            )
            
            assert success is True
            
            # Verify medical record was created
            medical_record = db_session.query(MedicalRecord).filter(
                MedicalRecord.appointment_id == appointment.calendar_event_id,
                MedicalRecord.template_id == template.id
            ).first()
            
            assert medical_record is not None
            assert medical_record.patient_id == patient.id
            assert medical_record.is_submitted is False
            
            # Verify LINE message was sent
            mock_instance.send_template_message_with_button.assert_called_once()
            call_args = mock_instance.send_template_message_with_button.call_args
            assert call_args[1]['line_user_id'] == line_user.line_user_id
            assert '填寫表單' in call_args[1]['button_label']
            
            # Verify scheduled message status updated
            db_session.refresh(scheduled)
            assert scheduled.status == 'sent'
            assert scheduled.actual_send_time is not None
            
            # Verify audit trail: medical_record_id in context
            assert scheduled.message_context['medical_record_id'] == medical_record.id

    def test_process_patient_form_deduplication(self, db_session):
        """Test that duplicate medical records are not created (de-duplication)."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            liff_id="test_liff_id"
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

        # Create existing medical record (simulating retry scenario)
        existing_record = MedicalRecord(
            clinic_id=clinic.id,
            patient_id=patient.id,
            template_id=template.id,
            template_name=template.name,
            template_snapshot={"fields": template.fields},
            values={},
            appointment_id=appointment.calendar_event_id,
            created_by_user_id=None,
            is_submitted=False
        )
        db_session.add(existing_record)
        db_session.commit()

        existing_record_id = existing_record.id

        # Create scheduled message
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
            clinic_id=clinic.id,
            message_type='patient_form',
            message_template=template.message_template,
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'patient_form_config_id': 1,
                'medical_record_template_id': template.id
            },
            scheduled_send_time=taiwan_now() - timedelta(minutes=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Mock LINE service
        with patch('services.scheduled_message_service.LINEService') as mock_line_service:
            mock_instance = MagicMock()
            mock_line_service.return_value = mock_instance
            
            # Process the message (retry scenario)
            success = ScheduledMessageService._process_patient_form_message(
                db_session, scheduled
            )
            
            assert success is True
            
            # Verify NO new medical record was created (de-duplication)
            records = db_session.query(MedicalRecord).filter(
                MedicalRecord.appointment_id == appointment.calendar_event_id,
                MedicalRecord.template_id == template.id
            ).all()
            
            assert len(records) == 1
            assert records[0].id == existing_record_id
            
            # Verify LINE message was still sent (retry)
            mock_instance.send_template_message_with_button.assert_called_once()
            
            # Verify audit trail uses existing record ID
            db_session.refresh(scheduled)
            assert scheduled.message_context['medical_record_id'] == existing_record_id

    def test_process_patient_form_commit_before_send(self, db_session):
        """Test that medical record is committed BEFORE LINE message is sent."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial",
            liff_id="test_liff_id"
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

        # Create scheduled message
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
            clinic_id=clinic.id,
            message_type='patient_form',
            message_template=template.message_template,
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'patient_form_config_id': 1,
                'medical_record_template_id': template.id
            },
            scheduled_send_time=taiwan_now() - timedelta(minutes=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Track when medical record is committed vs when LINE message is sent
        medical_record_committed = False
        
        def track_send(*args, **kwargs):
            # When LINE send is called, verify medical record already exists in DB
            # This proves it was committed before the send
            record_exists = db_session.query(MedicalRecord).filter(
                MedicalRecord.appointment_id == appointment.calendar_event_id,
                MedicalRecord.template_id == template.id
            ).first()
            assert record_exists is not None, "Medical record not committed before LINE send!"
        
        # Mock LINE service and track order
        with patch('services.scheduled_message_service.LINEService') as mock_line_service:
            mock_instance = MagicMock()
            mock_line_service.return_value = mock_instance
            mock_instance.send_template_message_with_button.side_effect = track_send
            
            # Process the message
            success = ScheduledMessageService._process_patient_form_message(
                db_session, scheduled
            )
            
            assert success is True
            # Verify LINE send was called (which means our assertion passed)
            mock_instance.send_template_message_with_button.assert_called_once()

    def test_process_patient_form_no_line_user(self, db_session):
        """Test that processing is skipped if patient has no LINE user."""
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

        # Create scheduled message
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id='nonexistent',
            clinic_id=clinic.id,
            message_type='patient_form',
            message_template="Test",
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'patient_form_config_id': 1,
                'medical_record_template_id': template.id
            },
            scheduled_send_time=taiwan_now() - timedelta(minutes=1),
            status='pending'
        )
        db_session.add(scheduled)
        db_session.commit()

        # Process the message
        success = ScheduledMessageService._process_patient_form_message(
            db_session, scheduled
        )
        
        assert success is False
        
        # Verify no medical record was created
        records = db_session.query(MedicalRecord).filter(
            MedicalRecord.appointment_id == appointment.calendar_event_id
        ).all()
        
        assert len(records) == 0
        
        # Verify scheduled message was skipped
        db_session.refresh(scheduled)
        assert scheduled.status == 'skipped'
        assert 'no LINE user' in scheduled.error_message
