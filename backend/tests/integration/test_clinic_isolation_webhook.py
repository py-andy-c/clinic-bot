"""
Integration tests asserting clinic identification and isolation in LINE webhook.

Focuses on `get_clinic_from_request()` behavior and signature verification using
clinic-provided credentials to prevent cross-clinic spoofing.
"""

import json
import hmac
import hashlib
import base64

import pytest
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic


def _sign(body: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


@pytest.fixture
def client(db_session):
    def override_get_db():
        return db_session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def two_clinics(db_session):
    # Create two clinics with distinct secrets/tokens
    clinic_a = Clinic(
        name="Clinic A",
        line_channel_id="chan_a",
        line_channel_secret="secret_a",
        line_channel_access_token="token_a",
    )
    clinic_b = Clinic(
        name="Clinic B",
        line_channel_id="chan_b",
        line_channel_secret="secret_b",
        line_channel_access_token="token_b",
    )
    db_session.add_all([clinic_a, clinic_b])
    db_session.commit()
    return clinic_a, clinic_b


def test_line_webhook_missing_clinic_header_returns_400(client, db_session):
    # Ensure there is NO clinic with id=1 to avoid helper fallback
    # The in-memory DB is empty here; so this is true.
    payload = {"events": []}
    body = json.dumps(payload, separators=(",", ":"))

    res = client.post(
        "/webhook/line",
        content=body,
        headers={
            "Content-Type": "application/json",
            # No X-Clinic-ID header
        },
    )
    assert res.status_code == 400
    assert "X-Clinic-ID" in res.json().get("detail", "")


def test_line_webhook_invalid_clinic_id_header_returns_400(client):
    payload = {"events": []}
    body = json.dumps(payload, separators=(",", ":"))

    res = client.post(
        "/webhook/line",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Clinic-ID": "abc",  # not an int
        },
    )
    # Helper will still try id=1 fallback; with empty DB -> 400
    assert res.status_code == 400


def test_line_webhook_signature_isolation_by_header(client, two_clinics):
    clinic_a, clinic_b = two_clinics

    # Prepare a minimal text message payload
    payload = {
        "events": [
            {
                "type": "message",
                "source": {"type": "user", "userId": "U123"},
                "message": {"type": "text", "id": "m1", "text": "test"},
            }
        ]
    }
    body = json.dumps(payload, separators=(",", ":"))

    # Sign with Clinic A secret, but send header for Clinic B
    signature_wrong = _sign(body, clinic_a.line_channel_secret)

    res = client.post(
        "/webhook/line",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Line-Signature": signature_wrong,
            "X-Clinic-ID": str(clinic_b.id),
        },
    )
    # Since webhook uses Clinic B's secret based on header, signature must fail
    assert res.status_code == 401
    assert "Invalid LINE signature" in res.json()["detail"]

    # Now sign with Clinic B's secret and it should pass
    signature_right = _sign(body, clinic_b.line_channel_secret)
    # Patch orchestrator to avoid async issues; import path in app module is api.webhooks.handle_line_message
    from unittest.mock import patch
    with patch("api.webhooks.handle_line_message") as mock_handle:
        mock_handle.return_value = None
        res2 = client.post(
            "/webhook/line",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Line-Signature": signature_right,
                "X-Clinic-ID": str(clinic_b.id),
            },
        )
        assert res2.status_code == 200
        assert res2.text == "OK"
