"""
Integration tests for LINE webhook auth and signup callback unhappy paths.

Covers:
- LINE webhook with invalid signature returns 401 and does not mutate webhook metrics
- Signup OAuth callback unhappy paths:
  - Invalid/expired state JWT
  - Token exchange failure from Google (HTTP error)
  - Missing email/sub in user info response
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock, Mock
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic


@pytest.fixture
def client(db_session):
    def override_get_db():
        return db_session
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def clinic(db_session):
    c = Clinic(
        name="Webhook Clinic",
        line_channel_id="line-abc",
        line_channel_secret="sec",
        line_channel_access_token="tok",
    )
    db_session.add(c)
    db_session.commit()
    return c


class TestLineWebhookInvalidSignature:
    def test_invalid_signature_unauthorized_and_no_metric_change(self, client, db_session, clinic):
        clinic.webhook_count_24h = 5
        clinic.last_webhook_received_at = datetime.now(timezone.utc)
        db_session.commit()

        with patch("api.webhooks.get_clinic_from_request", return_value=clinic), \
             patch("services.line_service.LINEService.verify_signature", return_value=False):
            res = client.post("/webhook/line", headers={"X-Line-Signature": "bad"}, json={})
            assert res.status_code == 401

        # Metrics should not be updated on invalid signature
        db_session.refresh(clinic)
        assert clinic.webhook_count_24h == 5


class TestSignupCallbackUnhappyPaths:
    def test_invalid_state_rejected(self, client):
        # Invalid/bogus state should be rejected with 400
        res = client.get("/api/signup/callback", params={"code": "any", "state": "bogus"})
        assert res.status_code == 400

    def test_token_exchange_http_error(self, client, db_session, clinic):
        # Create a minimally valid signed state by patching verifier to return expected dict
        with patch("services.jwt_service.jwt_service.verify_oauth_state", return_value={"type": "member", "token": "tok"}), \
             patch("sqlalchemy.orm.Session.query") as mock_query, \
             patch("httpx.AsyncClient.post", side_effect=Exception("http error")):
            # Mock SignupToken lookup to appear valid
            class Tok:
                def __init__(self):
                    self.token = "tok"
                    self.clinic_id = clinic.id
                    self.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                    self.is_revoked = False
                    self.used_at = None
            mock_q = Mock()
            mock_q.filter.return_value.first.return_value = Tok()
            mock_query.return_value = mock_q

            res = client.get("/api/signup/callback", params={"code": "code", "state": "signed"})
            # Expect 500 from our handler when token exchange fails
            assert res.status_code == 500

    def test_missing_email_or_sub_in_userinfo_rejected(self, client, db_session, clinic):
        with patch("services.jwt_service.jwt_service.verify_oauth_state", return_value={"type": "member", "token": "tok"}), \
             patch("sqlalchemy.orm.Session.query") as mock_query, \
             patch("services.google_oauth.GoogleOAuthService.get_user_info") as mock_userinfo:
            # Mock SignupToken valid
            class Tok:
                def __init__(self):
                    self.token = "tok"
                    self.clinic_id = clinic.id
                    self.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                    self.is_revoked = False
                    self.used_at = None
            mock_q = Mock()
            mock_q.filter.return_value.first.return_value = Tok()
            mock_query.return_value = mock_q

            # Mock token exchange success with minimal payload using proper async coroutine
            from unittest.mock import AsyncMock
            resp = Mock()
            resp.raise_for_status.return_value = None
            resp.json.return_value = {"access_token": "at", "token_type": "Bearer", "expires_in": 3600}
            # Patch the coroutine httpx.AsyncClient.post to return resp
            with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=resp)):

                # Case 1: missing email
                mock_userinfo.return_value = {"sub": "sub1", "name": "No Email"}
                res1 = client.get("/api/signup/callback", params={"code": "c", "state": "s"})
                assert res1.status_code == 400

                # Case 2: missing sub
                mock_userinfo.return_value = {"email": "x@ex.com", "name": "No Sub"}
                res2 = client.get("/api/signup/callback", params={"code": "c", "state": "s"})
                assert res2.status_code == 400
