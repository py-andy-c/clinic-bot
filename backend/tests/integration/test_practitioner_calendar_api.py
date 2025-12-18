"""
Integration tests for practitioner calendar API endpoints.

Tests the new calendar management functionality including:
- Default schedule management
- Calendar data retrieval
- Availability exception management
- Available slots for AI agent booking
"""

import pytest
from datetime import date, time, datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from utils.datetime_utils import taiwan_now
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, AvailabilityException, Appointment, ResourceType, Resource, AppointmentResourceAllocation
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


class TestPractitionerCalendarAPI:
    """Test practitioner calendar API endpoints."""

    def test_get_default_schedule(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test getting practitioner's default schedule."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create default availability
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=0,  # Monday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=0,  # Monday
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting default schedule
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/default",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert "monday" in data
        assert len(data["monday"]) == 2
        assert data["monday"][0]["start_time"] == "09:00"
        assert data["monday"][0]["end_time"] == "12:00"
        assert data["monday"][1]["start_time"] == "14:00"
        assert data["monday"][1]["end_time"] == "18:00"

    def test_update_default_schedule(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test updating practitioner's default schedule."""
        clinic, practitioner = test_clinic_and_practitioner

        # Test updating default schedule
        schedule_data = {
            "monday": [
                {"start_time": "09:00", "end_time": "12:00"},
                {"start_time": "14:00", "end_time": "18:00"}
            ],
            "tuesday": [
                {"start_time": "09:00", "end_time": "17:00"}
            ],
            "wednesday": [],
            "thursday": [],
            "friday": [],
            "saturday": [],
            "sunday": []
        }

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        response = client.put(
            f"/api/clinic/practitioners/{practitioner.id}/availability/default",
            json=schedule_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert len(data["monday"]) == 2
        assert len(data["tuesday"]) == 1
        assert len(data["wednesday"]) == 0

        # Verify database was updated
        monday_availability = db_session.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == practitioner.id,
            PractitionerAvailability.day_of_week == 0
        ).all()
        assert len(monday_availability) == 2

    def test_get_calendar_monthly_view(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test getting calendar data for monthly view."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create calendar event and appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting monthly calendar data
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?month=2025-01",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert data["month"] == "2025-01"
        assert len(data["days"]) == 1
        assert data["days"][0]["date"] == "2025-01-15"
        assert data["days"][0]["appointment_count"] == 1

    def test_get_calendar_daily_view(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test getting calendar data for daily view."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create default availability
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create calendar event and appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)

        # Create availability exception
        exception_calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="availability_exception",
            event_date=date(2025, 1, 15),
            start_time=time(17, 0),
            end_time=time(18, 0)
        )
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=exception_calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting daily calendar data
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?date=2025-01-15",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert data["date"] == "2025-01-15"
        assert len(data["default_schedule"]) == 1
        assert len(data["events"]) == 2
        
        # Check appointment event
        appointment_event = next(e for e in data["events"] if e["type"] == "appointment")
        assert appointment_event["start_time"] == "10:00"
        assert appointment_event["end_time"] == "11:00"
        assert appointment_event["title"] == "Test Patient - Test Appointment"
        
        # Check exception event
        exception_event = next(e for e in data["events"] if e["type"] == "availability_exception")
        assert exception_event["start_time"] == "17:00"
        assert exception_event["end_time"] == "18:00"
        assert exception_event["title"] == "休診"


    def test_get_available_slots(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test getting available slots for AI agent booking."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create default availability for future date
        future_date = (taiwan_now() + timedelta(days=5)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Associate practitioner with appointment type (required for availability check)
        from models import PractitionerAppointmentTypes
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.flush()

        # Create a patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.flush()

        # Create existing appointment (use future date)
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,  # Use the created patient ID
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting available slots (use same future date)
        future_date_str = future_date.isoformat()
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/slots?date={future_date_str}&appointment_type_id={appointment_type.id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert "available_slots" in data
        # Should have slots before 10:00 and after 11:00
        slots = data["available_slots"]
        assert len(slots) > 0
        
        # Check that 10:00-11:00 slot is not available (occupied)
        occupied_slot = next((s for s in slots if s["start_time"] == "10:00"), None)
        assert occupied_slot is None

    def test_create_availability_exception(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test creating availability exception."""
        clinic, practitioner = test_clinic_and_practitioner

        # Test creating availability exception
        exception_data = {
            "date": "2025-01-15",
            "start_time": "14:00",
            "end_time": "18:00"
        }

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        response = client.post(
            f"/api/clinic/practitioners/{practitioner.id}/availability/exceptions",
            json=exception_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.json()
        
        assert "calendar_event_id" in data
        assert "exception_id" in data
        assert data["date"] == "2025-01-15"
        assert data["start_time"] == "14:00"
        assert data["end_time"] == "18:00"

        # Verify database was updated
        calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == data["calendar_event_id"]
        ).first()
        assert calendar_event is not None
        assert calendar_event.event_type == "availability_exception"

    def test_create_availability_exception_with_conflicts(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test creating availability exception with appointment conflicts."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create existing appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(15, 0),
            end_time=time(16, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Test creating availability exception that conflicts with appointment
        exception_data = {
            "date": "2025-01-15",
            "start_time": "14:00",
            "end_time": "18:00"
        }

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        response = client.post(
            f"/api/clinic/practitioners/{practitioner.id}/availability/exceptions",
            json=exception_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.json()
        
        # Should return warning about conflicts
        assert "success" in data
        assert data["success"] == False
        assert "message" in data
        assert "conflicts" in data
        assert len(data["conflicts"]) > 0

    def test_delete_availability_exception(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test deleting availability exception."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create availability exception
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="availability_exception",
            event_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        exception_id = exception.id

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test deleting availability exception
        response = client.delete(
            f"/api/clinic/practitioners/{practitioner.id}/availability/exceptions/{exception.id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 204

        # Verify database was updated
        deleted_exception = db_session.query(AvailabilityException).filter(
            AvailabilityException.id == exception_id
        ).first()
        assert deleted_exception is None

        # Calendar event should also be deleted due to cascade
        deleted_calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == calendar_event.id
        ).first()
        assert deleted_calendar_event is None

    def test_daily_calendar_view_filters_cancelled_appointments(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that daily calendar view only shows confirmed appointments."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Confirmed Patient",
            phone_number="1234567890"
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Cancelled Patient",
            phone_number="0987654321"
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.flush()

        # Create confirmed appointment (use future date)
        future_date = (taiwan_now() + timedelta(days=5)).date()
        confirmed_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        confirmed_appointment = Appointment(
            calendar_event_id=confirmed_event.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(confirmed_appointment)

        # Create cancelled appointment
        cancelled_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(11, 0),
            end_time=time(12, 0)
        )
        db_session.flush()

        cancelled_appointment = Appointment(
            calendar_event_id=cancelled_event.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            status="canceled_by_patient"
        )
        db_session.add(cancelled_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting daily calendar data (use same future date)
        future_date_str = future_date.isoformat()
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?date={future_date_str}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        # Should only show confirmed appointment, not cancelled one
        appointment_events = [e for e in data["events"] if e["type"] == "appointment"]
        assert len(appointment_events) == 1
        assert appointment_events[0]["title"] == "Confirmed Patient - Test Appointment"
        assert appointment_events[0]["status"] == "confirmed"

    def test_monthly_calendar_view_excludes_cancelled_appointments(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that monthly calendar view only counts confirmed appointments."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Confirmed Patient",
            phone_number="1234567890"
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Cancelled Patient",
            phone_number="0987654321"
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.flush()

        # Create confirmed appointment on 2025-01-15
        confirmed_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        confirmed_appointment = Appointment(
            calendar_event_id=confirmed_event.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(confirmed_appointment)

        # Create cancelled appointment on same date
        cancelled_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(11, 0),
            end_time=time(12, 0)
        )
        db_session.add(cancelled_event)
        db_session.flush()

        cancelled_appointment = Appointment(
            calendar_event_id=cancelled_event.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            status="canceled_by_clinic"
        )
        db_session.add(cancelled_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting monthly calendar data
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?month=2025-01",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        # Should only count confirmed appointment, not cancelled one
        day_data = next((d for d in data["days"] if d["date"] == "2025-01-15"), None)
        assert day_data is not None
        assert day_data["appointment_count"] == 1  # Only confirmed appointment

    def test_available_slots_exclude_cancelled_appointments(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that cancelled appointments don't block available slots."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create default availability for future date
        future_date = (taiwan_now() + timedelta(days=5)).date()
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Associate practitioner with appointment type (required for availability check)
        from models import PractitionerAppointmentTypes
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.flush()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Cancelled Patient",
            phone_number="1234567890"
        )
        db_session.add(patient1)
        db_session.flush()

        # Create cancelled appointment at 10:00-11:00 (use future date)
        cancelled_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        cancelled_appointment = Appointment(
            calendar_event_id=cancelled_event.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="canceled_by_patient"
        )
        db_session.add(cancelled_appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test getting available slots (use same future date)
        future_date_str = future_date.isoformat()
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/slots?date={future_date_str}&appointment_type_id={appointment_type.id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        # Should have slots at 10:00-11:00 since the appointment is cancelled
        slots = data["available_slots"]
        assert len(slots) > 0
        
        # Check that 10:00 slot is available (cancelled appointment doesn't block it)
        available_10am_slot = next((s for s in slots if s["start_time"] == "10:00"), None)
        assert available_10am_slot is not None, "10:00 slot should be available since appointment is cancelled"

    def test_practitioner_can_view_other_practitioner_calendar(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that a practitioner can view another practitioner's calendar."""
        clinic, practitioner1 = test_clinic_and_practitioner
        
        # Create second practitioner
        practitioner2, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Dr. Second",
            email="practitioner2@example.com",
            google_subject_id="practitioner2_subject",
            roles=["practitioner"],
            is_active=True
        )
        db_session.flush()
        
        # Create appointment for practitioner2
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()
        
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()
        
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner2, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Get authentication token for practitioner1
        token = get_auth_token(client, practitioner1.email)
        
        # Test getting calendar data for practitioner2 (should succeed)
        response = client.get(
            f"/api/clinic/practitioners/{practitioner2.id}/availability/calendar?date=2025-01-15",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["date"] == "2025-01-15"
        assert len(data["events"]) == 1
        assert data["events"][0]["type"] == "appointment"

    def test_non_practitioner_can_view_practitioner_calendar(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that a non-practitioner (admin/read-only) can view a practitioner's calendar."""
        clinic, practitioner = test_clinic_and_practitioner
        
        # Create non-practitioner user (admin)
        admin, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Admin User",
            email="admin@example.com",
            google_subject_id="admin_subject",
            roles=["admin"],
            is_active=True
        )
        db_session.flush()
        
        # Create appointment for practitioner
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()
        
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()
        
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Get authentication token for admin
        token = get_auth_token(client, admin.email)
        
        # Test getting calendar data for practitioner (should succeed)
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?date=2025-01-15",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["date"] == "2025-01-15"
        assert len(data["events"]) == 1
        assert data["events"][0]["type"] == "appointment"

    def test_practitioner_can_view_own_calendar(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that a practitioner can still view their own calendar (backward compatibility)."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment for practitioner
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token for practitioner
        token = get_auth_token(client, practitioner.email)

        # Test getting calendar data for own calendar (should succeed)
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?date=2025-01-15",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["date"] == "2025-01-15"
        assert len(data["events"]) == 1
        assert data["events"][0]["type"] == "appointment"
        assert data["events"][0]["title"] == "Test Patient - Test Appointment"

    def test_calendar_api_includes_is_auto_assigned_for_auto_assigned_appointment(
        self, client: TestClient, db_session: Session, test_clinic_and_practitioner
    ):
        """Test that calendar API response includes is_auto_assigned field for auto-assigned appointments."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create auto-assigned appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=True  # Mark as auto-assigned
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token for practitioner
        token = get_auth_token(client, practitioner.email)

        # Test getting calendar data
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?date=2025-01-15",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["date"] == "2025-01-15"
        # Auto-assigned appointments should NOT appear in practitioner calendar (they're hidden)
        assert len(data["events"]) == 0

    def test_calendar_api_includes_is_auto_assigned_false_for_manually_assigned_appointment(
        self, client: TestClient, db_session: Session, test_clinic_and_practitioner
    ):
        """Test that calendar API response includes is_auto_assigned=False for manually assigned appointments."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create manually assigned appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            is_auto_assigned=False  # Manually assigned
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token for practitioner
        token = get_auth_token(client, practitioner.email)

        # Test getting calendar data
        response = client.get(
            f"/api/clinic/practitioners/{practitioner.id}/availability/calendar?date=2025-01-15",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["date"] == "2025-01-15"
        assert len(data["events"]) == 1
        assert data["events"][0]["type"] == "appointment"
        assert data["events"][0]["is_auto_assigned"] is False

    def test_admin_can_edit_other_practitioner_appointment_via_api(
        self, client: TestClient, db_session: Session, test_clinic_and_practitioner
    ):
        """Test that admin can edit appointments belonging to other practitioners via API."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create admin user
        admin, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Admin User",
            email="admin@example.com",
            google_subject_id="admin_subject",
            roles=["admin"],
            is_active=True
        )
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Associate practitioner with appointment type
        from models import PractitionerAppointmentTypes
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.flush()

        # Create availability for practitioner (9 AM - 6 PM on Wednesday, which is 2025-01-15)
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(18, 0)
        )
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create appointment for practitioner
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token for admin
        admin_token = get_auth_token(client, admin.email)

        # Admin edits the appointment (changes time to 11:00, which is within availability)
        edit_data = {
            "start_time": "2025-01-15T11:00:00+08:00"
        }
        response = client.put(
            f"/api/clinic/appointments/{calendar_event.id}",
            json=edit_data,
            headers={"Authorization": f"Bearer {admin_token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify appointment was updated
        db_session.refresh(appointment)
        assert appointment.calendar_event.start_time == time(11, 0)

    def test_batch_calendar_endpoint(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test batch calendar endpoint for multiple practitioners and date range."""
        clinic, practitioner1 = test_clinic_and_practitioner
        
        # Create a second practitioner
        practitioner2, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Dr. Test 2",
            email="practitioner2@example.com",
            google_subject_id="practitioner2_subject",
            roles=["practitioner"],
            is_active=True
        )
        db_session.flush()
        
        # Create a resource type and resource
        resource_type = ResourceType(clinic_id=clinic.id, name="Test Room")
        db_session.add(resource_type)
        db_session.flush()
        resource = Resource(resource_type_id=resource_type.id, clinic_id=clinic.id, name="Room 1")
        db_session.add(resource)
        db_session.flush()
        
        # Create appointments for both practitioners on different dates
        target_date1 = taiwan_now().date() + timedelta(days=1)
        target_date2 = taiwan_now().date() + timedelta(days=2)
        
        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.flush()
        
        # Create appointments
        event1 = create_calendar_event_with_clinic(
            db_session, practitioner1, clinic,
            event_type='appointment',
            event_date=target_date1,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()  # Flush to get event1.id
        appointment1 = Appointment(
            calendar_event_id=event1.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment1)
        
        event2 = create_calendar_event_with_clinic(
            db_session, practitioner2, clinic,
            event_type='appointment',
            event_date=target_date2,
            start_time=time(14, 0),
            end_time=time(14, 30)
        )
        db_session.flush()  # Flush to get event2.id
        appointment2 = Appointment(
            calendar_event_id=event2.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment2)
        
        # Allocate resource to appointment1
        allocation = AppointmentResourceAllocation(
            appointment_id=appointment1.calendar_event_id,
            resource_id=resource.id
        )
        db_session.add(allocation)
        
        db_session.commit()
        
        # Get authentication token
        token = get_auth_token(client, practitioner1.email)
        
        # Test batch endpoint
        response = client.post(
            "/api/clinic/practitioners/calendar/batch",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "practitioner_ids": [practitioner1.id, practitioner2.id],
                "start_date": target_date1.strftime('%Y-%m-%d'),
                "end_date": target_date2.strftime('%Y-%m-%d')
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 4  # 2 practitioners × 2 dates
        
        # Verify results contain data for both practitioners and dates
        result_dict = {(r["user_id"], r["date"]): r for r in data["results"]}
        
        # Check practitioner1 on date1
        assert (practitioner1.id, target_date1.strftime('%Y-%m-%d')) in result_dict
        result1 = result_dict[(practitioner1.id, target_date1.strftime('%Y-%m-%d'))]
        assert len(result1["events"]) == 1
        event = result1["events"][0]
        assert event["resource_names"] == ["Room 1"]
        assert event["resource_ids"] == [resource.id]
        assert result1["events"][0]["type"] == "appointment"
        
        # Check practitioner2 on date2
        assert (practitioner2.id, target_date2.strftime('%Y-%m-%d')) in result_dict
        result2 = result_dict[(practitioner2.id, target_date2.strftime('%Y-%m-%d'))]
        assert len(result2["events"]) == 1
        assert result2["events"][0]["type"] == "appointment"
        
        # Verify all results have default_schedule

    def test_batch_available_slots_endpoint(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test batch available slots endpoint for multiple dates."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Link appointment type to practitioner
        from models.practitioner_appointment_types import PractitionerAppointmentTypes
        practitioner_appt_type = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id
        )
        db_session.add(practitioner_appt_type)

        # Create default availability for Monday and Tuesday
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=0,  # Monday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.commit()

        # Calculate dates (next Monday and Tuesday)
        today = taiwan_now().date()
        days_until_monday = (0 - today.weekday()) % 7
        if days_until_monday == 0 and today.weekday() != 0:
            days_until_monday = 7
        monday = today + timedelta(days=days_until_monday)
        tuesday = monday + timedelta(days=1)

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test batch endpoint
        response = client.post(
            f"/api/clinic/practitioners/{practitioner.id}/availability/slots/batch",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "dates": [monday.strftime('%Y-%m-%d'), tuesday.strftime('%Y-%m-%d')],
                "appointment_type_id": appointment_type.id
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 2

        # Verify results contain date and available_slots
        result_dict = {r["date"]: r for r in data["results"]}
        assert monday.strftime('%Y-%m-%d') in result_dict
        assert tuesday.strftime('%Y-%m-%d') in result_dict

        monday_result = result_dict[monday.strftime('%Y-%m-%d')]
        assert "date" in monday_result
        assert "available_slots" in monday_result
        assert len(monday_result["available_slots"]) > 0

        tuesday_result = result_dict[tuesday.strftime('%Y-%m-%d')]
        assert "date" in tuesday_result
        assert "available_slots" in tuesday_result
        assert len(tuesday_result["available_slots"]) > 0

    def test_batch_available_slots_with_exclude_calendar_event_id(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test batch available slots endpoint with exclude_calendar_event_id for appointment editing."""
        clinic, practitioner = test_clinic_and_practitioner

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Link appointment type to practitioner
        from models.practitioner_appointment_types import PractitionerAppointmentTypes
        practitioner_appt_type = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id
        )
        db_session.add(practitioner_appt_type)

        # Create default availability for Monday
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=0,  # Monday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )

        # Calculate next Monday
        today = taiwan_now().date()
        days_until_monday = (0 - today.weekday()) % 7
        if days_until_monday == 0 and today.weekday() != 0:
            days_until_monday = 7
        monday = today + timedelta(days=days_until_monday)

        # Create an existing appointment on Monday at 10:00
        event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=monday,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        # Create patient and appointment
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token
        token = get_auth_token(client, practitioner.email)

        # Test batch endpoint without exclude - 10:00 slot should be missing
        response = client.post(
            f"/api/clinic/practitioners/{practitioner.id}/availability/slots/batch",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "dates": [monday.strftime('%Y-%m-%d')],
                "appointment_type_id": appointment_type.id
            }
        )

        assert response.status_code == 200
        data = response.json()
        result = data["results"][0]
        slots_without_exclude = [s["start_time"] for s in result["available_slots"]]
        assert "10:00" not in slots_without_exclude

        # Test batch endpoint with exclude - 10:00 slot should be available
        response = client.post(
            f"/api/clinic/practitioners/{practitioner.id}/availability/slots/batch",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "dates": [monday.strftime('%Y-%m-%d')],
                "appointment_type_id": appointment_type.id,
                "exclude_calendar_event_id": event.id
            }
        )

        assert response.status_code == 200
        data = response.json()
        result = data["results"][0]
        slots_with_exclude = [s["start_time"] for s in result["available_slots"]]
        assert "10:00" in slots_with_exclude

    # NOTE: Booking window filtering test has been moved to test_booking_restrictions.py
    # This keeps practitioner calendar API tests focused on API-specific functionality

    def test_practitioner_cannot_edit_other_practitioner_appointment_via_api(
        self, client: TestClient, db_session: Session, test_clinic_and_practitioner
    ):
        """Test that practitioner cannot edit appointments belonging to other practitioners via API."""
        clinic, practitioner1 = test_clinic_and_practitioner

        # Create another practitioner
        practitioner2, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Practitioner Two",
            email="practitioner2@example.com",
            google_subject_id="practitioner2_subject",
            roles=["practitioner"],
            is_active=True
        )
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="1234567890"
        )
        db_session.add(patient)
        db_session.flush()

        # Create appointment for practitioner1
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner1, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Get authentication token for practitioner2
        practitioner2_token = get_auth_token(client, practitioner2.email)

        # Practitioner2 tries to edit practitioner1's appointment (should fail)
        edit_data = {
            "start_time": "2025-01-15T11:00:00+08:00"
        }
        response = client.put(
            f"/api/clinic/appointments/{calendar_event.id}",
            json=edit_data,
            headers={"Authorization": f"Bearer {practitioner2_token}"}
        )

        assert response.status_code == 403
        assert "您只能編輯自己的預約" in response.json()["detail"]

        # Verify appointment was not changed
        db_session.refresh(appointment)
        assert appointment.calendar_event.start_time == time(10, 0)

    def test_update_appointment_event_name(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test updating appointment event name."""
        clinic, practitioner = test_clinic_and_practitioner
        
        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.flush()
        
        # Create appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Get authentication token
        token = get_auth_token(client, practitioner.email)
        
        # Update event name
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": "Custom Event Name"},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["event_name"] == "Custom Event Name"
        
        # Verify event name was updated
        db_session.refresh(calendar_event)
        assert calendar_event.custom_event_name == "Custom Event Name"
        
        # Test clearing event name (use default)
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": None},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        db_session.refresh(calendar_event)
        assert calendar_event.custom_event_name is None

    def test_update_availability_exception_event_name(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test updating availability exception event name."""
        clinic, practitioner = test_clinic_and_practitioner
        
        # Create availability exception
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="availability_exception",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()
        
        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()
        
        # Get authentication token
        token = get_auth_token(client, practitioner.email)
        
        # Update event name
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": "Custom 休診 Name"},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["event_name"] == "Custom 休診 Name"
        
        # Verify event name was updated
        db_session.refresh(calendar_event)
        assert calendar_event.custom_event_name == "Custom 休診 Name"

    def test_update_event_name_permissions(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test that practitioners can only update their own event names."""
        clinic, practitioner1 = test_clinic_and_practitioner
        
        # Create second practitioner
        practitioner2, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Dr. Test 2",
            email="practitioner2@example.com",
            google_subject_id="practitioner2_subject",
            roles=["practitioner"],
            is_active=True
        )
        db_session.flush()
        
        # Create appointment for practitioner1
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner1, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()
        
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()
        
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Practitioner2 tries to update practitioner1's event name
        token2 = get_auth_token(client, practitioner2.email)
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": "Unauthorized Update"},
            headers={"Authorization": f"Bearer {token2}"}
        )
        
        assert response.status_code == 403
        assert "您只能編輯自己的事件" in response.json()["detail"]
        
        # Admin can update any event
        admin, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Admin User",
            email="admin@example.com",
            google_subject_id="admin_subject",
            roles=["admin"],
            is_active=True
        )
        db_session.flush()
        
        admin_token = get_auth_token(client, admin.email)
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": "Admin Updated Name"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        db_session.refresh(calendar_event)
        assert calendar_event.custom_event_name == "Admin Updated Name"

    def test_update_event_name_validation(self, client: TestClient, db_session: Session, test_clinic_and_practitioner):
        """Test event name validation (max length)."""
        clinic, practitioner = test_clinic_and_practitioner
        
        # Create appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.flush()
        
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()
        
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        token = get_auth_token(client, practitioner.email)
        
        # Test name too long (over 100 characters)
        long_name = "a" * 101
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": long_name},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 422  # Validation error
        
        # Test empty string (should be treated as null)
        response = client.put(
            f"/api/clinic/calendar-events/{calendar_event.id}/event-name",
            json={"event_name": ""},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        db_session.refresh(calendar_event)
        assert calendar_event.custom_event_name is None
