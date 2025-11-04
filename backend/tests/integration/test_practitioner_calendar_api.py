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
from models import User, Clinic, AppointmentType, Patient, PractitionerAvailability, CalendarEvent, AvailabilityException, Appointment
from core.database import get_db


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        return db_session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


class TestPractitionerCalendarAPI:
    """Test practitioner calendar API endpoints."""

    def test_get_default_schedule(self, client: TestClient, db_session: Session):
        """Test getting practitioner's default schedule."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create default availability
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=0,  # Monday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.add(availability)
        
        availability2 = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=0,  # Monday
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.add(availability2)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_update_default_schedule(self, client: TestClient, db_session: Session):
        """Test updating practitioner's default schedule."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

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

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_get_calendar_monthly_view(self, client: TestClient, db_session: Session):
        """Test getting calendar data for monthly view."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
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
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_get_calendar_daily_view(self, client: TestClient, db_session: Session):
        """Test getting calendar data for daily view."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create default availability
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=2,  # Wednesday
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.add(availability)
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
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)

        # Create availability exception
        exception_calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(17, 0),
            end_time=time(18, 0)
        )
        db_session.add(exception_calendar_event)
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=exception_calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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


    def test_get_available_slots(self, client: TestClient, db_session: Session):
        """Test getting available slots for AI agent booking."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create default availability for future date
        future_date = (datetime.now() + timedelta(days=5)).date()
        day_of_week = future_date.weekday()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.add(availability)
        db_session.flush()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,  # Use the created patient ID
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_create_availability_exception(self, client: TestClient, db_session: Session):
        """Test creating availability exception."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Test creating availability exception
        exception_data = {
            "date": "2025-01-15",
            "start_time": "14:00",
            "end_time": "18:00"
        }

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_create_availability_exception_with_conflicts(self, client: TestClient, db_session: Session):
        """Test creating availability exception with appointment conflicts."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
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

        # Create existing appointment
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(15, 0),
            end_time=time(16, 0)
        )
        db_session.add(calendar_event)
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

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        response = client.post(
            f"/api/clinic/practitioners/{practitioner.id}/availability/exceptions",
            json=exception_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.json()
        
        # Should return warning about conflicts
        assert "warning" in data
        assert data["warning"] == "appointment_conflicts"
        assert "conflicting_appointments" in data["details"]

    def test_update_availability_exception(self, client: TestClient, db_session: Session):
        """Test updating availability exception."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create availability exception
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.add(calendar_event)
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        # Test updating availability exception
        update_data = {
            "date": "2025-01-15",
            "start_time": "15:00",
            "end_time": "19:00"
        }

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

        response = client.put(
            f"/api/clinic/practitioners/{practitioner.id}/availability/exceptions/{exception.id}",
            json=update_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()
        
        assert data["start_time"] == "15:00"
        assert data["end_time"] == "19:00"

    def test_delete_availability_exception(self, client: TestClient, db_session: Session):
        """Test deleting availability exception."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create availability exception
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="availability_exception",
            date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(18, 0)
        )
        db_session.add(calendar_event)
        db_session.flush()

        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db_session.add(exception)
        db_session.commit()

        exception_id = exception.id

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_daily_calendar_view_filters_cancelled_appointments(self, client: TestClient, db_session: Session):
        """Test that daily calendar view only shows confirmed appointments."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

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
        future_date = (datetime.now() + timedelta(days=5)).date()
        confirmed_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(confirmed_event)
        db_session.flush()

        confirmed_appointment = Appointment(
            calendar_event_id=confirmed_event.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(confirmed_appointment)

        # Create cancelled appointment
        cancelled_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=future_date,
            start_time=time(11, 0),
            end_time=time(12, 0)
        )
        db_session.add(cancelled_event)
        db_session.flush()

        cancelled_appointment = Appointment(
            calendar_event_id=cancelled_event.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            status="canceled_by_patient"
        )
        db_session.add(cancelled_appointment)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_monthly_calendar_view_excludes_cancelled_appointments(self, client: TestClient, db_session: Session):
        """Test that monthly calendar view only counts confirmed appointments."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

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
        confirmed_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(confirmed_event)
        db_session.flush()

        confirmed_appointment = Appointment(
            calendar_event_id=confirmed_event.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(confirmed_appointment)

        # Create cancelled appointment on same date
        cancelled_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=date(2025, 1, 15),
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

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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

    def test_available_slots_exclude_cancelled_appointments(self, client: TestClient, db_session: Session):
        """Test that cancelled appointments don't block available slots."""
        # Create test clinic and practitioner
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@example.com",
            google_subject_id="practitioner_subject",
            full_name="Dr. Test",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        db_session.flush()

        # Create default availability for future date
        future_date = (datetime.now() + timedelta(days=5)).date()
        day_of_week = future_date.weekday()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(12, 0)
        )
        db_session.add(availability)
        db_session.flush()

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
            full_name="Cancelled Patient",
            phone_number="1234567890"
        )
        db_session.add(patient1)
        db_session.flush()

        # Create cancelled appointment at 10:00-11:00 (use future date)
        cancelled_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=future_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(cancelled_event)
        db_session.flush()

        cancelled_appointment = Appointment(
            calendar_event_id=cancelled_event.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            status="canceled_by_patient"
        )
        db_session.add(cancelled_appointment)
        db_session.commit()

        # Use dev login endpoint to get authentication
        response = client.post(f"/api/auth/dev/login?email={practitioner.email}&user_type=clinic_user")
        assert response.status_code == 200
        token = response.json()["access_token"]

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
