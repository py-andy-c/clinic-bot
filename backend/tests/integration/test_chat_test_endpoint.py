"""
Integration tests for chatbot test endpoint.

Tests the POST /api/clinic/chat/test endpoint which allows clinic users
to test chatbot responses with unsaved settings.
"""

import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from auth.dependencies import get_current_user, UserContext
from models import Clinic
from models.clinic import ChatSettings
from tests.conftest import create_user_with_clinic_association


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
def test_clinic_and_user(db_session):
    """Create a test clinic with a user."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        settings={}
    )
    db_session.add(clinic)
    db_session.commit()
    
    user, user_assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="Test User",
        email="test@example.com",
        google_subject_id="test_sub",
        roles=["admin"],
        is_active=True
    )
    db_session.commit()
    
    return clinic, user


class TestChatTestEndpoint:
    """Test chatbot test endpoint functionality."""
    
    def test_chat_test_endpoint_success(self, client, db_session, test_clinic_and_user):
        """Test successful chatbot test request."""
        clinic, user = test_clinic_and_user
        
        # Mock authentication
        mock_user = UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=["admin"],
            active_clinic_id=clinic.id,
            google_subject_id=user.google_subject_id,
            name="Test User",
            user_id=user.id
        )
        
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            # Mock the ClinicAgentService.process_message to avoid actual OpenAI calls
            with patch('api.clinic.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_process:
                mock_process.return_value = "這是一個測試回應"
                
                # Create test chat settings
                chat_settings = ChatSettings(
                    chat_enabled=True,
                    clinic_description="測試診所描述",
                    ai_guidance="測試 AI 指引"
                )
                
                # Frontend provides UUID, backend prepends clinic info
                test_uuid = "abc-123-def-456"
                request_data = {
                    "message": "你好",
                    "session_id": test_uuid,
                    "chat_settings": chat_settings.model_dump()
                }
                
                response = client.post("/api/clinic/chat/test", json=request_data)
                
                assert response.status_code == 200
                data = response.json()
                assert "response" in data
                assert "session_id" in data
                assert data["response"] == "這是一個測試回應"
                # Backend returns full format: test-{clinic_id}-{uuid}
                expected_session_id = f"test-{clinic.id}-{test_uuid}"
                assert data["session_id"] == expected_session_id
                
                # Verify the service was called with correct parameters
                mock_process.assert_called_once()
                call_args = mock_process.call_args
                assert call_args.kwargs["message"] == "你好"
                assert call_args.kwargs["clinic"].id == clinic.id
                assert call_args.kwargs["chat_settings_override"].chat_enabled is True
                assert call_args.kwargs["chat_settings_override"].clinic_description == "測試診所描述"
                # Backend prepends clinic info to UUID
                assert call_args.kwargs["session_id"] == expected_session_id
        finally:
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)
    
    def test_chat_test_with_session_id(self, client, db_session, test_clinic_and_user):
        """Test chatbot test with provided UUID for conversation continuity."""
        clinic, user = test_clinic_and_user
        
        mock_user = UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=["admin"],
            active_clinic_id=clinic.id,
            google_subject_id=user.google_subject_id,
            name="Test User",
            user_id=user.id
        )
        
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            with patch('api.clinic.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_process:
                mock_process.return_value = "這是第二個回應"
                
                chat_settings = ChatSettings(chat_enabled=True)
                
                # Frontend provides UUID, backend prepends clinic info
                test_uuid = "custom-session-123"
                request_data = {
                    "message": "繼續對話",
                    "session_id": test_uuid,
                    "chat_settings": chat_settings.model_dump()
                }
                
                response = client.post("/api/clinic/chat/test", json=request_data)
                
                assert response.status_code == 200
                data = response.json()
                # Backend returns full format: test-{clinic_id}-{uuid}
                expected_session_id = f"test-{clinic.id}-{test_uuid}"
                assert data["session_id"] == expected_session_id
                
                # Verify session_id was passed to service with prepended format
                call_args = mock_process.call_args
                assert call_args.kwargs["session_id"] == expected_session_id
                assert call_args.kwargs["chat_settings_override"] is not None
        finally:
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)
    
    def test_chat_test_chat_disabled(self, client, db_session, test_clinic_and_user):
        """Test that chat test fails when chat is disabled in settings."""
        clinic, user = test_clinic_and_user
        
        mock_user = UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=["admin"],
            active_clinic_id=clinic.id,
            google_subject_id=user.google_subject_id,
            name="Test User",
            user_id=user.id
        )
        
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            chat_settings = ChatSettings(chat_enabled=False)
            
            test_uuid = "test-uuid-123"
            request_data = {
                "message": "你好",
                "session_id": test_uuid,
                "chat_settings": chat_settings.model_dump()
            }
            
            response = client.post("/api/clinic/chat/test", json=request_data)
            
            assert response.status_code == 400
            data = response.json()
            assert "請先啟用 AI 聊天功能" in data["detail"]
        finally:
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)
    
    def test_chat_test_uses_provided_settings(self, client, db_session, test_clinic_and_user):
        """Test that the endpoint uses provided chat_settings instead of saved settings."""
        clinic, user = test_clinic_and_user
        
        # Set saved settings in clinic (different from test settings)
        clinic.settings = {
            "chat_settings": {
                "chat_enabled": True,
                "clinic_description": "已儲存的描述",
                "ai_guidance": "已儲存的指引"
            }
        }
        db_session.commit()
        
        mock_user = UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=["admin"],
            active_clinic_id=clinic.id,
            google_subject_id=user.google_subject_id,
            name="Test User",
            user_id=user.id
        )
        
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            with patch('api.clinic.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_process:
                mock_process.return_value = "測試回應"
                
                # Provide different settings (unsaved)
                test_chat_settings = ChatSettings(
                    chat_enabled=True,
                    clinic_description="未儲存的測試描述",
                    ai_guidance="未儲存的測試指引"
                )
                
                test_uuid = "test-uuid-456"
                request_data = {
                    "message": "測試",
                    "session_id": test_uuid,
                    "chat_settings": test_chat_settings.model_dump()
                }
                
                response = client.post("/api/clinic/chat/test", json=request_data)
                
                assert response.status_code == 200
                
                # Verify the service was called with the provided settings, not saved ones
                call_args = mock_process.call_args
                provided_settings = call_args.kwargs["chat_settings_override"]
                assert provided_settings.clinic_description == "未儲存的測試描述"
                assert provided_settings.ai_guidance == "未儲存的測試指引"
                # Should NOT be the saved settings
                assert provided_settings.clinic_description != "已儲存的描述"
        finally:
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)
    
    def test_chat_test_error_handling(self, client, db_session, test_clinic_and_user):
        """Test error handling when service fails."""
        clinic, user = test_clinic_and_user
        
        mock_user = UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=["admin"],
            active_clinic_id=clinic.id,
            google_subject_id=user.google_subject_id,
            name="Test User",
            user_id=user.id
        )
        
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            with patch('api.clinic.ClinicAgentService.process_message', new_callable=AsyncMock) as mock_process:
                # Mock service to raise an exception
                mock_process.side_effect = Exception("Service error")
                
                chat_settings = ChatSettings(chat_enabled=True)
                
                test_uuid = "test-uuid-789"
                request_data = {
                    "message": "測試",
                    "session_id": test_uuid,
                    "chat_settings": chat_settings.model_dump()
                }
                
                response = client.post("/api/clinic/chat/test", json=request_data)
                
                # Should return 500 with error message
                assert response.status_code == 500
                data = response.json()
                assert "無法處理測試訊息" in data["detail"]
        finally:
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)
    
    def test_chat_test_requires_authentication(self, client, db_session, test_clinic_and_user):
        """Test that endpoint requires authentication."""
        # Don't set up authentication override
        chat_settings = ChatSettings(chat_enabled=True)
        
        test_uuid = "test-uuid-auth"
        request_data = {
            "message": "測試",
            "session_id": test_uuid,
            "chat_settings": chat_settings.model_dump()
        }
        
        response = client.post("/api/clinic/chat/test", json=request_data)
        
        # Should return 401 or 403 (depending on auth setup)
        assert response.status_code in [401, 403]
    
    def test_chat_test_missing_session_id(self, client, db_session, test_clinic_and_user):
        """Test that endpoint requires session_id."""
        clinic, user = test_clinic_and_user
        
        mock_user = UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=["admin"],
            active_clinic_id=clinic.id,
            google_subject_id=user.google_subject_id,
            name="Test User",
            user_id=user.id
        )
        
        original_override = client.app.dependency_overrides.get(get_current_user)
        client.app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            chat_settings = ChatSettings(chat_enabled=True)
            
            # Request without session_id
            request_data = {
                "message": "測試",
                "chat_settings": chat_settings.model_dump()
            }
            
            response = client.post("/api/clinic/chat/test", json=request_data)
            
            assert response.status_code == 400
            data = response.json()
            assert "session_id 是必需的" in data["detail"]
        finally:
            if original_override is not None:
                client.app.dependency_overrides[get_current_user] = original_override
            else:
                client.app.dependency_overrides.pop(get_current_user, None)

