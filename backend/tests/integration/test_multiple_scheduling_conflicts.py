"""
Tests for multiple scheduling conflict detection.
"""

import pytest
from datetime import date, time, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from utils.datetime_utils import taiwan_now
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, AvailabilityException, Appointment, PractitionerAppointmentTypes
from core.database import get_db
from tests.conftest import (
    create_user_with_clinic_association,
    create_practitioner_availability_with_clinic,
    create_calendar_event_with_clinic
)

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
def test_clinic_and_practitioner(db_session: Session):
    """Create a test clinic and practitioner with clinic association."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.flush()
    
    practitioner, _ = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="Dr. Multi",
        email="multi@example.com",
        google_subject_id="multi_subject",
        roles=["practitioner"],
        is_active=True
    )
    db_session.flush()
    
    return clinic, practitioner

def get_auth_token(client: TestClient, email: str) -> str:
    """Helper to get authentication token for a user."""
    response = client.post(f"/api/auth/dev/login?email={email}&user_type=clinic_user")
    assert response.status_code == 200
    return response.json()["access_token"]

class TestMultipleSchedulingConflicts:
    """Test multiple scheduling conflict detection."""

    def test_multi_appointment_conflicts(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that multiple overlapping appointments are all returned."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Link to practitioner
        link = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id
        )
        db_session.add(link)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=5)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create TWO existing appointments that overlap with 10:00 - 11:00
        patient1 = Patient(clinic_id=clinic.id, full_name="Patient One")
        patient2 = Patient(clinic_id=clinic.id, full_name="Patient Two")
        db_session.add_all([patient1, patient2])
        db_session.flush()

        # Appt 1: 9:30 - 10:30
        e1 = create_calendar_event_with_clinic(db_session, practitioner, clinic, "appointment", future_date, time(9, 30), time(10, 30))
        # Appt 2: 10:45 - 11:45
        e2 = create_calendar_event_with_clinic(db_session, practitioner, clinic, "appointment", future_date, time(10, 45), time(11, 45))
        db_session.flush()

        a1 = Appointment(calendar_event_id=e1.id, patient_id=patient1.id, appointment_type_id=appointment_type.id, status="confirmed")
        a2 = Appointment(calendar_event_id=e2.id, patient_id=patient2.id, appointment_type_id=appointment_type.id, status="confirmed")
        db_session.add_all([a1, a2])
        db_session.commit()

        token = get_auth_token(client, practitioner.email)

        # Check conflict for 10:00 - 11:00 (overlaps with both)
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": future_date.isoformat(),
                "start_time": "10:00",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        res = data["results"][0]
        
        assert res["has_conflict"] is True
        assert res["conflict_type"] == "appointment"
        # Backward compatibility
        assert res["appointment_conflict"] is not None
        # Plural fields
        assert len(res["appointment_conflicts"]) == 2
        patient_names = [a["patient_name"] for a in res["appointment_conflicts"]]
        assert "Patient One" in patient_names
        assert "Patient Two" in patient_names

    def test_multi_exception_conflicts(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that multiple overlapping exceptions are all returned."""
        clinic, practitioner = test_clinic_and_practitioner

        appointment_type = AppointmentType(clinic_id=clinic.id, name="Test", duration_minutes=60)
        db_session.add(appointment_type)
        db_session.flush()
        link = PractitionerAppointmentTypes(user_id=practitioner.id, appointment_type_id=appointment_type.id, clinic_id=clinic.id)
        db_session.add(link)
        db_session.flush()

        future_date = (taiwan_now() + timedelta(days=6)).date()
        create_practitioner_availability_with_clinic(db_session, practitioner, clinic, future_date.weekday(), time(9, 0), time(17, 0))
        db_session.flush()

        # Create TWO exceptions
        e1 = create_calendar_event_with_clinic(db_session, practitioner, clinic, "availability_exception", future_date, time(10, 0), time(10, 30), custom_event_name="Leave 1")
        e2 = create_calendar_event_with_clinic(db_session, practitioner, clinic, "availability_exception", future_date, time(10, 45), time(11, 15), custom_event_name="Leave 2")
        db_session.flush()
        db_session.add_all([AvailabilityException(calendar_event_id=e1.id), AvailabilityException(calendar_event_id=e2.id)])
        db_session.commit()

        token = get_auth_token(client, practitioner.email)

        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": future_date.isoformat(),
                "start_time": "10:15",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        res = data["results"][0]
        
        assert res["has_conflict"] is True
        assert res["conflict_type"] == "exception"
        assert res["exception_conflict"] is not None
        assert len(res["exception_conflicts"]) == 2
        reasons = [e["reason"] for e in res["exception_conflicts"]]
        assert "Leave 1" in reasons
        assert "Leave 2" in reasons
