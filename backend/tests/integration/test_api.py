"""
Integration tests for API endpoints.
"""

import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient
from sqlalchemy.orm import Session

from models.clinic import Clinic
from models.therapist import Therapist
from core.database import get_db


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
        from main import app
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
        from main import app
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/health")

            assert response.status_code == 200
            data = response.json()
            assert data == {"status": "healthy"}

    @pytest.mark.asyncio
    async def test_line_webhook_invalid_json(self):
        """Test LINE webhook with invalid JSON."""
        from main import app
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
        from main import app
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
        from main import app
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
        from main import app

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
        from main import app
        app.dependency_overrides[get_db] = self.get_db_override(db_session)

        # Mock the OAuth service
        with patch('api.admin.google_oauth_service', mock_google_oauth):
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
        from main import app
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
        from main import app
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
        from main import app
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
        with patch('api.admin.google_oauth_service', mock_google_oauth):
            from main import app
            async with AsyncClient(app=app, base_url="http://testserver") as client:
                response = await client.get(f"/api/admin/auth/google/callback?code=test_code&state={therapist.id}:{clinic.id}")

                assert response.status_code == 200
                data = response.json()
                assert "message" in data
                assert "therapist_id" in data
                assert "therapist_name" in data
                assert "Google Calendar access granted successfully" in data["message"]
