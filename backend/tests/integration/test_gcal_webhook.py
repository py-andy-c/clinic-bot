"""
Integration tests for Google Calendar webhook processing.

Covers deletion detection, missing practitioner, missing credentials,
unknown resource states, and ensures webhook returns OK while updating DB
and triggering LINE notifications.
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, Mock

import pytest
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic, User, Patient, AppointmentType, Appointment, LineUser, CalendarEvent


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        return db_session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    yield client

    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def clinic_with_practitioner(db_session):
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789",
    )
    db_session.add(clinic)
    db_session.commit()

    practitioner = User(
        clinic_id=clinic.id,
        full_name="Dr. Gcal",
        email="dr.gcal@example.com",
        google_subject_id="sub_gc_1",
        roles=["practitioner"],
        is_active=True,
    )

    # Minimal appointment type for FK
    apt_type = AppointmentType(
        clinic_id=clinic.id,
        name="初診評估",
        duration_minutes=60,
    )

    db_session.add_all([practitioner, apt_type])
    db_session.commit()

    return clinic, practitioner, apt_type


@pytest.fixture
def linked_patient(db_session, clinic_with_practitioner):
    clinic, _, _ = clinic_with_practitioner

    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="0912345678",
    )
    line_user = LineUser(line_user_id="U_line_patient_1")
    patient.line_user = line_user

    db_session.add_all([patient, line_user])
    db_session.commit()
    return patient


class TestGoogleCalendarWebhook:
    def test_ok_on_unknown_resource_state(self, client):
        response = client.post("/webhook/gcal", headers={"X-Goog-Resource-State": "mystery"})
        assert response.status_code == 200
        assert response.text == "OK"

    def test_ok_on_sync_state(self, client):
        response = client.post("/webhook/gcal", headers={"X-Goog-Resource-State": "sync"})
        assert response.status_code == 200

    def test_no_practitioner_for_resource_id(self, client):
        # Resource ID that doesn't match any practitioner
        response = client.post(
            "/webhook/gcal",
            headers={
                "X-Goog-Resource-State": "exists",
                "X-Goog-Resource-ID": "nonexistent",
            },
        )
        assert response.status_code == 200

    def test_practitioner_no_credentials(self, client, db_session, clinic_with_practitioner):
        _, practitioner, _ = clinic_with_practitioner
        # Associate a resource id but leave gcal_credentials None
        practitioner.gcal_watch_resource_id = "watch_1"
        practitioner.gcal_credentials = None
        db_session.commit()

        response = client.post(
            "/webhook/gcal",
            headers={
                "X-Goog-Resource-State": "exists",
                "X-Goog-Resource-ID": "watch_1",
            },
        )
        assert response.status_code == 200

    def test_marks_deleted_and_notifies_patient(self, client, db_session, clinic_with_practitioner, linked_patient):
        clinic, practitioner, apt_type = clinic_with_practitioner
        # Practitioner has credentials and watch id
        practitioner.gcal_watch_resource_id = "watch_2"
        # Store something that decrypts to a simple dict by our patched decrypt
        practitioner.gcal_credentials = "encrypted_dummy"
        db_session.commit()

        # Create a confirmed appointment with a gcal_event_id that WILL be treated as deleted
        start = datetime.now(timezone.utc) + timedelta(days=1)
        end = start + timedelta(minutes=apt_type.duration_minutes)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type='appointment',
            date=start.date(),
            start_time=start.time(),
            end_time=end.time(),
            gcal_event_id="event_to_be_deleted"
        )
        db_session.add(calendar_event)
        db_session.commit()

        appt = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appt)
        db_session.commit()

        # Patch decrypt to return a minimal credentials dict and patch Google API list to omit the appointment id
        with patch("services.encryption_service.get_encryption_service") as mock_get_enc, \
             patch("api.webhooks.GoogleCalendarService") as mock_gcal_cls, \
             patch("services.line_service.LINEService.send_text_message") as mock_send_line:
            mock_enc = Mock()
            mock_enc.decrypt_data.return_value = {"access_token": "x"}
            mock_get_enc.return_value = mock_enc

            # Mock the nested service.events().list(...).execute()
            mock_gcal_service = Mock()
            mock_events_api = Mock()
            mock_events_api.list.return_value.execute.return_value = {"items": [
                {"id": "other_event"},
                {"id": "another_event"},
            ]}
            mock_gcal_service.service.events.return_value = mock_events_api
            mock_gcal_cls.return_value = mock_gcal_service

            # Fire webhook
            response = client.post(
                "/webhook/gcal",
                headers={
                    "X-Goog-Resource-State": "exists",
                    "X-Goog-Resource-ID": "watch_2",
                },
            )

            assert response.status_code == 200

            # Appointment should now be canceled_by_clinic
            db_session.refresh(appt)
            assert appt.status == "canceled_by_clinic"

            # LINE notification should have been sent to patient's line user id
            mock_send_line.assert_called_once()
            args, kwargs = mock_send_line.call_args
            assert linked_patient.line_user.line_user_id in args[0]
            # Message should mention therapist and formatted time
            assert practitioner.full_name in args[1]

    def test_handles_gcal_init_failure(self, client, db_session, clinic_with_practitioner):
        _, practitioner, _ = clinic_with_practitioner
        practitioner.gcal_watch_resource_id = "watch_3"
        practitioner.gcal_credentials = "encrypted_dummy"
        db_session.commit()

        # Force GoogleCalendarService init to raise
        with patch("services.encryption_service.get_encryption_service") as mock_get_enc, \
             patch("api.webhooks.GoogleCalendarService", side_effect=Exception("boom")):
            mock_enc = Mock()
            mock_enc.decrypt_data.return_value = {"access_token": "x"}
            mock_get_enc.return_value = mock_enc

            response = client.post(
                "/webhook/gcal",
                headers={
                    "X-Goog-Resource-State": "exists",
                    "X-Goog-Resource-ID": "watch_3",
                },
            )
            assert response.status_code == 200
