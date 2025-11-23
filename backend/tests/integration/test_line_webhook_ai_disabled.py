"""
Integration tests for LINE webhook AI disabled functionality.

Tests that the webhook correctly respects permanent AI disable settings
and that the priority order is correct (commands > temporary opt-out > permanent disable > global setting).
"""

import pytest
import json
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic
from models.clinic import ChatSettings
from services.clinic_agent import ClinicAgentService
from services.line_opt_out_service import set_ai_opt_out
from services.line_user_ai_disabled_service import disable_ai_for_line_user
from utils.datetime_utils import taiwan_now
from core.constants import OPT_OUT_COMMAND, RE_ENABLE_COMMAND


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


class TestLineWebhookAiDisabled:
    """Test permanent AI disable handling in LINE webhook."""
    
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.clinic_agent.ClinicAgentService.process_message', new_callable=AsyncMock)
    def test_webhook_ignores_message_when_ai_disabled(
        self,
        mock_process_message,
        mock_send_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that webhook ignores messages when AI is permanently disabled."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Create LineUser first (required for per-clinic isolation)
        from models import LineUser
        line_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()
        
        # Disable AI permanently
        disable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        # Create webhook payload
        payload = create_line_webhook_payload(line_user_id, "Hello")
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={
                "X-Line-Signature": signature,
                "Content-Type": "application/json"
            }
        )
        
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "message": "AI disabled for this user"}
        
        # Verify AI agent was NOT called
        mock_process_message.assert_not_called()
    
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.clinic_agent.ClinicAgentService.process_message', new_callable=AsyncMock)
    def test_webhook_processes_message_when_ai_enabled(
        self,
        mock_process_message,
        mock_send_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that webhook processes messages when AI is enabled."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # AI is enabled by default (no disable record)
        
        # Create webhook payload
        payload = create_line_webhook_payload(line_user_id, "Hello")
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Mock AI agent response
        mock_process_message.return_value = {"status": "ok"}
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={
                "X-Line-Signature": signature,
                "Content-Type": "application/json"
            }
        )
        
        assert response.status_code == 200
        
        # Verify AI agent WAS called
        mock_process_message.assert_called_once()
    
    @patch('services.line_service.LINEService.send_text_message')
    def test_commands_still_work_when_disabled(
        self,
        mock_send_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that special commands still work even when AI is disabled."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Create LineUser first
        from models import LineUser
        line_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()
        
        # Disable AI permanently
        disable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        # Create webhook payload with opt-out command
        payload = create_line_webhook_payload(line_user_id, OPT_OUT_COMMAND)
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={
                "X-Line-Signature": signature,
                "Content-Type": "application/json"
            }
        )
        
        assert response.status_code == 200
        
        # Verify command was processed (should send confirmation message)
        mock_send_message.assert_called_once()
    
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.clinic_agent.ClinicAgentService.process_message', new_callable=AsyncMock)
    def test_priority_temporary_opt_out_over_permanent_disable(
        self,
        mock_process_message,
        mock_send_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that temporary opt-out takes precedence over permanent disable."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Create LineUser first
        from models import LineUser
        line_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()
        
        # Disable AI permanently
        disable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        # Also set temporary opt-out
        set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        # Create webhook payload
        payload = create_line_webhook_payload(line_user_id, "Hello")
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={
                "X-Line-Signature": signature,
                "Content-Type": "application/json"
            }
        )
        
        assert response.status_code == 200
        # Should return temporary opt-out message (takes precedence)
        assert "opted out" in response.json()["message"].lower() or response.json()["message"] == "User opted out, message ignored"
        
        # Verify AI agent was NOT called
        mock_process_message.assert_not_called()
    
    @patch('services.line_service.LINEService.send_text_message')
    @patch('services.clinic_agent.ClinicAgentService.process_message', new_callable=AsyncMock)
    def test_permanent_disable_persists_after_temp_opt_out_expires(
        self,
        mock_process_message,
        mock_send_message,
        client,
        db_session,
        test_clinic_with_chat_enabled
    ):
        """Test that permanent disable still blocks after temporary opt-out expires."""
        clinic = test_clinic_with_chat_enabled
        line_user_id = "U_test_user_123"
        
        # Create LineUser first
        from models import LineUser
        line_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()
        
        # Disable AI permanently
        disable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        # Set temporary opt-out that's already expired (directly set ai_opt_out_until to past time)
        from utils.datetime_utils import taiwan_now
        line_user.ai_opt_out_until = taiwan_now() - timedelta(hours=1)  # Already expired
        db_session.commit()
        
        # Create webhook payload
        payload = create_line_webhook_payload(line_user_id, "Hello")
        body = json.dumps(payload)
        signature = create_line_signature(body, clinic.line_channel_secret)
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={
                "X-Line-Signature": signature,
                "Content-Type": "application/json"
            }
        )
        
        assert response.status_code == 200
        # Should return permanent disable message (temp opt-out expired)
        assert response.json()["message"] == "AI disabled for this user"
        
        # Verify AI agent was NOT called
        mock_process_message.assert_not_called()

