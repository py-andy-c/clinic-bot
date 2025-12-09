"""
Integration tests for appointment permission checks.

Tests that verify the permission rules for editing, deleting, and viewing
appointments, especially for auto-assigned appointments.
"""

import pytest
from datetime import datetime, time, timedelta
from fastapi.testclient import TestClient
from fastapi import status

from main import app
from utils.datetime_utils import taiwan_now
from core.database import get_db
from auth.dependencies import get_current_user, UserContext
from models.clinic import Clinic
from models.user import User
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.calendar_event import CalendarEvent
from models.practitioner_appointment_types import PractitionerAppointmentTypes
from tests.conftest import create_user_with_clinic_association


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def test_clinic_and_users(db_session):
    """Create a test clinic with admin and practitioner users."""
    clinic = Clinic(
        name="Permission Test Clinic",
        line_channel_id="test_permission_channel",
        line_channel_secret="test_permission_secret",
        line_channel_access_token="test_permission_token"
    )
    db_session.add(clinic)
    db_session.commit()

    # Create admin user
    admin, admin_assoc = create_user_with_clinic_association(
        db_session, clinic, "Admin User", "admin@test.com", "admin_google_sub", ["admin", "practitioner"], True
    )

    # Create practitioner user (non-admin)
    practitioner, practitioner_assoc = create_user_with_clinic_association(
        db_session, clinic, "Practitioner User", "practitioner@test.com", "practitioner_google_sub", ["practitioner"], True
    )

    # Create another practitioner for testing "others' appointments"
    practitioner2, practitioner2_assoc = create_user_with_clinic_association(
        db_session, clinic, "Practitioner 2", "practitioner2@test.com", "practitioner2_google_sub", ["practitioner"], True
    )

    db_session.commit()

    return {
        'clinic': clinic,
        'admin': admin,
        'admin_assoc': admin_assoc,
        'practitioner': practitioner,
        'practitioner_assoc': practitioner_assoc,
        'practitioner2': practitioner2,
        'practitioner2_assoc': practitioner2_assoc,
    }


@pytest.fixture
def test_appointment_type(db_session, test_clinic_and_users):
    """Create a test appointment type."""
    clinic = test_clinic_and_users['clinic']
    appointment_type = AppointmentType(
        clinic_id=clinic.id,
        name="Test Service",
        duration_minutes=30,
        is_deleted=False
    )
    db_session.add(appointment_type)
    db_session.commit()
    
    # Associate all practitioners with the appointment type
    from models.practitioner_appointment_types import PractitionerAppointmentTypes
    for key in ['practitioner', 'practitioner2']:
        if key in test_clinic_and_users:
            practitioner = test_clinic_and_users[key]
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appointment_type.id
            )
            db_session.add(pat)
    db_session.commit()
    
    return appointment_type


@pytest.fixture
def test_patient(db_session, test_clinic_and_users):
    """Create a test patient."""
    from utils.datetime_utils import taiwan_now
    clinic = test_clinic_and_users['clinic']
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="0912345678",
        line_user_id=None,
        created_at=taiwan_now(),
        created_by_type='clinic_user'
    )
    db_session.add(patient)
    db_session.commit()
    return patient


def create_appointment(
    db_session,
    clinic,
    practitioner,
    patient,
    appointment_type,
    is_auto_assigned=False,
    appointment_status='confirmed'
):
    """Helper function to create an appointment."""
    start_time = taiwan_now() + timedelta(days=1)
    end_time = start_time + timedelta(hours=1)
    
    calendar_event = CalendarEvent(
        user_id=practitioner.id,
        clinic_id=clinic.id,
        event_type="appointment",
        date=start_time.date(),
        start_time=start_time.time(),
        end_time=end_time.time()
    )
    db_session.add(calendar_event)
    db_session.flush()

    appointment = Appointment(
        calendar_event_id=calendar_event.id,
        patient_id=patient.id,
        appointment_type_id=appointment_type.id,
        status=appointment_status,
        is_auto_assigned=is_auto_assigned
    )
    db_session.add(appointment)
    db_session.commit()

    return appointment, calendar_event


class TestAppointmentEditPermissions:
    """Test edit appointment permission checks."""

    def test_admin_can_edit_auto_assigned_appointment(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that admin can edit auto-assigned appointments."""
        clinic = test_clinic_and_users['clinic']
        admin = test_clinic_and_users['admin']
        admin_assoc = test_clinic_and_users['admin_assoc']
        practitioner = test_clinic_and_users['practitioner']

        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner, test_patient, test_appointment_type, is_auto_assigned=True
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to edit the auto-assigned appointment
            # Format start_time as ISO datetime string with timezone
            new_date = (taiwan_now() + timedelta(days=2)).date()
            start_time_str = f"{new_date.isoformat()}T10:00:00+08:00"
            
            response = client.put(
                f"/api/clinic/appointments/{calendar_event.id}",
                json={
                    "appointment_type_id": test_appointment_type.id,
                    "start_time": start_time_str,
                }
            )

            # Admin should be able to edit (status code should not be 403)
            assert response.status_code != status.HTTP_403_FORBIDDEN
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_practitioner_cannot_edit_auto_assigned_appointment_even_if_assigned_to_them(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that practitioners cannot edit auto-assigned appointments, even if assigned to them."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']

        # Create auto-assigned appointment for the practitioner
        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner, test_patient, test_appointment_type, is_auto_assigned=True
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to edit the auto-assigned appointment
            # Format start_time as ISO datetime string with timezone
            new_date = (taiwan_now() + timedelta(days=2)).date()
            start_time_str = f"{new_date.isoformat()}T10:00:00+08:00"
            
            response = client.put(
                f"/api/clinic/appointments/{calendar_event.id}",
                json={
                    "appointment_type_id": test_appointment_type.id,
                    "start_time": start_time_str,
                }
            )

            if response.status_code != status.HTTP_403_FORBIDDEN:
                print(f"Expected 403, got {response.status_code}")
                print(f"Response: {response.text}")
            assert response.status_code == status.HTTP_403_FORBIDDEN
            response_data = response.json()
            if "您無法編輯系統自動指派的預約" not in response_data.get("detail", ""):
                print(f"Expected error message not found. Got: {response_data}")
            assert "您無法編輯系統自動指派的預約" in response_data["detail"]
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_practitioner_can_edit_own_regular_appointment(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that practitioners can edit their own non-auto-assigned appointments."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']

        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner, test_patient, test_appointment_type, is_auto_assigned=False
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to edit the appointment
            response = client.put(
                f"/api/clinic/appointments/{calendar_event.id}",
                json={
                    "appointment_type_id": test_appointment_type.id,
                    "date": (taiwan_now() + timedelta(days=2)).date().isoformat(),
                    "start_time": "10:00:00",
                    "end_time": "11:00:00",
                }
            )

            # Should not be forbidden
            assert response.status_code != status.HTTP_403_FORBIDDEN
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_practitioner_cannot_edit_others_appointment(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that practitioners cannot edit other practitioners' appointments."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']
        practitioner2 = test_clinic_and_users['practitioner2']

        # Create appointment for practitioner2
        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner2, test_patient, test_appointment_type, is_auto_assigned=False
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to edit the other practitioner's appointment
            # Format start_time as ISO datetime string with timezone
            new_date = (taiwan_now() + timedelta(days=2)).date()
            start_time_str = f"{new_date.isoformat()}T10:00:00+08:00"
            
            response = client.put(
                f"/api/clinic/appointments/{calendar_event.id}",
                json={
                    "appointment_type_id": test_appointment_type.id,
                    "start_time": start_time_str,
                }
            )

            assert response.status_code == status.HTTP_403_FORBIDDEN
            assert "您只能編輯自己的預約" in response.json()["detail"]
        finally:
            app.dependency_overrides.pop(get_current_user, None)


class TestAppointmentCancelPermissions:
    """Test cancel appointment permission checks."""

    def test_admin_can_cancel_auto_assigned_appointment(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that admin can cancel auto-assigned appointments."""
        clinic = test_clinic_and_users['clinic']
        admin = test_clinic_and_users['admin']
        admin_assoc = test_clinic_and_users['admin_assoc']
        practitioner = test_clinic_and_users['practitioner']

        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner, test_patient, test_appointment_type, is_auto_assigned=True
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to cancel the auto-assigned appointment
            response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

            # Admin should be able to cancel (status code should not be 403)
            assert response.status_code != status.HTTP_403_FORBIDDEN
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_practitioner_cannot_cancel_auto_assigned_appointment_even_if_assigned_to_them(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that practitioners cannot cancel auto-assigned appointments, even if assigned to them."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']

        # Create auto-assigned appointment for the practitioner
        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner, test_patient, test_appointment_type, is_auto_assigned=True
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to cancel the auto-assigned appointment
            response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

            assert response.status_code == status.HTTP_403_FORBIDDEN
            assert "您無法取消系統自動指派的預約" in response.json()["detail"]
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_practitioner_can_cancel_own_regular_appointment(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that practitioners can cancel their own non-auto-assigned appointments."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']

        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner, test_patient, test_appointment_type, is_auto_assigned=False
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Try to cancel the appointment
            response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

            # Should not be forbidden
            assert response.status_code != status.HTTP_403_FORBIDDEN
        finally:
            app.dependency_overrides.pop(get_current_user, None)


class TestPatientAppointmentsAPIPermissions:
    """Test patient appointments API permission checks (practitioner_id hiding)."""

    def test_patient_appointments_hides_practitioner_id_for_auto_assigned_when_not_admin(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that patient appointments API hides practitioner_id for auto-assigned when user is not admin."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']
        practitioner2 = test_clinic_and_users['practitioner2']

        # Create auto-assigned appointment for practitioner2
        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner2, test_patient, test_appointment_type, is_auto_assigned=True
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Get patient appointments
            response = client.get(f"/api/clinic/patients/{test_patient.id}/appointments")

            assert response.status_code == status.HTTP_200_OK
            response_data = response.json()
            # Response is AppointmentListResponse with appointments array
            appointments = response_data.get('appointments', [])

            # Find the auto-assigned appointment
            # The response is a list of AppointmentListItem objects, need to check the id field
            auto_assigned_appt = next(
                (apt for apt in appointments if apt.get('id') == calendar_event.id or apt.get('calendar_event_id') == calendar_event.id),
                None
            )

            assert auto_assigned_appt is not None
            assert auto_assigned_appt['is_auto_assigned'] is True
            # practitioner_id should be null for auto-assigned when user is not admin
            assert auto_assigned_appt['practitioner_id'] is None
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_patient_appointments_shows_practitioner_id_for_auto_assigned_when_admin(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that patient appointments API shows practitioner_id for auto-assigned when user is admin."""
        clinic = test_clinic_and_users['clinic']
        admin = test_clinic_and_users['admin']
        admin_assoc = test_clinic_and_users['admin_assoc']
        practitioner2 = test_clinic_and_users['practitioner2']

        # Create auto-assigned appointment for practitioner2
        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner2, test_patient, test_appointment_type, is_auto_assigned=True
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Get patient appointments
            response = client.get(f"/api/clinic/patients/{test_patient.id}/appointments")

            assert response.status_code == status.HTTP_200_OK
            response_data = response.json()
            # Response is AppointmentListResponse with appointments array
            appointments = response_data.get('appointments', [])

            # Find the auto-assigned appointment
            # The response is a list of AppointmentListItem objects, need to check the id field
            auto_assigned_appt = next(
                (apt for apt in appointments if apt.get('id') == calendar_event.id or apt.get('calendar_event_id') == calendar_event.id),
                None
            )

            assert auto_assigned_appt is not None
            assert auto_assigned_appt['is_auto_assigned'] is True
            # practitioner_id should be visible for admin
            assert auto_assigned_appt['practitioner_id'] == practitioner2.id
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_patient_appointments_shows_practitioner_id_for_regular_appointment(
        self, client, db_session, test_clinic_and_users, test_appointment_type, test_patient
    ):
        """Test that patient appointments API shows practitioner_id for regular (non-auto-assigned) appointments."""
        clinic = test_clinic_and_users['clinic']
        practitioner = test_clinic_and_users['practitioner']
        practitioner_assoc = test_clinic_and_users['practitioner_assoc']
        practitioner2 = test_clinic_and_users['practitioner2']

        # Create regular appointment for practitioner2
        appointment, calendar_event = create_appointment(
            db_session, clinic, practitioner2, test_patient, test_appointment_type, is_auto_assigned=False
        )

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        app.dependency_overrides[get_current_user] = lambda: user_context

        try:
            # Get patient appointments
            response = client.get(f"/api/clinic/patients/{test_patient.id}/appointments")

            assert response.status_code == status.HTTP_200_OK
            response_data = response.json()
            # Response is AppointmentListResponse with appointments array
            appointments = response_data.get('appointments', [])

            # Find the regular appointment
            regular_appt = next(
                (apt for apt in appointments if apt.get('id') == calendar_event.id or apt.get('calendar_event_id') == calendar_event.id),
                None
            )

            assert regular_appt is not None
            assert regular_appt['is_auto_assigned'] is False
            # practitioner_id should be visible for regular appointments
            assert regular_appt['practitioner_id'] == practitioner2.id
        finally:
            app.dependency_overrides.pop(get_current_user, None)

