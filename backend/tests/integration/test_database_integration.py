"""
Database Integration Tests.

Tests database operations, transactions, and data integrity.
"""

import pytest
from datetime import datetime, time, timedelta
from unittest.mock import patch, AsyncMock, Mock

from models.patient import Patient
from models.line_user import LineUser
from models.appointment import Appointment
from models.user import User
from models.appointment_type import AppointmentType
from models.clinic import Clinic
from models.calendar_event import CalendarEvent
from models.practitioner_availability import PractitionerAvailability
from services.encryption_service import EncryptionService


@pytest.fixture
def test_clinic_with_therapist(db_session):
    """Create a test clinic with a therapist and appointment types."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()  # Commit clinic first to get ID

    therapist = User(
        clinic_id=clinic.id,
        full_name="Dr. Test",
        email="dr.test@example.com",
        google_subject_id="therapist_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    db_session.add(therapist)
    db_session.commit()  # Commit therapist to get ID

    # Create appointment types
    appointment_types = [
        AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        ),
        AppointmentType(
            clinic_id=clinic.id,
            name="回診",
            duration_minutes=30
        )
    ]

    # Create practitioner availability for Monday-Friday, 9am-5pm
    from datetime import time
    availability_records = []
    for day in range(5):  # Monday to Friday
        availability_records.append(
            PractitionerAvailability(
                user_id=therapist.id,
                day_of_week=day,
                start_time=time(9, 0),  # 9:00 AM
                end_time=time(17, 0)    # 5:00 PM
            )
        )

    db_session.add_all(appointment_types + availability_records)
    db_session.commit()

    return clinic, therapist, appointment_types


@pytest.fixture
def test_clinic_with_therapist_and_types(test_clinic_with_therapist):
    """Alias for test_clinic_with_therapist for backward compatibility."""
    return test_clinic_with_therapist


@pytest.fixture
def linked_patient(db_session, test_clinic_with_therapist):
    """Create a linked patient for testing."""
    clinic, therapist, appointment_types = test_clinic_with_therapist

    # Create patient
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="+1234567890"
    )
    db_session.add(patient)
    db_session.commit()

    # Create LINE user and link to patient
    line_user = LineUser(
        line_user_id="U_test_patient_123",
        display_name="Test Patient"
    )
    db_session.add(line_user)

    # Update patient to link to LINE user
    patient.line_user_id = line_user.id
    db_session.commit()

    return patient


# Copy mock_create_appointment function for testing
async def mock_create_appointment(db, therapist_id, appointment_type_id, start_time, patient_id):
    """Mock version of create_appointment for testing without @function_tool decorator."""
    from datetime import timedelta

    # Load related entities
    from utils.query_helpers import filter_by_role
    
    query = db.query(User).filter(
        User.id == therapist_id,
        User.is_active == True
    )
    query = filter_by_role(query, 'practitioner')
    practitioner = query.first()
    patient = db.get(Patient, patient_id)
    apt_type = db.get(AppointmentType, appointment_type_id)

    if practitioner is None:
        return {"error": "找不到指定的治療師"}
    if patient is None:
        return {"error": "找不到指定的病人"}
    if apt_type is None:
        return {"error": "找不到指定的預約類型"}

    # Calculate end time
    end_time = start_time + timedelta(minutes=apt_type.duration_minutes)

    # Check for appointment conflicts
    existing_conflicts = db.query(Appointment).join(CalendarEvent).filter(
        CalendarEvent.user_id == practitioner.id,
        Appointment.status.in_(['confirmed', 'pending']),
        CalendarEvent.start_time < end_time.time(),
        CalendarEvent.end_time > start_time.time()
    ).first()

    if existing_conflicts:
        return {"error": "預約時間衝突，請選擇其他時段"}

    # Check if practitioner has Google Calendar credentials
    if not practitioner.gcal_credentials:
        return {"error": "治療師未設定 Google Calendar 認證"}

    # For testing, skip actual encryption/decryption and just check format
    try:
        if practitioner.gcal_credentials.startswith("encrypted_"):
            # Extract the JSON part for testing
            credentials_json = practitioner.gcal_credentials[10:]  # Remove "encrypted_" prefix
            credentials_dict = eval(credentials_json)  # Simple dict for testing
        else:
            return {"error": "Google Calendar 認證無效"}
    except Exception:
        return {"error": "Google Calendar 認證無效"}

    # Create CalendarEvent first
    calendar_event = CalendarEvent(
        user_id=practitioner.id,
        event_type='appointment',
        date=start_time.date(),
        start_time=start_time.time(),
        end_time=end_time.time(),
        gcal_event_id=None
    )
    db.add(calendar_event)
    db.commit()

    # Create appointment record
    appointment = Appointment(
        calendar_event_id=calendar_event.id,
        patient_id=patient.id,
        appointment_type_id=apt_type.id,
        status='confirmed'
    )

    try:
        db.add(appointment)
        db.commit()
        db.refresh(appointment)

        return {
            "appointment_id": calendar_event.id,
            "message": f"預約已確認: {start_time.strftime('%Y-%m-%d %H:%M')} - {end_time.strftime('%H:%M')}"
        }

    except Exception as e:
        db.rollback()
        return {"error": f"建立預約失敗: {str(e)}"}


class TestDatabaseIntegration:
    """Integration tests for database operations and transactions."""

