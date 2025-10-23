"""
Integration test verifying reschedule conflict prevention.

Business rule: rescheduling an appointment must not move it into a time window
that conflicts with another confirmed appointment for the same practitioner.
"""

import pytest
from datetime import datetime, timedelta, time
from models import Clinic, User, Patient, AppointmentType, Appointment
from clinic_agents.context import ConversationContext
from unittest.mock import Mock
from clinic_agents import tools
from clinic_agents.tools import reschedule_appointment_impl


@pytest.mark.asyncio
async def test_reschedule_into_conflict_is_rejected(db_session):
    # Arrange clinic, practitioner, type, two patients
    clinic = Clinic(name="RC Clinic", line_channel_id="c1", line_channel_secret="s1", line_channel_access_token="t1")
    db_session.add(clinic)
    db_session.commit()

    practitioner = User(
        clinic_id=clinic.id,
        full_name="Dr. Move",
        email="move@ex.com",
        google_subject_id="sub_move",
        roles=["practitioner"],
        is_active=True,
    )
    at = AppointmentType(clinic_id=clinic.id, name="一般複診", duration_minutes=30)
    p1 = Patient(clinic_id=clinic.id, full_name="P1", phone_number="0912000001")
    p2 = Patient(clinic_id=clinic.id, full_name="P2", phone_number="0912000002")
    db_session.add_all([practitioner, at, p1, p2])
    db_session.commit()

    # Existing appointment A at 10:00-10:30
    day = datetime.now().date() + timedelta(days=1)
    a_start = datetime.combine(day, time(10, 0))
    appt_a = Appointment(
        patient_id=p1.id,
        user_id=practitioner.id,
        appointment_type_id=at.id,
        start_time=a_start,
        end_time=a_start + timedelta(minutes=30),
        status="confirmed",
        gcal_event_id="evtA",
    )
    db_session.add(appt_a)
    db_session.commit()

    # Appointment B currently at 11:00-11:30
    b_start = datetime.combine(day, time(11, 0))
    appt_b = Appointment(
        patient_id=p2.id,
        user_id=practitioner.id,
        appointment_type_id=at.id,
        start_time=b_start,
        end_time=b_start + timedelta(minutes=30),
        status="confirmed",
        gcal_event_id="evtB",
    )
    db_session.add(appt_b)
    db_session.commit()

    # Attempt to reschedule B into A's slot (conflict)
    new_b_start = a_start
    new_b_end = new_b_start + timedelta(minutes=30)

    # Prepare wrapper context
    ctx = ConversationContext(
        db_session=db_session,
        clinic=clinic,
        patient=None,
        line_user_id="U_resched",
        is_linked=True,
    )
    wrapper = Mock()
    wrapper.context = ctx

    # Call real tool
    result = await reschedule_appointment_impl(
        wrapper=wrapper,
        appointment_id=appt_b.id,
        patient_id=p2.id,
        new_start_time=new_b_start,
    )

    assert isinstance(result, dict)
    assert result.get("error") == "預約時間衝突，請選擇其他時段"
