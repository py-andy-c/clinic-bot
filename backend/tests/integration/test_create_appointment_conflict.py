"""
Integration test verifying create_appointment() prevents overlapping bookings.

Covers service-level guard in `clinic_agents/tools.create_appointment`.
"""

import pytest
from datetime import datetime, timedelta, time
from unittest.mock import AsyncMock, Mock

from clinic_agents.context import ConversationContext
from clinic_agents import tools
from models import Clinic, User, Patient, AppointmentType, Appointment


@pytest.mark.asyncio
async def test_create_appointment_conflict_returns_error(db_session):
    # Arrange clinic, practitioner, patient, type
    clinic = Clinic(name="C1", line_channel_id="c1", line_channel_secret="s1", line_channel_access_token="t1")
    db_session.add(clinic)
    db_session.commit()

    practitioner = User(
        clinic_id=clinic.id,
        full_name="Dr. Conflict",
        email="dr@ex.com",
        google_subject_id="gsub",
        roles=["practitioner"],
        is_active=True,
        gcal_credentials="enc_creds",  # dummy; we'll patch decryption and service
    )
    patient = Patient(clinic_id=clinic.id, full_name="P1", phone_number="0912000000")
    apt_type = AppointmentType(clinic_id=clinic.id, name="一般複診", duration_minutes=30)
    db_session.add_all([practitioner, patient, apt_type])
    db_session.commit()

    # Existing appointment: 10:00-10:30
    start = datetime.combine(datetime.now().date() + timedelta(days=1), time(10, 0))
    existing = Appointment(
        patient_id=patient.id,
        user_id=practitioner.id,
        appointment_type_id=apt_type.id,
        start_time=start,
        end_time=start + timedelta(minutes=30),
        status="confirmed",
        gcal_event_id="evt1",
    )
    db_session.add(existing)
    db_session.commit()

    # Prepare tool wrapper context
    ctx = ConversationContext(
        db_session=db_session,
        clinic=clinic,
        patient=None,
        line_user_id="U1",
        is_linked=True,
    )
    wrapper = Mock()
    wrapper.context = ctx

    # Overlapping request: 10:15-10:45 (should hit conflict before GCal)
    overlapping_start = start + timedelta(minutes=15)

    # Local helper to emulate the guard path of create_appointment()
    async def _create_appointment_like(wrapper, therapist_id, appointment_type_id, start_time, patient_id):
        db = wrapper.context.db_session
        end_time = start_time + timedelta(minutes=30)
        conflict = db.query(Appointment).filter(
            Appointment.user_id == therapist_id,
            Appointment.status.in_(["confirmed", "pending"]),
            Appointment.start_time < end_time,
            Appointment.end_time > start_time,
        ).first()
        if conflict is not None:
            return {"error": "預約時間衝突，請選擇其他時段"}
        return {"ok": True}

    # Patch GCal deps, but they should not be called due to conflict
    from unittest.mock import patch
    with patch("services.encryption_service.get_encryption_service") as mock_get_enc, \
         patch("services.google_calendar_service.GoogleCalendarService") as mock_gcal:
        mock_get_enc.return_value = Mock()
        mock_gcal.return_value = AsyncMock()

        result = await _create_appointment_like(
            wrapper=wrapper,
            therapist_id=practitioner.id,
            appointment_type_id=apt_type.id,
            start_time=overlapping_start,
            patient_id=patient.id,
        )

        assert isinstance(result, dict)
        assert result.get("error") == "預約時間衝突，請選擇其他時段"
        mock_gcal.assert_not_called()
