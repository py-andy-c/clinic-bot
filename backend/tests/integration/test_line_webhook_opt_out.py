"""
Integration tests for LINE webhook opt-out functionality.

Tests the complete flow of AI opt-out commands and message handling
through the LINE webhook endpoint.
"""

import pytest
import json
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic, LineUserAiOptOut
from models.clinic import ChatSettings
from services.clinic_agent import ClinicAgentService
from utils.datetime_utils import taiwan_now
from core.constants import OPT_OUT_COMMAND, RE_ENABLE_COMMAND, AI_OPT_OUT_DURATION_HOURS


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
    reply_token: str = "test_reply_token"
) -> dict:
    """Create a LINE webhook payload for testing."""
    return {
        "destination": destination,
        "events": [{
            "type": "message",
            "message": {
                "type": "text",
                "text": message_text
            },
            "source": {
                "userId": line_user_id
            },
            "replyToken": reply_token
        }]
    }


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


class TestLineWebhookOptOutCommands:
    """Test opt-out command handling in LINE webhook."""
    
    def test_opt_out_command_sets_opt_out(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that sending '人工回覆' command sets opt-out and sends confirmation."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text=OPT_OUT_COMMAND,
            destination=clinic.line_official_account_user_id
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Mock LINE service to capture sent messages
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, OPT_OUT_COMMAND, "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            response = client.post(
                "/api/line/webhook",
                content=body,
                headers={"X-Line-Signature": signature}
            )
            
            assert response.status_code == 200
            
            # Verify opt-out was set
            opt_out = db_session.query(LineUserAiOptOut).filter(
                LineUserAiOptOut.line_user_id == line_user_id,
                LineUserAiOptOut.clinic_id == clinic.id
            ).first()
            assert opt_out is not None
            assert opt_out.opted_out_until > taiwan_now()
            
            # Verify confirmation message was sent
            mock_service.send_text_message.assert_called_once()
            call_args = mock_service.send_text_message.call_args
            assert call_args.kwargs['line_user_id'] == line_user_id
            assert "診所人員會盡快回覆您" in call_args.kwargs['text']
            assert f"{AI_OPT_OUT_DURATION_HOURS}小時" in call_args.kwargs['text']
            assert "重啟AI" in call_args.kwargs['text']
    
    def test_opt_out_command_with_quotes(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that opt-out command works with quotes and parentheses."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Test various quote formats
        for message in [f'"{OPT_OUT_COMMAND}"', f"「{OPT_OUT_COMMAND}」", f"({OPT_OUT_COMMAND})", f"【{OPT_OUT_COMMAND}】"]:
            payload = create_line_webhook_payload(
                line_user_id=line_user_id,
                message_text=message,
                destination=clinic.line_official_account_user_id
            )
            body = json.dumps(payload)
            signature = create_line_signature(body, clinic.line_channel_secret)
            
            with patch('api.line_webhook.LINEService') as mock_line_service_class:
                mock_service = MagicMock()
                mock_service.verify_signature.return_value = True
                mock_service.extract_message_data.return_value = (line_user_id, message, "test_reply_token", "msg_123", None)
                mock_service.send_text_message = MagicMock()
                mock_service.start_loading_animation = MagicMock()
                mock_line_service_class.return_value = mock_service
                
                response = client.post(
                    "/api/line/webhook",
                    content=body,
                    headers={"X-Line-Signature": signature}
                )
                
                assert response.status_code == 200
                
                # Verify opt-out was set
                opt_out = db_session.query(LineUserAiOptOut).filter(
                    LineUserAiOptOut.line_user_id == line_user_id,
                    LineUserAiOptOut.clinic_id == clinic.id
                ).first()
                assert opt_out is not None
    
    def test_re_enable_command_clears_opt_out(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that sending '重啟AI' command (case-insensitive) clears opt-out and sends confirmation."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Set opt-out first
        from services.line_opt_out_service import set_ai_opt_out
        set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        # Verify opt-out exists
        opt_out = db_session.query(LineUserAiOptOut).filter(
            LineUserAiOptOut.line_user_id == line_user_id,
            LineUserAiOptOut.clinic_id == clinic.id
        ).first()
        assert opt_out is not None
        
        # Send re-enable command
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text=RE_ENABLE_COMMAND,
            destination=clinic.line_official_account_user_id
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, RE_ENABLE_COMMAND, "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            response = client.post(
                "/api/line/webhook",
                content=body,
                headers={"X-Line-Signature": signature}
            )
            
            assert response.status_code == 200
            
            # Verify opt-out was cleared
            opt_out = db_session.query(LineUserAiOptOut).filter(
                LineUserAiOptOut.line_user_id == line_user_id,
                LineUserAiOptOut.clinic_id == clinic.id
            ).first()
            assert opt_out is None
            
            # Verify confirmation message was sent
            mock_service.send_text_message.assert_called_once()
            call_args = mock_service.send_text_message.call_args
            assert call_args.kwargs['line_user_id'] == line_user_id
            assert "已重新啟用" in call_args.kwargs['text']
    
    def test_re_enable_command_case_insensitive(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that re-enable command works with different cases (重啟ai, 重啟AI, etc.)."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Set opt-out first
        from services.line_opt_out_service import set_ai_opt_out
        set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        # Test with lowercase "ai"
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="重啟ai",  # lowercase
            destination=clinic.line_official_account_user_id
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, "重啟ai", "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            response = client.post(
                "/api/line/webhook",
                content=body,
                headers={"X-Line-Signature": signature}
            )
            
            assert response.status_code == 200
            
            # Verify opt-out was cleared
            opt_out = db_session.query(LineUserAiOptOut).filter(
                LineUserAiOptOut.line_user_id == line_user_id,
                LineUserAiOptOut.clinic_id == clinic.id
            ).first()
            assert opt_out is None


class TestLineWebhookOptOutMessageHandling:
    """Test message handling when user is opted out."""
    
    def test_messages_ignored_when_opted_out(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that messages from opted-out users are ignored."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Set opt-out
        from services.line_opt_out_service import set_ai_opt_out
        set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        # Send regular message
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是一個測試訊息",
            destination=clinic.line_official_account_user_id
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, "這是一個測試訊息", "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            # Mock agent service to verify it's NOT called
            with patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_agent:
                response = client.post(
                    "/api/line/webhook",
                    content=body,
                    headers={"X-Line-Signature": signature}
                )
                
                assert response.status_code == 200
                
                # Verify agent was NOT called
                mock_agent.assert_not_called()
                
                # Verify no response message was sent
                mock_service.send_text_message.assert_not_called()
                
                # Verify loading animation was NOT started
                mock_service.start_loading_animation.assert_not_called()
    
    def test_messages_processed_when_not_opted_out(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that messages from non-opted-out users are processed normally."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Send regular message (user is NOT opted out)
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是一個測試訊息",
            destination=clinic.line_official_account_user_id
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, "這是一個測試訊息", "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            # Mock agent service to return a response
            with patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_agent:
                mock_agent.return_value = "這是AI回覆"
                
                response = client.post(
                    "/api/line/webhook",
                    content=body,
                    headers={"X-Line-Signature": signature}
                )
                
                assert response.status_code == 200
                
                # Verify agent WAS called
                mock_agent.assert_called_once()
                
                # Verify response message was sent
                mock_service.send_text_message.assert_called_once()
                call_args = mock_service.send_text_message.call_args
                assert call_args.kwargs['text'] == "這是AI回覆"
                
                # Verify loading animation was started
                mock_service.start_loading_animation.assert_called_once()
    
    def test_opt_out_expires_automatically(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that expired opt-outs are automatically treated as enabled."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Set opt-out with expired timestamp
        opt_out = LineUserAiOptOut(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            opted_out_until=taiwan_now() - timedelta(hours=1)  # Already expired
        )
        db_session.add(opt_out)
        db_session.commit()
        
        # Send regular message (opt-out should be auto-expired)
        payload = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="這是一個測試訊息",
            destination=clinic.line_official_account_user_id
        )
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, "這是一個測試訊息", "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            # Mock agent service
            with patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_agent:
                mock_agent.return_value = "這是AI回覆"
                
                response = client.post(
                    "/api/line/webhook",
                    content=body,
                    headers={"X-Line-Signature": signature}
                )
                
                assert response.status_code == 200
                
                # Verify agent WAS called (opt-out expired)
                mock_agent.assert_called_once()
                
                # Verify expired opt-out record was deleted
                opt_out = db_session.query(LineUserAiOptOut).filter(
                    LineUserAiOptOut.line_user_id == line_user_id,
                    LineUserAiOptOut.clinic_id == clinic.id
                ).first()
                assert opt_out is None
    
    def test_opt_out_per_clinic_isolation(self, client, db_session, test_clinic_with_chat_enabled):
        """Test that opt-out status is isolated per clinic."""
        clinic1 = test_clinic_with_chat_enabled
        clinic2 = Clinic(
            name="Test Clinic 2",
            line_channel_id="test_channel_2",
            line_channel_secret="test_secret_2",
            line_channel_access_token="test_token_2",
            line_official_account_user_id="U_official_account_456",
            settings={
                "chat_settings": {
                    "chat_enabled": True
                }
            }
        )
        db_session.add(clinic2)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Opt out from clinic1 only
        from services.line_opt_out_service import set_ai_opt_out
        set_ai_opt_out(db_session, line_user_id, clinic1.id)
        
        # Send message to clinic1 (should be ignored)
        payload1 = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="測試訊息",
            destination=clinic1.line_official_account_user_id
        )
        body1 = json.dumps(payload1)
        signature1 = create_line_signature(body1, clinic1.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, "測試訊息", "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            with patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_agent:
                response1 = client.post(
                    "/api/line/webhook",
                    content=body1,
                    headers={"X-Line-Signature": signature1}
                )
                
                assert response1.status_code == 200
                mock_agent.assert_not_called()  # Should be ignored
        
        # Send message to clinic2 (should be processed)
        payload2 = create_line_webhook_payload(
            line_user_id=line_user_id,
            message_text="測試訊息",
            destination=clinic2.line_official_account_user_id
        )
        body2 = json.dumps(payload2)
        signature2 = create_line_signature(body2, clinic2.line_channel_secret)
        
        with patch('api.line_webhook.LINEService') as mock_line_service_class:
            mock_service = MagicMock()
            mock_service.verify_signature.return_value = True
            mock_service.extract_message_data.return_value = (line_user_id, "測試訊息", "test_reply_token", "msg_123", None)
            mock_service.send_text_message = MagicMock()
            mock_service.start_loading_animation = MagicMock()
            mock_line_service_class.return_value = mock_service
            
            with patch('api.line_webhook.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_agent:
                mock_agent.return_value = "這是AI回覆"
                
                response2 = client.post(
                    "/api/line/webhook",
                    content=body2,
                    headers={"X-Line-Signature": signature2}
                )
                
                assert response2.status_code == 200
                mock_agent.assert_called_once()  # Should be processed

