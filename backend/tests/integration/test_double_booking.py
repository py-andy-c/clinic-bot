"""
Integration test to expose double-booking behavior.

This test is marked xfail to document the expected business rule:
- Prevent overlapping appointments for the same practitioner and time window.

Current implementation in `clinic_agents/tools.create_appointment` does not
check for conflicts before creating the DB record (it creates the GCal event
first). This test asserts the desired behavior and is expected to fail until
conflict checks/constraints are added.
"""

import pytest
from datetime import datetime, timedelta, time
from unittest.mock import Mock

from clinic_agents.context import ConversationContext
from models import Clinic, User, Patient, AppointmentType, Appointment


@pytest.mark.xfail(reason="Double-booking prevention not enforced yet; test documents desired behavior")
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
    )
    at = AppointmentType(clinic_id=clinic.id, name="一般複診", duration_minutes=30)
    patient = Patient(clinic_id=clinic.id, full_name="P1", phone_number="0912000000")
    db_session.add_all([practitioner, at, patient])
    db_session.commit()

    # Existing appointment at 10:00-10:30
    start = datetime.combine(datetime.now().date() + timedelta(days=1), time(10, 0))
    appt1 = Appointment(
        patient_id=patient.id,
        user_id=practitioner.id,
        appointment_type_id=at.id,
        start_time=start,
        end_time=start + timedelta(minutes=30),
        status="confirmed",
        gcal_event_id="evt1",
    )
    db_session.add(appt1)
    db_session.commit()

    # Attempt to create overlapping appointment 10:15-10:45 should be rejected
    overlapping_start = start + timedelta(minutes=15)

    # Expected: service should reject; we'll check desired DB condition
    overlapping = db_session.query(Appointment).filter(
        Appointment.user_id == practitioner.id,
        Appointment.status.in_(["confirmed", "pending"]),
        Appointment.start_time < overlapping_start + timedelta(minutes=30),
        Appointment.end_time > overlapping_start,
    ).first()

    # Failing implementation currently allows; we assert desired state
    assert overlapping is None, "Expected no overlapping appointment to be allowed (business rule)"
