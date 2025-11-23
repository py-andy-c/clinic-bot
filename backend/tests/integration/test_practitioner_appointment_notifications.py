"""
Integration tests for practitioner appointment notifications.
"""
import pytest
from datetime import datetime, date, time, timezone, timedelta
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient

from main import app
from models import User, Clinic, Patient, Appointment, CalendarEvent, AppointmentType, UserClinicAssociation, LineUser, PractitionerAppointmentTypes, PractitionerAvailability
from services.appointment_service import AppointmentService
from utils.datetime_utils import taiwan_now
from tests.conftest import db_session


@pytest.fixture
def client(db_session):
    """Create test client with database session override."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    
    app.dependency_overrides = {}
    from core.database import get_db
    app.dependency_overrides[get_db] = override_get_db
    
    yield TestClient(app)
    
    app.dependency_overrides.clear()


@pytest.fixture
def clinic_with_practitioner(db_session):
    """Create clinic and practitioner for testing."""
    clinic = Clinic(
        name="測試診所",
        line_channel_id="1234567890",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        settings={"clinic_info_settings": {"display_name": "測試診所"}},
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(clinic)
    db_session.flush()
    
    practitioner = User(
        email="practitioner@test.com",
        google_subject_id="google_subject_practitioner",
        line_user_id="U1234567890",  # Linked LINE account
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(practitioner)
    db_session.flush()
    
    association = UserClinicAssociation(
        user_id=practitioner.id,
        clinic_id=clinic.id,
        roles=["practitioner"],
        full_name="測試治療師",
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db_session.add(association)
    
    # Create appointment type
    appointment_type = AppointmentType(
        clinic_id=clinic.id,
        name="物理治療",
        duration_minutes=30,
        is_deleted=False
    )
    db_session.add(appointment_type)
    db_session.flush()
    
    # Link practitioner to appointment type
    practitioner_appointment_type = PractitionerAppointmentTypes(
        user_id=practitioner.id,
        appointment_type_id=appointment_type.id,
        clinic_id=clinic.id
    )
    db_session.add(practitioner_appointment_type)
    
    # Set up basic availability for practitioner (9 AM - 5 PM, Monday to Friday)
    # Python's weekday() returns 0-6 where Monday=0, Sunday=6
    for day_of_week in range(7):  # All days (0=Monday to 6=Sunday) to ensure availability
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)
    
    # Create patient
    line_user = LineUser(
        line_user_id="U_patient_123",
        clinic_id=clinic.id,
        display_name="病患"
    )
    db_session.add(line_user)
    db_session.flush()
    
    patient = Patient(
        clinic_id=clinic.id,
        full_name="王小明",
        phone_number="0912345678",
        line_user_id=line_user.id,
        is_deleted=False
    )
    db_session.add(patient)
    
    db_session.commit()
    db_session.refresh(clinic)
    db_session.refresh(practitioner)
    db_session.refresh(appointment_type)
    db_session.refresh(patient)
    
    return clinic, practitioner, appointment_type, patient


class TestPractitionerAppointmentNotifications:
    """Test practitioner appointment notifications."""
    
    @patch('services.line_service.LINEService')
    @patch('services.notification_service.format_datetime')
    def test_notification_sent_on_appointment_creation(
        self,
        mock_format_datetime,
        mock_line_service_class,
        client,
        clinic_with_practitioner,
        db_session
    ):
        """Test that notification is sent when appointment is created."""
        clinic, practitioner, appointment_type, patient = clinic_with_practitioner
        
        # Setup mocks
        mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
        mock_line_service = Mock()
        mock_line_service_class.return_value = mock_line_service
        
        # Create appointment (pass practitioner_id to bypass availability checks)
        # Use Taiwan timezone as expected by create_appointment
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=14, minute=30, second=0, microsecond=0)
        
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,  # Explicitly assign practitioner
            notes="請準備X光片"
        )
        
        # Verify notifications were sent (both practitioner and patient)
        # Should be called twice: once for practitioner, once for patient
        assert mock_line_service.send_text_message.call_count == 2
        
        # Check practitioner notification (first call)
        practitioner_call = mock_line_service.send_text_message.call_args_list[0]
        assert practitioner_call[0][0] == "U1234567890"  # Practitioner's LINE user ID
        practitioner_message = practitioner_call[0][1]
        assert "新預約通知" in practitioner_message
        assert "王小明" in practitioner_message
        
        # Check patient notification (second call)
        patient_call = mock_line_service.send_text_message.call_args_list[1]
        assert patient_call[0][0] == "U_patient_123"  # Patient's LINE user ID
        patient_message = patient_call[0][1]
        assert "預約已建立" in patient_message or "預約確認" in patient_message
        assert "物理治療" in patient_message
        assert "請準備X光片" in patient_message
    
    @patch('services.line_service.LINEService')
    @patch('services.notification_service.format_datetime')
    def test_no_notification_if_no_line_account(
        self,
        mock_format_datetime,
        mock_line_service_class,
        client,
        clinic_with_practitioner,
        db_session
    ):
        """Test that practitioner notification is not sent if practitioner has no LINE account, but patient notification is still sent."""
        clinic, practitioner, appointment_type, patient = clinic_with_practitioner
        
        # Remove LINE account
        practitioner.line_user_id = None
        db_session.commit()
        
        # Setup mocks
        mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
        mock_line_service = Mock()
        mock_line_service_class.return_value = mock_line_service
        
        # Create appointment
        # Use Taiwan timezone as expected by create_appointment
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=14, minute=30, second=0, microsecond=0)
        
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id
        )
        
        # Verify patient notification was sent (patient has LINE account)
        # But practitioner notification was NOT sent (practitioner has no LINE account)
        assert mock_line_service.send_text_message.call_count == 1
        call_args = mock_line_service.send_text_message.call_args
        # Should be patient notification, not practitioner notification
        assert call_args[0][0] == "U_patient_123"  # Patient's LINE user ID
        message = call_args[0][1]
        assert "預約已建立" in message or "預約確認" in message
    
    @patch('services.line_service.LINEService')
    @patch('services.notification_service.format_datetime')
    def test_notification_failure_does_not_block_appointment(
        self,
        mock_format_datetime,
        mock_line_service_class,
        client,
        clinic_with_practitioner,
        db_session
    ):
        """Test that notification failure doesn't prevent appointment creation."""
        clinic, practitioner, appointment_type, patient = clinic_with_practitioner
        
        # Setup mocks - LINE service will fail
        mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
        mock_line_service = Mock()
        mock_line_service.send_text_message.side_effect = Exception("LINE API error")
        mock_line_service_class.return_value = mock_line_service
        
        # Create appointment
        # Use Taiwan timezone as expected by create_appointment
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=14, minute=30, second=0, microsecond=0)
        
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id
        )
        
        # Verify appointment was still created
        assert "appointment_id" in result
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result["appointment_id"]
        ).first()
        assert appointment is not None

