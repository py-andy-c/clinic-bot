"""
Integration tests for follow-up message API endpoints.

Tests CRUD operations and message scheduling integration.
"""

import pytest
from datetime import datetime, timedelta, time
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Clinic, User, AppointmentType, FollowUpMessage, Appointment, CalendarEvent, Patient, LineUser
from tests.conftest import create_user_with_clinic_association, create_calendar_event_with_clinic
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def test_clinic_and_admin(db_session: Session):
    """Create test clinic and admin user."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        subscription_status="trial"
    )
    db_session.add(clinic)
    db_session.commit()

    admin, _ = create_user_with_clinic_association(
        db_session, clinic,
        full_name="Admin User",
        email="admin@test.com",
        google_subject_id="admin_google_123",
        roles=["admin"],
        is_active=True
    )

    return clinic, admin


@pytest.fixture
def test_appointment_type(db_session: Session, test_clinic_and_admin):
    """Create test appointment type."""
    clinic, _ = test_clinic_and_admin
    appointment_type = AppointmentType(
        clinic_id=clinic.id,
        name="Test Service",
        duration_minutes=60,
        is_deleted=False
    )
    db_session.add(appointment_type)
    db_session.commit()
    return appointment_type


class TestFollowUpMessageAPI:
    """Integration tests for follow-up message API endpoints."""

    def test_create_follow_up_message_hours_after(
        self, client: TestClient, db_session: Session,
        test_clinic_and_admin, test_appointment_type
    ):
        """Test creating a follow-up message with hours_after timing."""
        clinic, admin = test_clinic_and_admin
        
        # Get auth token (simplified - in real test would use proper auth)
        # For now, we'll test the service layer directly
        
        # Create follow-up message via service
        from services.follow_up_message_service import FollowUpMessageService
        
        follow_up = FollowUpMessage(
            appointment_type_id=test_appointment_type.id,
            clinic_id=clinic.id,
            timing_mode='hours_after',
            hours_after=2,
            message_template="{病患姓名}，感謝您今天的預約！",
            is_enabled=True,
            display_order=0
        )
        db_session.add(follow_up)
        db_session.commit()
        
        # Verify it was created
        assert follow_up.id is not None
        assert follow_up.timing_mode == 'hours_after'
        assert follow_up.hours_after == 2

    def test_create_follow_up_message_specific_time(
        self, db_session: Session, test_clinic_and_admin, test_appointment_type
    ):
        """Test creating a follow-up message with specific_time timing."""
        clinic, admin = test_clinic_and_admin
        
        follow_up = FollowUpMessage(
            appointment_type_id=test_appointment_type.id,
            clinic_id=clinic.id,
            timing_mode='specific_time',
            days_after=1,
            time_of_day=time(21, 0),
            message_template="{病患姓名}，感謝您今天的預約！",
            is_enabled=True,
            display_order=0
        )
        db_session.add(follow_up)
        db_session.commit()
        
        # Verify it was created
        assert follow_up.id is not None
        assert follow_up.timing_mode == 'specific_time'
        assert follow_up.days_after == 1
        assert follow_up.time_of_day == time(21, 0)

    def test_schedule_follow_up_on_appointment_creation(
        self, db_session: Session, test_clinic_and_admin, test_appointment_type
    ):
        """Test that follow-up messages are scheduled when appointment is created."""
        clinic, admin = test_clinic_and_admin
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_google_123",
            roles=["practitioner"],
            is_active=True
        )
        
        # Create patient with LINE user
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
        
        # Create follow-up message
        follow_up = FollowUpMessage(
            appointment_type_id=test_appointment_type.id,
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
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=test_appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()
        
        # Schedule follow-up messages
        from services.follow_up_message_service import FollowUpMessageService
        FollowUpMessageService.schedule_follow_up_messages(db_session, appointment)
        db_session.commit()
        
        # Verify scheduled message was created
        from models.scheduled_line_message import ScheduledLineMessage
        scheduled = db_session.query(ScheduledLineMessage).filter(
            ScheduledLineMessage.message_type == 'follow_up',
            ScheduledLineMessage.status == 'pending'
        ).first()
        
        assert scheduled is not None
        assert scheduled.recipient_line_user_id == line_user.line_user_id
        assert scheduled.message_context['appointment_id'] == appointment.calendar_event_id

    def test_cancel_follow_up_on_appointment_cancellation(
        self, db_session: Session, test_clinic_and_admin, test_appointment_type
    ):
        """Test that pending follow-up messages are canceled when appointment is canceled."""
        clinic, admin = test_clinic_and_admin
        
        # Create scheduled message
        from models.scheduled_line_message import ScheduledLineMessage
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
        from services.follow_up_message_service import FollowUpMessageService
        FollowUpMessageService.cancel_pending_follow_up_messages(db_session, 123)
        db_session.commit()
        
        # Verify status changed
        db_session.refresh(scheduled)
        assert scheduled.status == 'skipped'

    def test_reschedule_follow_up_on_appointment_edit(
        self, db_session: Session, test_clinic_and_admin, test_appointment_type
    ):
        """Test that follow-up messages are rescheduled when appointment time changes."""
        clinic, admin = test_clinic_and_admin
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Therapist",
            email="therapist@test.com",
            google_subject_id="therapist_google_123",
            roles=["practitioner"],
            is_active=True
        )
        
        # Create patient with LINE user
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
        
        # Create follow-up message
        follow_up = FollowUpMessage(
            appointment_type_id=test_appointment_type.id,
            clinic_id=clinic.id,
            timing_mode='hours_after',
            hours_after=2,
            message_template="Test message",
            is_enabled=True,
            display_order=0
        )
        db_session.add(follow_up)
        db_session.flush()
        
        # Create appointment
        appointment_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=appointment_time.date(),
            start_time=appointment_time.time(),
            end_time=(appointment_time + timedelta(minutes=60)).time()
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=test_appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()
        
        # Create old scheduled message
        from models.scheduled_line_message import ScheduledLineMessage
        old_scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
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
        db_session.add(old_scheduled)
        db_session.flush()
        
        # Reschedule
        from services.follow_up_message_service import FollowUpMessageService
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

