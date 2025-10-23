"""
Additional Google Calendar webhook integration tests.

Covers:
- Pagination desired behavior: if events are split across pages, deletion detection should still work (documented as xfail)
- API error during events listing should not crash webhook and should not alter appointment status
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic, User, Patient, AppointmentType, Appointment, LineUser


@pytest.fixture
def client(db_session):
    def override_get_db():
        return db_session
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def clinic_with_practitioner_and_appt(db_session):
    clinic = Clinic(
        name="GCal Clinic",
        line_channel_id="cid",
        line_channel_secret="sec",
        line_channel_access_token="tok",
    )
    db_session.add(clinic)
    db_session.commit()

    user = User(
        clinic_id=clinic.id,
        full_name="Dr. Page",
        email="page@ex.com",
        google_subject_id="sub_page",
        roles=["practitioner"],
        is_active=True,
    )
    at = AppointmentType(clinic_id=clinic.id, name="初診評估", duration_minutes=60)
    p = Patient(clinic_id=clinic.id, full_name="P", phone_number="0912000000")
    p.line_user = LineUser(line_user_id="U_page")

    db_session.add_all([user, at, p])
    db_session.commit()

    # Confirmed appointment with gcal_event_id that should be treated as deleted if not found
    start = datetime.now(timezone.utc) + timedelta(days=1)
    appt = Appointment(
        patient_id=p.id,
        user_id=user.id,
        appointment_type_id=at.id,
        start_time=start,
        end_time=start + timedelta(minutes=60),
        status="confirmed",
        gcal_event_id="evt_target",
    )
    db_session.add(appt)
    db_session.commit()

    # Set up watch id and minimal creds string; decrypt is patched in tests
    user.gcal_watch_resource_id = "watch_page"
    user.gcal_credentials = "encrypted_dummy"
    db_session.commit()

    return clinic, user, appt


def test_pagination_support_for_deleted_detection(client, db_session, clinic_with_practitioner_and_appt):
    clinic, user, appt = clinic_with_practitioner_and_appt

    with patch("services.encryption_service.get_encryption_service") as mock_get_enc, \
         patch("api.webhooks.GoogleCalendarService") as mock_gcal_cls, \
         patch("services.line_service.LINEService.send_text_message") as mock_send:
        # Decrypt creds
        mock_enc = Mock()
        mock_enc.decrypt_data.return_value = {"access_token": "x"}
        mock_get_enc.return_value = mock_enc

        # Simulate events across multiple pages that DO include the target id on page 2
        mock_service = Mock()
        mock_events = Mock()
        # First page: not containing evt_target, has nextPageToken
        mock_events.list.return_value.execute.side_effect = [
            {"items": [{"id": "evt_other1"}], "nextPageToken": "nxt"},
            {"items": [{"id": "evt_target"}]},
        ]
        mock_service.service.events.return_value = mock_events
        mock_gcal_cls.return_value = mock_service

        res = client.post(
            "/webhook/gcal",
            headers={
                "X-Goog-Resource-State": "exists",
                "X-Goog-Resource-ID": user.gcal_watch_resource_id,
            },
        )
        # Desired: still 200 OK
        assert res.status_code == 200

        # Desired: because evt_target exists on page 2, appointment should remain confirmed
        db_session.refresh(appt)
        assert appt.status == "confirmed", "Expected pagination-aware detection to avoid false cancellation"


def test_events_list_execute_error_does_not_cancel(client, db_session, clinic_with_practitioner_and_appt):
    clinic, user, appt = clinic_with_practitioner_and_appt

    with patch("services.encryption_service.get_encryption_service") as mock_get_enc, \
         patch("api.webhooks.GoogleCalendarService") as mock_gcal_cls:
        # Decrypt creds
        mock_enc = Mock()
        mock_enc.decrypt_data.return_value = {"access_token": "x"}
        mock_get_enc.return_value = mock_enc

        # Raise during execute
        mock_service = Mock()
        mock_events = Mock()
        mock_events.list.return_value.execute.side_effect = Exception("API error")
        mock_service.service.events.return_value = mock_events
        mock_gcal_cls.return_value = mock_service

        res = client.post(
            "/webhook/gcal",
            headers={
                "X-Goog-Resource-State": "exists",
                "X-Goog-Resource-ID": user.gcal_watch_resource_id,
            },
        )
        assert res.status_code == 200

        # Appointment should remain unchanged
        db_session.refresh(appt)
        assert appt.status == "confirmed"
