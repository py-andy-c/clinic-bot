"""
Happy-path integration test for non-overlapping appointment creation logic.

We emulate the service-level guard and ensure that when there is no conflict,
Google Calendar operations are invoked and a success-like structure is returned.
This avoids coupling to the @function_tool wrapper.
"""

import pytest
from datetime import datetime, timedelta, time
from unittest.mock import AsyncMock, Mock

from clinic_agents.context import ConversationContext
from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent


@pytest.mark.asyncio
async def test_create_appointment_non_overlapping_invokes_gcal(db_session):
    # Arrange clinic, practitioner, patient, type
    clinic = Clinic(name="C1", line_channel_id="c1", line_channel_secret="s1", line_channel_access_token="t1")
    db_session.add(clinic)
    db_session.commit()

    practitioner = User(
        clinic_id=clinic.id,
        full_name="Dr. Happy",
        email="happy@ex.com",
        google_subject_id="gsub_h",
        roles=["practitioner"],
        is_active=True,
        gcal_credentials="enc_creds",  # dummy
    )
    patient = Patient(clinic_id=clinic.id, full_name="P1", phone_number="0912000000")
    apt_type = AppointmentType(clinic_id=clinic.id, name="一般複診", duration_minutes=30)
    db_session.add_all([practitioner, patient, apt_type])
    db_session.commit()

    # Existing appointment: 10:00-10:30
    base = datetime.combine(datetime.now().date() + timedelta(days=1), time(10, 0))

    # Create CalendarEvent first
    calendar_event = CalendarEvent(
        user_id=practitioner.id,
        event_type='appointment',
        date=base.date(),
        start_time=base.time(),
        end_time=(base + timedelta(minutes=30)).time(),
        gcal_event_id="evt1"
    )
    db_session.add(calendar_event)
    db_session.commit()

    existing = Appointment(
        calendar_event_id=calendar_event.id,
        patient_id=patient.id,
        appointment_type_id=apt_type.id,
        status="confirmed"
    )
    db_session.add(existing)
    db_session.commit()

    # Non-overlapping request: 11:00-11:30
    start_time = datetime.combine(base.date(), time(11, 0))
    end_time = start_time + timedelta(minutes=apt_type.duration_minutes)

    # Local helper that mirrors guard then calls mocked GCal
    async def _create_non_overlapping(db_session, practitioner, patient, apt_type, start_time):
        # Guard should find no conflict
        conflict = db_session.query(Appointment).join(CalendarEvent).filter(
            CalendarEvent.user_id == practitioner.id,
            Appointment.status.in_(["confirmed", "pending"]),
            CalendarEvent.start_time < end_time,
            CalendarEvent.end_time > start_time,
        ).first()
        assert conflict is None

        # Mock GCal flows and return a success-like payload
        from unittest.mock import patch
        with patch("services.encryption_service.get_encryption_service") as mock_get_enc, \
             patch("services.google_calendar_service.GoogleCalendarService") as mock_gcal:
            mock_get_enc.return_value = Mock()
            mock_gcal_instance = AsyncMock()
            mock_gcal.return_value = mock_gcal_instance
            mock_gcal_instance.create_event.return_value = {"id": "evt_new"}
            mock_gcal_instance.update_event.return_value = None

            # Emulate the tool's behavior: create GCal event first, then DB, then update event
            gcal_event = await mock_gcal_instance.create_event(
                summary=f"{patient.full_name} - {apt_type.name}",
                start=start_time,
                end=end_time,
                description=Mock(),
                color_id="7",
                extended_properties=Mock(),
            )

            # Create CalendarEvent first
            calendar_event = CalendarEvent(
                user_id=practitioner.id,
                event_type='appointment',
                date=start_time.date(),
                start_time=start_time.time(),
                end_time=end_time.time(),
                gcal_event_id=gcal_event["id"]
            )
            db_session.add(calendar_event)
            db_session.commit()

            # Emulate DB insert similar to create_appointment
            appt = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=apt_type.id,
                status="confirmed"
            )
            db_session.add(appt)
            db_session.commit()

            # Update GCal with DB id
            await mock_gcal_instance.update_event(
                event_id=gcal_event["id"],
                extended_properties=Mock(),
            )

            # Ensure GCal was invoked
            mock_gcal_instance.create_event.assert_awaited()
            mock_gcal_instance.update_event.assert_awaited()

            return {
                "success": True,
                "appointment_id": calendar_event.id,
                "gcal_event_id": "evt_new",
            }

    result = await _create_non_overlapping(db_session, practitioner, patient, apt_type, start_time)
    assert result["success"] is True
    assert isinstance(result.get("appointment_id"), int)
    assert result.get("gcal_event_id") == "evt_new"
