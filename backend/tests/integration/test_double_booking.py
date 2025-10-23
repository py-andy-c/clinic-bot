"""
Integration test verifying create_appointment() prevents overlapping bookings.

Covers service-level guard in `clinic_agents/tools.create_appointment_impl`.
"""

import pytest
from datetime import datetime, timedelta, time
from unittest.mock import Mock, patch, AsyncMock

from clinic_agents.context import ConversationContext
from clinic_agents.tools import create_appointment_impl
from models import Clinic, User, Patient, AppointmentType


@pytest.mark.asyncio
async def test_prevent_double_booking_same_time_window(db_session):
    # Arrange clinic, practitioner, type, patient
    clinic = Clinic(
        name="DB Clinic",
        line_channel_id="chan",
        line_channel_secret="secret",
        line_channel_access_token="token",
    )
    db_session.add(clinic)
    db_session.commit()

    practitioner = User(
        clinic_id=clinic.id,
        full_name="Dr. Concurrency",
        email="conc@example.com",
        google_subject_id="sub_conc",
        roles=["practitioner"],
        is_active=True,
        gcal_credentials="enc_creds",  # ensure non-null for calendar path
    )
    at = AppointmentType(clinic_id=clinic.id, name="一般複診", duration_minutes=30)
    patient = Patient(clinic_id=clinic.id, full_name="P1", phone_number="0912000000")
    db_session.add_all([practitioner, at, patient])
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

    # First appointment: 10:00-10:30
    start = datetime.combine(datetime.now().date() + timedelta(days=1), time(10, 0))

    with patch("clinic_agents.tools.GoogleCalendarService", autospec=True) as mock_gcal_class, \
         patch("services.encryption_service.get_encryption_service", autospec=True) as mock_get_enc:
        # Mock decrypt - use autospecced return value
        mock_get_enc.return_value.decrypt_data.return_value = {"access_token": "x"}

        # Mock GCal service - use the autospecced return value
        gcal_instance = mock_gcal_class.return_value  # already autospecced to GoogleCalendarService
        gcal_instance.create_event = AsyncMock(return_value={'id': 'evt1'})
        gcal_instance.update_event = AsyncMock(return_value=None)

        res1 = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=practitioner.id,
            appointment_type_id=at.id,
            start_time=start,
            patient_id=patient.id,
        )
        assert res1.get("success") is True

    # Second overlapping appointment: 10:15-10:45 should be rejected
    overlapping_start = start + timedelta(minutes=15)
    with patch("clinic_agents.tools.GoogleCalendarService", autospec=True) as mock_gcal_class, \
         patch("services.encryption_service.get_encryption_service", autospec=True) as mock_get_enc:
        # Mock decrypt - use autospecced return value
        mock_get_enc.return_value.decrypt_data.return_value = {"access_token": "x"}

        # Mock GCal service - use the autospecced return value
        gcal_instance = mock_gcal_class.return_value  # already autospecced to GoogleCalendarService
        gcal_instance.create_event = AsyncMock(return_value={'id': 'evt2'})
        gcal_instance.update_event = AsyncMock(return_value=None)

        res2 = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=practitioner.id,
            appointment_type_id=at.id,
            start_time=overlapping_start,
            patient_id=patient.id,
        )
        assert res2.get("error") == "預約時間衝突，請選擇其他時段"
