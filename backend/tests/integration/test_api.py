"""
Integration tests for API endpoints.
"""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
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

    def test_root_endpoint(self):
        """Test the root API endpoint."""
        from main import app
        client = TestClient(app)
        response = client.get("/")

        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data
        assert "status" in data
        assert data["status"] == "running"

    def test_health_endpoint(self):
        """Test the health check endpoint."""
        from main import app
        client = TestClient(app)
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data == {"status": "healthy"}

    @pytest.mark.asyncio
    async def test_line_webhook_invalid_json(self, db_session):
        """Test LINE webhook with invalid JSON."""
        import hmac
        import hashlib
        import base64
        from main import app

        # Create test clinic in database
        clinic_data = {
            "name": "Test Clinic",
            "line_channel_id": "test_channel_123",
            "line_channel_secret": "test_secret_456",
            "line_channel_access_token": "test_token_789",
            "subscription_status": "trial"
        }
        clinic = Clinic(**clinic_data)
        db_session.add(clinic)
        db_session.commit()

        # Override database dependency for testing
        app.dependency_overrides[get_db] = self.get_db_override(db_session)

        client = TestClient(app)

        # Invalid JSON content
        invalid_json_content = "invalid json"

        # Generate valid signature for the invalid JSON
        signature = base64.b64encode(
            hmac.new(
                clinic_data["line_channel_secret"].encode('utf-8'),
                invalid_json_content.encode('utf-8'),
                hashlib.sha256
            ).digest()
        ).decode('utf-8')

        response = client.post(
            "/webhook/line",
            content=invalid_json_content,
            headers={
                "Content-Type": "application/json",
                "X-Clinic-ID": "1",
                "X-Line-Signature": signature
            }
        )

        assert response.status_code == 400
        assert "Invalid JSON payload" in response.json()["detail"]

        # Clean up override
        app.dependency_overrides = {}

    @pytest.mark.asyncio
    async def test_line_webhook_valid_payload(self, db_session):
        """Test LINE webhook with valid payload."""
        import hmac
        import hashlib
        import base64
        import json
        from main import app

        # Create test clinic in database
        clinic_data = {
            "name": "Test Clinic",
            "line_channel_id": "test_channel_123",
            "line_channel_secret": "test_secret_456",
            "line_channel_access_token": "test_token_789",
            "subscription_status": "trial"
        }
        clinic = Clinic(**clinic_data)
        db_session.add(clinic)
        db_session.commit()

        # Override database dependency for testing
        app.dependency_overrides[get_db] = self.get_db_override(db_session)

        client = TestClient(app)
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

        # Generate valid LINE signature for testing
        body_str = json.dumps(payload, separators=(',', ':'))
        signature = base64.b64encode(
            hmac.new(
                clinic_data["line_channel_secret"].encode('utf-8'),
                body_str.encode('utf-8'),
                hashlib.sha256
            ).digest()
        ).decode('utf-8')

        response = client.post(
                "/webhook/line",
                content=body_str,
                headers={
                    "Content-Type": "application/json",
                    "X-Clinic-ID": "1",
                    "X-Line-Signature": signature
                }
            )

        assert response.status_code == 200
        assert response.text == 'OK'

        # Clean up override
        app.dependency_overrides = {}

    def test_google_calendar_webhook(self, db_session, tables):
        """Test Google Calendar webhook endpoint."""
        from main import app
        app.dependency_overrides[get_db] = self.get_db_override(db_session)
        client = TestClient(app)
        headers = {
            "X-Goog-Resource-State": "exists",
            "X-Goog-Resource-ID": "test_resource_id",
            "X-Goog-Channel-ID": "test_channel_id",
            "X-Goog-Message-Number": "1"
        }

        response = client.post("/webhook/gcal", headers=headers)

        assert response.status_code == 200
        assert response.text == 'OK'

    @pytest.mark.skip(reason="Database integration test - requires test database setup")
    @pytest.mark.asyncio
    async def test_oauth_initiate_therapist_not_found(self, db_session, tables):
        """Test OAuth initiation with non-existent therapist."""
        from main import app

        client = TestClient(app)
        response = client.get("/api/admin/therapists/999/gcal/auth?clinic_id=1")

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
            client = TestClient(app)
            response = client.get(f"/api/admin/therapists/{therapist.id}/gcal/auth?clinic_id={clinic.id}")

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
        client = TestClient(app)
        response = client.get("/api/admin/auth/google/callback?state=1:2")

        assert response.status_code == 422
        errors = response.json()["detail"]
        assert len(errors) == 1
        assert errors[0]["loc"] == ["query", "error"]
        assert errors[0]["msg"] == "Field required"

    @pytest.mark.asyncio
    async def test_oauth_callback_missing_state(self):
        """Test OAuth callback without state parameter."""
        from main import app
        client = TestClient(app)
        response = client.get("/api/admin/auth/google/callback?code=test_code")

        assert response.status_code == 422
        errors = response.json()["detail"]
        assert len(errors) == 1
        assert errors[0]["loc"] == ["query", "error"]
        assert errors[0]["msg"] == "Field required"

    @pytest.mark.asyncio
    async def test_oauth_callback_with_error(self):
        """Test OAuth callback with error parameter."""
        from main import app
        client = TestClient(app)
        response = client.get("/api/admin/auth/google/callback?error=access_denied&state=1:2")

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
            client = TestClient(app)
            response = client.get(f"/api/admin/auth/google/callback?code=test_code&state={therapist.id}:{clinic.id}")

            assert response.status_code == 200
            data = response.json()
            assert "message" in data
            assert "therapist_id" in data
            assert "therapist_name" in data
            assert "Google Calendar access granted successfully" in data["message"]
