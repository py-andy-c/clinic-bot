"""
Integration tests for LIFF API endpoints.

These tests simulate real user flows and interact with the database,
testing the complete LIFF-based appointment booking system.
"""

import pytest
import jwt
from datetime import datetime, timedelta, time
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import (
    Clinic, User, AppointmentType, PractitionerAppointmentTypes,
    Patient, LineUser, Appointment, CalendarEvent
)
from core.config import JWT_SECRET_KEY
from core.database import get_db
from auth.dependencies import get_current_line_user_with_clinic


client = TestClient(app)


def create_line_user_jwt(line_user_id: str, clinic_id: int) -> str:
    """Create a JWT token for LINE user authentication."""
    payload = {
        "line_user_id": line_user_id,
        "clinic_id": clinic_id,
        "exp": datetime.utcnow() + timedelta(hours=1),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")


@pytest.fixture
def test_clinic_with_liff(db_session: Session):
    """Create a test clinic with LIFF configuration."""
    clinic = Clinic(
        name="Test LIFF Clinic",
        line_channel_id="test_liff_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.commit()

    # Create practitioner
    practitioner = User(
        clinic_id=clinic.id,
        email="practitioner@liffclinic.com",
        google_subject_id="google_123_practitioner",
        full_name="Dr. Test Practitioner",
        roles=["practitioner"]
    )
    db_session.add(practitioner)

    # Create appointment types
    appt_types = []
    for name, duration in [("General Consultation", 30), ("Follow-up", 15), ("Physical Therapy", 60)]:
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name=name,
            duration_minutes=duration
        )
        db_session.add(appt_type)
        appt_types.append(appt_type)

    db_session.commit()

    # Associate practitioner with appointment types
    for appt_type in appt_types:
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)

    db_session.commit()

    return clinic, practitioner, appt_types


@pytest.fixture
def authenticated_line_user(db_session: Session, test_clinic_with_liff):
    """Create an authenticated LINE user with JWT token."""
    clinic, practitioner, appt_types = test_clinic_with_liff

    # Create LINE user
    line_user = LineUser(
        line_user_id="U_test_line_user_123",
        display_name="Test LINE User"
    )
    db_session.add(line_user)
    db_session.commit()

    # Create JWT token for LINE user
    token = create_line_user_jwt(line_user.line_user_id, clinic.id)

    return line_user, token, clinic


class TestLiffDatabaseOperations:
    """Test LIFF API database operations with mocked authentication."""

    def test_patient_creation_database_operations(self, db_session: Session, test_clinic_with_liff):
        """Test patient creation with direct database operations (mimicking LIFF flow)."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user directly (simulating LIFF login)
        line_user = LineUser(
            line_user_id="U_test_patient_creation",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # For first-time users, we need to establish clinic context
        # Create a primary patient directly in DB to establish clinic relationship
        primary_patient = Patient(
            clinic_id=clinic.id,
            full_name="Primary Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(primary_patient)
        db_session.commit()

        # Now test creating additional patients (not primary)
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test creating additional patient
            patient_data = {
                "full_name": "Additional Patient",
                "phone_number": "0912345679"
            }

            response = client.post("/api/liff/patients", json=patient_data)
            if response.status_code != 200:
                print(f"Error response: {response.status_code} - {response.text}")
            assert response.status_code == 200

            data = response.json()
            assert data["full_name"] == "Additional Patient"
            assert data["phone_number"] == "0912345679"

            # Verify database state
            patient = db_session.query(Patient).filter_by(
                full_name="Additional Patient",
                clinic_id=clinic.id
            ).first()
            assert patient is not None
            assert patient.phone_number == "0912345679"
            assert patient.line_user_id == line_user.id

            # Verify we now have 2 patients for this user
            patients_count = db_session.query(Patient).filter_by(
                line_user_id=line_user.id,
                clinic_id=clinic.id
            ).count()
            assert patients_count == 2

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_creation_database_operations(self, db_session: Session, test_clinic_with_liff):
        """Test appointment creation with database verification."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_appointment",
            display_name="Appointment User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Appointment Patient",
            phone_number="0911111111",
            line_user_id=None  # Will be set after adding to DB
        )
        db_session.add(patient)
        db_session.commit()

        # Link patient to line user
        patient.line_user_id = line_user.id
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Book appointment
            tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
            appointment_data = {
                "patient_id": patient.id,
                "appointment_type_id": appt_types[0].id,
                "practitioner_id": practitioner.id,
                "start_time": f"{tomorrow}T10:00:00+08:00",
                "notes": "Integration test appointment"
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200

            appointment_result = response.json()
            assert appointment_result["patient_name"] == "Appointment Patient"
            assert appointment_result["practitioner_name"] == practitioner.full_name
            assert appointment_result["notes"] == "Integration test appointment"

            # Verify database state (time is stored in UTC)
            calendar_event = db_session.query(CalendarEvent).filter(
                CalendarEvent.date == datetime.fromisoformat(tomorrow).date(),
                CalendarEvent.start_time == time(2, 0)  # 10:00 UTC+8 = 02:00 UTC
            ).first()
            assert calendar_event is not None
            assert calendar_event.user_id == practitioner.id
            assert calendar_event.event_type == "appointment"

            appointment = db_session.query(Appointment).filter_by(
                calendar_event_id=calendar_event.id
            ).first()
            assert appointment is not None
            assert appointment.patient_id == patient.id
            assert appointment.appointment_type_id == appt_types[0].id
            assert appointment.status == "confirmed"
            assert appointment.notes == "Integration test appointment"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_listing_database_operations(self, db_session: Session, test_clinic_with_liff):
        """Test appointment listing with database verification."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user and multiple patients with appointments
        line_user = LineUser(
            line_user_id="U_test_listing",
            display_name="Listing User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create two patients
        patients = []
        for i, name in enumerate(["Patient One", "Patient Two"]):
            patient = Patient(
                clinic_id=clinic.id,
                full_name=name,
                phone_number=f"091234567{i}",
                line_user_id=line_user.id
            )
            db_session.add(patient)
            patients.append(patient)
        db_session.commit()

        # Create appointments for both patients
        appointments_data = []
        for i, patient in enumerate(patients):
            # Create calendar event
            event_date = (datetime.now() + timedelta(days=i+1)).date()
            calendar_event = CalendarEvent(
                user_id=practitioner.id,
                event_type="appointment",
                date=event_date,
                start_time=time(14, 0),
                end_time=time(15, 0)
            )
            db_session.add(calendar_event)
            db_session.commit()

            # Create appointment
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appt_types[0].id,
                status="confirmed",
                notes=f"Appointment for {patient.full_name}"
            )
            db_session.add(appointment)
            appointments_data.append(appointment)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # List appointments
            response = client.get("/api/liff/appointments")
            assert response.status_code == 200

            appointments_list = response.json()["appointments"]
            assert len(appointments_list) == 2

            # Verify appointment details
            patient_names = {appt["patient_name"] for appt in appointments_list}
            assert patient_names == {"Patient One", "Patient Two"}

            # Verify notes are included
            notes = {appt["notes"] for appt in appointments_list}
            assert "Appointment for Patient One" in notes
            assert "Appointment for Patient Two" in notes

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_first_time_user_complete_flow(self, db_session: Session, test_clinic_with_liff):
        """Test complete first-time user flow: registration -> appointment booking."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user directly (simulating LIFF login)
        line_user = LineUser(
            line_user_id="U_complete_flow_123",
            display_name="李小華"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="李小華",
                phone_number="0987654321",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Step 2: Get appointment types
            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            appt_types_data = response.json()["appointment_types"]
            assert len(appt_types_data) == 3

            # Step 3: Check availability for 2 days from now (to ensure it's definitely in the future)
            future_date = (datetime.now() + timedelta(days=2)).date().isoformat()
            appt_type_id = appt_types_data[0]["id"]

            response = client.get(
                f"/api/liff/availability?date={future_date}&appointment_type_id={appt_type_id}"
            )
            assert response.status_code == 200
            availability = response.json()
            assert "slots" in availability
            assert len(availability["slots"]) > 0  # Should have available slots

            # Step 4: Book appointment using the first available slot
            slot = availability["slots"][0]
            appointment_data = {
                "patient_id": primary_patient.id,  # Use actual patient ID
                "appointment_type_id": appt_type_id,
                "practitioner_id": slot["practitioner_id"],
                "start_time": f"{future_date}T{slot['start_time']}:00+08:00",
                "notes": "First appointment booking"
            }

            response = client.post(
                "/api/liff/appointments",
                json=appointment_data
            )
            assert response.status_code == 200
            appointment_result = response.json()
            assert appointment_result["patient_name"] == "李小華"
            assert "notes" in appointment_result

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

        # Verify database state
        appointment = db_session.query(Appointment).filter_by(
            calendar_event_id=appointment_result["calendar_event_id"]
        ).first()
        assert appointment is not None
        assert appointment.notes == "First appointment booking"
        assert appointment.status == "confirmed"


class TestLiffReturningUserFlow:
    """Test flows for returning users with existing patient profiles."""

    def test_returning_user_lists_patients(self, db_session: Session, test_clinic_with_liff):
        """Test returning user can list their patients."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_list_patients_123",
            display_name="王先生"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="王先生",
                phone_number="0933333333",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patients
            patients_data = [
                {"full_name": "王小美", "phone_number": "0911111111"},
                {"full_name": "王爸爸", "phone_number": "0922222222"}
            ]

            for patient_data in patients_data:
                response = client.post("/api/liff/patients", json=patient_data)
                assert response.status_code == 200

            # List patients
            response = client.get("/api/liff/patients")
            assert response.status_code == 200
            patients_list = response.json()["patients"]
            assert len(patients_list) == 3  # 1 primary + 2 additional

            # Verify patients belong to correct user and clinic
            for patient in patients_list:
                db_patient = db_session.query(Patient).get(patient["id"])
                assert db_patient.line_user_id == line_user.id
                assert db_patient.clinic_id == clinic.id

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_returning_user_books_for_different_patients(self, db_session: Session, test_clinic_with_liff):
        """Test returning user can book appointments for different family members."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_books_different_123",
            display_name="陳先生"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="陳先生",
                phone_number="0955555555",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patients
            patients = []
            for name, phone in [("媽媽", "0933333333"), ("女兒", "0944444444")]:
                response = client.post(
                    "/api/liff/patients",
                    json={"full_name": name, "phone_number": phone}
                )
                patients.append(response.json())
                assert response.status_code == 200

            # Book appointment for first patient
            tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
            start_time = f"{tomorrow}T10:00:00+08:00"

            appointment_data = {
                "patient_id": patients[0]["patient_id"],  # Use patient_id from creation response
                "appointment_type_id": appt_types[0].id,
                "practitioner_id": practitioner.id,
                "start_time": start_time,
                "notes": "媽媽的預約"
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200
            assert response.json()["patient_name"] == "媽媽"

            # Book appointment for second patient
            appointment_data["patient_id"] = patients[1]["patient_id"]  # Use patient_id from creation response
            appointment_data["start_time"] = f"{tomorrow}T11:00:00+08:00"
            appointment_data["notes"] = "女兒的預約"

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200
            assert response.json()["patient_name"] == "女兒"

            # Verify both appointments exist
            appointments = db_session.query(Appointment).join(Patient).filter(
                Patient.line_user_id == line_user.id
            ).all()
            assert len(appointments) == 2

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_user_views_appointment_history(self, db_session: Session, test_clinic_with_liff):
        """Test user can view their appointment history across all patients."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_appointment_history_123",
            display_name="陳大華"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="Primary Patient",
                phone_number="0955555555",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Now test creating additional patients
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "陳大華", "phone_number": "0955555556"}
            )
            patient = response.json()

            # Book multiple appointments at different times - use dates definitely in the future
            appointments_data = [
                (f"{(datetime.now() + timedelta(days=3)).date().isoformat()}T09:00:00+08:00", "第一次看診"),
                (f"{(datetime.now() + timedelta(days=10)).date().isoformat()}T14:00:00+08:00", "第二次看診"),
            ]

            booked_appointments = []
            for start_time, notes in appointments_data:
                response = client.post(
                    "/api/liff/appointments",
                    json={
                        "patient_id": patient["patient_id"],  # Use patient_id from creation response
                        "appointment_type_id": appt_types[0].id,
                        "practitioner_id": practitioner.id,
                        "start_time": start_time,
                        "notes": notes
                    }
                )
                booked_appointments.append(response.json())

            # View all appointments
            response = client.get("/api/liff/appointments")
            assert response.status_code == 200
            appointments_list = response.json()["appointments"]
            assert len(appointments_list) == 2

            # Verify appointment details
            for appt in appointments_list:
                assert appt["patient_name"] == "陳大華"
                assert appt["practitioner_name"] == practitioner.full_name
                assert "notes" in appt

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_user_cancels_appointment(self, db_session: Session, test_clinic_with_liff):
        """Test user can cancel their appointments."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_cancel_appointment_123",
            display_name="林小薇"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="Primary Patient",
                phone_number="0966666666",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patient
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "林小薇", "phone_number": "0966666667"}
            )
            patient = response.json()

            # Book appointment
            tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": f"{tomorrow}T16:00:00+08:00",
                    "notes": "需要取消的預約"
                }
            )
            appointment = response.json()

            # Cancel appointment
            response = client.delete(f"/api/liff/appointments/{appointment['calendar_event_id']}")
            assert response.status_code == 200
            assert response.json()["message"] == "預約已取消"

            # Verify appointment status in database
            db_appointment = db_session.query(Appointment).get(appointment["appointment_id"])
            assert db_appointment.status == "canceled_by_patient"
            assert db_appointment.canceled_at is not None

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestLiffAvailabilityAndScheduling:
    """Test availability checking and intelligent scheduling."""

    def test_availability_shows_correct_slots(self, db_session: Session, test_clinic_with_liff):
        """Test availability API returns correct time slots."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_availability_test_123",
            display_name="Availability User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="Availability User",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
            appt_type_id = appt_types[0].id  # 30-minute consultation

            response = client.get(f"/api/liff/availability?date={tomorrow}&appointment_type_id={appt_type_id}")
            assert response.status_code == 200

            data = response.json()
            assert data["date"] == tomorrow
            assert "slots" in data

            # Should have available slots (9 AM to 5 PM in 30-minute increments)
            slots = data["slots"]
            assert len(slots) > 0

            # Verify slot structure
            for slot in slots:
                assert "start_time" in slot
                assert "end_time" in slot
                assert "practitioner_id" in slot
                assert "practitioner_name" in slot

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_booking_creates_correct_database_records(self, db_session: Session, test_clinic_with_liff):
        """Test that booking creates all necessary database records."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_booking_records_123",
            display_name="趙小龍"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="趙小龍",
                phone_number="0977777777",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patient for testing
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "陳小美", "phone_number": "0977777778"}
            )
            patient = response.json()

            # Book appointment
            tomorrow = (datetime.now() + timedelta(days=1)).date()
            start_time = f"{tomorrow.isoformat()}T10:30:00+08:00"

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[1].id,  # 15-minute follow-up
                    "practitioner_id": practitioner.id,
                    "start_time": start_time,
                    "notes": "跟進檢查"
                }
            )
            print(f"Appointment creation response: {response.status_code} - {response.text}")
            assert response.status_code == 200

            # Verify CalendarEvent was created (time is stored in UTC)
            calendar_event = db_session.query(CalendarEvent).filter(
                CalendarEvent.date == tomorrow,
                CalendarEvent.start_time == time(2, 30),  # 10:30 UTC+8 = 02:30 UTC
                CalendarEvent.user_id == practitioner.id
            ).first()
            assert calendar_event is not None
            assert calendar_event.event_type == "appointment"

            # Verify Appointment record
            appointment = db_session.query(Appointment).filter_by(
                calendar_event_id=calendar_event.id
            ).first()
            assert appointment is not None
            assert appointment.patient_id == patient["patient_id"]
            assert appointment.appointment_type_id == appt_types[1].id
            assert appointment.status == "confirmed"
            assert appointment.notes == "跟進檢查"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_practitioner_assignment_without_specification(self, db_session: Session, test_clinic_with_liff):
        """Test intelligent practitioner assignment when user doesn't specify."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_practitioner_assignment_123",
            display_name="孫小美"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="孫小美",
                phone_number="0988888888",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patient for testing
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "孫小華", "phone_number": "0988888889"}
            )
            patient = response.json()

            # Book without specifying practitioner
            tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": None,  # 不指定
                    "start_time": f"{tomorrow}T11:00:00+08:00",
                    "notes": "不指定治療師"
                }
            )
            assert response.status_code == 200

            # Verify appointment was assigned to the practitioner
            appointment_result = response.json()
            assert appointment_result["practitioner_name"] == practitioner.full_name

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestLiffErrorHandling:
    """Test error handling and validation in LIFF API."""

    def test_invalid_patient_id_returns_403(self, db_session: Session, test_clinic_with_liff):
        """Test that booking with invalid patient ID returns 403."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_error_test_123",
            display_name="Error Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="Error Test User",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": 99999,  # Non-existent patient
                    "appointment_type_id": 1,
                    "start_time": "2025-12-01T10:00:00+08:00",
                }
            )
            assert response.status_code == 403
            assert "Patient not found" in response.json()["detail"]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_past_appointment_returns_validation_error(self, db_session: Session, test_clinic_with_liff):
        """Test that booking appointments in the past fails."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_past_appointment_test_123",
            display_name="郭小華"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="郭小華",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patient for testing
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "郭小明"}
            )
            patient = response.json()

            # Try to book in the past
            past_time = (datetime.now() - timedelta(hours=1)).isoformat()

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": past_time,
                }
            )
            assert response.status_code == 422
            assert "Cannot book appointments in the past" in str(response.json())

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_double_booking_prevention(self, db_session: Session, test_clinic_with_liff):
        """Test that double booking at the same time is prevented."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_double_booking_test_123",
            display_name="錢小明"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="錢小明",
                phone_number="0999999999",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patient for testing
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "錢小華", "phone_number": "0999999998"}
            )
            patient = response.json()

            # Book first appointment
            tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
            start_time = f"{tomorrow}T13:00:00+08:00"

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": start_time,
                }
            )
            assert response.status_code == 200

            # Try to book at the same time - should fail
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "錢太太"}
            )
            patient2 = response.json()

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient2["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": start_time,  # Same time
                }
            )
            assert response.status_code == 409
            assert "時段已被預約" in response.json()["detail"]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_too_far_future_booking_rejected(self, db_session: Session, test_clinic_with_liff):
        """Test that booking too far in the future is rejected."""
        clinic, practitioner, appt_types = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_far_future_test_123",
            display_name="周小美"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient directly in DB to establish clinic context
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="周小美",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Create additional patient for testing
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "周小華"}
            )
            patient = response.json()

            # Try to book more than 90 days in future
            far_future = (datetime.now() + timedelta(days=100)).isoformat()

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": far_future,
                }
            )
            assert response.status_code == 422
            assert "Cannot book more than 90 days in advance" in str(response.json())

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)
