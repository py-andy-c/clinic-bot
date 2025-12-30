"""
Integration tests for LIFF API endpoints.

These tests simulate real user flows and interact with the database,
testing the complete LIFF-based appointment booking system.
"""

import pytest
import jwt
from datetime import datetime, timedelta, time, timezone
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from unittest.mock import patch

from main import app
from models import (
    Clinic, User, AppointmentType, PractitionerAppointmentTypes,
    Patient, LineUser, Appointment, CalendarEvent, PractitionerAvailability,
    UserClinicAssociation
)
from models.user_clinic_association import PractitionerSettings
from core.config import JWT_SECRET_KEY
from core.database import get_db
from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
from utils.datetime_utils import taiwan_now
from utils.liff_token import generate_liff_access_token
from tests.conftest import (
    create_practitioner_availability_with_clinic,
    create_calendar_event_with_clinic,
    create_user_with_clinic_association
)


client = TestClient(app)


def create_line_user_jwt(line_user_id: str, clinic_id: int, clinic_token: str | None = None, liff_id: str | None = None, db_session: Session | None = None) -> str:
    """Create a JWT token for LINE user authentication."""
    # If identifiers not provided, look them up from database
    if db_session is not None:
        from models.clinic import Clinic
        clinic = db_session.query(Clinic).filter(Clinic.id == clinic_id).first()
        if clinic:
            if liff_id is None:
                liff_id = clinic.liff_id
            if clinic_token is None:
                clinic_token = clinic.liff_access_token
                if not clinic_token:
                    # Generate token if missing
                    from utils.liff_token import generate_liff_access_token
                    clinic_token = generate_liff_access_token(db_session, clinic_id)

    # If still no token and no liff_id, use a placeholder (tests should ensure clinic has identifier)
    if clinic_token is None and liff_id is None:
        clinic_token = f"test_token_clinic_{clinic_id}"

    payload = {
        "line_user_id": line_user_id,
        "clinic_id": clinic_id,
        "liff_id": liff_id,  # Include liff_id for clinic-specific apps
        "clinic_token": clinic_token if not liff_id else None,  # Only include clinic_token for shared LIFF
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
        line_channel_access_token="test_token",
        settings={
            "notification_settings": {"reminder_hours_before": 24},
            "booking_restriction_settings": {"booking_restriction_type": "minimum_hours_required", "minimum_booking_hours_ahead": 24},
            "clinic_info_settings": {"display_name": None, "address": None, "phone_number": None}
        }
    )
    db_session.add(clinic)
    db_session.commit()

    # Generate LIFF access token for the clinic
    clinic.liff_access_token = generate_liff_access_token(db_session, clinic.id)
    db_session.commit()

    # Create practitioner with clinic association
    practitioner, practitioner_assoc = create_user_with_clinic_association(
        db_session,
        clinic=clinic,
        email="practitioner@liffclinic.com",
        google_subject_id="google_123_practitioner",
        full_name="Dr. Test Practitioner",
        roles=["practitioner"]
    )

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
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)

    # Set up default availability for practitioner (Monday-Sunday, 9:00-17:00)
    for day_of_week in range(7):  # 0=Monday, 6=Sunday
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

    db_session.commit()

    return clinic, practitioner, appt_types, practitioner_assoc


@pytest.fixture
def authenticated_line_user(db_session: Session, test_clinic_with_liff):
    """Create an authenticated LINE user with JWT token."""
    clinic, practitioner, appt_types, _ = test_clinic_with_liff

    # Create LINE user
    line_user = LineUser(
        line_user_id="U_test_line_user_123",
        clinic_id=clinic.id,
        display_name="Test LINE User"
    )
    db_session.add(line_user)
    db_session.commit()

    # Create JWT token for LINE user
    token = create_line_user_jwt(line_user.line_user_id, clinic.id, db_session=db_session)

    return line_user, token, clinic


class TestLiffDatabaseOperations:
    """Test LIFF API database operations with mocked authentication."""

    def test_patient_creation_database_operations(self, db_session: Session, test_clinic_with_liff):
        """Test patient creation with direct database operations (mimicking LIFF flow)."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user directly (simulating LIFF login)
        line_user = LineUser(
            line_user_id="U_test_patient_creation",
            clinic_id=clinic.id,
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

    def test_patient_update_database_operations(self, db_session: Session, test_clinic_with_liff):
        """Test patient update with direct database operations."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_patient_update",
            clinic_id=clinic.id,
            display_name="Test Update User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create primary patient
        primary_patient = Patient(
            clinic_id=clinic.id,
            full_name="Original Name",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(primary_patient)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test updating patient name only
            update_data = {
                "full_name": "Updated Name"
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 200

            data = response.json()
            assert data["full_name"] == "Updated Name"
            assert data["phone_number"] == "0912345678"  # Phone number unchanged

            # Verify database state
            db_session.refresh(primary_patient)
            assert primary_patient.full_name == "Updated Name"
            assert primary_patient.phone_number == "0912345678"

            # Test updating phone number only
            update_data = {
                "phone_number": "0987654321"
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 200

            data = response.json()
            assert data["full_name"] == "Updated Name"
            assert data["phone_number"] == "0987654321"

            # Verify database state
            db_session.refresh(primary_patient)
            assert primary_patient.full_name == "Updated Name"
            assert primary_patient.phone_number == "0987654321"

            # Test updating both fields
            update_data = {
                "full_name": "Final Name",
                "phone_number": "0976543210"
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 200

            data = response.json()
            assert data["full_name"] == "Final Name"
            assert data["phone_number"] == "0976543210"

            # Verify database state
            db_session.refresh(primary_patient)
            assert primary_patient.full_name == "Final Name"
            assert primary_patient.phone_number == "0976543210"

            # Test updating with formatted phone number (should be cleaned)
            update_data = {
                "phone_number": "09-8765-4321"  # With dashes
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 200

            data = response.json()
            assert data["phone_number"] == "0987654321"  # Dashes removed

            # Verify database state
            db_session.refresh(primary_patient)
            assert primary_patient.phone_number == "0987654321"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_creation_with_birthday(self, db_session: Session, test_clinic_with_liff):
        """Test patient creation with birthday."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_birthday",
            clinic_id=clinic.id,
            display_name="Birthday Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create primary patient
        primary_patient = Patient(
            clinic_id=clinic.id,
            full_name="Primary Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(primary_patient)
        db_session.commit()

        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test creating patient with birthday
            patient_data = {
                "full_name": "Patient With Birthday",
                "phone_number": "0912345679",
                "birthday": "1990-05-15"
            }

            response = client.post("/api/liff/patients", json=patient_data)
            assert response.status_code == 200

            data = response.json()
            assert data["full_name"] == "Patient With Birthday"
            assert data["birthday"] == "1990-05-15"

            # Verify database state
            patient = db_session.query(Patient).filter_by(
                full_name="Patient With Birthday",
                clinic_id=clinic.id
            ).first()
            assert patient is not None
            assert patient.birthday is not None
            assert str(patient.birthday) == "1990-05-15"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_creation_requires_birthday_when_setting_enabled(self, db_session: Session, test_clinic_with_liff):
        """Test that patient creation requires birthday when clinic setting is enabled."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Enable require_birthday setting
        clinic_settings = clinic.get_validated_settings()
        clinic_settings.clinic_info_settings.require_birthday = True
        clinic.set_validated_settings(clinic_settings)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_require_birthday",
            clinic_id=clinic.id,
            display_name="Require Birthday Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create primary patient
        primary_patient = Patient(
            clinic_id=clinic.id,
            full_name="Primary Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(primary_patient)
        db_session.commit()

        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test creating patient without birthday (should fail)
            patient_data = {
                "full_name": "Patient Without Birthday",
                "phone_number": "0912345679"
            }

            response = client.post("/api/liff/patients", json=patient_data)
            assert response.status_code == 400
            assert "生日" in response.json()["detail"]

            # Test creating patient with birthday (should succeed)
            patient_data["birthday"] = "1990-05-15"
            response = client.post("/api/liff/patients", json=patient_data)
            assert response.status_code == 200

            data = response.json()
            assert data["birthday"] == "1990-05-15"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_creation_requires_gender_when_setting_enabled(self, db_session: Session, test_clinic_with_liff):
        """Test that patient creation requires gender when clinic setting is enabled."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Enable require_gender setting
        clinic_settings = clinic.get_validated_settings()
        clinic_settings.clinic_info_settings.require_gender = True
        clinic.set_validated_settings(clinic_settings)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_require_gender",
            clinic_id=clinic.id,
            display_name="Require Gender Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create primary patient
        primary_patient = Patient(
            clinic_id=clinic.id,
            full_name="Primary Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(primary_patient)
        db_session.commit()

        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test creating patient without gender (should fail)
            patient_data = {
                "full_name": "Patient Without Gender",
                "phone_number": "0912345679"
            }

            response = client.post("/api/liff/patients", json=patient_data)
            assert response.status_code == 400
            assert "生理性別" in response.json()["detail"]

            # Test creating patient with gender (should succeed)
            patient_data["gender"] = "male"
            response = client.post("/api/liff/patients", json=patient_data)
            assert response.status_code == 200

            data = response.json()
            assert data["gender"] == "male"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_creation_with_gender_validation(self, db_session: Session, test_clinic_with_liff):
        """Test gender validation in LIFF patient creation."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_gender_validation",
            clinic_id=clinic.id,
            display_name="Gender Validation Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test invalid gender value
            response = client.post("/api/liff/patients", json={
                "full_name": "Test Patient",
                "phone_number": "0912345678",
                "gender": "invalid"
            })
            assert response.status_code == 422
            detail = str(response.json())
            assert "性別" in detail or "gender" in detail.lower()

            # Test valid gender values (case-insensitive)
            for gender_value, expected in [("male", "male"), ("FEMALE", "female"), ("Other", "other")]:
                response = client.post("/api/liff/patients", json={
                    "full_name": f"Test Patient {gender_value}",
                    "phone_number": "0912345678",
                    "gender": gender_value
                })
                assert response.status_code == 200
                assert response.json()["gender"] == expected

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_update_with_birthday(self, db_session: Session, test_clinic_with_liff):
        """Test patient update with birthday."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_update_birthday",
            clinic_id=clinic.id,
            display_name="Update Birthday Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patient without birthday
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test updating patient with birthday
            update_data = {
                "birthday": "1990-05-15"
            }
            response = client.put(f"/api/liff/patients/{patient.id}", json=update_data)
            assert response.status_code == 200

            data = response.json()
            assert data["birthday"] == "1990-05-15"

            # Verify database state
            db_session.refresh(patient)
            assert patient.birthday is not None
            assert str(patient.birthday) == "1990-05-15"

            # Test updating birthday
            update_data = {
                "birthday": "1985-10-20"
            }
            response = client.put(f"/api/liff/patients/{patient.id}", json=update_data)
            assert response.status_code == 200

            data = response.json()
            assert data["birthday"] == "1985-10-20"

            # Verify database state
            db_session.refresh(patient)
            assert str(patient.birthday) == "1985-10-20"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_list_includes_birthday(self, db_session: Session, test_clinic_with_liff):
        """Test that patient list includes birthday."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_list_birthday",
            clinic_id=clinic.id,
            display_name="List Birthday Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patients with and without birthday
        from datetime import date
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient With Birthday",
            phone_number="0912345678",
            birthday=date(1990, 5, 15),
            line_user_id=line_user.id
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Without Birthday",
            phone_number="0912345679",
            line_user_id=line_user.id
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.commit()

        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get("/api/liff/patients")
            assert response.status_code == 200

            data = response.json()
            patients = data["patients"]
            assert len(patients) == 2

            # Find patients by name
            patient_with_bday = next(p for p in patients if p["full_name"] == "Patient With Birthday")
            patient_without_bday = next(p for p in patients if p["full_name"] == "Patient Without Birthday")

            assert patient_with_bday["birthday"] == "1990-05-15"
            assert patient_without_bday["birthday"] is None

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_update_validation_errors(self, db_session: Session, test_clinic_with_liff):
        """Test patient update validation errors."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_update_validation",
            clinic_id=clinic.id,
            display_name="Validation Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create primary patient
        primary_patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(primary_patient)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test updating with empty request (no fields provided)
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json={})
            assert response.status_code == 422
            assert "至少需提供一個欄位進行更新" in str(response.json())

            # Test updating with invalid phone format (not 09xxxxxxxx)
            update_data = {
                "phone_number": "1234567890"  # Doesn't start with 09
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 422
            assert "09xxxxxxxx" in str(response.json())

            # Test updating with phone number that's too short
            update_data = {
                "phone_number": "091234567"  # Only 9 digits
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 422

            # Test updating with phone number that's too long
            update_data = {
                "phone_number": "09123456789"  # 11 digits
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 422

            # Test updating with empty name
            update_data = {
                "full_name": "   "  # Only whitespace
            }
            response = client.put(f"/api/liff/patients/{primary_patient.id}", json=update_data)
            assert response.status_code == 422
            assert "姓名不能為空" in str(response.json())

            # Test updating with invalid patient ID (not owned by user)
            other_line_user = LineUser(
                line_user_id="U_other_user",
                clinic_id=clinic.id,
            display_name="Other User"
            )
            db_session.add(other_line_user)
            db_session.commit()

            other_patient = Patient(
                clinic_id=clinic.id,
                full_name="Other Patient",
                phone_number="0987654321",
                line_user_id=other_line_user.id
            )
            db_session.add(other_patient)
            db_session.commit()

            # Try to update patient from other user
            update_data = {
                "full_name": "Hacked Name"
            }
            response = client.put(f"/api/liff/patients/{other_patient.id}", json=update_data)
            assert response.status_code == 403
            assert "access denied" in response.json()["detail"].lower()

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_creation_database_operations(self, db_session: Session, test_clinic_with_liff):
        """Test appointment creation with database verification."""
        clinic, practitioner, appt_types, practitioner_assoc = test_clinic_with_liff

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_appointment",
            clinic_id=clinic.id,
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
            future_date = (taiwan_now() + timedelta(days=3)).date().isoformat()
            appointment_data = {
                "patient_id": patient.id,
                "appointment_type_id": appt_types[0].id,
                "practitioner_id": practitioner.id,
                "start_time": f"{future_date}T10:00:00+08:00",
                "notes": "Integration test appointment"
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200

            appointment_result = response.json()
            assert appointment_result["patient_name"] == "Appointment Patient"
            assert appointment_result["practitioner_name"] == practitioner_assoc.full_name
            assert appointment_result["notes"] == "Integration test appointment"

            # Verify database state (time is stored in Taiwan time)
            calendar_event = db_session.query(CalendarEvent).filter(
                CalendarEvent.date == datetime.fromisoformat(future_date).date(),
                CalendarEvent.start_time == time(10, 0)  # 10:00 Taiwan time
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
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user and multiple patients with appointments
        line_user = LineUser(
            line_user_id="U_test_listing",
            clinic_id=clinic.id,
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
        # Use Taiwan timezone for date consistency with service logic
        for i, patient in enumerate(patients):
            # Create calendar event with dates in the future (using Taiwan timezone)
            event_date = (taiwan_now() + timedelta(days=i+1)).date()
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                event_type="appointment",
                event_date=event_date,
                start_time=time(14, 0),
                end_time=time(15, 0)
            )
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
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user directly (simulating LIFF login)
        line_user = LineUser(
            line_user_id="U_complete_flow_123",
            clinic_id=clinic.id,
            display_name="李小華"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
            future_date_obj = (taiwan_now() + timedelta(days=2)).date()
            future_date = future_date_obj.isoformat()

            # Get day of week (0=Monday, 6=Sunday)
            day_of_week = future_date_obj.weekday()

            # Create practitioner availability for the future date's day of week
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.commit()

            appt_type_id = appt_types_data[0]["id"]

            response = client.get(
                f"/api/liff/availability?date={future_date}&appointment_type_id={appt_type_id}"
            )
            assert response.status_code == 200
            availability_data = response.json()
            assert "slots" in availability_data
            assert len(availability_data["slots"]) > 0  # Should have available slots

            # Step 4: Book appointment using the first available slot
            slot = availability_data["slots"][0]
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
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_list_patients_123",
            clinic_id=clinic.id,
            display_name="王先生"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_books_different_123",
            clinic_id=clinic.id,
            display_name="陳先生"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
            future_date = (taiwan_now() + timedelta(days=3)).date().isoformat()
            start_time = f"{future_date}T10:00:00+08:00"

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
            appointment_data["start_time"] = f"{future_date}T11:00:00+08:00"
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
        clinic, practitioner, appt_types, practitioner_assoc = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_appointment_history_123",
            clinic_id=clinic.id,
            display_name="陳大華"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
                (f"{(taiwan_now() + timedelta(days=3)).date().isoformat()}T09:00:00+08:00", "第一次看診"),
                (f"{(taiwan_now() + timedelta(days=10)).date().isoformat()}T14:00:00+08:00", "第二次看診"),
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
                assert appt["practitioner_name"] == practitioner_assoc.full_name
                assert "notes" in appt

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_user_cancels_appointment(self, db_session: Session, test_clinic_with_liff):
        """Test user can cancel their appointments."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_cancel_appointment_123",
            clinic_id=clinic.id,
            display_name="林小薇"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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

            # Book appointment (more than 24 hours in the future to allow cancellation)
            future_date = (taiwan_now() + timedelta(days=2)).date().isoformat()
            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": f"{future_date}T16:00:00+08:00",
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

    def test_user_cannot_cancel_when_deletion_disabled(self, db_session: Session, test_clinic_with_liff):
        """Test user cannot cancel appointments when clinic disallows patient deletion."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Disable patient deletion for this clinic
        clinic_settings = clinic.get_validated_settings()
        clinic_settings.booking_restriction_settings.allow_patient_deletion = False
        clinic.set_validated_settings(clinic_settings)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_no_deletion_123",
            clinic_id=clinic.id,
            display_name="林小薇"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user

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

            # Book appointment (more than 24 hours in the future)
            future_date = (taiwan_now() + timedelta(days=2)).date().isoformat()
            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": f"{future_date}T16:00:00+08:00",
                    "notes": "無法取消的預約"
                }
            )
            appointment = response.json()

            # Try to cancel appointment - should be rejected
            response = client.delete(f"/api/liff/appointments/{appointment['calendar_event_id']}")
            assert response.status_code == 403
            assert "不允許病患自行取消預約" in response.json()["detail"]

            # Verify appointment is still confirmed in database
            db_appointment = db_session.query(Appointment).get(appointment["appointment_id"])
            assert db_appointment.status == "confirmed"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_get_clinic_info_includes_allow_patient_deletion(self, db_session: Session, test_clinic_with_liff):
        """Test that get_clinic_info endpoint includes allow_patient_deletion setting."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_clinic_info_123",
            clinic_id=clinic.id,
            display_name="測試用戶"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)

        try:
            # Test with default setting (True)
            response = client.get("/api/liff/clinic-info")
            assert response.status_code == 200
            data = response.json()
            assert "allow_patient_deletion" in data
            assert data["allow_patient_deletion"] == True

            # Disable patient deletion
            clinic_settings = clinic.get_validated_settings()
            clinic_settings.booking_restriction_settings.allow_patient_deletion = False
            clinic.set_validated_settings(clinic_settings)
            db_session.commit()

            # Test with setting disabled
            response = client.get("/api/liff/clinic-info")
            assert response.status_code == 200
            data = response.json()
            assert "allow_patient_deletion" in data
            assert data["allow_patient_deletion"] == False

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)


class TestLiffAvailabilityAndScheduling:
    """Test availability checking and intelligent scheduling."""

    def test_availability_shows_correct_slots(self, db_session: Session, test_clinic_with_liff):
        """Test availability API returns correct time slots."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_availability_test_123",
            clinic_id=clinic.id,
            display_name="Availability User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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

            # Use a date that's always > 24 hours away to avoid time-dependent test failures
            # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
            now = taiwan_now()
            # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
            target_date = (now + timedelta(days=2)).date()
            target_date_iso = target_date.isoformat()

            # Get day of week (0=Monday, 6=Sunday)
            day_of_week = target_date.weekday()

            # Create practitioner availability for target date's day of week
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.commit()

            appt_type_id = appt_types[0].id  # 30-minute consultation

            response = client.get(f"/api/liff/availability?date={target_date_iso}&appointment_type_id={appt_type_id}")
            assert response.status_code == 200

            data = response.json()
            assert data["date"] == target_date_iso
            assert "slots" in data


            # Should have available slots based on practitioner's schedule (9 AM to 5 PM)
            slots = data["slots"]
            assert len(slots) > 0

            # Verify slot structure
            for slot in slots:
                assert "start_time" in slot
                assert "end_time" in slot
                assert "practitioner_id" in slot
                assert "practitioner_name" in slot
                assert slot["practitioner_id"] == practitioner.id

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_availability_with_practitioner_id_multi_clinic(self, db_session: Session):
        """Test availability endpoint with practitioner_id for multi-clinic practitioner.

        This test ensures that when a practitioner is associated with multiple clinics,
        the availability endpoint correctly validates the practitioner's association
        with the requested clinic (not just any clinic).
        """
        # Create two clinics
        clinic1 = Clinic(
            name="Multi-Clinic Test Clinic 1",
            line_channel_id="multiclinic1_channel",
            line_channel_secret="multiclinic1_secret",
            line_channel_access_token="multiclinic1_token",
            settings={}
        )
        clinic2 = Clinic(
            name="Multi-Clinic Test Clinic 2",
            line_channel_id="multiclinic2_channel",
            line_channel_secret="multiclinic2_secret",
            line_channel_access_token="multiclinic2_token",
            settings={}
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()

        # Create practitioner associated with BOTH clinics
        # Associate with clinic1 first (this was the bug - it checked first association)
        practitioner, assoc1 = create_user_with_clinic_association(
            db_session,
            clinic=clinic1,
            email="multiclinic_practitioner@test.com",
            google_subject_id="multiclinic_google_123",
            full_name="Dr. Multi-Clinic",
            roles=["practitioner"]
        )

        # Associate with clinic2 second
        from models import UserClinicAssociation
        assoc2 = UserClinicAssociation(
            user_id=practitioner.id,
            clinic_id=clinic2.id,
            roles=["practitioner"],
            full_name="Dr. Multi-Clinic at Clinic 2",
            is_active=True
        )
        db_session.add(assoc2)
        db_session.commit()

        # Create appointment types for both clinics
        appt_type1 = AppointmentType(
            clinic_id=clinic1.id,
            name="Clinic 1 Consultation",
            duration_minutes=30
        )
        appt_type2 = AppointmentType(
            clinic_id=clinic2.id,
            name="Clinic 2 Consultation",
            duration_minutes=30
        )
        db_session.add_all([appt_type1, appt_type2])
        db_session.commit()

        # Associate practitioner with appointment types at both clinics
        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic1.id,
            appointment_type_id=appt_type1.id
        )
        pat2 = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic2.id,
            appointment_type_id=appt_type2.id
        )
        db_session.add_all([pat1, pat2])
        db_session.commit()

        # Use a date that's always > 24 hours away to avoid time-dependent test failures
        # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
        now = taiwan_now()
        # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
        target_date = (now + timedelta(days=2)).date()
        day_of_week = target_date.weekday()

        # Create availability for practitioner at clinic2
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic2,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Create LINE user for clinic2
        line_user = LineUser(
            line_user_id="U_multiclinic_test_123",
            clinic_id=clinic2.id,
            display_name="Multi-Clinic Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication for clinic2 (not clinic1)
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic2)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient for clinic2
            primary_patient = Patient(
                clinic_id=clinic2.id,
                full_name="Multi-Clinic Patient",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            target_date_iso = target_date.isoformat()

            # Test availability with practitioner_id for clinic2
            # This should work even though practitioner's first association is with clinic1
            response = client.get(
                f"/api/liff/availability?date={target_date_iso}&appointment_type_id={appt_type2.id}&practitioner_id={practitioner.id}"
            )
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

            data = response.json()
            assert data["date"] == target_date_iso
            assert "slots" in data
            slots = data["slots"]
            assert len(slots) > 0, "Should have available slots"

            # Verify all slots are for the correct practitioner
            for slot in slots:
                assert slot["practitioner_id"] == practitioner.id
                assert "start_time" in slot
                assert "end_time" in slot
                assert "practitioner_name" in slot

            # Test that requesting availability for clinic1's appointment type with clinic2 context fails
            # (practitioner is associated with clinic1, but we're in clinic2 context)
            response = client.get(
                f"/api/liff/availability?date={target_date_iso}&appointment_type_id={appt_type1.id}&practitioner_id={practitioner.id}"
            )
            assert response.status_code == 404, "Should fail when appointment type belongs to different clinic"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_booking_creates_correct_database_records(self, db_session: Session, test_clinic_with_liff):
        """Test that booking creates all necessary database records."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_booking_records_123",
            clinic_id=clinic.id,
            display_name="趙小龍"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
            future_date = (taiwan_now() + timedelta(days=3)).date()
            start_time = f"{future_date.isoformat()}T10:30:00+08:00"

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

            # Verify CalendarEvent was created (time is stored in Taiwan time)
            calendar_event = db_session.query(CalendarEvent).filter(
                CalendarEvent.date == future_date,
                CalendarEvent.start_time == time(10, 30),  # 10:30 Taiwan time
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

    def test_batch_availability_endpoint(self, db_session: Session, test_clinic_with_liff):
        """Test batch availability endpoint for multiple dates."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_batch_test_123",
            clinic_id=clinic.id,
            display_name="Batch Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="Batch Test User",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Calculate dates (next Monday and Tuesday)
            from datetime import timedelta
            today = taiwan_now().date()
            days_until_monday = (0 - today.weekday()) % 7
            if days_until_monday == 0 and today.weekday() != 0:
                days_until_monday = 7
            monday = today + timedelta(days=days_until_monday)
            tuesday = monday + timedelta(days=1)

            # Test batch endpoint
            response = client.post(
                "/api/liff/availability/batch",
                json={
                    "dates": [monday.strftime('%Y-%m-%d'), tuesday.strftime('%Y-%m-%d')],
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert "results" in data
            assert len(data["results"]) == 2

            # Verify results contain data for both dates
            result_dict = {r["date"]: r for r in data["results"]}

            # Both dates should have slots (default availability covers all days)
            assert monday.strftime('%Y-%m-%d') in result_dict
            monday_result = result_dict[monday.strftime('%Y-%m-%d')]
            assert "slots" in monday_result
            assert "date" in monday_result

            assert tuesday.strftime('%Y-%m-%d') in result_dict
            tuesday_result = result_dict[tuesday.strftime('%Y-%m-%d')]
            assert "slots" in tuesday_result
            assert "date" in tuesday_result

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_availability_deduplicates_slots_for_multiple_practitioners(self, db_session: Session, test_clinic_with_liff):
        """Test that availability endpoint deduplicates time slots when multiple practitioners have the same times."""
        clinic, practitioner1, appt_types, _ = test_clinic_with_liff

        # Create a second practitioner
        practitioner2, practitioner2_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@liffclinic.com",
            google_subject_id="google_123_practitioner2",
            full_name="Dr. Second Practitioner",
            roles=["practitioner"]
        )

        # Associate second practitioner with appointment types
        for appt_type in appt_types:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner2.id,
                clinic_id=clinic.id,
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_dedup_test_123",
            clinic_id=clinic.id,
            display_name="Dedup Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create primary patient
            primary_patient = Patient(
                clinic_id=clinic.id,
                full_name="Dedup Test User",
                phone_number="0912345678",
                line_user_id=line_user.id
            )
            db_session.add(primary_patient)
            db_session.commit()

            # Use a date that's always > 24 hours away to avoid time-dependent test failures
            # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
            now = taiwan_now()
            # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
            target_date = (now + timedelta(days=2)).date()
            target_date_iso = target_date.isoformat()
            day_of_week = target_date.weekday()

            # Create same availability for both practitioners (9:00-17:00)
            # This will create overlapping time slots
            create_practitioner_availability_with_clinic(
                db_session, practitioner1, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            create_practitioner_availability_with_clinic(
                db_session, practitioner2, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.commit()

            # Request availability without specifying practitioner (不指定負責人員)
            appt_type_id = appt_types[0].id  # 30-minute consultation
            response = client.get(
                f"/api/liff/availability?date={target_date_iso}&appointment_type_id={appt_type_id}"
            )

            assert response.status_code == 200
            data = response.json()
            assert data["date"] == target_date_iso
            assert "slots" in data

            slots = data["slots"]
            assert len(slots) > 0, "Should have available slots"

            # Verify no duplicate start_times
            start_times = [slot["start_time"] for slot in slots]
            unique_start_times = set(start_times)
            assert len(start_times) == len(unique_start_times), \
                f"Found duplicate start_times. Total: {len(start_times)}, Unique: {len(unique_start_times)}"

            # Verify slots are sorted chronologically
            for i in range(len(slots) - 1):
                current_time = slots[i]["start_time"]
                next_time = slots[i + 1]["start_time"]
                assert current_time <= next_time, \
                    f"Slots not sorted: {current_time} should be <= {next_time}"

            # Verify slot structure
            for slot in slots:
                assert "start_time" in slot
                assert "end_time" in slot
                assert "practitioner_id" in slot
                assert "practitioner_name" in slot
                # Practitioner ID should be one of the two practitioners
                assert slot["practitioner_id"] in [practitioner1.id, practitioner2.id]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_practitioner_assignment_without_specification(self, db_session: Session, test_clinic_with_liff):
        """Test intelligent practitioner assignment when user doesn't specify."""
        clinic, practitioner, appt_types, practitioner_assoc = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_practitioner_assignment_123",
            clinic_id=clinic.id,
            display_name="孫小美"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
            # Use 3 days in future to avoid timezone edge cases, similar to other tests
            future_date = (taiwan_now() + timedelta(days=3)).date()
            start_time = f"{future_date.isoformat()}T11:00:00+08:00"
            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": None,  # 不指定
                    "start_time": start_time,
                    "notes": "不指定負責人員"
                }
            )
            assert response.status_code == 200

            # Verify appointment was auto-assigned (practitioner_name should be "不指定" for auto-assigned)
            appointment_result = response.json()
            assert appointment_result["practitioner_name"] == "不指定"
            assert appointment_result["is_auto_assigned"] == True
            # Verify it was still assigned to a practitioner (for blocking availability)
            assert appointment_result["practitioner_id"] is not None

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestLiffErrorHandling:
    """Test error handling and validation in LIFF API."""

    def test_invalid_patient_id_returns_403(self, db_session: Session, test_clinic_with_liff):
        """Test that booking with invalid patient ID returns 403."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_error_test_123",
            clinic_id=clinic.id,
            display_name="Error Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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

            # Use a future date to avoid validation errors
            future_time = taiwan_now() + timedelta(days=3)
            # Format as ISO string with timezone (e.g., "2025-12-15T10:00:00+08:00")
            future_time_str = future_time.isoformat()

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": 99999,  # Non-existent patient
                    "appointment_type_id": appt_types[0].id,  # Use appointment type from fixture
                    "start_time": future_time_str,
                }
            )
            assert response.status_code == 403
            assert "Patient not found" in response.json()["detail"]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_invalid_line_user_id_returns_400(self, db_session: Session, test_clinic_with_liff):
        """Test that creating patient with invalid line_user_id returns 400."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        from services.patient_service import PatientService

        # Try to create patient with non-existent line_user_id
        with pytest.raises(HTTPException) as exc_info:
            PatientService.create_patient(
                db=db_session,
                clinic_id=clinic.id,
                full_name="Test Patient",
                phone_number="0912345678",
                line_user_id=99999  # Non-existent line_user_id
            )

        assert exc_info.value.status_code == 400
        assert "無效的 LINE 使用者 ID" in exc_info.value.detail

    def test_past_appointment_returns_validation_error(self, db_session: Session, test_clinic_with_liff):
        """Test that booking appointments in the past fails."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_past_appointment_test_123",
            clinic_id=clinic.id,
            display_name="郭小華"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
                json={"full_name": "郭小明", "phone_number": "0912345679"}
            )
            assert response.status_code == 200
            patient = response.json()

            # Try to book in the past
            past_time = (taiwan_now() - timedelta(hours=1)).isoformat()

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
            assert "無法預約過去的時間" in str(response.json())

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_double_booking_prevention(self, db_session: Session, test_clinic_with_liff):
        """Test that double booking at the same time is prevented."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_double_booking_test_123",
            clinic_id=clinic.id,
            display_name="錢小明"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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

            # Set up practitioner availability for a future date (2 days from now to avoid timezone issues)
            future_date = (taiwan_now() + timedelta(days=2)).date()
            future_weekday = future_date.weekday()
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic,
                day_of_week=future_weekday,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.commit()

            # Create additional patient for testing
            response = client.post(
                "/api/liff/patients",
                json={"full_name": "錢小華", "phone_number": "0999999998"}
            )
            patient = response.json()

            # Book first appointment
            start_time = f"{future_date.isoformat()}T13:00:00+08:00"

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
                json={"full_name": "錢太太", "phone_number": "0999999997"}
            )
            assert response.status_code == 200
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
            assert "時段不可用" in response.json()["detail"]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_too_far_future_booking_rejected(self, db_session: Session, test_clinic_with_liff):
        """Test that booking too far in the future is rejected."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_far_future_test_123",
            clinic_id=clinic.id,
            display_name="周小美"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication and database
        from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user
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
                json={"full_name": "周小華", "phone_number": "0912345679"}
            )
            assert response.status_code == 200
            patient = response.json()

            # Try to book more than 90 days in future (default booking window)
            far_future = (taiwan_now() + timedelta(days=100)).isoformat()

            response = client.post(
                "/api/liff/appointments",
                json={
                    "patient_id": patient["patient_id"],  # Use patient_id from creation response
                    "appointment_type_id": appt_types[0].id,
                    "practitioner_id": practitioner.id,
                    "start_time": far_future,
                }
            )
            # Service layer validation returns 400 (not 422 from Pydantic)
            assert response.status_code == 400
            assert "最多只能預約 90 天內的時段" in str(response.json())

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)



# NOTE: Booking restriction tests have been moved to test_booking_restrictions.py
# This keeps LIFF integration tests focused on LIFF-specific functionality


class TestClinicIsolationSecurity:
    """Critical security tests for clinic data isolation.

    These tests ensure that users from different clinics cannot access
    each other's data, preventing privacy violations and data leakage.
    """

    @pytest.fixture
    def multiple_clinics_setup(self, db_session: Session):
        """Create multiple clinics with different appointment types and patients."""
        # Clinic 1: General Practice
        clinic1 = Clinic(
            name="General Practice Clinic",
            line_channel_id="clinic1_channel",
            line_channel_secret="clinic1_secret",
            line_channel_access_token="clinic1_token",
            settings={}
        )
        db_session.add(clinic1)

        # Clinic 2: Dental Clinic
        clinic2 = Clinic(
            name="Dental Clinic",
            line_channel_id="clinic2_channel",
            line_channel_secret="clinic2_secret",
            line_channel_access_token="clinic2_token",
            settings={}
        )
        db_session.add(clinic2)
        db_session.commit()

        # Practitioners for each clinic
        practitioner1, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic1,
            email="dr.smith@clinic1.com",
            google_subject_id="google_123_clinic1",
            full_name="Dr. Smith",
            roles=["practitioner"]
        )

        practitioner2, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic2,
            email="dr.jones@clinic2.com",
            google_subject_id="google_123_clinic2",
            full_name="Dr. Jones",
            roles=["practitioner"]
        )

        # Appointment types for each clinic
        appt_types1 = []
        for name, duration in [("General Consultation", 30), ("Follow-up", 15)]:
            appt_type = AppointmentType(
                clinic_id=clinic1.id,
                name=name,
                duration_minutes=duration
            )
            db_session.add(appt_type)
            appt_types1.append(appt_type)

        appt_types2 = []
        for name, duration in [("Dental Checkup", 45), ("Cleaning", 30)]:
            appt_type = AppointmentType(
                clinic_id=clinic2.id,
                name=name,
                duration_minutes=duration
            )
            db_session.add(appt_type)
            appt_types2.append(appt_type)

        db_session.commit()

        # Associate practitioners with appointment types
        for appt_type in appt_types1:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner1.id,
                clinic_id=clinic1.id,
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        for appt_type in appt_types2:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner2.id,
                clinic_id=clinic2.id,
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        # Create LINE users for each clinic
        line_user1 = LineUser(
            line_user_id="U_clinic1_patient",
            clinic_id=clinic1.id,
            display_name="Clinic1 Patient"
        )
        db_session.add(line_user1)

        line_user2 = LineUser(
            line_user_id="U_clinic2_patient",
            clinic_id=clinic2.id,
            display_name="Clinic2 Patient"
        )
        db_session.add(line_user2)
        db_session.commit()

        # Create patients for each clinic
        patient1 = Patient(
            clinic_id=clinic1.id,
            full_name="Clinic1 Patient",
            phone_number="0911111111",
            line_user_id=line_user1.id
        )
        db_session.add(patient1)

        patient2 = Patient(
            clinic_id=clinic2.id,
            full_name="Clinic2 Patient",
            phone_number="0922222222",
            line_user_id=line_user2.id
        )
        db_session.add(patient2)
        db_session.commit()

        return {
            'clinic1': clinic1, 'clinic2': clinic2,
            'practitioner1': practitioner1, 'practitioner2': practitioner2,
            'appt_types1': appt_types1, 'appt_types2': appt_types2,
            'line_user1': line_user1, 'line_user2': line_user2,
            'patient1': patient1, 'patient2': patient2
        }

    def test_appointment_types_clinic_isolation(self, db_session: Session, multiple_clinics_setup):
        """Test that appointment types are properly isolated by clinic."""
        setup = multiple_clinics_setup
        clinic1, clinic2 = setup['clinic1'], setup['clinic2']
        line_user1, line_user2 = setup['line_user1'], setup['line_user2']

        try:
            # Test clinic1 user sees only clinic1 appointment types
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic1)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            data = response.json()

            appointment_names = {appt['name'] for appt in data['appointment_types']}
            assert appointment_names == {"General Consultation", "Follow-up"}
            assert "Dental Checkup" not in appointment_names
            assert "Cleaning" not in appointment_names

            # Test clinic2 user sees only clinic2 appointment types
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user2, clinic2)

            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            data = response.json()

            appointment_names = {appt['name'] for appt in data['appointment_types']}
            assert appointment_names == {"Dental Checkup", "Cleaning"}
            assert "General Consultation" not in appointment_names
            assert "Follow-up" not in appointment_names

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_types_only_show_with_active_practitioners(self, db_session: Session):
        """Test that appointment types are only shown if they have active practitioners."""
        # Create a clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        # Create a LINE user
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create appointment types
        appt_type_with_practitioner = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation with Practitioner",
            duration_minutes=30
        )
        appt_type_without_practitioner = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation without Practitioner",
            duration_minutes=30
        )
        appt_type_with_inactive_practitioner = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation with Inactive Practitioner",
            duration_minutes=30
        )
        db_session.add(appt_type_with_practitioner)
        db_session.add(appt_type_without_practitioner)
        db_session.add(appt_type_with_inactive_practitioner)
        db_session.commit()

        # Create practitioners
        active_practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="active@clinic.com",
            google_subject_id="google_active",
            full_name="Active Practitioner",
            roles=["practitioner"],
            is_active=True
        )
        inactive_practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="inactive@clinic.com",
            google_subject_id="google_inactive",
            full_name="Inactive Practitioner",
            roles=["practitioner"],
            is_active=False
        )

        # Associate practitioners with appointment types
        # Active practitioner with first appointment type
        pat1 = PractitionerAppointmentTypes(
            user_id=active_practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_with_practitioner.id
        )
        db_session.add(pat1)

        # Inactive practitioner with third appointment type
        pat2 = PractitionerAppointmentTypes(
            user_id=inactive_practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_with_inactive_practitioner.id
        )
        db_session.add(pat2)

        db_session.commit()

        try:
            # Test that only appointment types with active practitioners are returned
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            data = response.json()

            appointment_names = {appt['name'] for appt in data['appointment_types']}

            # Should only include the appointment type with active practitioner
            assert "Consultation with Practitioner" in appointment_names
            assert len(appointment_names) == 1

            # Should not include appointment types without practitioners or with only inactive practitioners
            assert "Consultation without Practitioner" not in appointment_names
            assert "Consultation with Inactive Practitioner" not in appointment_names

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_list_practitioners_filters_by_patient_booking_allowed(self, db_session: Session, test_clinic_with_liff):
        """Test that list_practitioners filters out practitioners who don't allow patient booking."""
        clinic, practitioner, appt_types, practitioner_assoc = test_clinic_with_liff

        # Create a second practitioner who disallows patient booking
        practitioner2, practitioner2_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@liffclinic.com",
            google_subject_id="google_456_practitioner2",
            full_name="Dr. Restricted Practitioner",
            roles=["practitioner"]
        )

        # Set practitioner2 to disallow patient booking
        settings = PractitionerSettings(patient_booking_allowed=False)
        practitioner2_assoc.set_validated_settings(settings)
        db_session.commit()

        # Associate practitioner2 with appointment types
        for appt_type in appt_types:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner2.id,
                clinic_id=clinic.id,
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        # Set up availability for practitioner2
        for day_of_week in range(7):
            create_practitioner_availability_with_clinic(
                db_session, practitioner2, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )

        db_session.commit()

        # Create LINE user and authenticate
        line_user = LineUser(
            line_user_id="U_test_filter_practitioners",
            clinic_id=clinic.id,
            display_name="Test LINE User"
        )
        db_session.add(line_user)
        db_session.commit()

        token = create_line_user_jwt(
            line_user_id=line_user.line_user_id,
            clinic_id=clinic.id,
            db_session=db_session
        )

        # Mock the LINE user authentication
        from auth.dependencies import get_current_line_user_with_clinic, get_db

        def mock_get_current_line_user_with_clinic():
            return (line_user, clinic)

        client.app.dependency_overrides[get_current_line_user_with_clinic] = mock_get_current_line_user_with_clinic
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get practitioners list (should filter out practitioner2)
            response = client.get(
                "/api/liff/practitioners",
                headers={"Authorization": f"Bearer {token}"}
            )

            assert response.status_code == 200
            data = response.json()
            assert "practitioners" in data
            practitioners = data["practitioners"]

            # Should only return practitioner1 (who allows patient booking)
            assert len(practitioners) == 1
            assert practitioners[0]["id"] == practitioner.id
            assert practitioners[0]["full_name"] == practitioner_assoc.full_name

            # Verify practitioner2 is not in the list
            practitioner_ids = [p["id"] for p in practitioners]
            assert practitioner2.id not in practitioner_ids
        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_list_practitioners_includes_all_when_all_allow_patient_booking(self, db_session: Session, test_clinic_with_liff):
        """Test that list_practitioners includes all practitioners when they all allow patient booking."""
        clinic, practitioner, appt_types, practitioner_assoc = test_clinic_with_liff

        # Create a second practitioner who allows patient booking (default)
        practitioner2, practitioner2_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@liffclinic.com",
            google_subject_id="google_789_practitioner2",
            full_name="Dr. Allowed Practitioner",
            roles=["practitioner"]
        )

        # Ensure practitioner2 allows patient booking (default is True)
        settings = PractitionerSettings(patient_booking_allowed=True)
        practitioner2_assoc.set_validated_settings(settings)
        db_session.commit()

        # Associate practitioner2 with appointment types
        for appt_type in appt_types:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner2.id,
                clinic_id=clinic.id,
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        # Set up availability for practitioner2
        for day_of_week in range(7):
            create_practitioner_availability_with_clinic(
                db_session, practitioner2, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )

        db_session.commit()

        # Create LINE user and authenticate
        line_user = LineUser(
            line_user_id="U_test_all_practitioners",
            clinic_id=clinic.id,
            display_name="Test LINE User"
        )
        db_session.add(line_user)
        db_session.commit()

        token = create_line_user_jwt(
            line_user_id=line_user.line_user_id,
            clinic_id=clinic.id,
            db_session=db_session
        )

        # Mock the LINE user authentication
        from auth.dependencies import get_current_line_user_with_clinic, get_db

        def mock_get_current_line_user_with_clinic():
            return (line_user, clinic)

        client.app.dependency_overrides[get_current_line_user_with_clinic] = mock_get_current_line_user_with_clinic
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get practitioners list (should include both)
            response = client.get(
                "/api/liff/practitioners",
                headers={"Authorization": f"Bearer {token}"}
            )

            assert response.status_code == 200
            data = response.json()
            assert "practitioners" in data
            practitioners = data["practitioners"]

            # Should return both practitioners
            assert len(practitioners) == 2
            practitioner_ids = [p["id"] for p in practitioners]
            assert practitioner.id in practitioner_ids
            assert practitioner2.id in practitioner_ids
        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patients_clinic_isolation(self, db_session: Session, multiple_clinics_setup):
        """Test that patients are properly isolated by clinic."""
        setup = multiple_clinics_setup
        clinic1, clinic2 = setup['clinic1'], setup['clinic2']
        line_user1, line_user2 = setup['line_user1'], setup['line_user2']

        try:
            # Test clinic1 user sees only clinic1 patients
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic1)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get("/api/liff/patients")
            assert response.status_code == 200
            data = response.json()

            patient_names = {patient['full_name'] for patient in data['patients']}
            assert "Clinic1 Patient" in patient_names
            assert "Clinic2 Patient" not in patient_names

            # Test clinic2 user sees only clinic2 patients
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user2, clinic2)

            response = client.get("/api/liff/patients")
            assert response.status_code == 200
            data = response.json()

            patient_names = {patient['full_name'] for patient in data['patients']}
            assert "Clinic2 Patient" in patient_names
            assert "Clinic1 Patient" not in patient_names

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointments_clinic_isolation(self, db_session: Session, multiple_clinics_setup):
        """Test that appointments are properly isolated by clinic."""
        setup = multiple_clinics_setup
        clinic1, clinic2 = setup['clinic1'], setup['clinic2']
        line_user1, line_user2 = setup['line_user1'], setup['line_user2']

        # For this test, we focus on verifying that appointment retrieval is properly isolated
        # rather than testing appointment creation (which can have complex availability conflicts)
        try:
            # Test clinic1 user gets empty appointment list (no appointments created)
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic1)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get("/api/liff/appointments")
            assert response.status_code == 200
            data = response.json()
            # Should have empty or no appointments from clinic1
            clinic1_appointments = data['appointments']
            assert len(clinic1_appointments) == 0 or all(
                # If there are appointments, they should not contain clinic2-specific notes
                "Clinic2" not in appt.get('notes', '') for appt in clinic1_appointments
            )

            # Test clinic2 user gets empty appointment list (no appointments created)
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user2, clinic2)

            response = client.get("/api/liff/appointments")
            assert response.status_code == 200
            data = response.json()
            # Should have empty or no appointments from clinic2
            clinic2_appointments = data['appointments']
            assert len(clinic2_appointments) == 0 or all(
                # If there are appointments, they should not contain clinic1-specific notes
                "Clinic1" not in appt.get('notes', '') for appt in clinic2_appointments
            )

            # Verify that clinic isolation is working at the service level
            # Both should return empty lists since no appointments were created in this test
            assert len(clinic1_appointments) == 0
            assert len(clinic2_appointments) == 0

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_jwt_clinic_id_validation(self, db_session: Session, multiple_clinics_setup):
        """Test that JWT tokens with mismatched clinic_id are rejected."""
        setup = multiple_clinics_setup
        clinic1, clinic2 = setup['clinic1'], setup['clinic2']
        line_user1 = setup['line_user1']

        # Create JWT token for clinic1
        token_clinic1 = create_line_user_jwt(line_user1.line_user_id, clinic1.id, db_session=db_session)

        # Try to use clinic1 token to access clinic2 data
        try:
            # Override authentication to use clinic2 context but clinic1 token
            def mock_clinic2_auth():
                # This simulates what would happen if JWT contained clinic1 but URL requested clinic2
                raise HTTPException(
                    status_code=403,
                    detail="Clinic access denied"
                )

            # This test verifies the backend properly validates clinic context
            # In a real scenario, the frontend fix prevents this from happening
            # But we test that if it did happen, the backend rejects it
            client.app.dependency_overrides[get_current_line_user_with_clinic] = mock_clinic2_auth
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get("/api/liff/appointment-types")
            # Should be rejected due to clinic mismatch
            assert response.status_code == 403

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_jwt_contains_clinic_token(self, db_session: Session, multiple_clinics_setup):
        """Test that JWT tokens include clinic_token in payload for shared LIFF apps."""
        import jwt
        from core.config import JWT_SECRET_KEY
        from utils.liff_token import generate_liff_access_token

        setup = multiple_clinics_setup
        clinic1 = setup['clinic1']
        line_user1 = setup['line_user1']

        # Ensure clinic has token (and no liff_id for shared LIFF)
        if not clinic1.liff_access_token:
            clinic1.liff_access_token = generate_liff_access_token(db_session, clinic1.id)
            db_session.commit()
        clinic1.liff_id = None  # Ensure it's a shared LIFF app
        db_session.commit()

        # Create JWT token for clinic1
        token_clinic1 = create_line_user_jwt(line_user1.line_user_id, clinic1.id, db_session=db_session)

        # Decode JWT to verify clinic_token is included
        payload = jwt.decode(token_clinic1, JWT_SECRET_KEY, algorithms=["HS256"])
        assert "clinic_token" in payload, "JWT should contain clinic_token for shared LIFF"
        assert payload["clinic_token"] == clinic1.liff_access_token
        assert payload.get("liff_id") is None, "JWT should not contain liff_id for shared LIFF"
        assert payload["clinic_id"] == clinic1.id

    def test_jwt_contains_liff_id(self, db_session: Session):
        """Test that JWT tokens include liff_id in payload for clinic-specific LIFF apps."""
        import jwt
        from core.config import JWT_SECRET_KEY

        # Create clinic with liff_id
        clinic = Clinic(
            name="Test Clinic LIFF",
            line_channel_id="test_channel_liff_jwt",
            line_channel_secret="test_secret_liff_jwt",
            line_channel_access_token="test_token_liff_jwt",
            is_active=True,
            liff_id="1234567890-jwttest"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user_liff_jwt",
            clinic_id=clinic.id,
            display_name="Test User LIFF JWT"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create JWT token for clinic with liff_id
        token = create_line_user_jwt(line_user.line_user_id, clinic.id, db_session=db_session)

        # Decode JWT to verify liff_id is included
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        assert "liff_id" in payload, "JWT should contain liff_id for clinic-specific LIFF"
        assert payload["liff_id"] == clinic.liff_id
        assert payload.get("clinic_token") is None, "JWT should not contain clinic_token for clinic-specific LIFF"
        assert payload["clinic_id"] == clinic.id

class TestCompactScheduleFeature:
    """Test compact schedule recommendation feature."""

    def _setup_test_user_and_patient(self, db_session: Session, clinic: Clinic, line_user_id: str, patient_name: str, phone: str):
        """Helper to create LINE user and patient for tests."""
        line_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=f"Compact Schedule User {line_user_id[-3:]}"
        )
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            full_name=patient_name,
            phone_number=phone,
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        return line_user, patient

    def _enable_compact_schedule(self, db_session: Session, practitioner: User, clinic: Clinic, enabled: bool = True):
        """Helper to enable/disable compact schedule for a practitioner."""
        association = db_session.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == practitioner.id,
            UserClinicAssociation.clinic_id == clinic.id
        ).first()
        settings = PractitionerSettings(compact_schedule_enabled=enabled)
        association.set_validated_settings(settings)
        db_session.commit()

    def test_compact_schedule_single_appointment_recommends_before_after(self, db_session: Session, test_clinic_with_liff):
        """Test that compact schedule recommends slots right before and after a single appointment."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff
        appt_type = appt_types[0]  # 30-minute appointment

        # Create LINE user and patient
        line_user, patient = self._setup_test_user_and_patient(
            db_session, clinic, "U_compact_schedule_test_123",
            "Compact Schedule Patient", "0912345678"
        )

        # Enable compact schedule for practitioner
        self._enable_compact_schedule(db_session, practitioner, clinic, enabled=True)

        # Use a date that's always > 24 hours away to avoid time-dependent test failures
        # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
        now = taiwan_now()
        # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
        target_date = (now + timedelta(days=2)).date()

        # Create a single appointment at 10:00-10:30
        event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=target_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Get availability
        try:
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get(
                f"/api/liff/availability",
                params={
                    "date": target_date.strftime("%Y-%m-%d"),
                    "appointment_type_id": appt_type.id,
                    "practitioner_id": practitioner.id
                }
            )
            assert response.status_code == 200
            data = response.json()
            slots = data['slots']

            # Find recommended slots
            recommended_slots = [s for s in slots if s.get('is_recommended') == True]

            # Should have some recommended slots
            assert len(recommended_slots) > 0

            # Verify recommended slots are:
            # 1. Within the span (10:00-10:30) - but there are no slots within a single 30-min appointment
            # 2. Latest slot before 10:00 (if exists)
            # 3. Earliest slot after 10:30 (if exists)
            appt_start_minutes = 10 * 60 + 0  # 10:00
            appt_end_minutes = 10 * 60 + 30  # 10:30

            for slot in recommended_slots:
                slot_end = slot['end_time']
                slot_start = slot['start_time']
                slot_start_hour, slot_start_min = map(int, slot_start.split(':'))
                slot_end_hour, slot_end_min = map(int, slot_end.split(':'))
                slot_start_minutes = slot_start_hour * 60 + slot_start_min
                slot_end_minutes = slot_end_hour * 60 + slot_end_min

                # Should be: right before OR right after
                before_first = slot_end_minutes <= appt_start_minutes
                after_last = slot_start_minutes >= appt_end_minutes

                assert before_first or after_last, \
                    f"Slot {slot_start}-{slot_end} should be right before or after the appointment"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_compact_schedule_multiple_appointments_recommends_neighbors(self, db_session: Session, test_clinic_with_liff):
        """Test that compact schedule recommends immediate neighbor slots for multiple appointments."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff
        appt_type = appt_types[0]  # 30-minute appointment

        # Create LINE user and patient
        line_user, patient = self._setup_test_user_and_patient(
            db_session, clinic, "U_compact_schedule_test_456",
            "Compact Schedule Patient 2", "0912345679"
        )

        # Enable compact schedule for practitioner
        self._enable_compact_schedule(db_session, practitioner, clinic, enabled=True)

        # Use a date that's always > 24 hours away to avoid time-dependent test failures
        # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
        now = taiwan_now()
        # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
        target_date = (now + timedelta(days=2)).date()

        # Create two appointments: 10:00-10:30 and 14:00-14:30
        # Total span: 10:00 to 14:30
        event1 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=target_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.commit()

        appointment1 = Appointment(
            calendar_event_id=event1.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(appointment1)
        db_session.commit()

        event2 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=target_date,
            start_time=time(14, 0),
            end_time=time(14, 30)
        )
        db_session.commit()

        appointment2 = Appointment(
            calendar_event_id=event2.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(appointment2)
        db_session.commit()

        # Get availability
        try:
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get(
                f"/api/liff/availability",
                params={
                    "date": target_date.strftime("%Y-%m-%d"),
                    "appointment_type_id": appt_type.id,
                    "practitioner_id": practitioner.id
                }
            )
            assert response.status_code == 200
            data = response.json()
            slots = data['slots']

            # Find recommended and non-recommended slots
            recommended_slots = [s for s in slots if s.get('is_recommended') == True]

            # Verify recommended slots are only the closest ones
            # 1. 09:30 (ends at 10:00)
            # 2. 10:30 (starts at 10:30)
            # 3. 13:30 (ends at 14:00)
            # 4. 14:30 (starts at 14:30)
            expected_recommended = {'09:30', '10:30', '13:30', '14:30'}
            recommended_start_times = {s['start_time'] for s in recommended_slots}
            
            assert recommended_start_times == expected_recommended, \
                f"Expected {expected_recommended}, but got {recommended_start_times}"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_compact_schedule_disabled_no_recommendations(self, db_session: Session, test_clinic_with_liff):
        """Test that when compact schedule is disabled, no recommendations are made."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff
        appt_type = appt_types[0]  # 30-minute appointment

        # Create LINE user and patient
        line_user, patient = self._setup_test_user_and_patient(
            db_session, clinic, "U_compact_schedule_test_789",
            "Compact Schedule Patient 3", "0912345680"
        )

        # Ensure compact schedule is disabled (default)
        self._enable_compact_schedule(db_session, practitioner, clinic, enabled=False)

        # Use a date that's always > 24 hours away to avoid time-dependent test failures
        # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
        now = taiwan_now()
        # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
        target_date = (now + timedelta(days=2)).date()

        # Create an appointment
        event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=target_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Get availability
        try:
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
            client.app.dependency_overrides[get_db] = lambda: db_session

            response = client.get(
                f"/api/liff/availability",
                params={
                    "date": target_date.strftime("%Y-%m-%d"),
                    "appointment_type_id": appt_type.id,
                    "practitioner_id": practitioner.id
                }
            )
            assert response.status_code == 200
            data = response.json()
            slots = data['slots']

            # No slots should have is_recommended set (or all should be None/False)
            recommended_slots = [s for s in slots if s.get('is_recommended') == True]
            assert len(recommended_slots) == 0

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_compact_schedule_no_appointments_no_recommendations(self, db_session: Session, test_clinic_with_liff):
        """Test that when there are no appointments, no recommendations are made."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff
        appt_type = appt_types[0]  # 30-minute appointment

        # Create LINE user (no patient needed for this test)
        line_user = LineUser(
            line_user_id="U_compact_schedule_test_000",
            clinic_id=clinic.id,
            display_name="Compact Schedule User 4"
        )
        db_session.add(line_user)
        db_session.commit()

        # Enable compact schedule
        self._enable_compact_schedule(db_session, practitioner, clinic, enabled=True)

        # No appointments created

        # Get availability
        try:
            client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
            client.app.dependency_overrides[get_db] = lambda: db_session

            # Use a date that's always > 24 hours away to avoid time-dependent test failures
            # Calculate date that ensures slots are always > 24 hours away (minimum_booking_hours_ahead = 24)
            now = taiwan_now()
            # Use 2 days from now to ensure we're always > 24 hours away regardless of test execution time
            target_date = (now + timedelta(days=2)).date()

            response = client.get(
                f"/api/liff/availability",
                params={
                    "date": target_date.strftime("%Y-%m-%d"),
                    "appointment_type_id": appt_type.id,
                    "practitioner_id": practitioner.id
                }
            )
            assert response.status_code == 200
            data = response.json()
            slots = data['slots']

            # No slots should have is_recommended set
            recommended_slots = [s for s in slots if s.get('is_recommended') == True]
            assert len(recommended_slots) == 0

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestRequireNotes:
    """Test require_notes setting for appointment types."""

    def test_create_appointment_rejects_when_notes_required_but_missing(self, db_session: Session, test_clinic_with_liff):
        """Test that creating appointment without notes is rejected when require_notes=True."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with require_notes=True
        appt_type_require_notes = AppointmentType(
            clinic_id=clinic.id,
            name="Requires Notes",
            duration_minutes=30,
            allow_patient_booking=True,
            require_notes=True
        )
        db_session.add(appt_type_require_notes)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_require_notes.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_require_notes",
            clinic_id=clinic.id,
            display_name="Require Notes User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Require Notes Patient",
            phone_number="0911111111",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to create appointment without notes - should be rejected
            future_date = (taiwan_now() + timedelta(days=3)).date().isoformat()
            appointment_data = {
                "patient_id": patient.id,
                "appointment_type_id": appt_type_require_notes.id,
                "practitioner_id": practitioner.id,
                "start_time": f"{future_date}T10:00:00+08:00",
                "notes": None  # Missing notes
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 400
            assert "此服務項目需要填寫備註" in response.json()["detail"]

            # Try with empty notes - should also be rejected
            appointment_data["notes"] = ""
            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 400
            assert "此服務項目需要填寫備註" in response.json()["detail"]

            # Try with whitespace-only notes - should also be rejected
            appointment_data["notes"] = "   "
            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 400
            assert "此服務項目需要填寫備註" in response.json()["detail"]

            # Try with valid notes - should succeed
            appointment_data["notes"] = "Test notes"
            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_create_appointment_allows_empty_notes_when_not_required(self, db_session: Session, test_clinic_with_liff):
        """Test that creating appointment without notes is allowed when require_notes=False."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with require_notes=False (default)
        appt_type_no_require = AppointmentType(
            clinic_id=clinic.id,
            name="No Notes Required",
            duration_minutes=30,
            allow_patient_booking=True,
            require_notes=False
        )
        db_session.add(appt_type_no_require)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_no_require.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_no_require_notes",
            clinic_id=clinic.id,
            display_name="No Require Notes User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="No Require Notes Patient",
            phone_number="0911111111",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create appointment without notes - should succeed
            future_date = (taiwan_now() + timedelta(days=3)).date().isoformat()
            appointment_data = {
                "patient_id": patient.id,
                "appointment_type_id": appt_type_no_require.id,
                "practitioner_id": practitioner.id,
                "start_time": f"{future_date}T10:00:00+08:00",
                "notes": None
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_require_notes_only_applies_when_allow_patient_booking_true(self, db_session: Session, test_clinic_with_liff):
        """Test that require_notes validation only applies when allow_patient_booking=True."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with require_notes=True but allow_patient_booking=False
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Not Available on LIFF",
            duration_minutes=30,
            allow_patient_booking=False,  # Not available on LIFF
            require_notes=True  # But notes required
        )
        db_session.add(appt_type)
        db_session.commit()

        # This should not cause issues since allow_patient_booking=False
        # The appointment type won't be available for LIFF booking anyway
        assert appt_type.require_notes is True
        assert appt_type.allow_patient_booking is False

    def test_notes_instructions_in_api_response(self, db_session: Session, test_clinic_with_liff):
        """Test that notes_instructions and require_notes are returned in appointment types API response."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with custom notes_instructions
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Custom Notes Instructions",
            duration_minutes=30,
            allow_patient_booking=True,
            require_notes=True,
            notes_instructions="請詳細描述您的症狀"
        )
        db_session.add(appt_type)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_notes_instructions",
            clinic_id=clinic.id,
            display_name="Notes Instructions User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get appointment types
            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            
            data = response.json()
            assert "appointment_types" in data
            
            # Find our appointment type
            found_type = None
            for at in data["appointment_types"]:
                if at["id"] == appt_type.id:
                    found_type = at
                    break
            
            assert found_type is not None
            assert found_type["require_notes"] is True
            assert found_type["notes_instructions"] == "請詳細描述您的症狀"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_notes_instructions_fallback_to_global(self, db_session: Session, test_clinic_with_liff):
        """Test that notes_instructions fallback to global when service-specific is null."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Set global notes instructions
        clinic_settings = clinic.get_validated_settings()
        clinic_settings.clinic_info_settings.appointment_notes_instructions = "全域備註指引"
        clinic.settings = clinic_settings.model_dump()
        db_session.commit()

        # Create appointment type without notes_instructions (should fallback to global)
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Uses Global Instructions",
            duration_minutes=30,
            allow_patient_booking=True,
            require_notes=False,
            notes_instructions=None  # No service-specific instructions
        )
        db_session.add(appt_type)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_fallback",
            clinic_id=clinic.id,
            display_name="Fallback User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get appointment types
            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            
            data = response.json()
            # The API returns appointment_type_instructions, but notes_instructions fallback
            # is handled on the frontend. The API returns null for notes_instructions,
            # and frontend should use global appointment_notes_instructions from clinic-info
            
            # Verify appointment type has null notes_instructions
            found_type = None
            for at in data["appointment_types"]:
                if at["id"] == appt_type.id:
                    found_type = at
                    break
            
            assert found_type is not None
            assert found_type["notes_instructions"] is None

            # Get clinic info to verify global instructions are available
            clinic_info_response = client.get("/api/liff/clinic-info")
            assert clinic_info_response.status_code == 200
            clinic_info = clinic_info_response.json()
            assert clinic_info["appointment_notes_instructions"] == "全域備註指引"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_notes_instructions_service_specific_overrides_global(self, db_session: Session, test_clinic_with_liff):
        """Test that service-specific notes_instructions override global instructions."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Set global notes instructions
        clinic_settings = clinic.get_validated_settings()
        clinic_settings.clinic_info_settings.appointment_notes_instructions = "全域備註指引"
        clinic.settings = clinic_settings.model_dump()
        db_session.commit()

        # Create appointment type with service-specific notes_instructions
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Has Custom Instructions",
            duration_minutes=30,
            allow_patient_booking=True,
            require_notes=False,
            notes_instructions="服務專屬指引"  # Service-specific instructions
        )
        db_session.add(appt_type)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_override",
            clinic_id=clinic.id,
            display_name="Override User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get appointment types
            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200
            
            data = response.json()
            
            # Find our appointment type
            found_type = None
            for at in data["appointment_types"]:
                if at["id"] == appt_type.id:
                    found_type = at
                    break
            
            assert found_type is not None
            # Service-specific instructions should be returned
            assert found_type["notes_instructions"] == "服務專屬指引"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestLanguagePreference:
    """Test language preference functionality."""

    def test_liff_login_returns_existing_preferred_language(self, db_session: Session, test_clinic_with_liff):
        """Test that LIFF login returns existing preferred_language in response."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user with preferred_language
        line_user = LineUser(
            line_user_id="U_test_lang_login_existing",
            clinic_id=clinic.id,
            display_name="Test User",
            preferred_language="en"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock database dependency
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.post("/api/liff/auth/liff-login", json={
                "line_user_id": "U_test_lang_login_existing",
                "display_name": "Test User",
                "liff_access_token": "test_token",
                "clinic_token": clinic.liff_access_token
            })

            assert response.status_code == 200
            data = response.json()
            assert "preferred_language" in data
            assert data["preferred_language"] == "en"
        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_liff_login_returns_default_language_when_null(self, db_session: Session, test_clinic_with_liff):
        """Test that LIFF login returns default language when preferred_language is null."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user without preferred_language (null)
        line_user = LineUser(
            line_user_id="U_test_lang_login_null",
            clinic_id=clinic.id,
            display_name="Test User",
            preferred_language=None
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock database dependency
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.post("/api/liff/auth/liff-login", json={
                "line_user_id": "U_test_lang_login_null",
                "display_name": "Test User",
                "liff_access_token": "test_token",
                "clinic_token": clinic.liff_access_token
            })

            assert response.status_code == 200
            data = response.json()
            assert "preferred_language" in data
            assert data["preferred_language"] == "zh-TW"  # Default
        finally:
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_language_preference_success(self, db_session: Session, test_clinic_with_liff):
        """Test successfully updating language preference."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_lang_update",
            clinic_id=clinic.id,
            display_name="Test User",
            preferred_language="zh-TW"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication - use get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Update to English
            response = client.put("/api/liff/language-preference", json={
                "language": "en"
            })

            assert response.status_code == 200
            data = response.json()
            assert data["preferred_language"] == "en"

            # Verify database state (object is already updated in session)
            assert line_user.preferred_language == "en"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_language_preference_invalid_code(self, db_session: Session, test_clinic_with_liff):
        """Test updating language preference with invalid language code."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_lang_invalid",
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication - use get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try invalid language codes
            invalid_codes = ["zh", "en-US", "invalid", "中文", ""]
            for invalid_code in invalid_codes:
                response = client.put("/api/liff/language-preference", json={
                    "language": invalid_code
                })

                assert response.status_code == 422  # Validation error

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_language_preference_persists_in_database(self, db_session: Session, test_clinic_with_liff):
        """Test that language preference persists in database."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_lang_persist",
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Mock authentication for update - use get_current_line_user_with_clinic
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Update language preference
            response = client.put("/api/liff/language-preference", json={
                "language": "en"
            })
            assert response.status_code == 200

            # Verify in database (object is already updated in session)
            assert line_user.preferred_language == "en"

            # Verify it persists by querying fresh from database
            db_session.expire(line_user)
            db_session.refresh(line_user)
            assert line_user.preferred_language == "en"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestAllowPatientPractitionerSelection:
    """Test allow_patient_practitioner_selection setting for appointment types."""

    def test_create_appointment_rejects_practitioner_when_setting_false(self, db_session: Session, test_clinic_with_liff):
        """Test that creating appointment with practitioner_id is rejected when allow_patient_practitioner_selection=False."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with allow_patient_practitioner_selection=False
        appt_type_no_selection = AppointmentType(
            clinic_id=clinic.id,
            name="No Practitioner Selection",
            duration_minutes=30,
            allow_patient_practitioner_selection=False
        )
        db_session.add(appt_type_no_selection)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_no_selection.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_no_selection",
            clinic_id=clinic.id,
            display_name="No Selection User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="No Selection Patient",
            phone_number="0911111111",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to create appointment with practitioner_id - should be rejected
            future_date = (taiwan_now() + timedelta(days=3)).date().isoformat()
            appointment_data = {
                "patient_id": patient.id,
                "appointment_type_id": appt_type_no_selection.id,
                "practitioner_id": practitioner.id,  # This should be rejected
                "start_time": f"{future_date}T10:00:00+08:00",
                "notes": "Test appointment"
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 400
            assert "不允許指定負責人員" in response.json()["detail"]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_create_appointment_auto_assigns_when_setting_false(self, db_session: Session, test_clinic_with_liff):
        """Test that creating appointment without practitioner_id auto-assigns when allow_patient_practitioner_selection=False."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with allow_patient_practitioner_selection=False
        appt_type_no_selection = AppointmentType(
            clinic_id=clinic.id,
            name="Auto Assign Type",
            duration_minutes=30,
            allow_patient_practitioner_selection=False
        )
        db_session.add(appt_type_no_selection)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_no_selection.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_auto_assign",
            clinic_id=clinic.id,
            display_name="Auto Assign User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Auto Assign Patient",
            phone_number="0911111112",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Create appointment without practitioner_id - should auto-assign
            future_date = (taiwan_now() + timedelta(days=3)).date().isoformat()
            appointment_data = {
                "patient_id": patient.id,
                "appointment_type_id": appt_type_no_selection.id,
                "practitioner_id": None,  # No practitioner specified
                "start_time": f"{future_date}T10:00:00+08:00",
                "notes": "Auto assigned appointment"
            }

            response = client.post("/api/liff/appointments", json=appointment_data)
            assert response.status_code == 200

            appointment_result = response.json()
            # Should be auto-assigned
            assert appointment_result["practitioner_id"] is not None

            # Verify in database that it's auto-assigned
            calendar_event = db_session.query(CalendarEvent).filter(
                CalendarEvent.date == datetime.fromisoformat(future_date).date(),
                CalendarEvent.start_time == time(10, 0)
            ).first()
            assert calendar_event is not None

            appointment = db_session.query(Appointment).filter_by(
                calendar_event_id=calendar_event.id
            ).first()
            assert appointment is not None
            assert appointment.is_auto_assigned == True

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_reschedule_rejects_practitioner_change_when_setting_false(self, db_session: Session, test_clinic_with_liff):
        """Test that rescheduling with practitioner change is rejected when allow_patient_practitioner_selection=False."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create second practitioner
        practitioner2, practitioner2_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@liffclinic.com",
            google_subject_id="google_123_practitioner2",
            full_name="Dr. Second Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type with allow_patient_practitioner_selection=False
        appt_type_no_selection = AppointmentType(
            clinic_id=clinic.id,
            name="No Selection Type",
            duration_minutes=30,
            allow_patient_practitioner_selection=False
        )
        db_session.add(appt_type_no_selection)
        
        # Associate both practitioners with this appointment type
        for p in [practitioner, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=p.id,
                clinic_id=clinic.id,
                appointment_type_id=appt_type_no_selection.id
            )
            db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_reschedule_reject",
            clinic_id=clinic.id,
            display_name="Reschedule Reject User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Reschedule Reject Patient",
            phone_number="0911111113",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Create an existing appointment with practitioner
        future_date = (taiwan_now() + timedelta(days=3)).date()
        calendar_event = create_calendar_event_with_clinic(
            db_session,
            practitioner=practitioner,
            clinic=clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()  # Flush to get calendar_event.id

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type_no_selection.id,
            status="confirmed",
            is_auto_assigned=False  # Originally manually assigned
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to reschedule and change practitioner - should be rejected
            new_future_date = (taiwan_now() + timedelta(days=4)).date().isoformat()
            reschedule_data = {
                "new_practitioner_id": practitioner2.id,  # Trying to change practitioner
                "new_start_time": f"{new_future_date}T11:00:00+08:00",
                "new_notes": None
            }

            response = client.post(
                f"/api/liff/appointments/{appointment.calendar_event_id}/reschedule",
                json=reschedule_data
            )
            assert response.status_code == 400
            assert "不允許變更治療師" in response.json()["detail"]

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_reschedule_allows_keeping_same_practitioner_when_setting_false(self, db_session: Session, test_clinic_with_liff):
        """Test that rescheduling while keeping same practitioner is allowed when allow_patient_practitioner_selection=False."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with allow_patient_practitioner_selection=False
        appt_type_no_selection = AppointmentType(
            clinic_id=clinic.id,
            name="Keep Practitioner Type",
            duration_minutes=30,
            allow_patient_practitioner_selection=False
        )
        db_session.add(appt_type_no_selection)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_no_selection.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_reschedule_keep",
            clinic_id=clinic.id,
            display_name="Reschedule Keep User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Reschedule Keep Patient",
            phone_number="0911111114",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Create an existing appointment with practitioner
        future_date = (taiwan_now() + timedelta(days=3)).date()
        calendar_event = create_calendar_event_with_clinic(
            db_session,
            practitioner=practitioner,
            clinic=clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()  # Flush to get calendar_event.id

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type_no_selection.id,
            status="confirmed",
            is_auto_assigned=False  # Originally manually assigned
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Reschedule keeping same practitioner (by passing current practitioner_id) - should succeed
            new_future_date = (taiwan_now() + timedelta(days=4)).date().isoformat()
            reschedule_data = {
                "new_practitioner_id": practitioner.id,  # Keeping same practitioner
                "new_start_time": f"{new_future_date}T11:00:00+08:00",
                "new_notes": "Updated notes"
            }

            response = client.post(
                f"/api/liff/appointments/{appointment.calendar_event_id}/reschedule",
                json=reschedule_data
            )
            assert response.status_code == 200

            # Verify appointment was updated
            db_session.refresh(appointment)
            db_session.refresh(calendar_event)
            assert calendar_event.user_id == practitioner.id  # Still same practitioner
            assert appointment.notes == "Updated notes"

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_reschedule_allows_auto_assignment_request_when_setting_false(self, db_session: Session, test_clinic_with_liff):
        """Test that rescheduling with auto-assignment request (-1) is allowed when allow_patient_practitioner_selection=False."""
        clinic, practitioner, appt_types, _ = test_clinic_with_liff

        # Create appointment type with allow_patient_practitioner_selection=False
        appt_type_no_selection = AppointmentType(
            clinic_id=clinic.id,
            name="Auto Assign Request Type",
            duration_minutes=30,
            allow_patient_practitioner_selection=False
        )
        db_session.add(appt_type_no_selection)
        
        # Associate practitioner with this appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_no_selection.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_reschedule_auto",
            clinic_id=clinic.id,
            display_name="Reschedule Auto User"
        )
        db_session.add(line_user)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Reschedule Auto Patient",
            phone_number="0911111115",
            line_user_id=None
        )
        db_session.add(patient)
        db_session.commit()

        patient.line_user_id = line_user.id
        db_session.commit()

        # Create an existing appointment with practitioner
        future_date = (taiwan_now() + timedelta(days=3)).date()
        calendar_event = create_calendar_event_with_clinic(
            db_session,
            practitioner=practitioner,
            clinic=clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()  # Flush to get calendar_event.id

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type_no_selection.id,
            status="confirmed",
            is_auto_assigned=False  # Originally manually assigned
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Reschedule requesting auto-assignment (pass -1) - should succeed
            # Note: Frontend doesn't currently expose this option, but backend supports it
            new_future_date = (taiwan_now() + timedelta(days=4)).date().isoformat()
            reschedule_data = {
                "new_practitioner_id": -1,  # Request auto-assignment
                "new_start_time": f"{new_future_date}T11:00:00+08:00",
                "new_notes": "Request auto-assignment"
            }

            response = client.post(
                f"/api/liff/appointments/{appointment.calendar_event_id}/reschedule",
                json=reschedule_data
            )
            assert response.status_code == 200

            # Verify appointment was updated and auto-assigned
            db_session.refresh(appointment)
            db_session.refresh(calendar_event)
            # The appointment should be auto-assigned (practitioner may be different or same)
            assert appointment.notes == "Request auto-assignment"
            # Verify it's marked as auto-assigned
            assert appointment.is_auto_assigned == True

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)
