"""
Appointment Integration Tests.

Tests appointment creation, validation, and business logic integration.
These tests validate real business rules and error scenarios.
"""

import pytest
from datetime import datetime, time, timedelta
from unittest.mock import patch, AsyncMock, Mock

from clinic_agents.context import ConversationContext
from clinic_agents.tools import create_appointment_impl
from models.patient import Patient
from models.line_user import LineUser
from models.appointment import Appointment
from models.user import User
from models.appointment_type import AppointmentType
from models.clinic import Clinic
from models.calendar_event import CalendarEvent


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


class TestAppointmentIntegration:
    """Integration tests for appointment creation and business logic."""

    @pytest.mark.asyncio
    async def test_invalid_therapist_id_appointment_creation(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test appointment creation with invalid therapist ID.

        This tests error handling for invalid foreign key references.
        """
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Use a non-existent therapist ID
        invalid_therapist_id = 99999
        start_time = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))

        # Set up context
        ctx = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=linked_patient,
            line_user_id="test_user",
            is_linked=True,
        )
        wrapper = Mock()
        wrapper.context = ctx

        with patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:
            mock_session = AsyncMock()
            mock_session.get_items.return_value = []
            mock_session.add_items = AsyncMock()
            mock_session_storage.return_value = mock_session

            result = await create_appointment_impl(
                wrapper=wrapper,
                therapist_id=invalid_therapist_id,  # Invalid ID
                appointment_type_id=appointment_types[0].id,
                start_time=start_time,
                patient_id=linked_patient.id
            )

            # Should fail with appropriate error message
            assert "error" in result
            assert "治療師" in result["error"] or "practitioner" in result["error"].lower()
            assert "appointment_id" not in result

    @pytest.mark.asyncio
    async def test_double_booking_prevention_business_logic(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test that double booking prevention works correctly.

        This tests the critical business rule that prevents overlapping appointments.
        """
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]  # Assume 30-minute appointment

        # Set up therapist with Google Calendar credentials
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"
        db_session.add(therapist)
        db_session.commit()

        # Set up context
        ctx = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=linked_patient,
            line_user_id="test_user",
            is_linked=True,
        )
        wrapper = Mock()
        wrapper.context = ctx

        # Create first appointment at 10:00
        start_time_1 = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))

        # Mock Google Calendar and encryption service for first booking
        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch('services.encryption_service.get_encryption_service') as mock_get_enc, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:

            # Mock encryption service
            mock_get_enc.return_value.decrypt_data.return_value = {"access_token": "test_token"}

            # Mock Google Calendar service
            mock_gcal_instance = Mock()
            mock_gcal_instance.create_event = AsyncMock(return_value={'id': 'gcal_event_1'})
            mock_gcal_instance.update_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal_instance

            mock_session = AsyncMock()
            mock_session.get_items.return_value = []
            mock_session.add_items = AsyncMock()
            mock_session_storage.return_value = mock_session

            # First booking should succeed
            result1 = await create_appointment_impl(
                wrapper=wrapper,
                therapist_id=therapist.id,
                appointment_type_id=apt_type.id,
                start_time=start_time_1,
                patient_id=linked_patient.id
            )

            assert result1.get("success") is True

        # Create second patient for testing double booking
        second_patient = Patient(
            clinic_id=clinic.id,
            full_name="Second Patient",
            phone_number="+19876543210"
        )
        db_session.add(second_patient)
        db_session.commit()

        # Update context for second patient
        ctx.patient = second_patient

        # Try to book the same time slot - should fail
        start_time_conflict = start_time_1  # Same time

        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch('services.encryption_service.get_encryption_service') as mock_get_enc, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:

            # Mock encryption service
            mock_get_enc.return_value.decrypt_data.return_value = {"access_token": "test_token"}

            # Mock Google Calendar service
            mock_gcal_instance = Mock()
            mock_gcal_instance.create_event = AsyncMock(return_value={'id': 'gcal_event_2'})
            mock_gcal_instance.update_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal_instance

            mock_session = AsyncMock()
            mock_session.get_items.return_value = []
            mock_session.add_items = AsyncMock()
            mock_session_storage.return_value = mock_session

            # Second booking should fail due to conflict
            result2 = await create_appointment_impl(
                wrapper=wrapper,
                therapist_id=therapist.id,
                appointment_type_id=apt_type.id,
                start_time=start_time_conflict,  # Same time slot
                patient_id=second_patient.id
            )

            # Should fail with conflict error
            assert "error" in result2
            assert "衝突" in result2["error"] or "conflict" in result2["error"].lower()

            # Verify only one appointment exists
            appointments = db_session.query(Appointment).join(CalendarEvent).filter(
                CalendarEvent.user_id == therapist.id,
                CalendarEvent.start_time == start_time_1.time()
            ).all()
            assert len(appointments) == 1
