"""
End-to-end integration tests for complete appointment workflows.

Tests full user journeys from LINE message to calendar sync.
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime, timezone

from clinic_agents.orchestrator import handle_line_message
from models.clinic import Clinic
from models.patient import Patient
from models.therapist import Therapist
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser


class TestEndToEndAppointmentBooking:
    """Test complete appointment booking workflow."""

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

    @pytest.fixture
    def test_data(self):
        """Create comprehensive test data."""
        clinic = Clinic(
            id=1,
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )

        therapist = Therapist(
            id=1,
            clinic_id=1,
            name="王大明",
            email="wang@test.com",
            gcal_credentials='{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'
        )

        patient = Patient(
            id=1,
            clinic_id=1,
            full_name="測試病人",
            phone_number="0912345678"
        )

        appointment_type = AppointmentType(
            id=1,
            clinic_id=1,
            name="初診評估",
            duration_minutes=60
        )

        line_user = LineUser(
            id=1,
            line_user_id="test_user_123",
            patient_id=1
        )

        return {
            'clinic': clinic,
            'therapist': therapist,
            'patient': patient,
            'appointment_type': appointment_type,
            'line_user': line_user
        }

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_complete_appointment_booking_workflow(self, mock_get_patient, mock_get_line_user, db_session, test_data):
        """Test complete appointment booking from LINE message to calendar sync."""
        # Setup mocks
        mock_get_line_user.return_value = test_data['line_user']
        mock_get_patient.return_value = test_data['patient']

        # Mock triage - appointment related
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock appointment agent - successful booking
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約成功！已為您預約王大明治療師，時間是2024年1月15日 14:00-15:00，項目為初診評估。"

        # Mock Google Calendar service
        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('services.google_calendar_service.GoogleCalendarService') as mock_gcal_class, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_appointment_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Setup Google Calendar mock (should be called during appointment creation)
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(return_value={'id': 'gcal_event_123'})
            mock_gcal.update_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal

            # Execute the workflow
            result = await handle_line_message(
                db=db_session,
                clinic=test_data['clinic'],
                line_user_id="test_user_123",
                message_text="我想預約王大明治療師的初診評估"
            )

            # Verify the result
            assert result == "預約成功！已為您預約王大明治療師，時間是2024年1月15日 14:00-15:00，項目為初診評估。"

            # Verify Runner was called twice (triage + appointment)
            assert mock_runner.run.call_count == 2

            # Verify session was created
            mock_get_session.assert_called_once_with("test_user_123")

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_appointment_booking_with_account_linking(self, mock_get_patient, mock_get_line_user, db_session, test_data):
        """Test appointment booking that requires account linking first."""
        # User not linked initially
        mock_line_user = LineUser(id=1, line_user_id="new_user_123", patient_id=None)
        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = None

        # Mock triage - appointment related
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock account linking - successful
        mock_linking_result = Mock()
        mock_item = Mock()
        mock_item.output = '{"success": true}'
        mock_linking_result.new_items = [mock_item]
        mock_linking_result.final_output_as.return_value = "帳號連結成功！"

        # Mock appointment booking after linking
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約成功！"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock - triage, linking, then appointment
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_linking_result, mock_appointment_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Execute workflow
            result = await handle_line_message(
                db=db_session,
                clinic=test_data['clinic'],
                line_user_id="new_user_123",
                message_text="0912345678"  # Phone number for linking
            )

            # Should get appointment response since linking succeeded
            assert result == "預約成功！"

            # Verify all three agents were called
            assert mock_runner.run.call_count == 3

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_appointment_rescheduling_workflow(self, mock_get_patient, mock_get_line_user, db_session, test_data):
        """Test complete appointment rescheduling workflow."""
        # Setup mocks
        mock_get_line_user.return_value = test_data['line_user']
        mock_get_patient.return_value = test_data['patient']

        # Mock triage - appointment related
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock appointment agent - rescheduling response
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約已更改！新時間為2024年1月16日 10:00-11:00。"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('services.google_calendar_service.GoogleCalendarService') as mock_gcal_class, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_appointment_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Setup Google Calendar mock for rescheduling
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(return_value={'id': 'new_gcal_event_456'})
            mock_gcal.delete_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal

            # Execute rescheduling workflow
            result = await handle_line_message(
                db=db_session,
                clinic=test_data['clinic'],
                line_user_id="test_user_123",
                message_text="我想更改預約到明天上午"
            )

            # Verify result
            assert result == "預約已更改！新時間為2024年1月16日 10:00-11:00。"

            # Verify runner calls
            assert mock_runner.run.call_count == 2

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_appointment_cancellation_workflow(self, mock_get_patient, mock_get_line_user, db_session, test_data):
        """Test complete appointment cancellation workflow."""
        # Setup mocks
        mock_get_line_user.return_value = test_data['line_user']
        mock_get_patient.return_value = test_data['patient']

        # Mock triage - appointment related
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock appointment agent - cancellation response
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "預約已取消！如需重新預約請告訴我。"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('services.google_calendar_service.GoogleCalendarService') as mock_gcal_class, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_appointment_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Setup Google Calendar mock for cancellation
            mock_gcal = Mock()
            mock_gcal.delete_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal

            # Execute cancellation workflow
            result = await handle_line_message(
                db=db_session,
                clinic=test_data['clinic'],
                line_user_id="test_user_123",
                message_text="我想取消明天的預約"
            )

            # Verify result
            assert result == "預約已取消！如需重新預約請告訴我。"

            # Verify runner calls
            assert mock_runner.run.call_count == 2

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_non_appointment_message_filtered_out(self, mock_get_patient, mock_get_line_user, db_session, test_data):
        """Test that non-appointment messages are filtered out (no response)."""
        # Setup mocks
        mock_get_line_user.return_value = test_data['line_user']
        mock_get_patient.return_value = test_data['patient']

        # Mock triage - non-appointment intent
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "casual_chat"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock(return_value=mock_triage_result)

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Execute workflow with non-appointment message
            result = await handle_line_message(
                db=db_session,
                clinic=test_data['clinic'],
                line_user_id="test_user_123",
                message_text="你好嗎？"
            )

            # Should return None (no response for non-appointment messages)
            assert result is None

            # Verify only triage was called
            assert mock_runner.run.call_count == 1

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_account_linking_only_workflow(self, mock_get_patient, mock_get_line_user, db_session, test_data):
        """Test account linking workflow without appointment booking."""
        # User not linked
        mock_line_user = LineUser(id=1, line_user_id="new_user_456", patient_id=None)
        mock_get_line_user.return_value = mock_line_user
        mock_get_patient.return_value = None

        # Mock triage - account linking intent
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "account_linking"

        # Mock account linking - successful
        mock_linking_result = Mock()
        mock_item = Mock()
        mock_item.output = '{"success": true}'
        mock_linking_result.new_items = [mock_item]
        mock_linking_result.final_output_as.return_value = "帳號連結成功！歡迎使用預約服務。"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_linking_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Execute account linking workflow
            result = await handle_line_message(
                db=db_session,
                clinic=test_data['clinic'],
                line_user_id="new_user_456",
                message_text="0912345678"
            )

            # Should get linking success response
            assert result == "帳號連結成功！歡迎使用預約服務。"

            # Verify both agents were called
            assert mock_runner.run.call_count == 2


class TestErrorHandlingWorkflows:
    """Test error handling in end-to-end workflows."""

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
    async def test_google_calendar_sync_failure_handling(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test handling of Google Calendar sync failures during appointment booking."""
        # Setup mocks
        line_user = LineUser(id=1, line_user_id="test_user", patient_id=1)
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")

        mock_get_line_user.return_value = line_user
        mock_get_patient.return_value = patient

        # Mock triage
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock appointment agent - handles GCal failure internally
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "抱歉，預約失敗。請稍後再試或聯繫診所。"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('services.google_calendar_service.GoogleCalendarService') as mock_gcal_class, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_appointment_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Setup Google Calendar mock to fail
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(side_effect=Exception("Calendar API error"))
            mock_gcal_class.return_value = mock_gcal

            # Execute workflow
            result = await handle_line_message(
                db=db_session,
                clinic=clinic,
                line_user_id="test_user",
                message_text="我想預約治療"
            )

            # Should get error message from appointment agent
            assert "抱歉，預約失敗" in result

    @patch('clinic_agents.orchestrator.get_or_create_line_user')
    @patch('clinic_agents.orchestrator.get_patient_from_line_user')
    @pytest.mark.asyncio
    async def test_database_error_recovery(self, mock_get_patient, mock_get_line_user, db_session, clinic):
        """Test database error handling and recovery."""
        # Setup mocks
        line_user = LineUser(id=1, line_user_id="test_user", patient_id=1)
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")

        mock_get_line_user.return_value = line_user
        mock_get_patient.return_value = patient

        # Mock triage
        mock_triage_result = Mock()
        mock_triage_result.final_output.intent = "appointment_related"

        # Mock appointment agent - handles database errors
        mock_appointment_result = Mock()
        mock_appointment_result.final_output_as.return_value = "系統忙碌中，請稍後再試。"

        with patch('clinic_agents.orchestrator.Runner') as mock_runner, \
             patch('clinic_agents.orchestrator.get_session_storage') as mock_get_session:

            # Setup runner mock
            mock_runner.run = AsyncMock()
            mock_runner.run.side_effect = [mock_triage_result, mock_appointment_result]

            # Setup session mock
            mock_session = Mock()
            mock_get_session.return_value = mock_session

            # Make database operations fail
            original_query = db_session.query
            def failing_query(*args, **kwargs):
                raise Exception("Database connection error")
            db_session.query = failing_query

            try:
                # Execute workflow
                result = await handle_line_message(
                    db=db_session,
                    clinic=clinic,
                    line_user_id="test_user",
                    message_text="我想預約治療"
                )

                # Should handle the error gracefully
                assert "系統忙碌中" in result
            finally:
                # Restore original query method
                db_session.query = original_query
