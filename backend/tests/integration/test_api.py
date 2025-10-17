"""
Integration tests for API endpoints.
"""

import pytest
import os
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient
from sqlalchemy.orm import Session

from src.models.clinic import Clinic
from src.models.therapist import Therapist
from src.models.patient import Patient
from src.models.line_user import LineUser
from src.core.database import get_db


class TestAPIIntegration:
    """Integration tests for API endpoints."""

    def get_db_override(self, db_session):
        """Override database dependency for tests."""
        from typing import Generator
        def override_get_db() -> Generator[Session, None, None]:
            try:
                yield db_session
            finally:
                # Don't close the session as it's managed by the test fixture
                pass
        return override_get_db

    @pytest.mark.asyncio
    async def test_root_endpoint(self):
        """Test the root API endpoint."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/")

            assert response.status_code == 200
            data = response.json()
            assert "message" in data
            assert "version" in data
            assert "status" in data
            assert data["status"] == "running"

    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Test the health check endpoint."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/health")

            assert response.status_code == 200
            data = response.json()
            assert data == {"status": "healthy"}

    @pytest.mark.asyncio
    async def test_line_webhook_invalid_json(self):
        """Test LINE webhook with invalid JSON."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.post(
                "/webhook/line",
                content="invalid json",
                headers={"Content-Type": "application/json"}
            )

            assert response.status_code == 400
            assert "Invalid JSON payload" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_line_webhook_valid_payload(self):
        """Test LINE webhook with valid payload."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            payload = {
                "events": [
                    {
                        "type": "message",
                        "message": {
                            "type": "text",
                            "text": "Hello"
                        }
                    }
                ]
            }

            response = await client.post(
                "/webhook/line",
                json=payload,
                headers={"Content-Type": "application/json"}
            )

            assert response.status_code == 200
            assert response.text == 'OK'

    @pytest.mark.asyncio
    async def test_google_calendar_webhook(self):
        """Test Google Calendar webhook endpoint."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            headers = {
                "X-Goog-Resource-State": "exists",
                "X-Goog-Resource-ID": "test_resource_id",
                "X-Goog-Channel-ID": "test_channel_id",
                "X-Goog-Message-Number": "1"
            }

            response = await client.post("/webhook/gcal", headers=headers)

            assert response.status_code == 200
            assert response.text == 'OK'

    @pytest.mark.skip(reason="Database integration test - requires test database setup")
    @pytest.mark.asyncio
    async def test_oauth_initiate_therapist_not_found(self, db_session, tables):
        """Test OAuth initiation with non-existent therapist."""
        from src.main import app

        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/api/admin/therapists/999/gcal/auth?clinic_id=1")

            assert response.status_code == 404
            assert "Therapist not found" in response.json()["detail"]

    @pytest.mark.skip(reason="Database integration test - requires test database setup")
    @pytest.mark.asyncio
    async def test_oauth_initiate_success(self, db_session, tables, sample_clinic_data, sample_therapist_data, mock_google_oauth):
        """Test successful OAuth initiation."""
        # Create test clinic and therapist
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()

        therapist_data = sample_therapist_data.copy()
        therapist_data["clinic_id"] = clinic.id
        therapist = Therapist(**therapist_data)
        db_session.add(therapist)
        db_session.commit()

        # Override database dependency
        from src.main import app
        app.dependency_overrides[get_db] = self.get_db_override(db_session)

        # Mock the OAuth service
        with patch('src.api.admin.google_oauth_service', mock_google_oauth):
            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.get(f"/api/admin/therapists/{therapist.id}/gcal/auth?clinic_id={clinic.id}")

                assert response.status_code == 200
                data = response.json()
                assert "authorization_url" in data
                assert data["authorization_url"] == "https://accounts.google.com/oauth/test"

        # Clean up override
        app.dependency_overrides = {}

    @pytest.mark.asyncio
    async def test_oauth_callback_missing_code(self):
        """Test OAuth callback without authorization code."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/api/admin/auth/google/callback?state=1:2")

            assert response.status_code == 422
            errors = response.json()["detail"]
            assert len(errors) == 1
            assert errors[0]["loc"] == ["query", "error"]
            assert errors[0]["msg"] == "Field required"

    @pytest.mark.asyncio
    async def test_oauth_callback_missing_state(self):
        """Test OAuth callback without state parameter."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/api/admin/auth/google/callback?code=test_code")

            assert response.status_code == 422
            errors = response.json()["detail"]
            assert len(errors) == 1
            assert errors[0]["loc"] == ["query", "error"]
            assert errors[0]["msg"] == "Field required"

    @pytest.mark.asyncio
    async def test_oauth_callback_with_error(self):
        """Test OAuth callback with error parameter."""
        from src.main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/api/admin/auth/google/callback?error=access_denied&state=1:2")

            assert response.status_code == 400
            assert "OAuth authorization failed: access_denied" in response.json()["detail"]

    @pytest.mark.skip(reason="Database integration test - requires test database setup")
    @pytest.mark.asyncio
    async def test_oauth_callback_success(self, db_session, tables, sample_clinic_data, sample_therapist_data, mock_google_oauth):
        """Test successful OAuth callback."""
        # Create test clinic and therapist
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()

        therapist_data = sample_therapist_data.copy()
        therapist_data["clinic_id"] = clinic.id
        therapist = Therapist(**therapist_data)
        db_session.add(therapist)
        db_session.commit()

        # Mock the OAuth service
        with patch('src.api.admin.google_oauth_service', mock_google_oauth):
            from src.main import app
            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.get(f"/api/admin/auth/google/callback?code=test_code&state={therapist.id}:{clinic.id}")

                assert response.status_code == 200
                data = response.json()
                assert "message" in data
                assert "therapist_id" in data
                assert "therapist_name" in data
                assert "Google Calendar access granted successfully" in data["message"]

    @pytest.mark.asyncio
    async def test_line_webhook_patient_linking_success(self, db_session, create_sample_clinic, create_sample_patients):
        """Test successful patient linking via LINE webhook."""
        from src.main import app

        # Override the database dependency to use our test session
        def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            # Sample LINE webhook payload with phone number
            payload = {
                "events": [{
                    "type": "message",
                    "source": {"userId": "test_line_user_123"},
                    "message": {
                        "type": "text",
                        "text": "0912345678"
                    }
                }]
            }

            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.post("/webhook/line", json=payload)
                assert response.status_code == 200
                assert response.text == "OK"

            # Verify patient was linked
            line_user = db_session.query(LineUser).filter(LineUser.line_user_id == "test_line_user_123").first()
            assert line_user is not None
            assert line_user.patient_id == create_sample_patients[0].id
        finally:
            # Clean up dependency override
            app.dependency_overrides.pop(get_db, None)

    @pytest.mark.asyncio
    async def test_line_webhook_patient_linking_failure(self, db_session, create_sample_clinic):
        """Test failed patient linking via LINE webhook."""
        from src.main import app

        # Override the database dependency to use our test session
        def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            # Sample LINE webhook payload with non-existent phone number
            payload = {
                "events": [{
                    "type": "message",
                    "source": {"userId": "test_line_user_456"},
                    "message": {
                        "type": "text",
                        "text": "0999999999"
                    }
                }]
            }

            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.post("/webhook/line", json=payload)
                assert response.status_code == 200
                assert response.text == "OK"

            # Verify no patient was linked
            line_user = db_session.query(LineUser).filter(LineUser.line_user_id == "test_line_user_456").first()
            assert line_user is None
        finally:
            # Clean up dependency override
            app.dependency_overrides.pop(get_db, None)

    @pytest.mark.asyncio
    @patch('src.services.llm_service.llm_service')
    async def test_line_webhook_llm_processing_unlinked_patient(self, mock_llm_service, db_session, create_sample_clinic):
        """Test LLM processing for unlinked patient."""
        from src.main import app

        # Override the database dependency to use our test session
        def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            # Mock LLM response
            mock_llm_service.process_message.return_value = {
                "response": "請提供您的手機號碼來連結帳號。",
                "tool_results": [],
                "success": True
            }

            # Sample LINE webhook payload
            payload = {
                "events": [{
                    "type": "message",
                    "source": {"userId": "test_line_user_unlinked"},
                    "message": {
                        "type": "text",
                        "text": "我想預約門診"
                    }
                }]
            }

            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.post("/webhook/line", json=payload)
                assert response.status_code == 200
                assert response.text == "OK"

            # Verify LLM was called with correct parameters
            mock_llm_service.process_message.assert_called_once()
            call_args = mock_llm_service.process_message.call_args
            assert call_args[1]["message"] == "我想預約門診"
            assert call_args[1]["clinic_id"] == create_sample_clinic.id
            assert call_args[1]["patient_id"] is None
        finally:
            # Clean up dependency override
            app.dependency_overrides.pop(get_db, None)

    @pytest.mark.asyncio
    @patch('src.services.llm_service.llm_service')
    async def test_line_webhook_llm_processing_linked_patient(self, mock_llm_service, db_session, create_sample_clinic, create_sample_patients):
        """Test LLM processing for linked patient."""
        from src.main import app

        # Override the database dependency to use our test session
        def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            # First link the patient
            line_user = LineUser(line_user_id="test_line_user_linked", patient_id=create_sample_patients[0].id)
            db_session.add(line_user)
            db_session.commit()

            # Mock LLM response with tool call
            mock_llm_service.process_message.return_value = {
                "response": "讓我幫您查看空檔時間。",
                "tool_results": [{
                    "success": True,
                    "availability": [{
                        "therapist": "王大明",
                        "slots": [{"date": "2024-12-25", "time": "10:00", "datetime": "2024-12-25T10:00:00"}]
                    }]
                }],
                "success": True
            }

            # Sample LINE webhook payload
            payload = {
                "events": [{
                    "type": "message",
                    "source": {"userId": "test_line_user_linked"},
                    "message": {
                        "type": "text",
                        "text": "我想預約初診評估"
                    }
                }]
            }

            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.post("/webhook/line", json=payload)
                assert response.status_code == 200
                assert response.text == "OK"

            # Verify LLM was called with correct parameters
            mock_llm_service.process_message.assert_called_once()
            call_args = mock_llm_service.process_message.call_args
            assert call_args[1]["message"] == "我想預約初診評估"
            assert call_args[1]["clinic_id"] == create_sample_clinic.id
            assert call_args[1]["patient_id"] == create_sample_patients[0].id
        finally:
            # Clean up dependency override
            app.dependency_overrides.pop(get_db, None)

    @pytest.mark.asyncio
    @patch('src.services.llm_service.llm_service')
    async def test_line_webhook_non_appointment_message(self, mock_llm_service, db_session, create_sample_clinic):
        """Test webhook handling of non-appointment messages."""
        from src.main import app

        # Override the database dependency to use our test session
        def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            # Mock LLM service to return non-appointment protocol
            mock_llm_service.process_message.return_value = {
                "response": "NON_APPOINTMENT_MESSAGE",
                "success": True,
                "intent": "other"
            }

            # Sample LINE webhook payload with non-appointment message
            payload = {
                "events": [{
                    "type": "message",
                    "source": {"userId": "test_line_user_other"},
                    "message": {
                        "type": "text",
                        "text": "你好嗎？"
                    }
                }]
            }

            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.post("/webhook/line", json=payload)
                assert response.status_code == 200
                assert response.text == "OK"

            # Verify LLM was called but webhook didn't process further
            mock_llm_service.process_message.assert_called_once()
            call_args = mock_llm_service.process_message.call_args
            assert call_args[1]["message"] == "你好嗎？"
            assert call_args[1]["clinic_id"] == create_sample_clinic.id
        finally:
            # Clean up dependency override
            app.dependency_overrides.pop(get_db, None)

    @pytest.mark.asyncio
    async def test_line_webhook_follow_event(self, db_session):
        """Test processing follow events."""
        from src.main import app

        payload = {
            "events": [{
                "type": "follow",
                "source": {"userId": "test_follow_user"}
            }]
        }

        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.post("/webhook/line", json=payload)
            assert response.status_code == 200
            assert response.text == "OK"

    @pytest.mark.asyncio
    async def test_line_webhook_unfollow_event(self, db_session):
        """Test processing unfollow events."""
        from src.main import app

        payload = {
            "events": [{
                "type": "unfollow",
                "source": {"userId": "test_unfollow_user"}
            }]
        }

        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.post("/webhook/line", json=payload)
            assert response.status_code == 200
            assert response.text == "OK"

    @pytest.mark.asyncio
    async def test_line_webhook_invalid_json(self):
        """Test webhook with invalid JSON."""
        from src.main import app

        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.post("/webhook/line", content="invalid json")
            assert response.status_code == 400
            data = response.json()
            assert "Invalid JSON payload" in data["detail"]

    @pytest.mark.asyncio
    async def test_line_webhook_no_events(self):
        """Test webhook with no events."""
        from src.main import app

        payload = {"events": []}

        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.post("/webhook/line", json=payload)
            assert response.status_code == 200
            assert response.text == "OK"
