"""
Integration tests for scheduling conflict detection endpoint.

Tests the conflict detection functionality including:
- Appointment conflicts (highest priority)
- Availability exception conflicts (medium priority)
- Outside default availability (lowest priority)
- Excluding calendar events (for editing appointments)
"""

import pytest
from datetime import date, time, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from utils.datetime_utils import taiwan_now
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, AvailabilityException, Appointment
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
        full_name="Dr. Test",
        email="practitioner@example.com",
        google_subject_id="practitioner_subject",
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


class TestSchedulingConflicts:
    """Test scheduling conflict detection endpoint."""

    def test_check_scheduling_conflicts_past_appointment(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking scheduling conflicts - past appointment (highest priority)."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        past_date = (taiwan_now() - timedelta(days=1)).date()
        day_of_week = past_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict for past appointment using batch API
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": past_date.isoformat(),
                "start_time": "10:00",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]
        assert practitioner_result["has_conflict"] is True
        assert practitioner_result["conflict_type"] == "past_appointment"
        assert practitioner_result["appointment_conflict"] is None
        assert practitioner_result["exception_conflict"] is None

    def test_check_scheduling_conflicts_past_appointment_priority(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that past appointment takes priority over other conflicts."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        past_date = (taiwan_now() - timedelta(days=1)).date()
        day_of_week = past_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create existing appointment at the same time (would normally cause appointment conflict)
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=past_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict - should show past_appointment (highest priority), not appointment conflict
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": past_date.isoformat(),
                "start_time": "10:15",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        # Should show past_appointment (highest priority), but also include appointment conflict
        assert practitioner_result["has_conflict"] is True
        assert practitioner_result["conflict_type"] == "past_appointment"  # Highest priority for backward compatibility
        # With new behavior, all conflicts are returned, so appointment_conflict should be populated
        assert practitioner_result["appointment_conflict"] is not None

    def test_check_scheduling_conflicts_appointment_conflict(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking scheduling conflicts - appointment conflict (highest priority)."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create existing appointment
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict at overlapping time
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

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        assert practitioner_result["has_conflict"] is True
        assert practitioner_result["conflict_type"] == "appointment"
        assert practitioner_result["appointment_conflict"] is not None
        assert practitioner_result["appointment_conflict"]["patient_name"] == "Existing Patient"
        assert practitioner_result["appointment_conflict"]["start_time"] == "10:00"
        assert practitioner_result["appointment_conflict"]["end_time"] == "10:30"
        assert practitioner_result["exception_conflict"] is None

    def test_check_scheduling_conflicts_exception_conflict(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking scheduling conflicts - availability exception conflict (medium priority)."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create availability exception
        exception_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="availability_exception",
            event_date=future_date,
            start_time=time(14, 0),
            end_time=time(16, 0),
            custom_event_name="個人請假"
        )
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=exception_event.id
        )
        db_session.add(exception)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict at overlapping time
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": future_date.isoformat(),
                "start_time": "14:30",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        assert practitioner_result["has_conflict"] is True
        assert practitioner_result["conflict_type"] == "exception"
        assert practitioner_result["exception_conflict"] is not None
        assert practitioner_result["exception_conflict"]["start_time"] == "14:00"
        assert practitioner_result["exception_conflict"]["end_time"] == "16:00"
        assert practitioner_result["exception_conflict"]["reason"] == "個人請假"
        assert practitioner_result["appointment_conflict"] is None

    def test_check_scheduling_conflicts_outside_availability(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking scheduling conflicts - outside default availability (lowest priority)."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability (9 AM to 5 PM)
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict outside normal hours (8 AM)
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": future_date.isoformat(),
                "start_time": "08:00",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        assert practitioner_result["has_conflict"] is True
        assert practitioner_result["conflict_type"] == "availability"
        assert practitioner_result["default_availability"]["is_within_hours"] is False
        assert practitioner_result["default_availability"]["normal_hours"] is not None
        assert "09:00" in practitioner_result["default_availability"]["normal_hours"]
        assert practitioner_result["appointment_conflict"] is None
        assert practitioner_result["exception_conflict"] is None

    def test_check_scheduling_conflicts_no_conflict(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking scheduling conflicts - no conflict."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict at available time
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": future_date.isoformat(),
                "start_time": "11:00",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        assert practitioner_result["has_conflict"] is False
        assert practitioner_result["conflict_type"] is None
        assert practitioner_result["default_availability"]["is_within_hours"] is True
        assert practitioner_result["appointment_conflict"] is None
        assert practitioner_result["exception_conflict"] is None

    def test_check_scheduling_conflicts_exclude_calendar_event(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking scheduling conflicts with exclude_calendar_event_id (for editing appointments)."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create existing appointment
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict at same time but excluding the existing appointment
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id, "exclude_calendar_event_id": existing_event.id}],
                "date": future_date.isoformat(),
                "start_time": "10:00",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        # Should not show conflict since we're excluding the existing appointment
        assert practitioner_result["has_conflict"] is False
        assert practitioner_result["conflict_type"] is None

    def test_check_scheduling_conflicts_priority_order(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that appointment conflicts take priority over exception conflicts."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create availability exception
        exception_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="availability_exception",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(12, 0),
            custom_event_name="個人請假"
        )
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=exception_event.id
        )
        db_session.add(exception)
        db_session.flush()

        # Create appointment that overlaps with exception
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 30),
            end_time=time(11, 0)
        )
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict - should show appointment conflict (higher priority)
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": future_date.isoformat(),
                "start_time": "10:45",
                "appointment_type_id": appointment_type.id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["results"]) == 1
        practitioner_result = data["results"][0]

        # Should show appointment conflict (highest priority), but also include exception conflict
        assert practitioner_result["has_conflict"] is True
        assert practitioner_result["conflict_type"] == "appointment"  # Highest priority for backward compatibility
        assert practitioner_result["appointment_conflict"] is not None
        # With new behavior, all conflicts are returned, so exception_conflict should be populated
        assert practitioner_result["exception_conflict"] is not None


class TestRecurringConflicts:
    """Test recurring appointment conflict detection endpoint."""

    def test_check_recurring_conflicts_past_appointment(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking recurring conflicts - past appointment."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability for both past and future dates
        past_date = (taiwan_now() - timedelta(days=1)).date()
        future_date = (taiwan_now() + timedelta(days=2)).date()
        past_day_of_week = past_date.weekday()
        future_day_of_week = future_date.weekday()
        
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=past_day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        if future_day_of_week != past_day_of_week:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic,
                day_of_week=future_day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking recurring conflicts with past appointment
        from utils.datetime_utils import TAIWAN_TZ
        from datetime import datetime
        past_time = datetime.combine(past_date, time(10, 0)).replace(tzinfo=TAIWAN_TZ)
        future_time = datetime.combine(future_date, time(11, 0)).replace(tzinfo=TAIWAN_TZ)
        
        response = client.post(
            "/api/clinic/appointments/check-recurring-conflicts",
            json={
                "practitioner_id": practitioner.id,
                "appointment_type_id": appointment_type.id,
                "occurrences": [
                    past_time.isoformat(),
                    future_time.isoformat()
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["occurrences"]) == 2
        
        # First occurrence has past_appointment conflict
        occ1 = data["occurrences"][0]
        assert occ1["has_conflict"] is True
        assert occ1["conflict_type"] == "past_appointment"
        assert occ1["appointment_conflict"] is None
        assert occ1["exception_conflict"] is None
        assert occ1["is_duplicate"] is False
        
        # Second occurrence has no conflict
        occ2 = data["occurrences"][1]
        assert occ2["has_conflict"] is False
        assert occ2["conflict_type"] is None
        assert occ2["appointment_conflict"] is None
        assert occ2["exception_conflict"] is None
        assert occ2["is_duplicate"] is False

    def test_check_recurring_conflicts_appointment_conflict(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking recurring conflicts - appointment conflict."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create existing appointment
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking recurring conflicts
        from utils.datetime_utils import TAIWAN_TZ
        from datetime import datetime
        conflict_time = datetime.combine(future_date, time(10, 15)).replace(tzinfo=TAIWAN_TZ)
        no_conflict_time = datetime.combine(future_date, time(11, 0)).replace(tzinfo=TAIWAN_TZ)
        
        response = client.post(
            "/api/clinic/appointments/check-recurring-conflicts",
            json={
                "practitioner_id": practitioner.id,
                "appointment_type_id": appointment_type.id,
                "occurrences": [
                    conflict_time.isoformat(),
                    no_conflict_time.isoformat()
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["occurrences"]) == 2
        
        # First occurrence has conflict
        occ1 = data["occurrences"][0]
        assert occ1["has_conflict"] is True
        assert occ1["conflict_type"] == "appointment"
        assert occ1["appointment_conflict"] is not None
        assert occ1["appointment_conflict"]["patient_name"] == "Existing Patient"
        assert occ1["appointment_conflict"]["start_time"] == "10:00"
        assert occ1["appointment_conflict"]["end_time"] == "10:30"
        assert occ1["exception_conflict"] is None
        assert occ1["is_duplicate"] is False
        
        # Second occurrence has no conflict
        occ2 = data["occurrences"][1]
        assert occ2["has_conflict"] is False
        assert occ2["conflict_type"] is None
        assert occ2["appointment_conflict"] is None
        assert occ2["exception_conflict"] is None
        assert occ2["is_duplicate"] is False

    def test_check_recurring_conflicts_exception_conflict(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking recurring conflicts - exception conflict."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create availability exception
        exception_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="availability_exception",
            event_date=future_date,
            start_time=time(14, 0),
            end_time=time(16, 0),
            custom_event_name="個人請假"
        )
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=exception_event.id
        )
        db_session.add(exception)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking recurring conflicts
        from utils.datetime_utils import TAIWAN_TZ
        from datetime import datetime
        conflict_time = datetime.combine(future_date, time(14, 30)).replace(tzinfo=TAIWAN_TZ)
        
        response = client.post(
            "/api/clinic/appointments/check-recurring-conflicts",
            json={
                "practitioner_id": practitioner.id,
                "appointment_type_id": appointment_type.id,
                "occurrences": [conflict_time.isoformat()]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["occurrences"]) == 1
        occ = data["occurrences"][0]
        assert occ["has_conflict"] is True
        assert occ["conflict_type"] == "exception"
        assert occ["exception_conflict"] is not None
        assert occ["exception_conflict"]["start_time"] == "14:00"
        assert occ["exception_conflict"]["end_time"] == "16:00"
        assert occ["exception_conflict"]["reason"] == "個人請假"
        assert occ["appointment_conflict"] is None

    def test_check_recurring_conflicts_outside_availability(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking recurring conflicts - outside default availability."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability (9 AM to 5 PM)
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking conflict outside normal hours (8 AM)
        from utils.datetime_utils import TAIWAN_TZ
        from datetime import datetime
        conflict_time = datetime.combine(future_date, time(8, 0)).replace(tzinfo=TAIWAN_TZ)
        
        response = client.post(
            "/api/clinic/appointments/check-recurring-conflicts",
            json={
                "practitioner_id": practitioner.id,
                "appointment_type_id": appointment_type.id,
                "occurrences": [conflict_time.isoformat()]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["occurrences"]) == 1
        occ = data["occurrences"][0]
        assert occ["has_conflict"] is True
        assert occ["conflict_type"] == "availability"
        assert occ["default_availability"]["is_within_hours"] is False
        assert occ["default_availability"]["normal_hours"] is not None
        assert "09:00" in occ["default_availability"]["normal_hours"]
        assert occ["appointment_conflict"] is None
        assert occ["exception_conflict"] is None

    def test_check_recurring_conflicts_duplicate(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking recurring conflicts - duplicate occurrences."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking duplicate occurrences
        from utils.datetime_utils import TAIWAN_TZ
        from datetime import datetime
        same_time = datetime.combine(future_date, time(11, 0)).replace(tzinfo=TAIWAN_TZ)
        
        response = client.post(
            "/api/clinic/appointments/check-recurring-conflicts",
            json={
                "practitioner_id": practitioner.id,
                "appointment_type_id": appointment_type.id,
                "occurrences": [
                    same_time.isoformat(),
                    same_time.isoformat()  # Duplicate
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["occurrences"]) == 2
        
        # First occurrence - duplicate
        occ1 = data["occurrences"][0]
        assert occ1["has_conflict"] is True
        assert occ1["conflict_type"] == "duplicate"
        assert occ1["is_duplicate"] is True
        assert occ1["duplicate_index"] == 1
        
        # Second occurrence - duplicate
        occ2 = data["occurrences"][1]
        assert occ2["has_conflict"] is True
        assert occ2["conflict_type"] == "duplicate"
        assert occ2["is_duplicate"] is True
        assert occ2["duplicate_index"] == 0

    def test_check_recurring_conflicts_mixed(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test checking recurring conflicts - mixed conflict types."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30,
            scheduling_buffer_minutes=0
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create default availability
        future_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.flush()

        # Create existing appointment
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        existing_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        existing_appointment = Appointment(
            calendar_event_id=existing_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(existing_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test checking mixed conflicts
        from utils.datetime_utils import TAIWAN_TZ
        from datetime import datetime
        appointment_conflict_time = datetime.combine(future_date, time(10, 15)).replace(tzinfo=TAIWAN_TZ)
        outside_availability_time = datetime.combine(future_date, time(8, 0)).replace(tzinfo=TAIWAN_TZ)
        no_conflict_time = datetime.combine(future_date, time(11, 0)).replace(tzinfo=TAIWAN_TZ)
        
        response = client.post(
            "/api/clinic/appointments/check-recurring-conflicts",
            json={
                "practitioner_id": practitioner.id,
                "appointment_type_id": appointment_type.id,
                "occurrences": [
                    appointment_conflict_time.isoformat(),
                    outside_availability_time.isoformat(),
                    no_conflict_time.isoformat()
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["occurrences"]) == 3
        
        # First: appointment conflict
        assert data["occurrences"][0]["has_conflict"] is True
        assert data["occurrences"][0]["conflict_type"] == "appointment"
        assert data["occurrences"][0]["appointment_conflict"] is not None
        
        # Second: outside availability
        assert data["occurrences"][1]["has_conflict"] is True
        assert data["occurrences"][1]["conflict_type"] == "availability"
        assert data["occurrences"][1]["default_availability"]["is_within_hours"] is False
        
        # Third: no conflict
        assert data["occurrences"][2]["has_conflict"] is False
        assert data["occurrences"][2]["conflict_type"] is None


class TestBatchSchedulingConflicts:
    """Integration tests for batch scheduling conflict detection endpoint."""

    def test_batch_conflicts_empty_practitioners(self, client: TestClient, test_clinic_and_practitioner):
        """Test batch conflicts with empty practitioner list."""
        clinic, practitioner = test_clinic_and_practitioner
        token = get_auth_token(client, practitioner.email)

        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [],
                "date": "2024-01-15",
                "start_time": "10:00",
                "appointment_type_id": 1
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422  # Validation error

    def test_batch_conflicts_validation(self, client: TestClient, test_clinic_and_practitioner):
        """Test batch conflicts validation."""
        clinic, practitioner = test_clinic_and_practitioner
        token = get_auth_token(client, practitioner.email)

        # Test too many practitioners
        practitioners = [{"user_id": i} for i in range(11)]
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": practitioners,
                "date": "2024-01-15",
                "start_time": "10:00",
                "appointment_type_id": 1
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422  # Validation error



    def test_batch_conflicts_validation(self, client: TestClient, test_clinic_and_practitioner):
        """Test batch conflicts validation."""
        clinic, practitioner = test_clinic_and_practitioner
        token = get_auth_token(client, practitioner.email)

        # Test too many practitioners
        practitioners = [{"user_id": i} for i in range(11)]
        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": practitioners,
                "date": "2024-01-15",
                "start_time": "10:00",
                "appointment_type_id": 1
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422  # Validation error

    def test_batch_conflicts_invalid_time(self, client: TestClient, test_clinic_and_practitioner):
        """Test batch conflicts with invalid time format."""
        clinic, practitioner = test_clinic_and_practitioner
        token = get_auth_token(client, practitioner.email)

        response = client.post(
            "/api/clinic/practitioners/availability/conflicts/batch",
            json={
                "practitioners": [{"user_id": practitioner.id}],
                "date": "2024-01-15",
                "start_time": "25:00",  # Invalid hour
                "appointment_type_id": 1
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 400
