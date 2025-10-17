"""
Unit tests for the LLM service.
"""

import pytest
import os
from unittest.mock import patch, MagicMock
from sqlalchemy.orm import Session

from src.services.llm_service import (
    LLMService,
    GetTherapistAvailabilityTool,
    CreateAppointmentTool
)


@pytest.fixture(autouse=True)
def mock_gemini_api_key():
    """Set mock Gemini API key for all tests."""
    os.environ['GEMINI_API_KEY'] = 'test_gemini_api_key'
    yield
    # Clean up
    os.environ.pop('GEMINI_API_KEY', None)


class TestLLMService:
    """Test cases for LLM service."""

    def test_llm_service_init_missing_api_key(self, monkeypatch):
        """Test LLM service initialization fails without API key."""
        # Remove the environment variable for this test
        monkeypatch.delenv('GEMINI_API_KEY', raising=False)
        # Also patch the settings to return empty
        from src import core
        monkeypatch.setattr('src.core.config.settings.gemini_api_key', '')
        with pytest.raises(ValueError, match="GEMINI_API_KEY environment variable is required"):
            LLMService()

    @patch('src.services.llm_service.genai')
    def test_llm_service_init_success(self, mock_genai, monkeypatch):
        """Test LLM service initialization succeeds with API key."""
        # The fixture sets GEMINI_API_KEY to 'test_gemini_api_key'
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        service = LLMService()

        mock_genai.configure.assert_called_once_with(api_key='test_gemini_api_key')
        # Check that model is created
        assert hasattr(service, 'model')
        assert service.model == mock_genai.GenerativeModel.return_value

    @patch('src.services.llm_service.genai')
    def test_process_message_unlinked_patient(self, mock_genai, monkeypatch, db_session, create_sample_clinic, create_sample_therapists, create_sample_appointment_types):
        """Test processing message from unlinked patient returns a text response."""
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        # Mock classification response (appointment)
        from src.services.llm_service import IntentClassification
        mock_classification_response = MagicMock()
        mock_classification_response.parsed = IntentClassification.APPOINTMENT
        mock_classification_response.text = 'appointment'

        # Mock conversation response
        mock_part = MagicMock()
        mock_part.text = "請提供您的手機號碼來連結帳號。"
        mock_part.function_call.name = ""  # No function call
        mock_response = MagicMock()
        mock_response.candidates = [MagicMock(content=MagicMock(parts=[mock_part]))]

        # Mock model generate_content calls
        mock_model = MagicMock()
        mock_model.generate_content.side_effect = [mock_classification_response, mock_response]
        mock_genai.GenerativeModel.return_value = mock_model

        service = LLMService()

        result = service.process_message(
            message="我想預約門診",
            clinic_id=create_sample_clinic.id,
            patient_id=None,
            db=db_session
        )

        assert result["success"] is True
        assert "手機號碼" in result["response"]
        assert result["tool_results"] == []
        # Should call generate_content twice: once for classification, once for main processing
        assert mock_model.generate_content.call_count == 2


    @patch('src.services.llm_service.genai')
    def test_process_message_with_tool_cycle(self, mock_genai, monkeypatch, db_session, create_sample_clinic, create_sample_therapists, create_sample_patients, create_sample_appointment_types):
        """Test processing message with a full tool call and response cycle."""
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        # 0. Mock classification response (appointment)
        from src.services.llm_service import IntentClassification
        mock_classification_response = MagicMock()
        mock_classification_response.parsed = IntentClassification.APPOINTMENT
        mock_classification_response.text = 'appointment'

        # 1. Mock the first response to request a function call
        mock_function_call = MagicMock()
        mock_function_call.name = "get_therapist_availability"
        mock_function_call.args = {"appointment_type": "初診評估"}

        mock_response1 = MagicMock()
        mock_part1 = MagicMock()
        mock_part1.text = ""
        mock_part1.function_call = mock_function_call
        mock_response1.candidates = [MagicMock(content=MagicMock(parts=[mock_part1]))]

        # 2. Mock the second response after getting tool output
        mock_response2 = MagicMock()
        mock_part2 = MagicMock()
        mock_part2.text = "好的，王大明治療師在以下時段有空..."
        mock_part2.function_call.name = ""  # No function call
        mock_response2.candidates = [MagicMock(content=MagicMock(parts=[mock_part2]))]

        # Mock model generate_content calls
        mock_model = MagicMock()
        mock_model.generate_content.side_effect = [mock_classification_response, mock_response1, mock_response2]
        mock_genai.GenerativeModel.return_value = mock_model

        service = LLMService()

        # Execute the process
        result = service.process_message(
            message="我想預約初診",
            clinic_id=create_sample_clinic.id,
            patient_id=create_sample_patients[0].id,
            db=db_session
        )

        # 3. Assertions
        assert result["success"] is True
        assert "王大明" in result["response"]  # Check final text response

        # Check that the tool was called correctly
        assert len(result["tool_results"]) == 1
        tool_result = result["tool_results"][0]
        assert tool_result["tool_name"] == "get_therapist_availability"
        assert tool_result["result"]["success"] is True
        assert len(tool_result["result"]["availability"]) > 0

        # Check that generate_content was called three times: once for classification, twice for tool cycle
        assert mock_model.generate_content.call_count == 3

    @patch('src.services.llm_service.genai')
    def test_classify_message_intent_appointment(self, mock_genai, monkeypatch):
        """Test message intent classification for appointment-related messages."""
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        # Mock structured response
        from src.services.llm_service import IntentClassification
        mock_response = MagicMock()
        mock_response.parsed = IntentClassification.APPOINTMENT
        mock_response.text = 'appointment'  # Fallback

        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_response
        mock_genai.GenerativeModel.return_value = mock_model

        service = LLMService()
        # Build conversation contents
        conversation_contents = [{"role": "user", "parts": [{"text": "我想預約門診"}]}]
        result = service._classify_message_intent(conversation_contents)

        assert result == IntentClassification.APPOINTMENT
        mock_model.generate_content.assert_called_once()

    @patch('src.services.llm_service.genai')
    def test_classify_message_intent_other(self, mock_genai, monkeypatch):
        """Test message intent classification for non-appointment messages."""
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        # Mock structured response
        from src.services.llm_service import IntentClassification
        mock_response = MagicMock()
        mock_response.parsed = IntentClassification.OTHER
        mock_response.text = 'other'  # Fallback

        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_response
        mock_genai.GenerativeModel.return_value = mock_model

        service = LLMService()
        # Build conversation contents
        conversation_contents = [{"role": "user", "parts": [{"text": "你好嗎？"}]}]
        result = service._classify_message_intent(conversation_contents)

        assert result == IntentClassification.OTHER
        mock_model.generate_content.assert_called_once()

    @patch('src.services.llm_service.genai')
    def test_classify_message_intent_with_context(self, mock_genai, monkeypatch):
        """Test message intent classification with conversation history context."""
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        # Mock structured response
        from src.services.llm_service import IntentClassification
        mock_response = MagicMock()
        mock_response.parsed = IntentClassification.APPOINTMENT
        mock_response.text = 'appointment'  # Fallback

        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_response
        mock_genai.GenerativeModel.return_value = mock_model

        service = LLMService()

        # Build conversation contents the same way the method would
        conversation_contents = [
            {"role": "user", "parts": [{"text": "我想預約初診"}]},
            {"role": "model", "parts": [{"text": "好的，請問您想要預約哪位治療師？"}]},
            {"role": "user", "parts": [{"text": "好的"}]}
        ]

        result = service._classify_message_intent(conversation_contents)

        assert result == IntentClassification.APPOINTMENT
        mock_model.generate_content.assert_called_once()

        # Verify the conversation contents are passed correctly
        call_args = mock_model.generate_content.call_args[0][0]  # First positional argument (contents)
        assert len(call_args) == 3  # History + current message
        assert call_args[0]["role"] == "user"
        assert "我想預約初診" in call_args[0]["parts"][0]["text"]
        assert call_args[1]["role"] == "model"
        assert "好的，請問您想要預約哪位治療師？" in call_args[1]["parts"][0]["text"]
        assert call_args[2]["role"] == "user"
        assert "好的" in call_args[2]["parts"][0]["text"]

    @patch('src.services.llm_service.genai')
    def test_process_message_non_appointment(self, mock_genai, monkeypatch, db_session, create_sample_clinic):
        """Test processing non-appointment message returns special protocol."""
        monkeypatch.setattr('src.core.config.settings.gemini_model', 'gemini-2.5-flash-lite')

        # Mock classification response - other intent
        from src.services.llm_service import IntentClassification
        mock_classification_response = MagicMock()
        mock_classification_response.parsed = IntentClassification.OTHER
        mock_classification_response.text = 'other'

        # Mock model generate_content calls
        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_classification_response
        mock_genai.GenerativeModel.return_value = mock_model

        service = LLMService()
        result = service.process_message(
            message="你好嗎？",
            clinic_id=create_sample_clinic.id,
            patient_id=None,
            db=db_session
        )

        assert result["response"] == "NON_APPOINTMENT_MESSAGE"
        assert result["success"] is True
        assert result["intent"] == "other"
        # Should only call classification
        mock_model.generate_content.assert_called_once()


class TestGetTherapistAvailabilityTool:
    """Test cases for therapist availability tool."""

    def test_tool_initialization(self, db_session, create_sample_clinic):
        """Test tool initialization."""
        tool = GetTherapistAvailabilityTool(db_session, create_sample_clinic.id)

        assert tool.name == "get_therapist_availability"
        assert tool.description.startswith("Get available time slots")
        assert "appointment_type" in tool.parameters["required"]

    def test_get_availability_missing_appointment_type(self, db_session, create_sample_clinic):
        """Test getting availability without appointment type."""
        tool = GetTherapistAvailabilityTool(db_session, create_sample_clinic.id)

        result = tool.execute(therapist_name="王大明")

        assert result["success"] is False
        assert "not found" in result["error"]

    def test_get_availability_invalid_appointment_type(self, db_session, create_sample_clinic):
        """Test getting availability with invalid appointment type."""
        tool = GetTherapistAvailabilityTool(db_session, create_sample_clinic.id)

        result = tool.execute(appointment_type="不存在的項目")

        assert result["success"] is False
        assert "not found" in result["error"]

    def test_get_availability_success(self, db_session, create_sample_clinic, create_sample_therapists, create_sample_appointment_types):
        """Test successfully getting therapist availability."""
        tool = GetTherapistAvailabilityTool(db_session, create_sample_clinic.id)

        result = tool.execute(appointment_type="初診評估")

        assert result["success"] is True
        assert "availability" in result
        assert len(result["availability"]) > 0
        assert result["appointment_type"] == "初診評估"
        assert result["duration_minutes"] == 60

    def test_get_availability_with_therapist_filter(self, db_session, create_sample_clinic, create_sample_therapists, create_sample_appointment_types):
        """Test getting availability for specific therapist."""
        tool = GetTherapistAvailabilityTool(db_session, create_sample_clinic.id)

        result = tool.execute(therapist_name="王大明", appointment_type="初診評估")

        assert result["success"] is True
        assert len(result["availability"]) == 1
        assert result["availability"][0]["therapist"] == "王大明"

    def test_tool_to_gemini_format(self, db_session, create_sample_clinic):
        """Test conversion to Gemini tool format."""
        tool = GetTherapistAvailabilityTool(db_session, create_sample_clinic.id)
        gemini_tool = tool.to_gemini_tool()
        assert gemini_tool.name == "get_therapist_availability"
        assert "Get available time slots" in gemini_tool.description
        assert gemini_tool.parameters.properties['appointment_type'].type.name == 'STRING'


class TestCreateAppointmentTool:
    """Test cases for appointment creation tool."""

    def test_tool_initialization(self, db_session, create_sample_clinic, create_sample_patients):
        """Test tool initialization."""
        tool = CreateAppointmentTool(db_session, create_sample_clinic.id, create_sample_patients[0].id)

        assert tool.name == "create_appointment"
        assert tool.description.startswith("Create a new appointment")
        assert tool.patient_id == create_sample_patients[0].id

    def test_create_appointment_missing_parameters(self, db_session, create_sample_clinic, create_sample_patients):
        """Test creating appointment with missing parameters."""
        tool = CreateAppointmentTool(db_session, create_sample_clinic.id, create_sample_patients[0].id)

        result = tool.execute(therapist_name="王大明")  # Missing required parameters

        assert result["success"] is False
        assert "error" in result

    def test_create_appointment_invalid_therapist(self, db_session, create_sample_clinic, create_sample_patients):
        """Test creating appointment with invalid therapist."""
        tool = CreateAppointmentTool(db_session, create_sample_clinic.id, create_sample_patients[0].id)

        result = tool.execute(
            therapist_name="不存在的治療師",
            appointment_type="初診評估",
            date="2024-12-25",
            time="10:00"
        )

        assert result["success"] is False
        assert "not found" in result["error"]

    def test_create_appointment_invalid_appointment_type(self, db_session, create_sample_clinic, create_sample_patients, create_sample_therapists):
        """Test creating appointment with invalid appointment type."""
        tool = CreateAppointmentTool(db_session, create_sample_clinic.id, create_sample_patients[0].id)

        result = tool.execute(
            therapist_name="王大明",
            appointment_type="不存在的項目",
            date="2024-12-25",
            time="10:00"
        )

        assert result["success"] is False
        assert "not found" in result["error"]

    def test_create_appointment_success(self, db_session, create_sample_clinic, create_sample_patients, create_sample_therapists, create_sample_appointment_types):
        """Test successfully creating an appointment."""
        tool = CreateAppointmentTool(db_session, create_sample_clinic.id, create_sample_patients[0].id)

        result = tool.execute(
            therapist_name="王大明",
            appointment_type="初診評估",
            date="2024-12-25",
            time="10:00"
        )

        assert result["success"] is True
        assert "appointment_id" in result
        assert result["therapist"] == "王大明"
        assert result["appointment_type"] == "初診評估"
        assert result["date"] == "2024-12-25"
        assert result["time"] == "10:00"

        # Verify appointment was created in database
        from src.models.appointment import Appointment
        appointment = db_session.query(Appointment).filter(Appointment.id == result["appointment_id"]).first()
        assert appointment is not None
        assert appointment.patient_id == create_sample_patients[0].id
        assert appointment.status == "confirmed"

    def test_create_appointment_double_booking(self, db_session, create_sample_clinic, create_sample_patients, create_sample_therapists, create_sample_appointment_types):
        """Test preventing double booking."""
        # First create an appointment
        tool = CreateAppointmentTool(db_session, create_sample_clinic.id, create_sample_patients[0].id)

        result1 = tool.execute(
            therapist_name="王大明",
            appointment_type="初診評估",
            date="2024-12-25",
            time="10:00"
        )
        assert result1["success"] is True

        # Try to create another appointment at the same time
        result2 = tool.execute(
            therapist_name="王大明",
            appointment_type="一般複診",
            date="2024-12-25",
            time="10:00"
        )

        assert result2["success"] is False
        assert "no longer available" in result2["error"]
