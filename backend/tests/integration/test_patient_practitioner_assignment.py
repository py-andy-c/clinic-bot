"""
Integration tests for patient-practitioner assignment endpoints.

Tests:
- GET /clinic/patients/:id (with assigned_practitioner_ids)
- PUT /clinic/patients/:id (with assigned_practitioner_ids)
- POST /clinic/patients/:id/assign-practitioner
- DELETE /clinic/patients/:id/assign-practitioner/:practitioner_id
- GET /clinic/patients (with practitioner_id filter)
- GET /api/liff/practitioners (with patient_id filter)
"""
import pytest
from datetime import date, datetime, timezone
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.patient_practitioner_assignment import PatientPractitionerAssignment
from models.appointment_type import AppointmentType
from models.practitioner_appointment_types import PractitionerAppointmentTypes
from tests.conftest import create_user_with_clinic_association

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
def second_practitioner(db_session, test_clinic):
    """Create a second practitioner user."""
    practitioner, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Second Practitioner",
        email="practitioner2@test.com",
        google_subject_id="practitioner2_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    return practitioner, test_clinic


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
def test_patient(db_session, test_clinic):
    """Create a test patient."""
    patient = Patient(
        clinic_id=test_clinic.id,
        full_name="Test Patient",
        phone_number="0912345678",
        birthday=date(1990, 1, 1),
        created_at=datetime.now(timezone.utc),
        created_by_type="clinic_user"
    )
    db_session.add(patient)
    db_session.commit()
    return patient


class TestGetPatientWithAssignments:
    """Tests for GET /clinic/patients/:id with assigned practitioners."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_get_patient_with_no_assignments(self, auth_headers_admin, test_patient):
        """Patient with no assignments should return empty list."""
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_practitioner_ids"] == []

    def test_get_patient_with_assignments(self, db_session, auth_headers_admin, test_patient, clinic_practitioner, second_practitioner):
        """Patient with assignments should return practitioner IDs."""
        practitioner, clinic = clinic_practitioner
        practitioner2, _ = second_practitioner
        
        # Create assignments
        assignment1 = PatientPractitionerAssignment(
            patient_id=test_patient.id,
            user_id=practitioner.id,
            clinic_id=clinic.id,
            created_at=datetime.now(timezone.utc)
        )
        assignment2 = PatientPractitionerAssignment(
            patient_id=test_patient.id,
            user_id=practitioner2.id,
            clinic_id=clinic.id,
            created_at=datetime.now(timezone.utc)
        )
        db_session.add(assignment1)
        db_session.add(assignment2)
        db_session.commit()
        
        response = client.get(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        assert set(data["assigned_practitioner_ids"]) == {practitioner.id, practitioner2.id}


class TestUpdatePatientAssignments:
    """Tests for PUT /clinic/patients/:id with assigned_practitioner_ids."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_update_patient_with_assignments(self, auth_headers_admin, test_patient, clinic_practitioner, second_practitioner):
        """Can update patient with assigned practitioners."""
        practitioner, clinic = clinic_practitioner
        practitioner2, _ = second_practitioner
        
        response = client.put(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin,
            json={
                "assigned_practitioner_ids": [practitioner.id, practitioner2.id]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert set(data["assigned_practitioner_ids"]) == {practitioner.id, practitioner2.id}

    def test_update_patient_clear_assignments(self, db_session, auth_headers_admin, test_patient, clinic_practitioner):
        """Can clear all assignments by passing empty list."""
        practitioner, clinic = clinic_practitioner
        
        # First assign a practitioner
        assignment = PatientPractitionerAssignment(
            patient_id=test_patient.id,
            user_id=practitioner.id,
            clinic_id=clinic.id,
            created_at=datetime.now(timezone.utc)
        )
        db_session.add(assignment)
        db_session.commit()
        
        # Then clear assignments
        response = client.put(
            f"/api/clinic/patients/{test_patient.id}",
            headers=auth_headers_admin,
            json={
                "assigned_practitioner_ids": []
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_practitioner_ids"] == []


class TestAssignPractitioner:
    """Tests for POST /clinic/patients/:id/assign-practitioner."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_assign_practitioner(self, auth_headers_admin, test_patient, clinic_practitioner):
        """Can assign a practitioner to a patient."""
        practitioner, clinic = clinic_practitioner
        
        response = client.post(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner",
            headers=auth_headers_admin,
            json={"user_id": practitioner.id}
        )
        assert response.status_code == 200
        data = response.json()
        assert practitioner.id in data["assigned_practitioner_ids"]

    def test_assign_duplicate_practitioner(self, auth_headers_admin, test_patient, clinic_practitioner):
        """Cannot assign the same practitioner twice."""
        practitioner, clinic = clinic_practitioner
        
        # First assignment
        response1 = client.post(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner",
            headers=auth_headers_admin,
            json={"user_id": practitioner.id}
        )
        assert response1.status_code == 200
        
        # Second assignment should fail
        response2 = client.post(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner",
            headers=auth_headers_admin,
            json={"user_id": practitioner.id}
        )
        assert response2.status_code == 409

    def test_assign_nonexistent_practitioner(self, auth_headers_admin, test_patient):
        """Cannot assign nonexistent practitioner."""
        response = client.post(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner",
            headers=auth_headers_admin,
            json={"user_id": 99999}
        )
        assert response.status_code == 404

    def test_assign_practitioner_as_practitioner(self, auth_headers_practitioner, test_patient, clinic_practitioner):
        """Practitioner can assign themselves."""
        practitioner, clinic = clinic_practitioner
        
        response = client.post(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner",
            headers=auth_headers_practitioner,
            json={"user_id": practitioner.id}
        )
        assert response.status_code == 200


class TestRemovePractitionerAssignment:
    """Tests for DELETE /clinic/patients/:id/assign-practitioner/:practitioner_id."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_remove_assignment(self, db_session, auth_headers_admin, test_patient, clinic_practitioner):
        """Can remove a practitioner assignment."""
        practitioner, clinic = clinic_practitioner
        
        # First assign
        assignment = PatientPractitionerAssignment(
            patient_id=test_patient.id,
            user_id=practitioner.id,
            clinic_id=clinic.id,
            created_at=datetime.now(timezone.utc)
        )
        db_session.add(assignment)
        db_session.commit()
        
        # Then remove
        response = client.delete(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner/{practitioner.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        assert practitioner.id not in data["assigned_practitioner_ids"]

    def test_remove_nonexistent_assignment(self, auth_headers_admin, test_patient, clinic_practitioner):
        """Cannot remove nonexistent assignment."""
        practitioner, clinic = clinic_practitioner
        
        response = client.delete(
            f"/api/clinic/patients/{test_patient.id}/assign-practitioner/{practitioner.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 404


class TestListPatientsWithPractitionerFilter:
    """Tests for GET /clinic/patients with practitioner_id filter."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_filter_by_practitioner(self, db_session, auth_headers_admin, test_patient, clinic_practitioner, second_practitioner):
        """Can filter patients by assigned practitioner."""
        practitioner, clinic = clinic_practitioner
        practitioner2, _ = second_practitioner
        
        # Create another patient
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Second Patient",
            phone_number="0923456789",
            created_at=datetime.now(timezone.utc),
            created_by_type="clinic_user"
        )
        db_session.add(patient2)
        db_session.commit()
        
        # Assign practitioner to first patient only
        assignment = PatientPractitionerAssignment(
            patient_id=test_patient.id,
            user_id=practitioner.id,
            clinic_id=clinic.id,
            created_at=datetime.now(timezone.utc)
        )
        db_session.add(assignment)
        db_session.commit()
        
        # Filter by practitioner
        response = client.get(
            f"/api/clinic/patients?practitioner_id={practitioner.id}",
            headers=auth_headers_admin
        )
        assert response.status_code == 200
        data = response.json()
        patient_ids = [p["id"] for p in data["patients"]]
        assert test_patient.id in patient_ids
        assert patient2.id not in patient_ids

