"""
Timezone normalization tests.

Covers:
- `utils.datetime_utils.ensure_utc` conversions
- Document desired behavior: cancellation messages should present Asia/Taipei (UTC+8) local time
  for `appointment.start_time`. Current implementation formats naive datetime directly.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, Mock

from utils import datetime_utils as du
from models import Clinic, User, Patient, AppointmentType, Appointment


def test_ensure_utc_conversions():
    # Naive -> assumed UTC
    naive = datetime(2025, 1, 1, 12, 0, 0)
    ensured = du.ensure_utc(naive)
    assert ensured.tzinfo == timezone.utc
    assert ensured.hour == 12

    # Aware non-UTC -> converted to UTC
    aware = datetime(2025, 1, 1, 20, 0, 0, tzinfo=timezone(timedelta(hours=8)))
    ensured2 = du.ensure_utc(aware)
    assert ensured2.tzinfo == timezone.utc
    assert ensured2.hour == 12  # 20:00 UTC+8 -> 12:00 UTC


@pytest.mark.asyncio
async def test_cancellation_message_uses_taipei_time(db_session):
    # Build clinic, practitioner, patient, appt type, appointment
    clinic = Clinic(
        name="TZ Clinic",
        line_channel_id="chan",
        line_channel_secret="secret",
        line_channel_access_token="token",
    )
    db_session.add(clinic)
    db_session.commit()

    practitioner = User(
        clinic_id=clinic.id,
        full_name="Dr. TZ",
        email="tz@example.com",
        google_subject_id="tz_sub",
        roles=["practitioner"],
        is_active=True,
    )
    at = AppointmentType(clinic_id=clinic.id, name="初診評估", duration_minutes=60)
    patient = Patient(clinic_id=clinic.id, full_name="P TZ", phone_number="0912345678")
    db_session.add_all([practitioner, at, patient])
    db_session.commit()

    # Appointment at 23:30 UTC on Jan 1 -> 07:30 (Jan 2) Asia/Taipei
    start_utc = datetime(2025, 1, 1, 23, 30, 0, tzinfo=timezone.utc)
    appt = Appointment(
        patient_id=patient.id,
        user_id=practitioner.id,
        appointment_type_id=at.id,
        start_time=start_utc,
        end_time=start_utc + timedelta(minutes=60),
        status="confirmed",
        gcal_event_id="evt_tz",
    )
    db_session.add(appt)
    db_session.commit()

    # Trigger cancellation notification helper by directly calling module function
    from api.webhooks import _send_cancellation_notification
    # Ensure there is a linked LINE user so notification proceeds
    from models.line_user import LineUser
    db_session.add(LineUser(line_user_id="U_TZ", patient_id=patient.id))
    db_session.commit()

    with patch("services.line_service.LINEService.send_text_message") as mock_send:
        await _send_cancellation_notification(db_session, appt)

        # Assert message used local Asia/Taipei time (expected business rule)
        # Jan 1 23:30 UTC -> Jan 2 (Thu) 07:30 local; pattern: MM/DD (dow) HH:MM
        args, _ = mock_send.call_args
        message = args[1]
        assert "01/02" in message and "07:30" in message
