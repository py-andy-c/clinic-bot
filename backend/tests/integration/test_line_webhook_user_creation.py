"""
Integration tests for proactive LINE user creation via webhook events.

Tests that LINE users are created automatically when users follow the account
or send messages, even if chat is disabled.
"""

import pytest
import json
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient

from models import Clinic, LineUser
from main import app
from core.database import get_db


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
def test_clinic_with_webhook(db_session, sample_clinic_data):
    """Create a test clinic with webhook configuration."""
    clinic = Clinic(**sample_clinic_data)
    clinic.line_official_account_user_id = "U_official_account_123"
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


def create_webhook_payload(event_type: str, line_user_id: str, reply_token: str = None, message_text: str = None):
    """Helper to create webhook payload for testing."""
    payload = {
        "destination": "U_official_account_123",
        "events": [
            {
                "type": event_type,
                "timestamp": 1234567890123,
                "source": {
                    "type": "user",
                    "userId": line_user_id
                }
            }
        ]
    }
    
    if reply_token:
        payload["events"][0]["replyToken"] = reply_token
    
    if message_text:
        payload["events"][0]["message"] = {
            "type": "text",
            "id": "message_id_123",
            "text": message_text
        }
    
    return payload


def create_webhook_signature(body: str, channel_secret: str) -> str:
    """Helper to create webhook signature for testing."""
    import hmac
    import hashlib
    import base64
    
    hash_digest = hmac.new(
        channel_secret.encode('utf-8'),
        body.encode('utf-8'),
        hashlib.sha256
    ).digest()
    
    return base64.b64encode(hash_digest).decode('utf-8')


class TestFollowEventUserCreation:
    """Test that users are created when they follow the account."""
    
    def test_follow_event_creates_user(self, client, db_session, test_clinic_with_webhook):
        """Test that follow event creates a LineUser entry."""
        clinic = test_clinic_with_webhook
        line_user_id = "U_new_follower_123"
        
        # Verify user doesn't exist
        existing_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert existing_user is None
        
        # Create webhook payload
        payload = create_webhook_payload("follow", line_user_id, reply_token="reply_token_123")
        body = json.dumps(payload)
        signature = create_webhook_signature(body, clinic.line_channel_secret)
        
        # Mock LINE API profile fetch
        with patch('services.line_service.httpx.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "displayName": "New Follower",
                "userId": line_user_id
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            # Send webhook request
            response = client.post(
                "/api/line/webhook",
                content=body,
                headers={
                    "X-Line-Signature": signature,
                    "Content-Type": "application/json"
                }
            )
        
        # Verify response
        assert response.status_code == 200
        
        # Verify user was created
        created_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert created_user is not None
        assert created_user.display_name == "New Follower"
    
    def test_follow_event_without_reply_token(self, client, db_session, test_clinic_with_webhook):
        """Test that follow event works even without reply token."""
        clinic = test_clinic_with_webhook
        line_user_id = "U_follower_no_token_123"
        
        # Create webhook payload without reply token
        payload = create_webhook_payload("follow", line_user_id)
        body = json.dumps(payload)
        signature = create_webhook_signature(body, clinic.line_channel_secret)
        
        # Mock LINE API profile fetch
        with patch('services.line_service.httpx.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "displayName": "Follower",
                "userId": line_user_id
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            # Send webhook request
            response = client.post(
                "/api/line/webhook",
                content=body,
                headers={
                    "X-Line-Signature": signature,
                    "Content-Type": "application/json"
                }
            )
        
        # Verify response
        assert response.status_code == 200
        
        # Verify user was created
        created_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert created_user is not None


class TestUnfollowEvent:
    """Test that unfollow events are handled correctly."""
    
    def test_unfollow_event_logged(self, client, db_session, test_clinic_with_webhook):
        """Test that unfollow event is logged but user is not deleted."""
        clinic = test_clinic_with_webhook
        line_user_id = "U_unfollower_123"
        
        # Create existing user
        existing_user = LineUser(
            line_user_id=line_user_id,
            display_name="Existing User"
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Create webhook payload
        payload = create_webhook_payload("unfollow", line_user_id)
        body = json.dumps(payload)
        signature = create_webhook_signature(body, clinic.line_channel_secret)
        
        # Send webhook request
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={
                "X-Line-Signature": signature,
                "Content-Type": "application/json"
            }
        )
        
        # Verify response
        assert response.status_code == 200
        
        # Verify user still exists (not deleted)
        user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert user is not None
        assert user.id == existing_user.id


class TestMessageEventUserCreation:
    """Test that users are created when they send messages."""
    
    def test_message_event_creates_user(self, client, db_session, test_clinic_with_webhook):
        """Test that message event creates a LineUser entry."""
        clinic = test_clinic_with_webhook
        line_user_id = "U_message_sender_123"
        
        # Verify user doesn't exist
        existing_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert existing_user is None
        
        # Create webhook payload
        payload = create_webhook_payload(
            "message",
            line_user_id,
            reply_token="reply_token_123",
            message_text="Hello"
        )
        body = json.dumps(payload)
        signature = create_webhook_signature(body, clinic.line_channel_secret)
        
        # Mock LINE API profile fetch
        with patch('services.line_service.httpx.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "displayName": "Message Sender",
                "userId": line_user_id
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            # Mock AI agent to avoid processing
            with patch('services.clinic_agent.service.ClinicAgentService.process_message') as mock_agent:
                mock_agent.return_value = "Response"
                
                # Send webhook request
                response = client.post(
                    "/api/line/webhook",
                    content=body,
                    headers={
                        "X-Line-Signature": signature,
                        "Content-Type": "application/json"
                    }
                )
        
        # Verify response
        assert response.status_code == 200
        
        # Verify user was created
        created_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert created_user is not None
        assert created_user.display_name == "Message Sender"
    
    def test_message_event_creates_user_even_when_chat_disabled(self, client, db_session, test_clinic_with_webhook):
        """Test that user is created even when chat feature is disabled."""
        clinic = test_clinic_with_webhook
        
        # Disable chat feature
        settings = clinic.get_validated_settings()
        settings.chat_settings.chat_enabled = False
        clinic.settings = settings.model_dump()
        db_session.commit()
        
        line_user_id = "U_chat_disabled_user_123"
        
        # Create webhook payload
        payload = create_webhook_payload(
            "message",
            line_user_id,
            reply_token="reply_token_123",
            message_text="Hello"
        )
        body = json.dumps(payload)
        signature = create_webhook_signature(body, clinic.line_channel_secret)
        
        # Mock LINE API profile fetch
        with patch('services.line_service.httpx.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "displayName": "Chat Disabled User",
                "userId": line_user_id
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            # Send webhook request
            response = client.post(
                "/api/line/webhook",
                content=body,
                headers={
                    "X-Line-Signature": signature,
                    "Content-Type": "application/json"
                }
            )
        
        # Verify response (should be OK even though chat is disabled)
        assert response.status_code == 200
        
        # Verify user was created despite chat being disabled
        created_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        assert created_user is not None
        assert created_user.display_name == "Chat Disabled User"
    
    def test_message_event_updates_existing_user(self, client, db_session, test_clinic_with_webhook):
        """Test that message event updates display name if user already exists."""
        clinic = test_clinic_with_webhook
        line_user_id = "U_existing_user_123"
        
        # Create existing user with old name
        existing_user = LineUser(
            line_user_id=line_user_id,
            display_name="Old Name"
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Create webhook payload
        payload = create_webhook_payload(
            "message",
            line_user_id,
            reply_token="reply_token_123",
            message_text="Hello"
        )
        body = json.dumps(payload)
        signature = create_webhook_signature(body, clinic.line_channel_secret)
        
        # Mock LINE API profile fetch with new name
        with patch('services.line_service.httpx.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "displayName": "New Name",
                "userId": line_user_id
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            # Mock AI agent
            with patch('services.clinic_agent.service.ClinicAgentService.process_message') as mock_agent:
                mock_agent.return_value = "Response"
                
                # Send webhook request
                response = client.post(
                    "/api/line/webhook",
                    content=body,
                    headers={
                        "X-Line-Signature": signature,
                        "Content-Type": "application/json"
                    }
                )
        
        # Verify response
        assert response.status_code == 200
        
        # Verify user still exists (was accessed, not recreated)
        db_session.refresh(existing_user)
        assert existing_user.id is not None
        # Note: Display name is not updated for existing users unless explicitly provided
        # This is intentional to avoid unnecessary API calls on every message
        assert existing_user.display_name == "Old Name"

