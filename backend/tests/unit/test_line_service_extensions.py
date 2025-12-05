"""
Unit tests for LINE service extensions.

Tests the new methods added to LINEService for event extraction and profile fetching.
"""

import pytest
from unittest.mock import Mock, patch
import httpx

from services.line_service import LINEService


class TestExtractEventData:
    """Test extracting event data from webhook payloads."""
    
    def test_extracts_follow_event(self):
        """Test that follow event is extracted correctly."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        payload = {
            "destination": "U1234567890",
            "events": [
                {
                    "type": "follow",
                    "timestamp": 1234567890123,
                    "source": {
                        "type": "user",
                        "userId": "U_test_user_123"
                    },
                    "replyToken": "reply_token_123"
                }
            ]
        }
        
        result = service.extract_event_data(payload)
        
        assert result is not None
        event_type, line_user_id, reply_token = result
        assert event_type == "follow"
        assert line_user_id == "U_test_user_123"
        assert reply_token == "reply_token_123"
    
    def test_extracts_unfollow_event(self):
        """Test that unfollow event is extracted correctly."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        payload = {
            "destination": "U1234567890",
            "events": [
                {
                    "type": "unfollow",
                    "timestamp": 1234567890123,
                    "source": {
                        "type": "user",
                        "userId": "U_test_user_123"
                    }
                }
            ]
        }
        
        result = service.extract_event_data(payload)
        
        assert result is not None
        event_type, line_user_id, reply_token = result
        assert event_type == "unfollow"
        assert line_user_id == "U_test_user_123"
        assert reply_token is None  # Unfollow events don't have reply tokens
    
    def test_extracts_message_event(self):
        """Test that message event is extracted correctly."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        payload = {
            "destination": "U1234567890",
            "events": [
                {
                    "type": "message",
                    "timestamp": 1234567890123,
                    "source": {
                        "type": "user",
                        "userId": "U_test_user_123"
                    },
                    "replyToken": "reply_token_123",
                    "message": {
                        "type": "text",
                        "id": "message_id_123",
                        "text": "Hello"
                    }
                }
            ]
        }
        
        result = service.extract_event_data(payload)
        
        assert result is not None
        event_type, line_user_id, reply_token = result
        assert event_type == "message"
        assert line_user_id == "U_test_user_123"
        assert reply_token == "reply_token_123"
    
    def test_returns_none_for_invalid_payload(self):
        """Test that None is returned for invalid payload structure."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        # Missing events
        payload1 = {"destination": "U1234567890"}
        assert service.extract_event_data(payload1) is None
        
        # Empty events
        payload2 = {"destination": "U1234567890", "events": []}
        assert service.extract_event_data(payload2) is None
        
        # Missing source
        payload3 = {
            "destination": "U1234567890",
            "events": [{"type": "follow"}]
        }
        assert service.extract_event_data(payload3) is None
    
    def test_handles_missing_reply_token(self):
        """Test that missing reply token is handled correctly."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        payload = {
            "destination": "U1234567890",
            "events": [
                {
                    "type": "follow",
                    "timestamp": 1234567890123,
                    "source": {
                        "type": "user",
                        "userId": "U_test_user_123"
                    }
                    # No replyToken
                }
            ]
        }
        
        result = service.extract_event_data(payload)
        
        assert result is not None
        event_type, line_user_id, reply_token = result
        assert event_type == "follow"
        assert line_user_id == "U_test_user_123"
        assert reply_token is None


class TestGetUserProfile:
    """Test fetching user profile from LINE API."""
    
    @patch('services.line_service.httpx.get')
    def test_fetches_profile_successfully(self, mock_get):
        """Test that user profile is fetched successfully."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        # Mock successful response
        mock_response = Mock()
        mock_response.json.return_value = {
            "displayName": "Test User",
            "userId": "U_test_user_123",
            "pictureUrl": "https://example.com/pic.jpg",
            "statusMessage": "Hello"
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        result = service.get_user_profile("U_test_user_123")
        
        assert result is not None
        assert result["displayName"] == "Test User"
        assert result["userId"] == "U_test_user_123"
        mock_get.assert_called_once()
        assert "Authorization" in mock_get.call_args[1]["headers"]
        assert "Bearer test_token" in mock_get.call_args[1]["headers"]["Authorization"]
    
    @patch('services.line_service.httpx.get')
    def test_returns_none_on_http_error(self, mock_get):
        """Test that None is returned on HTTP error."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        # Mock HTTP error
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.text = "Not Found"
        mock_get.return_value = mock_response
        mock_get.side_effect = httpx.HTTPStatusError(
            "Not Found",
            request=Mock(),
            response=mock_response
        )
        
        result = service.get_user_profile("U_test_user_123")
        
        assert result is None
    
    @patch('services.line_service.httpx.get')
    def test_returns_none_on_exception(self, mock_get):
        """Test that None is returned on exception."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        # Mock exception
        mock_get.side_effect = Exception("Network error")
        
        result = service.get_user_profile("U_test_user_123")
        
        assert result is None
    
    @patch('services.line_service.httpx.get')
    def test_calls_correct_endpoint(self, mock_get):
        """Test that correct LINE API endpoint is called."""
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        
        line_user_id = "U_test_user_123"
        
        mock_response = Mock()
        mock_response.json.return_value = {"displayName": "Test"}
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        service.get_user_profile(line_user_id)
        
        # Verify correct endpoint
        call_args = mock_get.call_args
        assert call_args[0][0] == f"https://api.line.me/v2/bot/profile/{line_user_id}"


class TestSendTextMessageTracking:
    """Test push message tracking in send_text_message."""
    
    @patch('services.line_service.MessagingApi')
    def test_tracks_push_message_when_labels_provided(self, mock_api_class, db_session, sample_clinic_data):
        """Test that push messages are tracked when labels are provided."""
        from models import Clinic, LinePushMessage
        
        # Create clinic
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        # Mock LINE API response
        mock_api = Mock()
        mock_sent_message = Mock()
        mock_sent_message.id = "msg_123456"
        mock_response = Mock()
        mock_response.sent_messages = [mock_sent_message]
        mock_api.push_message.return_value = mock_response
        mock_api_class.return_value = mock_api
        
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        service.api = mock_api
        
        labels = {
            'recipient_type': 'patient',
            'event_type': 'appointment_confirmation',
            'trigger_source': 'clinic_triggered',
            'appointment_context': 'new_appointment'
        }
        
        # Send push message (no reply_token)
        result = service.send_text_message(
            line_user_id="U1234567890",
            text="Test message",
            reply_token=None,
            db=db_session,
            clinic_id=clinic.id,
            labels=labels
        )
        
        # Verify message was sent
        assert result == "msg_123456"
        mock_api.push_message.assert_called_once()
        
        # Verify push message was tracked
        db_session.commit()
        push_message = db_session.query(LinePushMessage).filter_by(
            line_user_id="U1234567890",
            clinic_id=clinic.id
        ).first()
        
        assert push_message is not None
        assert push_message.recipient_type == 'patient'
        assert push_message.event_type == 'appointment_confirmation'
        assert push_message.trigger_source == 'clinic_triggered'
        assert push_message.labels == labels
        assert push_message.line_message_id == "msg_123456"
    
    @patch('services.line_service.MessagingApi')
    def test_does_not_track_reply_messages(self, mock_api_class, db_session, sample_clinic_data):
        """Test that reply messages (with reply_token) are not tracked."""
        from models import Clinic, LinePushMessage
        
        # Create clinic
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        # Mock LINE API response
        mock_api = Mock()
        mock_sent_message = Mock()
        mock_sent_message.id = "msg_123456"
        mock_response = Mock()
        mock_response.sent_messages = [mock_sent_message]
        mock_api.reply_message.return_value = mock_response
        mock_api_class.return_value = mock_api
        
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        service.api = mock_api
        
        labels = {
            'recipient_type': 'patient',
            'event_type': 'appointment_confirmation',
            'trigger_source': 'clinic_triggered'
        }
        
        # Send reply message (with reply_token)
        result = service.send_text_message(
            line_user_id="U1234567890",
            text="Test message",
            reply_token="reply_token_123",
            db=db_session,
            clinic_id=clinic.id,
            labels=labels
        )
        
        # Verify message was sent
        assert result == "msg_123456"
        mock_api.reply_message.assert_called_once()
        
        # Verify push message was NOT tracked (reply messages are free)
        db_session.commit()
        push_message = db_session.query(LinePushMessage).filter_by(
            line_user_id="U1234567890",
            clinic_id=clinic.id
        ).first()
        
        assert push_message is None
    
    @patch('services.line_service.MessagingApi')
    def test_does_not_track_when_labels_not_provided(self, mock_api_class, db_session, sample_clinic_data):
        """Test that push messages are not tracked when labels are not provided."""
        from models import Clinic, LinePushMessage
        
        # Create clinic
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        # Mock LINE API response
        mock_api = Mock()
        mock_sent_message = Mock()
        mock_sent_message.id = "msg_123456"
        mock_response = Mock()
        mock_response.sent_messages = [mock_sent_message]
        mock_api.push_message.return_value = mock_response
        mock_api_class.return_value = mock_api
        
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        service.api = mock_api
        
        # Send push message without labels
        result = service.send_text_message(
            line_user_id="U1234567890",
            text="Test message",
            reply_token=None,
            db=db_session,
            clinic_id=clinic.id,
            labels=None
        )
        
        # Verify message was sent
        assert result == "msg_123456"
        
        # Verify push message was NOT tracked
        db_session.commit()
        push_message = db_session.query(LinePushMessage).filter_by(
            line_user_id="U1234567890",
            clinic_id=clinic.id
        ).first()
        
        assert push_message is None
    
    @patch('services.line_service.MessagingApi')
    def test_does_not_track_when_line_api_fails(self, mock_api_class, db_session, sample_clinic_data):
        """Test that push messages are not tracked when LINE API call fails."""
        from models import Clinic, LinePushMessage
        
        # Create clinic
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        # Mock LINE API failure
        mock_api = Mock()
        mock_api.push_message.side_effect = Exception("LINE API error")
        mock_api_class.return_value = mock_api
        
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        service.api = mock_api
        
        labels = {
            'recipient_type': 'patient',
            'event_type': 'appointment_confirmation',
            'trigger_source': 'clinic_triggered'
        }
        
        # Send push message - should raise exception
        with pytest.raises(Exception, match="LINE API error"):
            service.send_text_message(
                line_user_id="U1234567890",
                text="Test message",
                reply_token=None,
                db=db_session,
                clinic_id=clinic.id,
                labels=labels
            )
        
        # Verify push message was NOT tracked (API failed)
        db_session.commit()
        push_message = db_session.query(LinePushMessage).filter_by(
            line_user_id="U1234567890",
            clinic_id=clinic.id
        ).first()
        
        assert push_message is None
    
    @patch('services.line_service.MessagingApi')
    def test_handles_tracking_failure_gracefully(self, mock_api_class, db_session, sample_clinic_data):
        """Test that tracking failure doesn't prevent message from being sent."""
        from models import Clinic
        from unittest.mock import patch
        
        # Create clinic
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)
        
        # Mock LINE API response
        mock_api = Mock()
        mock_sent_message = Mock()
        mock_sent_message.id = "msg_123456"
        mock_response = Mock()
        mock_response.sent_messages = [mock_sent_message]
        mock_api.push_message.return_value = mock_response
        mock_api_class.return_value = mock_api
        
        service = LINEService(
            channel_secret="test_secret",
            channel_access_token="test_token"
        )
        service.api = mock_api
        
        labels = {
            'recipient_type': 'patient',
            'event_type': 'appointment_confirmation',
            'trigger_source': 'clinic_triggered'
        }
        
        # Mock database commit failure
        with patch.object(db_session, 'commit', side_effect=Exception("DB error")):
            # Message should still be sent successfully
            result = service.send_text_message(
                line_user_id="U1234567890",
                text="Test message",
                reply_token=None,
                db=db_session,
                clinic_id=clinic.id,
                labels=labels
            )
            
            # Verify message was sent despite tracking failure
            assert result == "msg_123456"
            mock_api.push_message.assert_called_once()

