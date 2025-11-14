"""
Integration tests for LINE webhook quoted message functionality.

Tests the complete flow of quoted message handling through the LINE webhook endpoint.
"""

import pytest
import json
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic, LineMessage
from models.clinic import ChatSettings
from services.clinic_agent import ClinicAgentService
from services.line_message_service import LineMessageService, QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
from utils.datetime_utils import taiwan_now


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def test_clinic_with_chat_enabled(db_session):
    """Create a test clinic with chat enabled."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        line_official_account_user_id="U_official_account_123",
        settings={
            "chat_settings": {
                "chat_enabled": True,
                "clinic_description": "Test clinic description"
            }
        }
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


def create_line_webhook_payload(
    line_user_id: str,
    message_text: str,
    destination: str = "U_official_account_123",
    reply_token: str = "test_reply_token",
    message_id: str = "test_message_id_123",
    quoted_message_id: str = None
) -> dict:
    """Create a LINE webhook payload for testing."""
    payload = {
        "destination": destination,
        "events": [{
            "type": "message",
            "message": {
                "type": "text",
                "text": message_text,
                "id": message_id
            },
            "source": {
                "userId": line_user_id
            },
            "replyToken": reply_token
        }]
    }
    
    if quoted_message_id:
        payload["events"][0]["message"]["quotedMessageId"] = quoted_message_id
    
    return payload


def create_line_signature(body: str, secret: str) -> str:
    """Create a mock LINE webhook signature for testing."""
    import hmac
    import hashlib
    import base64
    
    hash_value = hmac.new(
        secret.encode('utf-8'),
        body.encode('utf-8'),
        hashlib.sha256
    ).digest()
    return base64.b64encode(hash_value).decode('utf-8')


class TestLineWebhookQuotedMessages:
    """Test quoted message handling in LINE webhook."""
    
    @patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock)
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.line_service.LINEService.start_loading_animation')
    def test_message_with_quoted_content(
        self,
        mock_loading,
        mock_send,
        mock_process_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that messages with quoted content are properly formatted and processed."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Store an original message that will be quoted
        original_message = LineMessageService.store_message(
            db=db_session,
            line_message_id="original_msg_123",
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            message_text="這是原始訊息",
            message_type="text",
            is_from_user=True,
            quoted_message_id=None,
            session_id=f"{clinic.id}-{line_user_id}"
        )
        
        # Create webhook payload with quoted message
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是回覆",
            destination=clinic.line_official_account_user_id,
            message_id="reply_msg_456",
            quoted_message_id="original_msg_123"
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Mock agent response
        mock_process_message.return_value = "這是AI回覆"
        
        # Mock LINE API response (message ID)
        mock_send.return_value = "bot_msg_789"
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={"X-Line-Signature": signature}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify message was stored
        stored_message = db_session.query(LineMessage).filter(
            LineMessage.line_message_id == "reply_msg_456"
        ).first()
        assert stored_message is not None
        assert stored_message.message_text == "這是回覆"
        assert stored_message.quoted_message_id == "original_msg_123"
        
        # Verify agent was called with formatted message containing quoted content
        mock_process_message.assert_called_once()
        call_args = mock_process_message.call_args
        # Check that quoted_message_text and quoted_is_from_user were passed
        assert call_args[1]["quoted_message_text"] == "這是原始訊息"
        assert call_args[1]["quoted_is_from_user"] is True
        assert call_args[1]["message"] == "這是回覆"
    
    @patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock)
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.line_service.LINEService.start_loading_animation')
    def test_message_with_quoted_message_not_found(
        self,
        mock_loading,
        mock_send,
        mock_process_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that when quoted message is not found, AI is informed."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Create webhook payload with quoted message that doesn't exist
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是回覆",
            destination=clinic.line_official_account_user_id,
            message_id="reply_msg_456",
            quoted_message_id="nonexistent_msg_123"
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Mock agent response
        mock_process_message.return_value = "這是AI回覆"
        
        # Mock LINE API response (message ID)
        mock_send.return_value = "bot_msg_789"
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={"X-Line-Signature": signature}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify agent was called with message indicating quote attempt failed
        mock_process_message.assert_called_once()
        call_args = mock_process_message.call_args
        # Check that quoted_message_text indicates quote was attempted but failed
        assert call_args[1]["quoted_message_text"] == QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
        assert call_args[1]["quoted_is_from_user"] is None
        assert call_args[1]["message"] == "這是回覆"
    
    @patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock)
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.line_service.LINEService.start_loading_animation')
    def test_message_with_quoted_message_non_text(
        self,
        mock_loading,
        mock_send,
        mock_process_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that when quoted message is non-text, AI is informed."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Store a non-text message (e.g., image)
        original_message = LineMessageService.store_message(
            db=db_session,
            line_message_id="image_msg_123",
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            message_text=None,  # Non-text message
            message_type="image",
            is_from_user=True,
            quoted_message_id=None,
            session_id=f"{clinic.id}-{line_user_id}"
        )
        
        # Create webhook payload with quoted message
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是回覆",
            destination=clinic.line_official_account_user_id,
            message_id="reply_msg_456",
            quoted_message_id="image_msg_123"
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Mock agent response
        mock_process_message.return_value = "這是AI回覆"
        
        # Mock LINE API response (message ID)
        mock_send.return_value = "bot_msg_789"
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={"X-Line-Signature": signature}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify agent was called with message indicating quote attempt failed
        mock_process_message.assert_called_once()
        call_args = mock_process_message.call_args
        # Check that quoted_message_text indicates quote was attempted but failed (non-text)
        assert call_args[1]["quoted_message_text"] == QUOTE_ATTEMPTED_BUT_NOT_AVAILABLE
        assert call_args[1]["quoted_is_from_user"] is None
        assert call_args[1]["message"] == "這是回覆"
    
    @patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock)
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.line_service.LINEService.start_loading_animation')
    def test_message_without_quote(
        self,
        mock_loading,
        mock_send,
        mock_process_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that messages without quotes are processed normally."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Create webhook payload without quoted message
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是普通訊息",
            destination=clinic.line_official_account_user_id,
            message_id="normal_msg_123"
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Mock agent response
        mock_process_message.return_value = "這是AI回覆"
        
        # Mock LINE API response (message ID)
        mock_send.return_value = "bot_msg_789"
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={"X-Line-Signature": signature}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        
        # Verify agent was called with message as-is (no quote formatting)
        mock_process_message.assert_called_once()
        call_args = mock_process_message.call_args
        assert call_args[1]["message"] == "這是普通訊息"
        assert call_args[1]["quoted_message_text"] is None
        assert call_args[1]["quoted_is_from_user"] is None
    
    def test_store_and_retrieve_message(self, db_session, test_clinic_with_chat_enabled):
        """Test storing and retrieving LINE messages."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Store a message
        stored = LineMessageService.store_message(
            db=db_session,
            line_message_id="msg_123",
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            message_text="測試訊息",
            message_type="text",
            is_from_user=True,
            quoted_message_id=None,
            session_id=f"{clinic.id}-{line_user_id}"
        )
        
        assert stored.id is not None
        assert stored.line_message_id == "msg_123"
        assert stored.message_text == "測試訊息"
        
        # Retrieve quoted message
        quoted_result = LineMessageService.get_quoted_message(
            db=db_session,
            quoted_message_id="msg_123",
            clinic_id=clinic.id,
            line_user_id=line_user_id
        )
        
        assert quoted_result is not None
        quoted_text, is_from_user = quoted_result
        assert quoted_text == "測試訊息"
        assert is_from_user is True
    
    def test_retrieve_quoted_message_not_found(self, db_session, test_clinic_with_chat_enabled):
        """Test retrieving a quoted message that doesn't exist."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        quoted_result = LineMessageService.get_quoted_message(
            db=db_session,
            quoted_message_id="nonexistent_msg",
            clinic_id=clinic.id,
            line_user_id=line_user_id
        )
        
        assert quoted_result is None
    
    def test_retrieve_quoted_message_wrong_clinic(self, db_session):
        """Test that quoted messages from different clinics are not returned."""
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="channel1",
            line_channel_secret="secret1",
            line_channel_access_token="token1",
            line_official_account_user_id="U_account_1",
            settings={"chat_settings": {"chat_enabled": True}}
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="channel2",
            line_channel_secret="secret2",
            line_channel_access_token="token2",
            line_official_account_user_id="U_account_2",
            settings={"chat_settings": {"chat_enabled": True}}
        )
        db_session.add(clinic1)
        db_session.add(clinic2)
        db_session.commit()
        db_session.refresh(clinic1)
        db_session.refresh(clinic2)
        
        line_user_id = "U_test_user_123"
        
        # Store message in clinic1
        LineMessageService.store_message(
            db=db_session,
            line_message_id="msg_123",
            line_user_id=line_user_id,
            clinic_id=clinic1.id,
            message_text="Clinic 1 message",
            message_type="text",
            is_from_user=True,
            quoted_message_id=None,
            session_id=f"{clinic1.id}-{line_user_id}"
        )
        
        # Try to retrieve from clinic2 (should fail)
        quoted_result = LineMessageService.get_quoted_message(
            db=db_session,
            quoted_message_id="msg_123",
            clinic_id=clinic2.id,
            line_user_id=line_user_id
        )
        
        assert quoted_result is None

