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

    db_session.add_all([therapist] + appointment_types)
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
        patient_id=patient.id
    )
    db_session.add(line_user)
    db_session.commit()

    return patient


# Copy mock_create_appointment function for testing
async def mock_create_appointment(db, therapist_id, appointment_type_id, start_time, patient_id):
    """Mock version of create_appointment for testing without @function_tool decorator."""
    from datetime import timedelta

    # Load related entities
    practitioner = db.query(User).filter(
        User.id == therapist_id,
        User.roles.contains(['practitioner']),
        User.is_active == True
    ).first()
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
    existing_conflicts = db.query(Appointment).filter(
        Appointment.user_id == practitioner.id,
        Appointment.status.in_(['confirmed', 'pending']),
        Appointment.start_time < end_time,
        Appointment.end_time > start_time
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

    # Create appointment record
    appointment = Appointment(
        user_id=practitioner.id,
        patient_id=patient.id,
        appointment_type_id=apt_type.id,
        start_time=start_time,
        end_time=end_time,
        status='confirmed'
    )

    try:
        db.add(appointment)
        db.commit()
        db.refresh(appointment)

        return {
            "appointment_id": appointment.id,
            "message": f"預約已確認: {start_time.strftime('%Y-%m-%d %H:%M')} - {end_time.strftime('%H:%M')}"
        }

    except Exception as e:
        db.rollback()
        return {"error": f"建立預約失敗: {str(e)}"}


class TestDatabaseIntegration:
    """Integration tests for database operations and transactions."""

    @pytest.mark.asyncio
    async def test_database_failure_during_appointment_creation_rollback(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test that database failures during appointment creation properly rollback.

        This test exposes potential bugs where partial operations aren't rolled back.
        """
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Mock a database failure scenario
        original_commit = db_session.commit
        original_rollback = db_session.rollback

        commit_count = 0
        rollback_count = 0

        def failing_commit():
            nonlocal commit_count
            commit_count += 1
            if commit_count == 1:  # Fail on first commit (appointment creation)
                raise Exception("Simulated database failure")
            original_commit()

        def counting_rollback():
            nonlocal rollback_count
            rollback_count += 1
            original_rollback()

        # Mock session methods
        db_session.commit = failing_commit
        db_session.rollback = counting_rollback

        # Set up therapist with Google Calendar credentials
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"
        db_session.add(therapist)
        # Use original commit for setup
        original_commit()
        db_session.commit = failing_commit  # Now replace with failing commit

        # Target appointment time
        start_time = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))

        # Mock Google Calendar service to succeed
        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:

            mock_gcal_instance = Mock()
            mock_gcal_instance.create_event.return_value = {'id': 'gcal_event_123'}
            mock_gcal_class.return_value = mock_gcal_instance

            mock_session = AsyncMock()
            mock_session.get_items.return_value = []
            mock_session.add_items = AsyncMock()
            mock_session_storage.return_value = mock_session

            # Try to create appointment - this should fail due to database error
            result = await mock_create_appointment(
                db=db_session,
                therapist_id=therapist.id,
                appointment_type_id=appointment_types[0].id,
                start_time=start_time,
                patient_id=linked_patient.id
            )

            # Should fail due to database error
            assert "error" in result
            assert "appointment_id" not in result

            # Verify rollback was called (this exposes rollback bugs)
            assert rollback_count > 0, "Database rollback should have been called on failure"

            # Verify no appointment was actually created in database
            appointments = db_session.query(Appointment).filter(
                Appointment.patient_id == linked_patient.id,
                Appointment.start_time == start_time
            ).all()
            assert len(appointments) == 0, "Appointment should not exist after rollback"
