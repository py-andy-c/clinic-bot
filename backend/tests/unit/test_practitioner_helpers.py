"""
Unit tests for practitioner helper functions.
"""
import pytest
from sqlalchemy.orm import Session

from models import User, Clinic
from models.user_clinic_association import UserClinicAssociation
from utils.practitioner_helpers import (
    get_practitioner_display_name,
    get_practitioner_display_name_with_title,
    get_practitioner_display_name_for_appointment,
    AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
)


class TestPractitionerDisplayName:
    """Test practitioner display name functions."""
    
    def test_get_practitioner_display_name_with_title(self, db_session: Session):
        """Test getting practitioner name with title for external displays."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create practitioner with title
        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_123"
        )
        db_session.add(user)
        db_session.flush()
        
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="王小明",
            title="治療師",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()
        
        # Test with title
        display_name = get_practitioner_display_name_with_title(
            db_session, user.id, clinic.id
        )
        assert display_name == "王小明治療師"
        
        # Test with empty title
        association.title = ""
        db_session.commit()
        display_name_empty = get_practitioner_display_name_with_title(
            db_session, user.id, clinic.id
        )
        assert display_name_empty == "王小明"
        
        # Test with different title
        association.title = "復健師"
        db_session.commit()
        display_name_different = get_practitioner_display_name_with_title(
            db_session, user.id, clinic.id
        )
        assert display_name_different == "王小明復健師"
    
    def test_get_practitioner_display_name_without_title(self, db_session: Session):
        """Test getting practitioner name without title for internal displays."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create practitioner with title
        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_456"
        )
        db_session.add(user)
        db_session.flush()
        
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="王小明",
            title="治療師",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()
        
        # Test without title (internal display)
        display_name = get_practitioner_display_name(
            db_session, user.id, clinic.id
        )
        assert display_name == "王小明"  # Should not include title
    
    def test_get_practitioner_display_name_for_appointment_with_title(self, db_session: Session):
        """Test getting practitioner name for appointment (external display with title)."""
        from models.appointment import Appointment
        from models.calendar_event import CalendarEvent
        from models.patient import Patient
        from models.appointment_type import AppointmentType
        from datetime import date, time
        
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create practitioner with title
        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_789"
        )
        db_session.add(user)
        db_session.flush()
        
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="王小明",
            title="治療師",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create appointment type
        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()
        
        # Create calendar event and appointment
        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date.today(),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed",
            is_auto_assigned=False
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Test with title (external display)
        display_name = get_practitioner_display_name_for_appointment(
            db_session, appointment, clinic.id
        )
        assert display_name == "王小明治療師"  # Should include title for external display
        
        # Test with auto-assigned
        appointment.is_auto_assigned = True
        db_session.commit()
        display_name_auto = get_practitioner_display_name_for_appointment(
            db_session, appointment, clinic.id
        )
        assert display_name_auto == AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME

