"""
Integration tests for patient detail endpoints.

Tests GET /clinic/patients/:id, PUT /clinic/patients/:id, and GET /clinic/patients/:id/appointments.
"""
import pytest
from datetime import date, datetime, timezone, timedelta, time
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.appointment_type import AppointmentType
from tests.conftest import create_user_with_clinic_association, create_calendar_event_with_clinic

client = TestClient(app)


@pytest.fixture
def test_clinic(db_session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()
    return clinic


@pytest.fixture
def clinic_admin(db_session, test_clinic):
    """Create a clinic admin user."""
    admin, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Admin User",
        email="admin@test.com",
        google_subject_id="admin_sub_123",
        roles=["admin"],
        is_active=True
    )
    return admin, test_clinic


@pytest.fixture
def clinic_practitioner(db_session, test_clinic):
    """Create a clinic practitioner user."""
    practitioner, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Practitioner User",
        email="practitioner@test.com",
        google_subject_id="practitioner_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    return practitioner, test_clinic


@pytest.fixture
def read_only_user(db_session, test_clinic):
    """Create a read-only user."""
    user, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Read Only User",
        email="readonly@test.com",
        google_subject_id="readonly_sub_123",
        roles=[],
        is_active=True
    )
    return user, test_clinic


@pytest.fixture
def auth_headers_admin(clinic_admin, db_session):
    """Get auth headers for clinic admin."""
    admin, clinic = clinic_admin
    db_session.refresh(admin)
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=admin.google_subject_id or f"test_sub_{admin.id}",
        user_id=admin.id,
        email=admin.email,
        user_type="clinic_user",
        roles=["admin"],
        name="Admin User",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_practitioner(clinic_practitioner, db_session):
    """Get auth headers for clinic practitioner."""
    practitioner, clinic = clinic_practitioner
    db_session.refresh(practitioner)
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=practitioner.google_subject_id or f"test_sub_{practitioner.id}",
        user_id=practitioner.id,
        email=practitioner.email,
        user_type="clinic_user",
        roles=["practitioner"],
        name="Practitioner User",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_readonly(read_only_user, db_session):
    """Get auth headers for read-only user."""
    user, clinic = read_only_user
    db_session.refresh(user)
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=user.google_subject_id or f"test_sub_{user.id}",
        user_id=user.id,
        email=user.email,
        user_type="clinic_user",
        roles=[],
        name="Read Only User",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_patient(db_session, test_clinic):
    """Create a test patient."""
    patient = Patient(
        clinic_id=test_clinic.id,
        full_name="Test Patient",
        phone_number="0912345678",
        birthday=date(1990, 1, 1),
        created_at=datetime.now(timezone.utc),
        is_deleted=False
    )
    db_session.add(patient)
    db_session.commit()
    return patient


@pytest.fixture
def soft_deleted_patient(db_session, test_clinic):
    """Create a soft-deleted test patient."""
    patient = Patient(
        clinic_id=test_clinic.id,
        full_name="Deleted Patient",
        phone_number="0987654321",
        birthday=date(1985, 5, 15),
        created_at=datetime.now(timezone.utc),
        is_deleted=True,
        deleted_at=datetime.now(timezone.utc)
    )
    db_session.add(patient)
    db_session.commit()
    return patient


class TestGetPatient:
    """Tests for GET /clinic/patients/:id endpoint."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_get_patient_as_admin(self, auth_headers_admin, test_patient):
        """Admin can get patient details."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_patient.id
        assert data["full_name"] == "Test Patient"
        assert data["phone_number"] == "0912345678"
        assert data["birthday"] == "1990-01-01"
        assert data["is_deleted"] is False

    def test_get_patient_as_practitioner(self, auth_headers_practitioner, test_patient):
        """Practitioner can get patient details."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_practitioner
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_patient.id

    def test_get_patient_as_readonly(self, auth_headers_readonly, test_patient):
        """Read-only user can get patient details."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_readonly
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_patient.id

    def test_get_soft_deleted_patient(self, auth_headers_admin, soft_deleted_patient):
        """Can get soft-deleted patient details."""
        response = client.get(
            f"/api/clinic/patients/{soft_deleted_patient.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == soft_deleted_patient.id
        assert data["is_deleted"] is True

    def test_get_nonexistent_patient(self, auth_headers_admin):
        """Returns 404 for nonexistent patient."""
        response = client.get(
            "/api/clinic/patients/99999",
            headers=auth_headers_admin
        )
        assert response.status_code == 404


class TestUpdatePatient:
    """Tests for PUT /clinic/patients/:id endpoint."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_update_patient_as_admin(self, auth_headers_admin, test_patient):
        """Admin can update patient."""
        response = client.put(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin,
            json={
                "full_name": "Updated Name",
                "phone_number": "0999888777",
                "birthday": "1995-06-15"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "Updated Name"
        assert data["phone_number"] == "0999888777"
        assert data["birthday"] == "1995-06-15"

    def test_update_patient_as_practitioner(self, auth_headers_practitioner, test_patient):
        """Practitioner can update patient."""
        response = client.put(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_practitioner,
            json={"full_name": "Practitioner Updated"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "Practitioner Updated"

    def test_update_patient_as_readonly(self, auth_headers_readonly, test_patient):
        """Read-only user cannot update patient."""
        response = client.put(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_readonly,
            json={"full_name": "Should Fail"}
        )
        assert response.status_code == 403

    def test_partial_update(self, auth_headers_admin, test_patient):
        """Can update only some fields."""
        response = client.put(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin,
            json={"full_name": "Partial Update"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "Partial Update"
        # Other fields should remain unchanged
        assert data["phone_number"] == "0912345678"

    def test_update_nonexistent_patient(self, auth_headers_admin):
        """Returns 404 for nonexistent patient."""
        response = client.put(
            "/api/clinic/patients/99999",
            headers=auth_headers_admin,
            json={"full_name": "Test"}
        )
        assert response.status_code == 404


class TestGetPatientAppointments:
    """Tests for GET /clinic/patients/:id/appointments endpoint."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    @pytest.fixture
    def appointment_type(self, db_session, test_clinic):
        """Create an appointment type."""
        apt_type = AppointmentType(
            clinic_id=test_clinic.id,
            name="Test Appointment",
            duration_minutes=30
        )
        db_session.add(apt_type)
        db_session.commit()
        return apt_type

    @pytest.fixture
    def practitioner_user(self, db_session, test_clinic):
        """Create a practitioner user for appointments."""
        user, assoc = create_user_with_clinic_association(
            db_session=db_session,
            clinic=test_clinic,
            full_name="Practitioner",
            email="pract@test.com",
            google_subject_id="pract_sub",
            roles=["practitioner"],
            is_active=True
        )
        return user

    @pytest.fixture
    def past_appointment(self, db_session, test_clinic, test_patient, appointment_type, practitioner_user):
        """Create a past appointment."""
        from utils.datetime_utils import taiwan_now
        past_date = taiwan_now().date() - timedelta(days=7)
        
        event = create_calendar_event_with_clinic(
            db_session,
            practitioner_user,
            test_clinic,
            event_type="appointment",
            event_date=past_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=event.id,
            patient_id=test_patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        return appointment

    @pytest.fixture
    def future_appointment(self, db_session, test_clinic, test_patient, appointment_type, practitioner_user):
        """Create a future appointment."""
        from utils.datetime_utils import taiwan_now
        future_date = taiwan_now().date() + timedelta(days=7)
        
        event = create_calendar_event_with_clinic(
            db_session,
            practitioner_user,
            test_clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(14, 0),
            end_time=time(14, 30)
        )
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=event.id,
            patient_id=test_patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed",
            notes="Test notes"
        )
        db_session.add(appointment)
        db_session.commit()
        return appointment

    def test_get_all_appointments(self, auth_headers_admin, test_patient, past_appointment, future_appointment):
        """Can get all appointments for a patient."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["appointments"]) == 2

    def test_get_future_appointments_only(self, auth_headers_admin, test_patient, past_appointment, future_appointment):
        """Can filter for future appointments only."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin,
            params={"upcoming_only": True}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["appointments"]) == 1
        assert data["appointments"][0]["status"] == "confirmed"

    def test_get_appointments_by_status(self, auth_headers_admin, test_patient, past_appointment, future_appointment):
        """Can filter appointments by status."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin,
            params={"status": "confirmed"}
        )
        assert response.status_code == 200
        data = response.json()
        assert all(apt["status"] == "confirmed" for apt in data["appointments"])

    def test_get_appointments_as_readonly(self, auth_headers_readonly, test_patient, future_appointment):
        """Read-only user can view appointments."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_readonly
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["appointments"]) >= 1

    def test_get_appointments_includes_notes(self, auth_headers_admin, test_patient, future_appointment):
        """Future appointments include patient notes."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin,
            params={"upcoming_only": True}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["appointments"][0]["notes"] == "Test notes"

    def test_get_appointments_includes_new_fields(self, auth_headers_admin, test_patient, future_appointment, practitioner_user, appointment_type):
        """Appointments include new fields needed for edit/delete functionality."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin,
            params={"upcoming_only": True}
        )
        assert response.status_code == 200
        data = response.json()
        appointment = data["appointments"][0]
        
        # Check new fields are present
        assert "calendar_event_id" in appointment
        assert appointment["calendar_event_id"] == appointment["id"]  # Should match id field
        assert "practitioner_id" in appointment
        assert appointment["practitioner_id"] == practitioner_user.id
        assert "appointment_type_id" in appointment
        assert appointment["appointment_type_id"] == appointment_type.id
        assert "line_display_name" in appointment
        assert "event_name" in appointment
        # event_name should be the default format when custom_event_name is not set
        assert appointment["event_name"] == f"{test_patient.full_name} - {appointment_type.name}"
        assert "originally_auto_assigned" in appointment
        assert isinstance(appointment["originally_auto_assigned"], bool)

    def test_get_appointments_with_line_user(self, db_session, auth_headers_admin, test_clinic, test_patient, future_appointment):
        """Appointments include line_display_name when patient has LINE user."""
        from models.line_user import LineUser
        
        # Create a LINE user and link it to the patient
        line_user = LineUser(
            line_user_id="test_line_user_123",
            clinic_id=test_clinic.id,
            display_name="Test LINE User",
            clinic_display_name=None
        )
        db_session.add(line_user)
        db_session.flush()
        
        test_patient.line_user_id = line_user.id
        db_session.commit()
        
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin,
            params={"upcoming_only": True}
        )
        assert response.status_code == 200
        data = response.json()
        appointment = data["appointments"][0]
        
        # Should have line_display_name
        assert appointment["line_display_name"] == "Test LINE User"

    def test_get_appointments_without_line_user(self, auth_headers_admin, test_patient, future_appointment):
        """Appointments have null line_display_name when patient has no LINE user."""
        # Ensure patient has no LINE user
        assert test_patient.line_user_id is None
        
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}/appointments",
            headers=auth_headers_admin,
            params={"upcoming_only": True}
        )
        assert response.status_code == 200
        data = response.json()
        appointment = data["appointments"][0]
        
        # Should have null line_display_name
        assert appointment["line_display_name"] is None

