"""
Integration tests for agent orchestration.

Tests the complete agent workflow from LINE webhook to response.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timezone

from clinic_agents.orchestrator import handle_line_message, _is_linking_successful
from agents import Runner
from clinic_agents.context import ConversationContext
from models.clinic import Clinic
from models.patient import Patient
from models.therapist import Therapist
from models.appointment_type import AppointmentType
from models.line_user import LineUser


class TestOrchestratorIntegration:
    """Test the complete agent orchestration workflow."""

    @pytest.fixture
    def clinic(self):
        """Create test clinic."""
        return Clinic(
            id=1,
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_handle_line_message_appointment_related(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test complete flow for appointment-related messages."""
        # Setup mocks
        mock_line_user = LineUser(id=1, line_user_id="test_user", patient_id=1)
        mock_patient = Patient(id=1, clinic_id=1, full_name="Test Patient", phone_number="0912345678")

        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = mock_patient

        # Mock triage result
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock appointment result
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約成功！"

        with patch.object(Runner, 'run') as mock_runner:
            mock_runner.side_effect = [mock_triage_result, mock_appointment_result]

            # Mock session storage
            with patch('clinic_agents.orchestrator.session_storage') as mock_session_storage:
                mock_session = Mock()
                mock_session_storage.get_session.return_value = mock_session

                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id="test_user",
                    message_text="我想預約治療"
                )

                assert result == "預約成功！"

                # Verify Runner.run was called twice (triage + appointment)
                assert mock_runner.call_count == 2

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_handle_line_message_non_appointment(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test complete flow for non-appointment messages."""
        # Setup mocks
        mock_line_user = LineUser(id=1, line_user_id="test_user", patient_id=None)
        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = None  # Not linked

        # Mock triage result
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "other"

        with patch.object(Runner, 'run') as mock_runner:
            mock_runner.return_value = mock_triage_result

            # Mock session storage
            with patch('clinic_agents.orchestrator.session_storage') as mock_session_storage:
                mock_session = Mock()
                mock_session_storage.get_session.return_value = mock_session

                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id="test_user",
                    message_text="診所地址在哪裡？"
                )

                # Should return None for non-appointment queries
                assert result is None

                # Verify Runner.run was called once (only triage)
                assert mock_runner.call_count == 1

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_handle_line_message_account_linking_flow(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test complete account linking flow."""
        # Setup mocks for unlinked user
        mock_line_user = LineUser(id=1, line_user_id="test_user", patient_id=None)
        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = None  # Not linked

        # Mock triage result
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock account linking result
        mock_linking_result = Mock()
        mock_linking_result.final_output_as.return_value = "帳號連結成功！"
        mock_linking_result.new_items = [
            Mock(output='{"success": true, "patient": {"id": 1, "name": "Test Patient"}}')
        ]

        # Mock appointment result
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約成功！"

        with patch.object(Runner, 'run') as mock_runner:
            mock_runner.side_effect = [mock_triage_result, mock_linking_result, mock_appointment_result]

            # Mock session storage
            with patch('clinic_agents.orchestrator.session_storage') as mock_session_storage:
                mock_session = Mock()
                mock_session_storage.get_session.return_value = mock_session

                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id="test_user",
                    message_text="我想預約治療"
                )

                assert result == "預約成功！"

                # Verify Runner.run was called three times (triage + linking + appointment)
                assert mock_runner.call_count == 3

    def test_is_linking_successful_true(self):
        """Test successful linking detection."""
        mock_result = Mock()
        mock_result.new_items = [
            Mock(output='{"success": true, "message": "Linked successfully"}'),
            Mock(output='some other data')
        ]

        result = _is_linking_successful(mock_result)
        assert result is True

    def test_is_linking_successful_false(self):
        """Test failed linking detection."""
        mock_result = Mock()
        mock_result.new_items = [
            Mock(output='{"success": false, "message": "Not found"}')
        ]

        result = _is_linking_successful(mock_result)
        assert result is False

    def test_is_linking_successful_no_items(self):
        """Test linking detection with no tool results."""
        mock_result = Mock()
        mock_result.new_items = []

        result = _is_linking_successful(mock_result)
        assert result is False

    def test_is_linking_successful_invalid_json(self):
        """Test linking detection with invalid JSON."""
        mock_result = Mock()
        mock_result.new_items = [
            Mock(output='invalid json')
        ]

        result = _is_linking_successful(mock_result)
        assert result is False

    def test_is_linking_successful_no_output(self):
        """Test linking detection with items that have no output."""
        mock_result = Mock()
        mock_result.new_items = [
            Mock(output=None)
        ]

        result = _is_linking_successful(mock_result)
        assert result is False

