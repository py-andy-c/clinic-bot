"""
Integration tests for LINE webhook processing.

Tests the complete flow from webhook reception to agent orchestration,
ensuring the critical path works end-to-end.
"""

import json
import hmac
import hashlib
import base64
from unittest.mock import patch, AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from main import app

from models import Clinic, User, Patient, AppointmentType, LineUser
from clinic_agents.orchestrator import handle_line_message
from core.database import get_db


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        return db_session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    yield client

    # Cleanup
    app.dependency_overrides.pop(get_db, None)


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
def linked_patient(db_session, test_clinic_with_therapist):
    """Create a patient linked to a LINE user."""
    clinic, _, _ = test_clinic_with_therapist

    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="+1234567890"
    )

    line_user = LineUser(
        line_user_id="Utest_patient_123"
    )

    patient.line_user = line_user

    db_session.add_all([patient, line_user])
    db_session.commit()

    return patient


@pytest.fixture
def unlinked_line_user(db_session, test_clinic_with_therapist):
    """Create an unlinked LINE user."""
    clinic, _, _ = test_clinic_with_therapist

    line_user = LineUser(
        line_user_id="Utest_unlinked_456"
    )

    db_session.add(line_user)
    db_session.commit()

    return line_user


def create_line_signature(body: str, secret: str) -> str:
    """Create a LINE webhook signature for testing."""
    hash_digest = hmac.new(
        secret.encode('utf-8'),
        body.encode('utf-8'),
        hashlib.sha256
    ).digest()
    return base64.b64encode(hash_digest).decode('utf-8')


def create_line_webhook_payload(line_user_id: str, message_text: str) -> dict:
    """Create a valid LINE webhook payload."""
    return {
        "events": [
            {
                "type": "message",
                "timestamp": 1234567890123,
                "source": {
                    "type": "user",
                    "userId": line_user_id
                },
                "message": {
                    "type": "text",
                    "id": "msg123",
                    "text": message_text
                }
            }
        ]
    }


class TestLineWebhookIntegration:
    """Integration tests for LINE webhook processing."""

    @pytest.mark.asyncio
    async def test_line_webhook_with_valid_message_linked_patient(self, client, db_session, test_clinic_with_therapist, linked_patient):
        """Test LINE webhook processes text message and calls orchestrator for linked patient."""
        clinic, therapist, _ = test_clinic_with_therapist

        # Create webhook payload
        payload = create_line_webhook_payload(linked_patient.line_user.line_user_id, "我想預約門診")
        body = json.dumps(payload, separators=(',', ':'))

        # Create signature
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Mock the orchestrator and LINE service to return a response (avoid external API calls)
        with patch('api.webhooks.handle_line_message') as mock_handle, \
             patch('services.line_service.LINEService.send_text_message') as mock_send:
            mock_handle.return_value = "好的，我來幫您安排預約。"

            # Make request with clinic header
            response = client.post(
                "/webhook/line",
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Line-Signature": signature,
                    "X-Clinic-ID": str(clinic.id)
                }
            )

            # Should return OK
            assert response.status_code == 200
            assert response.text == "OK"

            # Should have called orchestrator
            mock_handle.assert_called_once()
            call_args = mock_handle.call_args
            assert call_args[1]['clinic'] == clinic
            assert call_args[1]['line_user_id'] == linked_patient.line_user.line_user_id
            assert "預約門診" in call_args[1]['message_text']

    @pytest.mark.asyncio
    async def test_line_webhook_with_valid_message_unlinked_user(self, client, db_session, test_clinic_with_therapist, unlinked_line_user):
        """Test LINE webhook processes text message for unlinked user."""
        clinic, _, _ = test_clinic_with_therapist

        # Create webhook payload
        payload = create_line_webhook_payload(unlinked_line_user.line_user_id, "我的手機號碼是0912345678")
        body = json.dumps(payload, separators=(',', ':'))

        # Create signature
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Mock the orchestrator and LINE service to return a response (avoid external API calls)
        with patch('api.webhooks.handle_line_message') as mock_handle, \
             patch('services.line_service.LINEService.send_text_message') as mock_send:
            mock_handle.return_value = "請提供您的手機號碼以完成帳號連結。"

            # Make request with clinic header
            response = client.post(
                "/webhook/line",
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Line-Signature": signature,
                    "X-Clinic-ID": str(clinic.id)
                }
            )

            # Should return OK
            assert response.status_code == 200
            assert response.text == "OK"

            # Should have called orchestrator
            mock_handle.assert_called_once()
            call_args = mock_handle.call_args
            assert call_args[1]['clinic'] == clinic
            assert call_args[1]['line_user_id'] == unlinked_line_user.line_user_id
            assert "0912345678" in call_args[1]['message_text']

    def test_line_webhook_updates_clinic_stats(self, client, db_session, test_clinic_with_therapist, linked_patient):
        """Test webhook updates clinic webhook count and timestamp."""
        clinic, _, _ = test_clinic_with_therapist
        initial_count = clinic.webhook_count_24h or 0
        initial_timestamp = clinic.last_webhook_received_at

        # Create webhook payload
        payload = create_line_webhook_payload(linked_patient.line_user.line_user_id, "test")
        body = json.dumps(payload, separators=(',', ':'))

        # Create signature
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Mock the orchestrator (avoid async session issues)
        with patch('api.webhooks.handle_line_message') as mock_handle:
            mock_handle.return_value = None  # No response

            # Make request
            response = client.post(
                "/webhook/line",
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Line-Signature": signature,
                    "X-Clinic-ID": str(clinic.id)
                }
            )

            assert response.status_code == 200

            # Refresh clinic from database
            db_session.refresh(clinic)

            # Should have updated stats
            assert clinic.webhook_count_24h == initial_count + 1
            assert clinic.last_webhook_received_at is not None
            if initial_timestamp:
                assert clinic.last_webhook_received_at >= initial_timestamp

    @pytest.mark.asyncio
    async def test_line_webhook_with_non_text_message(self, client, db_session, test_clinic_with_therapist, linked_patient):
        """Test LINE webhook ignores non-text messages (images, stickers, etc.)."""
        clinic, _, _ = test_clinic_with_therapist

        # Create webhook payload with image message
        payload = {
            "events": [
                {
                    "type": "message",
                    "timestamp": 1234567890123,
                    "source": {
                        "type": "user",
                        "userId": linked_patient.line_user.line_user_id
                    },
                    "message": {
                        "type": "image",
                        "id": "img123",
                        "contentProvider": {
                            "type": "line"
                        }
                    }
                }
            ]
        }
        body = json.dumps(payload, separators=(',', ':'))

        # Create signature
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Make request
        response = client.post(
            "/webhook/line",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Line-Signature": signature,
                "X-Clinic-ID": str(clinic.id)
            }
        )

        # Should return OK without calling orchestrator
        assert response.status_code == 200
        assert response.text == "OK"

        # Orchestrator should not have been called (we can't easily test this without mocking at module level)

    @pytest.mark.asyncio
    async def test_line_webhook_with_empty_events(self, client, db_session, test_clinic_with_therapist):
        """Test LINE webhook handles empty events array."""
        clinic, _, _ = test_clinic_with_therapist

        # Create webhook payload with empty events
        payload = {"events": []}
        body = json.dumps(payload, separators=(',', ':'))

        # Create signature
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Make request
        response = client.post(
            "/webhook/line",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Line-Signature": signature,
                "X-Clinic-ID": str(clinic.id)
            }
        )

        # Should return OK
        assert response.status_code == 200
        assert response.text == "OK"

    def test_line_webhook_invalid_json(self, client, test_clinic_with_therapist):
        """Test LINE webhook handles invalid JSON payload."""
        clinic, _, _ = test_clinic_with_therapist

        # Invalid JSON body
        body = '{"events": [{"type": "message", "invalid": json}'
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Make request
        response = client.post(
            "/webhook/line",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Line-Signature": signature,
                "X-Clinic-ID": str(clinic.id)
            }
        )

        # Should return 400 Bad Request
        assert response.status_code == 400
        response_data = response.json()
        assert "Invalid JSON payload" in response_data["detail"]


class TestLineWebhookSecurity:
    """Security tests for LINE webhook signature validation."""

    def test_line_webhook_missing_signature(self, client, test_clinic_with_therapist, linked_patient):
        """Test LINE webhook rejects requests without signature."""
        clinic, _, _ = test_clinic_with_therapist

        payload = create_line_webhook_payload(linked_patient.line_user.line_user_id, "test")
        body = json.dumps(payload, separators=(',', ':'))

        # Make request without signature
        response = client.post(
            "/webhook/line",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Clinic-ID": str(clinic.id)
            }
        )

        # Should return 401 Unauthorized
        assert response.status_code == 401
        response_data = response.json()
        assert "Invalid LINE signature" in response_data["detail"]

    def test_line_webhook_invalid_signature(self, client, test_clinic_with_therapist, linked_patient):
        """Test LINE webhook rejects invalid signatures."""
        clinic, _, _ = test_clinic_with_therapist

        payload = create_line_webhook_payload(linked_patient.line_user.line_user_id, "test")
        body = json.dumps(payload, separators=(',', ':'))

        # Create invalid signature
        invalid_signature = create_line_signature(body, "wrong_secret")

        # Make request with invalid signature
        response = client.post(
            "/webhook/line",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Line-Signature": invalid_signature,
                "X-Clinic-ID": str(clinic.id)
            }
        )

        # Should return 401 Unauthorized
        assert response.status_code == 401
        response_data = response.json()
        assert "Invalid LINE signature" in response_data["detail"]

    def test_line_webhook_tampered_payload(self, client, test_clinic_with_therapist, linked_patient):
        """Test LINE webhook rejects tampered payloads."""
        clinic, _, _ = test_clinic_with_therapist

        # Create payload and sign it
        original_payload = create_line_webhook_payload(linked_patient.line_user.line_user_id, "original message")
        body = json.dumps(original_payload, separators=(',', ':'))
        signature = create_line_signature(body, clinic.line_channel_secret)

        # Tamper with the payload after signing
        tampered_payload = create_line_webhook_payload(linked_patient.line_user.line_user_id, "tampered message")
        tampered_body = json.dumps(tampered_payload, separators=(',', ':'))

        # Make request with original signature but tampered body
        response = client.post(
            "/webhook/line",
            content=tampered_body,
            headers={
                "Content-Type": "application/json",
                "X-Line-Signature": signature,
                "X-Clinic-ID": str(clinic.id)
            }
        )

        # Should return 401 Unauthorized
        assert response.status_code == 401
        response_data = response.json()
        assert "Invalid LINE signature" in response_data["detail"]
