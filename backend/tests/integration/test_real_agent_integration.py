"""
Real OpenAI Agent SDK Integration Tests.

These tests run actual OpenAI Agent SDK calls to catch integration bugs
that mocking would miss (like the final_output_as() issue we fixed).

Requires: OPENAI_API_KEY in .env.test
"""

import pytest
from unittest.mock import patch

from clinic_agents.orchestrator import handle_line_message
from models.clinic import Clinic
from models.patient import Patient
from models.line_user import LineUser


@pytest.mark.real_agent
@pytest.mark.slow
class TestRealAgentIntegration:
    """Integration tests that use real OpenAI Agent SDK."""

    @pytest.fixture
    def real_agent_clinic(self, db_session):
        """Create a clinic for real agent testing."""
        clinic = Clinic(
            name="Real Agent Test Clinic",
            line_channel_id="real_agent_test",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        return clinic

    @pytest.fixture
    def linked_patient(self, db_session, real_agent_clinic):
        """Create a linked patient for real agent testing."""
        patient = Patient(
            clinic_id=real_agent_clinic.id,
            full_name="測試病人",
            phone_number="+886912345678"
        )
        db_session.add(patient)
        db_session.flush()  # Get patient.id

        line_user = LineUser(
            line_user_id="real_agent_test_user",
            patient_id=patient.id
        )
        db_session.add(line_user)
        db_session.commit()
        return patient

    @pytest.mark.skip(reason="Cursor sandbox env does not have internet connection")
    @pytest.mark.asyncio
    async def test_triage_agent_real_sdk_call(self, db_session, real_agent_clinic, linked_patient):
        """Test that triage agent works with real OpenAI SDK."""
        # This will actually call OpenAI API and test the final_output.intent access
        response = await handle_line_message(
            db_session,
            real_agent_clinic,
            "real_agent_test_user",
            "我想預約看診"
        )

        # Verify response is returned (not None)
        assert response is not None
        assert isinstance(response, str)

    @pytest.mark.skip(reason="Cursor sandbox env does not have internet connection")
    @pytest.mark.asyncio
    async def test_appointment_agent_real_sdk_call(self, db_session, real_agent_clinic, linked_patient):
        """Test that appointment agent works with real OpenAI SDK."""
        # Test the final_output_as(str) call that we fixed
        response = await handle_line_message(
            db_session,
            real_agent_clinic,
            "real_agent_test_user",
            "我想預約明天上午10點"
        )

        assert response is not None
        assert isinstance(response, str)

    @pytest.mark.skip(reason="Cursor sandbox env does not have internet connection")
    @pytest.mark.asyncio
    async def test_account_linking_agent_real_sdk_call(self, db_session, real_agent_clinic):
        """Test account linking with real OpenAI SDK."""
        # Create unlinked user (no patient_id means unlinked)
        line_user = LineUser(
            line_user_id="unlinked_test_user"
        )
        db_session.add(line_user)
        db_session.commit()

        # Test account linking flow
        response = await handle_line_message(
            db_session,
            real_agent_clinic,
            "unlinked_test_user",
            "我的手機號碼是0912345678"
        )

        assert response is not None
        assert isinstance(response, str)
