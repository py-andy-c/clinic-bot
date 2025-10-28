"""
LINE Agent Integration Tests.

Tests the complete conversation flows and agent interactions
as described in the PRD, focusing on business logic validation.
"""

import pytest
from datetime import datetime, time, timedelta
from unittest.mock import patch, AsyncMock, Mock

from clinic_agents.orchestrator import handle_line_message
from models.patient import Patient
from models.line_user import LineUser
from models.appointment import Appointment
from models.practitioner_availability import PractitionerAvailability
from models.user import User
from models.appointment_type import AppointmentType
from models.clinic import Clinic


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
        patient_id=patient.id
    )
    db_session.add(line_user)
    db_session.commit()

    return patient


@pytest.fixture
def unlinked_line_user(db_session, test_clinic_with_therapist):
    """Create an unlinked LINE user for testing."""
    clinic, therapist, appointment_types = test_clinic_with_therapist

    # Create LINE user without linking to patient
    line_user = LineUser(
        line_user_id="U_unlinked_user_456"
    )
    db_session.add(line_user)
    db_session.commit()

    return line_user


class TestLineConversationFlowsIntegration:
    """Integration tests for LINE conversation flows from PRD."""

    @pytest.mark.asyncio
    async def test_appointment_booking_conversation_flow_business_logic(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test complete appointment booking conversation flow.

        Business logic from PRD: Triage → Intent classification → Appointment agent → Tool execution
        This test exposes bugs in the conversation flow orchestration.
        """
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Test appointment booking message that should trigger the full flow
        appointment_message = "我想預約明天上午10點的門診"

        # Mock the agent execution to test the orchestration logic
        # The key is testing that the right agents are called in the right order
        with patch('clinic_agents.orchestrator.Runner.run') as mock_runner, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:

            # Mock session
            mock_session = AsyncMock()
            mock_session.get_items.return_value = []
            mock_session.add_items = AsyncMock()
            mock_session_storage.return_value = mock_session

            # Mock triage agent to return appointment intent
            mock_triage_result = Mock()
            mock_triage_result.final_output.intent = "appointment_related"
            mock_triage_result.final_output.confidence = 0.95

            # Mock appointment agent to return booking confirmation
            mock_appointment_result = Mock()
            mock_appointment_result.final_output_as.return_value = "預約已確認：明天上午10點"

            # Configure Runner.run to return our mocks in sequence
            mock_runner.side_effect = [mock_triage_result, mock_appointment_result]

            # Execute the conversation flow
            result = await handle_line_message(
                db=db_session,
                clinic=clinic,
                line_user_id=linked_patient.line_user.line_user_id,
                message_text=appointment_message
            )

            # Verify the conversation flow worked correctly
            assert result == "預約已確認：明天上午10點"

            # Verify agents were called in correct order with correct parameters
            assert mock_runner.call_count == 2

            # Verify triage was called first
            triage_call = mock_runner.call_args_list[0]
            assert triage_call[1]['input'] == appointment_message

            # Verify appointment agent was called second
            appointment_call = mock_runner.call_args_list[1]
            assert appointment_call[1]['input'] == appointment_message

    @pytest.mark.asyncio
    async def test_non_appointment_message_handling_business_logic(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test non-appointment message handling follows PRD business logic.

        Business rule: Non-medical messages should be handled gracefully without breaking the flow.
        This test exposes bugs where invalid messages crash the system.
        """
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Test various non-appointment messages
        non_appointment_messages = [
            "你好嗎？",  # Greeting
            "今天天氣真好",  # Casual conversation
            "謝謝你",  # Thanks
            "Hello",  # English greeting
            "123",  # Random numbers
            "",  # Empty message
            "這是一個很長的訊息，包含了很多不相關的內容，可能會影響系統的處理能力。"  # Long irrelevant message
        ]

        for message in non_appointment_messages:
            with patch('clinic_agents.orchestrator.Runner.run') as mock_runner, \
                 patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:

                # Mock session
                mock_session = AsyncMock()
                mock_session.get_items.return_value = []
                mock_session.add_items = AsyncMock()
                mock_session_storage.return_value = mock_session

                # Mock triage to return non-appointment intent
                mock_triage_result = Mock()
                mock_triage_result.final_output.intent = "casual_conversation"
                mock_triage_result.final_output.confidence = 0.8

                mock_runner.return_value = mock_triage_result

                # Execute the message handling
                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id=linked_patient.line_user.line_user_id,
                    message_text=message
                )

                # System should handle gracefully - either return None or a polite response
                # The key is that it shouldn't crash or return an error
                if result is not None:
                    # If it returns a response, it should be appropriate
                    assert isinstance(result, str)
                    assert len(result.strip()) > 0

                # Verify triage was still called to classify the message
                mock_runner.assert_called_once()

    @pytest.mark.asyncio
    async def test_unlinked_user_appointment_request_flow(self, db_session, test_clinic_with_therapist_and_types, unlinked_line_user):
        """Test unlinked user appointment request follows PRD flow.

        Business rule: Unlinked users should be directed to account linking before appointments.
        This test exposes bugs in the user state management flow.
        """
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types

        # Test appointment request from unlinked user
        appointment_request = "我想預約明天上午10點的門診，我的電話是0912345678"

        with patch('clinic_agents.orchestrator.Runner.run') as mock_runner, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_session_storage:

            # Mock session
            mock_session = AsyncMock()
            mock_session.get_items.return_value = []
            mock_session.add_items = AsyncMock()
            mock_session_storage.return_value = mock_session

            # Mock triage to return appointment intent
            mock_triage_result = Mock()
            mock_triage_result.final_output.intent = "appointment_related"
            mock_triage_result.final_output.confidence = 0.9

            # Mock account linking agent response
            mock_linking_result = Mock()
            mock_linking_result.final_output_as.return_value = "請先驗證您的手機號碼"
            mock_linking_result.new_items = []

            # Configure Runner.run to return our mocks in sequence
            mock_runner.side_effect = [mock_triage_result, mock_linking_result]

            # Execute message handling
            result = await handle_line_message(
                db=db_session,
                clinic=clinic,
                line_user_id=unlinked_line_user.line_user_id,
                message_text=appointment_request
            )

            # Should direct to account linking first
            assert result == "請先驗證您的手機號碼"

            # Verify both triage and linking agents were called
            assert mock_runner.call_count == 2
