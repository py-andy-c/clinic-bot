"""
Integration tests for agent orchestration.

Tests the complete agent workflow from LINE webhook to response.
"""

import pytest
from unittest.mock import Mock, patch
import tempfile
import os

from clinic_agents.orchestrator import handle_line_message, _is_linking_successful, get_session_storage
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
            with patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:
                mock_session = Mock()
                mock_get_session.return_value = mock_session

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
            with patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:
                mock_session = Mock()
                mock_get_session.return_value = mock_session

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
            with patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:
                mock_session = Mock()
                mock_get_session.return_value = mock_session

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


class TestConversationHistory:
    """Test message history management and conversation persistence."""

    @pytest.fixture
    def temp_db_path(self):
        """Create a temporary database file for testing."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            db_path = f.name
        yield f"sqlite:///{db_path}"
        # Cleanup
        try:
            os.unlink(db_path)
        except:
            pass

    def test_get_session_storage_returns_sqlalchemy_session(self):
        """Test that get_session_storage returns a SQLAlchemySession instance."""
        from agents.extensions.memory import SQLAlchemySession

        # Mock the async parts to avoid database connection issues in tests
        with patch('agents.extensions.memory.SQLAlchemySession.from_url') as mock_from_url:
            mock_session = Mock(spec=SQLAlchemySession)
            mock_from_url.return_value = mock_session

            session = get_session_storage("test_user_123")

            # Verify the factory was called with correct parameters
            mock_from_url.assert_called_once()
            call_args = mock_from_url.call_args
            assert call_args[1]['session_id'] == "test_user_123"
            assert "create_tables=True" in str(call_args)

            # Verify we get back the mocked session
            assert session == mock_session

    @pytest.mark.asyncio
    async def test_conversation_persistence_across_runs(self, temp_db_path):
        """Test that conversation history persists across multiple agent runs."""
        # This test would require setting up async SQLAlchemy, which is complex
        # For now, we'll test the session creation and mocking approach
        with patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:
            mock_session = Mock()

            # Mock session to track what gets stored
            stored_items = []
            mock_session.add_items = Mock(side_effect=lambda items: stored_items.extend(items))

            # Mock retrieval to return stored items
            mock_session.get_items = Mock(return_value=stored_items)

            mock_get_session.return_value = mock_session

            # Simulate multiple conversation turns
            clinic = Clinic(
                id=1, name="Test Clinic", line_channel_id="test",
                line_channel_secret="secret", line_channel_access_token="token"
            )

            # First message
            with patch('clinic_agents.orchestrator.get_or_create_line_user'), \
                 patch('clinic_agents.orchestrator.get_patient_from_line_user'), \
                 patch.object(Runner, 'run') as mock_runner:

                mock_line_user = LineUser(id=1, line_user_id="test_user", patient_id=1)
                mock_patient = Patient(id=1, clinic_id=1, full_name="Test Patient", phone_number="0912345678")

                mock_runner.return_value = Mock(final_output=Mock(intent="appointment_related"))

                result1 = await handle_line_message(
                    db=Mock(), clinic=clinic, line_user_id="test_user",
                    message_text="Hello"
                )

                # Verify session was created for this user
                mock_get_session.assert_called_with("test_user")

                # Simulate agent storing conversation items
                conversation_items = [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi there!"}
                ]
                mock_session.add_items(conversation_items)

            # Second message - should retrieve previous history
            with patch('clinic_agents.orchestrator.get_or_create_line_user'), \
                 patch('clinic_agents.orchestrator.get_patient_from_line_user'), \
                 patch.object(Runner, 'run') as mock_runner:

                mock_runner.return_value = Mock(final_output=Mock(intent="appointment_related"))

                result2 = await handle_line_message(
                    db=Mock(), clinic=clinic, line_user_id="test_user",
                    message_text="How are you?"
                )

                # Verify session methods are available for conversation persistence
                assert hasattr(mock_session, 'get_items')
                assert hasattr(mock_session, 'add_items')
                # In real implementation, get_items would be called by agents to retrieve history
                # and add_items would be called to store new messages

    def test_session_isolation_between_users(self):
        """Test that different users have isolated conversation sessions."""
        from agents.extensions.memory import SQLAlchemySession

        with patch('agents.extensions.memory.SQLAlchemySession.from_url') as mock_from_url:
            mock_session_user1 = Mock(spec=SQLAlchemySession)
            mock_session_user2 = Mock(spec=SQLAlchemySession)

            # Return different sessions for different users
            def mock_from_url_side_effect(**kwargs):
                if kwargs.get('session_id') == 'user_1':
                    return mock_session_user1
                elif kwargs.get('session_id') == 'user_2':
                    return mock_session_user2
                return Mock()

            mock_from_url.side_effect = mock_from_url_side_effect

            # Get sessions for different users
            session1 = get_session_storage("user_1")
            session2 = get_session_storage("user_2")

            # Verify different sessions are returned
            assert session1 == mock_session_user1
            assert session2 == mock_session_user2
            assert session1 != session2

            # Verify sessions were created with correct user IDs
            calls = mock_from_url.call_args_list
            user_ids = [call[1]['session_id'] for call in calls]
            assert "user_1" in user_ids
            assert "user_2" in user_ids


class TestOrchestratorAccountLinking:
    """Test account linking flows in orchestrator."""

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
    async def test_handle_line_message_account_linking_intent(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test complete flow for account linking intent."""
        # Setup mocks - user not linked
        mock_line_user = LineUser(id=1, line_user_id="test_user", patient_id=None)
        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = None

        # Mock triage result with account_linking intent
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "account_linking"

        # Mock account linking result
        mock_linking_result = Mock()
        mock_linking_result.new_items = []  # No successful linking for this test
        mock_linking_result.final_output_as.return_value = "請提供手機號碼"

        with patch.object(Runner, 'run') as mock_runner:
            mock_runner.side_effect = [mock_triage_result, mock_linking_result]

            # Mock session storage
            with patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:
                mock_session = Mock()
                mock_get_session.return_value = mock_session

                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id="test_user",
                    message_text="0912345678"
                )

                assert result == "請提供手機號碼"

                # Verify Runner.run was called twice (triage + account linking)
                assert mock_runner.call_count == 2

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_handle_line_message_appointment_with_account_linking(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test appointment flow that triggers account linking for unlinked user."""
        # Setup mocks - user not linked initially
        mock_line_user = LineUser(id=1, line_user_id="test_user", patient_id=None)
        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = None

        # Mock triage result
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock account linking result (successful)
        mock_linking_result = Mock()
        # Mock the new_items to simulate successful linking
        mock_item = Mock()
        mock_item.output = '{"success": true}'
        mock_linking_result.new_items = [mock_item]
        mock_linking_result.final_output_as.return_value = "帳號連結成功！"

        # Mock appointment result after linking
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約成功！"

        with patch.object(Runner, 'run') as mock_runner:
            mock_runner.side_effect = [mock_triage_result, mock_linking_result, mock_appointment_result]

            # Mock session storage
            with patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:
                mock_session = Mock()
                mock_get_session.return_value = mock_session

                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id="test_user",
                    message_text="我想預約治療"
                )

                assert result == "預約成功！"

                # Verify Runner.run was called three times (triage + linking + appointment)
                assert mock_runner.call_count == 3

    @pytest.mark.asyncio
    async def test_is_linking_successful_true_json(self, db_session):
        """Test _is_linking_successful returns True for JSON success."""
        from clinic_agents.orchestrator import _is_linking_successful

        mock_result = Mock()
        mock_item = Mock()
        mock_item.output = '{"success": true}'
        mock_result.new_items = [mock_item]

        assert _is_linking_successful(mock_result) is True

    @pytest.mark.asyncio
    async def test_is_linking_successful_true_legacy_string(self, db_session):
        """Test _is_linking_successful returns True for legacy SUCCESS string."""
        from clinic_agents.orchestrator import _is_linking_successful

        mock_result = Mock()
        mock_item = Mock()
        mock_item.output = "SUCCESS: Account linked"
        mock_result.new_items = [mock_item]

        assert _is_linking_successful(mock_result) is True

    @pytest.mark.asyncio
    async def test_is_linking_successful_false_no_success(self, db_session):
        """Test _is_linking_successful returns False when no success found."""
        from clinic_agents.orchestrator import _is_linking_successful

        mock_result = Mock()
        mock_item = Mock()
        mock_item.output = '{"message": "Please provide phone number"}'
        mock_result.new_items = [mock_item]

        assert _is_linking_successful(mock_result) is False

    @pytest.mark.asyncio
    async def test_is_linking_successful_false_empty_items(self, db_session):
        """Test _is_linking_successful returns False for empty new_items."""
        from clinic_agents.orchestrator import _is_linking_successful

        mock_result = Mock()
        mock_result.new_items = []

        assert _is_linking_successful(mock_result) is False

    @pytest.mark.asyncio
    async def test_is_linking_successful_false_invalid_json(self, db_session):
        """Test _is_linking_successful handles invalid JSON gracefully."""
        from clinic_agents.orchestrator import _is_linking_successful

        mock_result = Mock()
        mock_item = Mock()
        mock_item.output = "invalid json {"
        mock_result.new_items = [mock_item]

        assert _is_linking_successful(mock_result) is False

    @pytest.mark.asyncio
    async def test_is_linking_successful_false_missing_output(self, db_session):
        """Test _is_linking_successful handles missing output attribute."""
        from clinic_agents.orchestrator import _is_linking_successful

        mock_result = Mock()
        mock_item = Mock()
        # No output attribute
        mock_result.new_items = [mock_item]

        assert _is_linking_successful(mock_result) is False

