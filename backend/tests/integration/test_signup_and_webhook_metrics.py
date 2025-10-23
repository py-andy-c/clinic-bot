"""
Integration tests for signup token validation and LINE webhook metrics.

Covers:
- Signup token invalid states (revoked, used, expired) return 400 for both clinic and member initiation
- LINE webhook increments `webhook_count_24h` and resets after >24h (exposes time-window logic)
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic, SignupToken


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
        name="Signup Clinic",
        line_channel_id="line-xyz",
        line_channel_secret="sec",
        line_channel_access_token="tok",
    )
    db_session.add(c)
    db_session.commit()
    return c


class TestSignupTokenValidation:
    def test_initiate_clinic_admin_signup_invalid_token_states(self, client, db_session, clinic):
        # revoked
        t1 = SignupToken(token="t1", clinic_id=clinic.id, default_roles=["admin"], expires_at=datetime.now(timezone.utc)+timedelta(hours=1), is_revoked=True)
        # used
        t2 = SignupToken(token="t2", clinic_id=clinic.id, default_roles=["admin"], expires_at=datetime.now(timezone.utc)+timedelta(hours=1))
        t2.mark_used(email="x@ex.com")
        # expired
        t3 = SignupToken(token="t3", clinic_id=clinic.id, default_roles=["admin"], expires_at=datetime.now(timezone.utc)-timedelta(seconds=1))
        # non-admin roles for clinic admin path
        t4 = SignupToken(token="t4", clinic_id=clinic.id, default_roles=["practitioner"], expires_at=datetime.now(timezone.utc)+timedelta(hours=1))
        db_session.add_all([t1, t2, t3, t4])
        db_session.commit()

        for tok in ["t1", "t2", "t3"]:
            res = client.get(f"/api/signup/clinic", params={"token": tok})
            assert res.status_code == 400
        # Valid but wrong role for clinic admin path
        res = client.get(f"/api/signup/clinic", params={"token": "t4"})
        assert res.status_code == 400

    def test_initiate_member_signup_invalid_token_states(self, client, db_session, clinic):
        # revoked
        t1 = SignupToken(token="m1", clinic_id=clinic.id, default_roles=["practitioner"], expires_at=datetime.now(timezone.utc)+timedelta(hours=1), is_revoked=True)
        # used
        t2 = SignupToken(token="m2", clinic_id=clinic.id, default_roles=["practitioner"], expires_at=datetime.now(timezone.utc)+timedelta(hours=1))
        t2.mark_used(email="x@ex.com")
        # expired
        t3 = SignupToken(token="m3", clinic_id=clinic.id, default_roles=["practitioner"], expires_at=datetime.now(timezone.utc)-timedelta(seconds=1))
        db_session.add_all([t1, t2, t3])
        db_session.commit()

        for tok in ["m1", "m2", "m3"]:
            res = client.get(f"/api/signup/member", params={"token": tok})
            assert res.status_code == 400


class TestLineWebhookMetrics:
    def test_webhook_count_increments_and_resets_after_24h(self, client, db_session, clinic):
        # Ensure initial values
        assert clinic.webhook_count_24h == 0
        clinic.last_webhook_received_at = None
        db_session.commit()

        # Patch helper to select this clinic and bypass signature and message parsing
        with patch("api.webhooks.get_clinic_from_request", return_value=clinic), \
             patch("services.line_service.LINEService.verify_signature", return_value=True), \
             patch("services.line_service.LINEService.extract_message_data", return_value=None):
            # First webhook increments to 1
            res1 = client.post("/webhook/line", headers={"X-Line-Signature": "sig"}, json={})
            assert res1.status_code == 200
            db_session.refresh(clinic)
            assert clinic.webhook_count_24h == 1
            first_time = clinic.last_webhook_received_at
            assert first_time is not None

            # Second webhook within 24h increments to 2
            res2 = client.post("/webhook/line", headers={"X-Line-Signature": "sig"}, json={})
            assert res2.status_code == 200
            db_session.refresh(clinic)
            assert clinic.webhook_count_24h == 2

            # Simulate >24h elapsed
            clinic.last_webhook_received_at = first_time - timedelta(hours=25)
            db_session.commit()

            # Next webhook should reset counter to 1 (after reset then increment)
            res3 = client.post("/webhook/line", headers={"X-Line-Signature": "sig"}, json={})
            assert res3.status_code == 200
            db_session.refresh(clinic)
            assert clinic.webhook_count_24h == 1
