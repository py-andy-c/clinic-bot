"""
Integration tests for appointment type patient visibility feature.

Tests the new dual-field appointment type visibility logic:
- allow_new_patient_booking
- allow_existing_patient_booking
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import (
    Clinic, User, AppointmentType, PractitionerAppointmentTypes,
    Patient, LineUser, PatientPractitionerAssignment
)
from auth.dependencies import get_current_line_user_with_clinic, get_db
from tests.conftest import create_user_with_clinic_association


client = TestClient(app)


class TestAppointmentTypePatientVisibility:
    """Integration tests for appointment type patient visibility."""

    def test_appointment_types_include_new_fields(self, db_session: Session):
        """Test that appointment types API returns the new visibility fields."""
        # Setup: Create clinic, user, and appointment types
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            liff_id="test-liff-id",
            liff_access_token="test-token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner with clinic association
        practitioner, practitioner_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="google_practitioner",
            full_name="Test Practitioner",
            roles=["practitioner"]
        )

        line_user = LineUser(
            line_user_id="test-line-user",
            display_name="Test User",
            clinic_id=clinic.id
        )
        db_session.add(line_user)
        db_session.commit()

        # Create appointment types with different visibility settings
        appt_type_new_only = AppointmentType(
            clinic_id=clinic.id,
            name="New Patients Only",
            duration_minutes=30,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=False
        )

        appt_type_existing_only = AppointmentType(
            clinic_id=clinic.id,
            name="Existing Patients Only",
            duration_minutes=45,
            allow_new_patient_booking=False,
            allow_existing_patient_booking=True
        )

        appt_type_both = AppointmentType(
            clinic_id=clinic.id,
            name="All Patients",
            duration_minutes=60,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True
        )

        db_session.add_all([appt_type_new_only, appt_type_existing_only, appt_type_both])
        db_session.commit()

        # Associate practitioner with appointment types
        from models import PractitionerAppointmentTypes
        pat_new_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_new_only.id
        )
        pat_existing_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_existing_only.id
        )
        pat_both = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_both.id
        )
        db_session.add_all([pat_new_only, pat_existing_only, pat_both])
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test API response includes new fields
            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200

            data = response.json()
            appointment_types = data["appointment_types"]

            # Should return appointment types available to new patients when no patient_id is specified
            assert len(appointment_types) == 2

            # Check that all required fields are present
            for appt_type in appointment_types:
                assert "id" in appt_type
                assert "name" in appt_type
                assert "duration_minutes" in appt_type
                assert "allow_patient_booking" in appt_type  # Deprecated field
                assert "allow_new_patient_booking" in appt_type  # New field
                assert "allow_existing_patient_booking" in appt_type  # New field

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_types_filter_for_new_patient(self, db_session: Session):
        """Test that appointment types are filtered correctly for new patients (no assignments)."""
        # Setup: Create clinic, user, patient without assignments, and appointment types
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            liff_id="test-liff-id",
            liff_access_token="test-token"
        )
        db_session.add(clinic)
        db_session.commit()

        user, user_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="test@example.com",
            google_subject_id="google_test_user",
            full_name="Test User",
            roles=["admin"]
        )

        line_user = LineUser(
            line_user_id="test-line-user",
            display_name="Test User",
            clinic_id=clinic.id
        )
        db_session.add(line_user)
        db_session.commit()  # Commit LineUser first

        # Create patient without practitioner assignments (new patient)
        new_patient = Patient(
            clinic_id=clinic.id,
            full_name="New Patient",
            line_user_id=line_user.id
        )
        db_session.add(new_patient)
        db_session.commit()

        # Create appointment types with different visibility settings
        appt_type_new_only = AppointmentType(
            clinic_id=clinic.id,
            name="New Patients Only",
            duration_minutes=30,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=False
        )

        appt_type_existing_only = AppointmentType(
            clinic_id=clinic.id,
            name="Existing Patients Only",
            duration_minutes=45,
            allow_new_patient_booking=False,
            allow_existing_patient_booking=True
        )

        appt_type_both = AppointmentType(
            clinic_id=clinic.id,
            name="All Patients",
            duration_minutes=60,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True
        )

        db_session.add_all([appt_type_new_only, appt_type_existing_only, appt_type_both])
        db_session.commit()

        # Associate practitioner with appointment types
        from models import PractitionerAppointmentTypes
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="google_practitioner",
            full_name="Test Practitioner",
            roles=["practitioner"]
        )
        pat_new_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_new_only.id
        )
        pat_existing_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_existing_only.id
        )
        pat_both = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_both.id
        )
        db_session.add_all([pat_new_only, pat_existing_only, pat_both])
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test filtering for new patient
            response = client.get(f"/api/liff/appointment-types?patient_id={new_patient.id}")
            assert response.status_code == 200

            data = response.json()
            appointment_types = data["appointment_types"]

            # Should only return appointment types available to new patients
            appointment_names = {appt["name"] for appt in appointment_types}
            assert "New Patients Only" in appointment_names
            assert "All Patients" in appointment_names
            assert "Existing Patients Only" not in appointment_names
            assert len(appointment_types) == 2

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_types_filter_for_existing_patient(self, db_session: Session):
        """Test that appointment types are filtered correctly for existing patients (with assignments)."""
        # Setup: Create clinic, user, patient with assignments, and appointment types
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            liff_id="test-liff-id",
            liff_access_token="test-token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner, practitioner_assoc = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@example.com",
            google_subject_id="google_practitioner",
            full_name="Test Practitioner",
            roles=["practitioner"]
        )

        line_user = LineUser(
            line_user_id="test-line-user",
            display_name="Test User",
            clinic_id=clinic.id
        )
        db_session.add(line_user)
        db_session.commit()  # Commit LineUser first

        # Create patient with practitioner assignment (existing patient)
        existing_patient = Patient(
            clinic_id=clinic.id,
            full_name="Existing Patient",
            line_user_id=line_user.id
        )
        db_session.add(existing_patient)
        db_session.commit()  # Commit patient first to get ID

        # Create practitioner assignment
        assignment = PatientPractitionerAssignment(
            patient_id=existing_patient.id,
            user_id=practitioner.id,
            clinic_id=clinic.id
        )
        db_session.add(assignment)
        db_session.commit()

        # Create appointment types with different visibility settings
        appt_type_new_only = AppointmentType(
            clinic_id=clinic.id,
            name="New Patients Only",
            duration_minutes=30,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=False
        )

        appt_type_existing_only = AppointmentType(
            clinic_id=clinic.id,
            name="Existing Patients Only",
            duration_minutes=45,
            allow_new_patient_booking=False,
            allow_existing_patient_booking=True
        )

        appt_type_both = AppointmentType(
            clinic_id=clinic.id,
            name="All Patients",
            duration_minutes=60,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True
        )

        db_session.add_all([appt_type_new_only, appt_type_existing_only, appt_type_both])
        db_session.commit()

        # Associate practitioner with appointment types
        from models import PractitionerAppointmentTypes
        pat_new_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_new_only.id
        )
        pat_existing_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_existing_only.id
        )
        pat_both = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_both.id
        )
        db_session.add_all([pat_new_only, pat_existing_only, pat_both])
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test filtering for existing patient
            response = client.get(f"/api/liff/appointment-types?patient_id={existing_patient.id}")
            assert response.status_code == 200

            data = response.json()
            appointment_types = data["appointment_types"]

            # Should only return appointment types available to existing patients
            appointment_names = {appt["name"] for appt in appointment_types}
            assert "Existing Patients Only" in appointment_names
            assert "All Patients" in appointment_names
            assert "New Patients Only" not in appointment_names
            assert len(appointment_types) == 2

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_appointment_types_no_patient_filter(self, db_session: Session):
        """Test that appointment types return new patient types when no patient_id is provided."""
        # Setup: Create clinic, user, and appointment types
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            liff_id="test-liff-id",
            liff_access_token="test-token"
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(
            line_user_id="test-line-user",
            display_name="Test User",
            clinic_id=clinic.id
        )
        db_session.add(line_user)
        db_session.commit()

        # Create appointment types with different visibility settings
        appt_type_new_only = AppointmentType(
            clinic_id=clinic.id,
            name="New Patients Only",
            duration_minutes=30,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=False
        )

        appt_type_existing_only = AppointmentType(
            clinic_id=clinic.id,
            name="Existing Patients Only",
            duration_minutes=45,
            allow_new_patient_booking=False,
            allow_existing_patient_booking=True
        )

        appt_type_both = AppointmentType(
            clinic_id=clinic.id,
            name="All Patients",
            duration_minutes=60,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True
        )

        db_session.add_all([appt_type_new_only, appt_type_existing_only, appt_type_both])
        db_session.commit()

        # Associate practitioner with appointment types
        from models import PractitionerAppointmentTypes
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="google_practitioner",
            full_name="Test Practitioner",
            roles=["practitioner"]
        )
        pat_new_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_new_only.id
        )
        pat_existing_only = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_existing_only.id
        )
        pat_both = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type_both.id
        )
        db_session.add_all([pat_new_only, pat_existing_only, pat_both])
        db_session.commit()

        # Mock authentication
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user, clinic)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test without patient_id (Flow 1 scenario)
            response = client.get("/api/liff/appointment-types")
            assert response.status_code == 200

            data = response.json()
            appointment_types = data["appointment_types"]

            # Should return appointment types available to new patients
            appointment_names = {appt["name"] for appt in appointment_types}
            assert "New Patients Only" in appointment_names
            assert "All Patients" in appointment_names
            assert "Existing Patients Only" not in appointment_names
            assert len(appointment_types) == 2

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_patient_ownership_validation(self, db_session: Session):
        """Test that patient_id parameter validates patient ownership."""
        # Setup: Create two clinics and users
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="test_channel_1",
            line_channel_secret="test_secret_1",
            line_channel_access_token="test_token_1",
            liff_id="test-liff-id-1",
            liff_access_token="test-token-1"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="test_channel_2",
            line_channel_secret="test_secret_2",
            line_channel_access_token="test_token_2",
            liff_id="test-liff-id-2",
            liff_access_token="test-token-2"
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()

        line_user1 = LineUser(
            line_user_id="test-line-user-1",
            display_name="Test User 1",
            clinic_id=clinic1.id
        )
        line_user2 = LineUser(
            line_user_id="test-line-user-2",
            display_name="Test User 2",
            clinic_id=clinic2.id
        )
        db_session.add_all([line_user1, line_user2])

        # Create patient belonging to clinic2
        patient_clinic2 = Patient(
            clinic_id=clinic2.id,
            full_name="Patient from Clinic 2",
            line_user_id=line_user2.id
        )
        db_session.add(patient_clinic2)
        db_session.commit()

        # Mock authentication as clinic1 user trying to access clinic2 patient
        client.app.dependency_overrides[get_current_line_user_with_clinic] = lambda: (line_user1, clinic1)
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Should be rejected due to patient ownership validation
            response = client.get(f"/api/liff/appointment-types?patient_id={patient_clinic2.id}")
            assert response.status_code == 403

        finally:
            client.app.dependency_overrides.pop(get_current_line_user_with_clinic, None)
            client.app.dependency_overrides.pop(get_db, None)
