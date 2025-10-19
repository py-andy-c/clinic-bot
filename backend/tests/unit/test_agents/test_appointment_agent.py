"""
Unit tests for appointment agent.

Tests the appointment agent dynamic instructions generation.
"""

import pytest
from unittest.mock import Mock
from datetime import datetime

from clinic_agents.appointment_agent import get_appointment_instructions
from clinic_agents.context import ConversationContext
from models.clinic import Clinic
from models.patient import Patient
from models.therapist import Therapist
from models.appointment_type import AppointmentType


class TestAppointmentAgent:
    """Test appointment agent functionality."""

    def test_get_appointment_instructions_with_linked_patient(self):
        """Test dynamic instructions generation with linked patient."""
        # Setup test data
        clinic = Clinic(id=1, name="測試診所", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")

        # Mock therapists and appointment types
        therapist1 = Therapist(id=1, clinic_id=1, name="王治療師", email="wang@test.com")
        therapist2 = Therapist(id=2, clinic_id=1, name="陳治療師", email="chen@test.com")

        apt_type1 = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)
        apt_type2 = AppointmentType(id=2, clinic_id=1, name="一般複診", duration_minutes=30)

        # Mock database session
        mock_db = Mock()
        def query_side_effect(model):
            mock_query = Mock()
            mock_filter = Mock()
            if model == Therapist:
                mock_filter.all.return_value = [therapist1, therapist2]
            elif model == AppointmentType:
                mock_filter.all.return_value = [apt_type1, apt_type2]
            mock_query.filter.return_value = mock_filter
            return mock_query
        mock_db.query.side_effect = query_side_effect

        # Create context
        context = ConversationContext(
            db_session=mock_db,
            clinic=clinic,
            patient=patient,
            line_user_id="test_user",
            is_linked=True
        )

        # Create wrapper
        wrapper = Mock()
        wrapper.context = context

        # Call the function
        instructions = get_appointment_instructions(wrapper, None)

        # Verify the instructions contain expected content
        assert "測試診所" in instructions
        assert "王治療師" in instructions
        assert "陳治療師" in instructions
        assert "初診評估" in instructions
        assert "一般複診" in instructions
        assert "測試病人" in instructions
        assert "已驗證" in instructions

        # Verify structure
        assert "你是一個友好的預約助手" in instructions
        assert "**診所資訊：**" in instructions
        assert "**用戶資訊：**" in instructions
        assert "**任務說明：**" in instructions

    def test_get_appointment_instructions_without_patient(self):
        """Test dynamic instructions generation without linked patient."""
        # Setup test data
        clinic = Clinic(id=1, name="測試診所", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock therapists and appointment types
        therapist1 = Therapist(id=1, clinic_id=1, name="王治療師", email="wang@test.com")
        apt_type1 = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)

        # Mock database session
        mock_db = Mock()
        def query_side_effect(model):
            mock_query = Mock()
            mock_filter = Mock()
            if model == Therapist:
                mock_filter.all.return_value = [therapist1]
            elif model == AppointmentType:
                mock_filter.all.return_value = [apt_type1]
            mock_query.filter.return_value = mock_filter
            return mock_query
        mock_db.query.side_effect = query_side_effect

        # Create context without patient
        context = ConversationContext(
            db_session=mock_db,
            clinic=clinic,
            patient=None,
            line_user_id="test_user",
            is_linked=False
        )

        # Create wrapper
        wrapper = Mock()
        wrapper.context = context

        # Call the function
        instructions = get_appointment_instructions(wrapper, None)

        # Verify the instructions contain expected content
        assert "測試診所" in instructions
        assert "王治療師" in instructions
        assert "初診評估" in instructions
        assert "未連結的用戶" in instructions
        assert "未連結" in instructions

    def test_get_appointment_instructions_empty_lists(self):
        """Test dynamic instructions generation with empty therapist/appointment type lists."""
        # Setup test data
        clinic = Clinic(id=1, name="測試診所", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock database session
        mock_db = Mock()
        def query_side_effect(model):
            mock_query = Mock()
            mock_filter = Mock()
            if model == Therapist:
                mock_filter.all.return_value = []
            elif model == AppointmentType:
                mock_filter.all.return_value = []
            mock_query.filter.return_value = mock_filter
            return mock_query
        mock_db.query.side_effect = query_side_effect

        # Create context
        context = ConversationContext(
            db_session=mock_db,
            clinic=clinic,
            patient=None,
            line_user_id="test_user",
            is_linked=False
        )

        # Create wrapper
        wrapper = Mock()
        wrapper.context = context

        # Call the function
        instructions = get_appointment_instructions(wrapper, None)

        # Verify the instructions handle empty lists gracefully
        assert "測試診所" in instructions
        assert "未連結的用戶" in instructions
