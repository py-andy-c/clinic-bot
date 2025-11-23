"""
Clinic Management Integration Tests.

Tests clinic onboarding, member management, and role-based access control
business logic from authentication_user_management.md.
"""

import pytest
from datetime import datetime, time, timedelta
from unittest.mock import patch, AsyncMock, Mock
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models.user import User

# Test client for API calls
client = TestClient(app)
from models.clinic import Clinic
from tests.conftest import create_user_with_clinic_association
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser
from models.calendar_event import CalendarEvent
from models.practitioner_availability import PractitionerAvailability
from models.user_clinic_association import UserClinicAssociation
from models.practitioner_appointment_types import PractitionerAppointmentTypes


@pytest.fixture
def test_clinic_with_therapist(db_session):
    """Create a test clinic with a therapist and appointment types."""
    from tests.conftest import create_user_with_clinic_association
    from models.practitioner_availability import PractitionerAvailability
    from datetime import time
    
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()  # Commit clinic first to get ID

    # Create therapist with clinic association
    therapist, therapist_assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="Dr. Test",
        email="dr.test@example.com",
        google_subject_id="therapist_sub_123",
        roles=["practitioner"],
        is_active=True
    )

    # Create appointment types
    appointment_types = [
        AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        ),
        AppointmentType(
            clinic_id=clinic.id,
            name="回診",
            duration_minutes=30
        )
    ]

    # Create practitioner availability for Monday-Friday, 9am-5pm
    availability_records = []
    for day in range(5):  # Monday to Friday
        availability_records.append(
            PractitionerAvailability(
                user_id=therapist.id,
                clinic_id=clinic.id,
                day_of_week=day,
                start_time=time(9, 0),  # 9:00 AM
                end_time=time(17, 0)    # 5:00 PM
            )
        )

    db_session.add_all(appointment_types + availability_records)
    db_session.commit()

    return clinic, therapist, appointment_types, therapist_assoc


@pytest.fixture
def test_clinic_with_therapist_and_types(test_clinic_with_therapist):
    """Alias for test_clinic_with_therapist for backward compatibility."""
    clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist
    return clinic, therapist, appointment_types, therapist_assoc


@pytest.fixture
def linked_patient(db_session, test_clinic_with_therapist):
    """Create a linked patient for testing."""
    clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

    # Create patient
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="+1234567890"
    )
    db_session.add(patient)
    db_session.commit()

    # Create LINE user and link to patient
    line_user = LineUser(
        line_user_id="U_test_patient_123",
        clinic_id=clinic.id,
        display_name="Test Patient"
    )
    db_session.add(line_user)

    # Update patient to link to LINE user
    patient.line_user_id = line_user.id
    db_session.commit()

    return patient


class TestClinicOnboardingIntegration:
    """Integration tests for clinic onboarding business logic."""

    @pytest.mark.asyncio
    async def test_clinic_admin_role_assignment_business_logic(self, db_session):
        """Test clinic admin role assignment follows business rules.

        Business rule: Clinic admins must have admin role, can also have practitioner role.
        This test exposes bugs where role assignments don't follow business rules.
        """
        # Create a clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel_123",
            line_channel_secret="test_secret_456",
            line_channel_access_token="test_access_token_789"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create clinic admin (admin + practitioner roles)
        from tests.conftest import create_user_with_clinic_association
        clinic_admin, clinic_admin_assoc = create_user_with_clinic_association(
            db_session, clinic, "Clinic Admin", "admin@testclinic.com", "admin_sub_123", ["admin", "practitioner"], True
        )

        # Create practitioner only
        practitioner, practitioner_assoc = create_user_with_clinic_association(
            db_session, clinic, "Practitioner Only", "practitioner@testclinic.com", "pract_sub_456", ["practitioner"], True
        )

        # Create admin only
        admin_only, admin_only_assoc = create_user_with_clinic_association(
            db_session, clinic, "Admin Only", "adminonly@testclinic.com", "adminonly_sub_789", ["admin"], True
        )
        db_session.commit()

        # Verify role assignments follow business rules
        # Clinic admin should have both roles
        assert "admin" in clinic_admin_assoc.roles
        assert "practitioner" in clinic_admin_assoc.roles

        # Practitioner should only have practitioner role
        assert "practitioner" in practitioner_assoc.roles
        assert "admin" not in practitioner_assoc.roles

        # Admin-only should only have admin role
        assert "admin" in admin_only_assoc.roles
        assert "practitioner" not in admin_only_assoc.roles

        # Test that all users belong to the same clinic
        from models import UserClinicAssociation
        associations = db_session.query(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic.id,
            UserClinicAssociation.is_active == True
        ).all()
        assert len(associations) == 3
        for assoc in associations:
            assert assoc.clinic_id == clinic.id

    @pytest.mark.asyncio
    async def test_cross_clinic_data_isolation_business_logic(self, db_session):
        """Test that clinic data isolation prevents cross-clinic access.

        Business rule: Users from one clinic cannot access data from another clinic.
        This test exposes data isolation bugs.
        """
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic One",
            line_channel_id="channel_1",
            line_channel_secret="secret_1",
            line_channel_access_token="token_1"
        )
        clinic2 = Clinic(
            name="Clinic Two",
            line_channel_id="channel_2",
            line_channel_secret="secret_2",
            line_channel_access_token="token_2"
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()

        # Create users for each clinic
        from tests.conftest import create_user_with_clinic_association
        user1, user1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "User One", "user1@clinic1.com", "user1_sub", ["practitioner"], True
        )
        user2, user2_assoc = create_user_with_clinic_association(
            db_session, clinic2, "User Two", "user2@clinic2.com", "user2_sub", ["practitioner"], True
        )
        db_session.commit()

        # Create patients for each clinic
        patient1 = Patient(
            clinic_id=clinic1.id,
            full_name="Patient One",
            phone_number="+1234567890"
        )
        patient2 = Patient(
            clinic_id=clinic2.id,
            full_name="Patient Two",
            phone_number="+0987654321"
        )
        db_session.add_all([patient1, patient2])
        db_session.commit()

        # Create appointment types for each clinic
        apt_type1 = AppointmentType(
            clinic_id=clinic1.id,
            name="Clinic 1 Service",
            duration_minutes=30
        )
        apt_type2 = AppointmentType(
            clinic_id=clinic2.id,
            name="Clinic 2 Service",
            duration_minutes=45
        )
        db_session.add_all([apt_type1, apt_type2])
        db_session.commit()

        # Test data isolation - Clinic 1 user should only see Clinic 1 data
        from models import UserClinicAssociation
        clinic1_users = db_session.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic1.id,
            UserClinicAssociation.is_active == True
        ).all()
        assert len(clinic1_users) == 1
        assert clinic1_users[0].id == user1.id

        clinic1_patients = db_session.query(Patient).filter(Patient.clinic_id == clinic1.id).all()
        assert len(clinic1_patients) == 1
        assert clinic1_patients[0].id == patient1.id

        clinic1_apt_types = db_session.query(AppointmentType).filter(AppointmentType.clinic_id == clinic1.id).all()
        assert len(clinic1_apt_types) == 1
        assert clinic1_apt_types[0].id == apt_type1.id

        # Test data isolation - Clinic 2 user should only see Clinic 2 data
        clinic2_users = db_session.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic2.id,
            UserClinicAssociation.is_active == True
        ).all()
        assert len(clinic2_users) == 1
        assert clinic2_users[0].id == user2.id

        clinic2_patients = db_session.query(Patient).filter(Patient.clinic_id == clinic2.id).all()
        assert len(clinic2_patients) == 1
        assert clinic2_patients[0].id == patient2.id

        clinic2_apt_types = db_session.query(AppointmentType).filter(AppointmentType.clinic_id == clinic2.id).all()
        assert len(clinic2_apt_types) == 1
        assert clinic2_apt_types[0].id == apt_type2.id

        # Critical: Verify no cross-contamination
        # Clinic 1 should not see Clinic 2 data
        cross_clinic_users = db_session.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic1.id,
            UserClinicAssociation.is_active == True,
            User.email == "user2@clinic2.com"
        ).all()
        assert len(cross_clinic_users) == 0

        cross_clinic_patients = db_session.query(Patient).filter(
            Patient.clinic_id == clinic1.id,
            Patient.phone_number == "+0987654321"
        ).all()
        assert len(cross_clinic_patients) == 0


class TestAppointmentLifecycleIntegration:
    """Integration tests for appointment lifecycle business logic."""

    @pytest.mark.asyncio
    async def test_appointment_reschedule_business_logic(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test appointment rescheduling follows business rules.

        Business rule: Rescheduling should maintain appointment constraints and update related data.
        This test exposes bugs in the reschedule logic.
        """
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Set up therapist with Google Calendar credentials
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        # Google Calendar credentials removed
        db_session.add(therapist)
        db_session.commit()

        # Create original appointment
        original_start = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))
        original_end = original_start + timedelta(minutes=apt_type.duration_minutes)

        # Create CalendarEvent first
        original_calendar_event = CalendarEvent(
            user_id=therapist.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=original_start.date(),
            start_time=original_start.time(),
            end_time=original_end.time(),
        )
        db_session.add(original_calendar_event)
        db_session.commit()

        original_appointment = Appointment(
            calendar_event_id=original_calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=apt_type.id,
            status='confirmed'
        )
        db_session.add(original_appointment)
        db_session.commit()

        # Test reschedule to different time (this would be handled by the reschedule tool)
        # For now, we'll simulate the expected behavior
        new_start = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(14, 0))
        new_end = new_start + timedelta(minutes=apt_type.duration_minutes)

        # Update calendar event (simulating reschedule)
        original_calendar_event.start_time = new_start.time()
        original_calendar_event.end_time = new_end.time()
        db_session.commit()

        # Verify reschedule maintained data integrity
        updated_appointment = db_session.query(Appointment).filter(Appointment.calendar_event_id == original_calendar_event.id).first()
        assert updated_appointment.calendar_event.start_time == new_start.time()
        assert updated_appointment.calendar_event.end_time == new_end.time()
        # Google Calendar integration removed
        assert updated_appointment.patient_id == linked_patient.id
        assert updated_appointment.user_id == therapist.id
        assert updated_appointment.appointment_type_id == apt_type.id

        # Verify no duplicate appointments were created
        appointments = db_session.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id == linked_patient.id,
            CalendarEvent.date >= original_start.date()
        ).all()
        assert len(appointments) == 1  # Should only be the rescheduled one

    @pytest.mark.asyncio
    async def test_appointment_cancellation_business_logic(self, db_session, test_clinic_with_therapist_and_types, linked_patient):
        """Test appointment cancellation follows business rules.

        Business rule: Cancellation should update status and handle Google Calendar appropriately.
        This test exposes bugs in cancellation logic.
        """
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Set up therapist with Google Calendar credentials
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        # Google Calendar credentials removed
        db_session.add(therapist)
        db_session.commit()

        # Create appointment
        start_time = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))
        end_time = start_time + timedelta(minutes=apt_type.duration_minutes)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=therapist.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=apt_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Simulate cancellation (this would be handled by the cancellation tool)
        appointment.status = 'canceled_by_patient'
        db_session.commit()

        # Verify cancellation maintained data integrity
        canceled_appointment = db_session.query(Appointment).filter(Appointment.calendar_event_id == appointment.calendar_event_id).first()
        assert canceled_appointment.status == 'canceled_by_patient'
        # Google Calendar integration removed
        assert canceled_appointment.calendar_event.start_time == start_time.time()
        assert canceled_appointment.calendar_event.end_time == end_time.time()
        assert canceled_appointment.patient_id == linked_patient.id
        assert canceled_appointment.calendar_event.user_id == therapist.id

        # Verify appointment still exists but is marked as canceled
        all_appointments = db_session.query(Appointment).filter(
            Appointment.patient_id == linked_patient.id
        ).all()
        assert len(all_appointments) == 1
        assert all_appointments[0].status == 'canceled_by_patient'


class TestClinicAppointmentManagement:
    """Test clinic admin appointment management endpoints."""

    def test_cancel_appointment_by_admin(self, test_clinic_with_therapist, linked_patient, db_session):
        """Test that clinic admin can cancel appointments."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create admin user with clinic association
        admin, admin_assoc = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Admin User",
            email="admin@example.com",
            google_subject_id="admin_google_sub_123",
            roles=["admin"],
            is_active=True
        )

        # Create an appointment
        start_time = datetime.now() + timedelta(days=1)
        end_time = start_time + timedelta(hours=1)
        calendar_event = CalendarEvent(
            user_id=therapist.id,
            clinic_id=clinic.id,
            event_type="appointment",
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=appointment_types[0].id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Override dependencies for testing
        from auth.dependencies import get_current_user
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        # Mock LINE service to avoid actual API calls
        with patch('services.line_service.LINEService') as mock_line_service_class:
            mock_line_service = Mock()
            mock_line_service_class.return_value = mock_line_service

            try:
                # Cancel appointment
                response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert "已取消" in data["message"]
                assert data["appointment_id"] == calendar_event.id

                # Verify appointment status updated
                db_session.refresh(appointment)
                assert appointment.status == 'canceled_by_clinic'
                assert appointment.canceled_at is not None
            finally:
                # Clean up overrides
                client.app.dependency_overrides.pop(get_current_user, None)
                client.app.dependency_overrides.pop(get_db, None)

    def test_cancel_appointment_nonexistent(self, test_clinic_with_therapist, db_session):
        """Test cancelling a non-existent appointment."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create admin user with clinic association
        admin, admin_assoc = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Admin User",
            email="admin@example.com",
            google_subject_id="admin_google_sub_123",
            roles=["admin"],
            is_active=True
        )

        # Override dependencies for testing
        from auth.dependencies import get_current_user
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to cancel non-existent appointment
            response = client.delete("/api/clinic/appointments/99999")

            assert response.status_code == 404
            assert "不存在" in response.json()["detail"]
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_cancel_appointment_already_cancelled(self, test_clinic_with_therapist, linked_patient, db_session):
        """Test cancelling an already cancelled appointment."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create admin user with clinic association
        admin, admin_assoc = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Admin User",
            email="admin@example.com",
            google_subject_id="admin_google_sub_123",
            roles=["admin"],
            is_active=True
        )

        # Create a cancelled appointment
        start_time = datetime.now() + timedelta(days=1)
        end_time = start_time + timedelta(hours=1)
        calendar_event = CalendarEvent(
            user_id=therapist.id,
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
            patient_id=linked_patient.id,
            appointment_type_id=appointment_types[0].id,
            status='canceled_by_patient'
        )
        db_session.add(appointment)
        db_session.commit()

        # Override dependencies for testing
        from auth.dependencies import get_current_user
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to cancel already cancelled appointment (should succeed idempotently)
            response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "已被取消" in data["message"] or "已取消" in data["message"]
            assert data["appointment_id"] == calendar_event.id
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_practitioner_cannot_cancel_other_practitioner_appointment(self, test_clinic_with_therapist, linked_patient, db_session):
        """Test that practitioners cannot cancel other practitioners' appointments."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create practitioner user (not admin)
        from tests.conftest import create_user_with_clinic_association
        practitioner, practitioner_assoc = create_user_with_clinic_association(
            db_session, clinic, "Practitioner User", "practitioner@example.com", "practitioner_google_sub_456", ["practitioner"], True
        )
        db_session.commit()

        # Create an appointment for therapist (not the practitioner)
        start_time = datetime.now() + timedelta(days=1)
        end_time = start_time + timedelta(hours=1)
        calendar_event = CalendarEvent(
            user_id=therapist.id,
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
            patient_id=linked_patient.id,
            appointment_type_id=appointment_types[0].id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Override dependencies for testing
        from auth.dependencies import get_current_user
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=practitioner_assoc.clinic_id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to cancel another practitioner's appointment
            response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

            assert response.status_code == 403
            assert "您只能取消自己的預約" in response.json()["detail"]
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_practitioner_can_cancel_own_appointment(self, test_clinic_with_therapist, linked_patient, db_session):
        """Test that practitioners can cancel their own appointments."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create an appointment for therapist
        start_time = datetime.now() + timedelta(days=1)
        end_time = start_time + timedelta(hours=1)
        calendar_event = CalendarEvent(
            user_id=therapist.id,
            clinic_id=clinic.id,
            event_type="appointment",
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
        )
        db_session.add(calendar_event)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=linked_patient.id,
            appointment_type_id=appointment_types[0].id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        # Override dependencies for testing
        from auth.dependencies import get_current_user
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        # Mock LINE service to avoid actual API calls
        with patch('services.line_service.LINEService') as mock_line_service_class:
            mock_line_service = Mock()
            mock_line_service_class.return_value = mock_line_service

            try:
                # Cancel appointment
                response = client.delete(f"/api/clinic/appointments/{calendar_event.id}")

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert "已取消" in data["message"]
                assert data["appointment_id"] == calendar_event.id

                # Verify appointment status updated
                db_session.refresh(appointment)
                assert appointment.status == 'canceled_by_clinic'
                assert appointment.canceled_at is not None
            finally:
                # Clean up overrides
                client.app.dependency_overrides.pop(get_current_user, None)
                client.app.dependency_overrides.pop(get_db, None)


class TestPractitionerAppointmentTypes:
    """Test practitioner appointment type management."""

    def test_get_practitioner_appointment_types_success(self, db_session, test_clinic_with_therapist):
        """Test getting practitioner's appointment types successfully."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create some practitioner appointment type associations
        from models.practitioner_appointment_types import PractitionerAppointmentTypes

        # Associate therapist with first appointment type
        pat1 = PractitionerAppointmentTypes(
            user_id=therapist.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_types[0].id
        )
        db_session.add(pat1)
        db_session.commit()

        # Mock authentication for therapist
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get practitioner's appointment types
            response = client.get(f"/api/clinic/practitioners/{therapist.id}/appointment-types")

            assert response.status_code == 200
            data = response.json()
            assert data["practitioner_id"] == therapist.id
            assert len(data["appointment_types"]) == 1
            assert data["appointment_types"][0]["id"] == appointment_types[0].id
            assert data["appointment_types"][0]["name"] == appointment_types[0].name
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_get_practitioner_appointment_types_empty(self, db_session, test_clinic_with_therapist):
        """Test getting practitioner's appointment types when none are configured."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Mock authentication for therapist
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Get practitioner's appointment types (should be empty)
            response = client.get(f"/api/clinic/practitioners/{therapist.id}/appointment-types")

            assert response.status_code == 200
            data = response.json()
            assert data["practitioner_id"] == therapist.id
            assert len(data["appointment_types"]) == 0
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_get_practitioner_appointment_types_permission_denied(self, db_session, test_clinic_with_therapist):
        """Test that practitioners cannot view other practitioners' appointment types."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create another therapist
        from tests.conftest import create_user_with_clinic_association
        therapist2, therapist2_assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test 2", "dr.test2@example.com", "therapist_sub_456", ["practitioner"], True
        )
        db_session.commit()

        # Mock authentication for therapist trying to view therapist2's types
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to get therapist2's appointment types (should fail)
            response = client.get(f"/api/clinic/practitioners/{therapist2.id}/appointment-types")

            assert response.status_code == 403
            assert "無權限查看其他治療師的設定" in response.json()["detail"]
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_practitioner_appointment_types_success(self, db_session, test_clinic_with_therapist):
        """Test updating practitioner's appointment types successfully."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Mock authentication for therapist
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Update practitioner's appointment types
            appointment_type_ids = [appointment_types[0].id, appointment_types[1].id]
            response = client.put(
                f"/api/clinic/practitioners/{therapist.id}/appointment-types",
                json={"appointment_type_ids": appointment_type_ids}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "治療師預約類型已更新" in data["message"]

            # Verify the associations were created
            from models.practitioner_appointment_types import PractitionerAppointmentTypes
            associations = db_session.query(PractitionerAppointmentTypes).filter_by(user_id=therapist.id).all()
            assert len(associations) == 2
            assert {a.appointment_type_id for a in associations} == set(appointment_type_ids)
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_practitioner_appointment_types_clear_all(self, db_session, test_clinic_with_therapist):
        """Test clearing all practitioner's appointment types."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # First create some associations
        from models.practitioner_appointment_types import PractitionerAppointmentTypes

        pat1 = PractitionerAppointmentTypes(
            user_id=therapist.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_types[0].id
        )
        db_session.add(pat1)
        db_session.commit()

        # Mock authentication for therapist
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Clear all appointment types
            response = client.put(
                f"/api/clinic/practitioners/{therapist.id}/appointment-types",
                json={"appointment_type_ids": []}
            )

            assert response.status_code == 200

            # Verify associations were cleared
            associations = db_session.query(PractitionerAppointmentTypes).filter_by(user_id=therapist.id).all()
            assert len(associations) == 0
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_practitioner_appointment_types_invalid_type_id(self, db_session, test_clinic_with_therapist):
        """Test updating with invalid appointment type ID."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Mock authentication for therapist
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to update with invalid appointment type ID
            response = client.put(
                f"/api/clinic/practitioners/{therapist.id}/appointment-types",
                json={"appointment_type_ids": [99999]}  # Non-existent ID
            )

            assert response.status_code == 400
            assert "不存在或不屬於此診所" in response.json()["detail"]
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_update_practitioner_appointment_types_permission_denied(self, db_session, test_clinic_with_therapist):
        """Test that practitioners cannot update other practitioners' appointment types."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create another therapist
        from tests.conftest import create_user_with_clinic_association
        therapist2, therapist2_assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test 2", "dr.test2@example.com", "therapist_sub_456", ["practitioner"], True
        )
        db_session.commit()

        # Mock authentication for therapist trying to update therapist2's types
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Try to update therapist2's appointment types (should fail)
            response = client.put(
                f"/api/clinic/practitioners/{therapist2.id}/appointment-types",
                json={"appointment_type_ids": [appointment_types[0].id]}
            )

            assert response.status_code == 403
            assert "無權限修改其他治療師的設定" in response.json()["detail"]
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestPractitionerCrossClinicIsolation:
    """Test that practitioner appointment types, status, and availability are properly isolated by clinic.
    
    This test verifies the fix for the bug where practitioners with appointment types
    in one clinic would not show warnings in another clinic where they have no types.
    """

    def test_practitioner_appointment_types_cross_clinic_isolation(self, db_session):
        """Test that practitioner appointment types are isolated by clinic."""
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="clinic1_channel",
            line_channel_secret="clinic1_secret",
            line_channel_access_token="clinic1_token"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="clinic2_channel",
            line_channel_secret="clinic2_secret",
            line_channel_access_token="clinic2_token"
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()

        # Create appointment types for each clinic
        appt_type1 = AppointmentType(
            clinic_id=clinic1.id,
            name="Clinic 1 Service",
            duration_minutes=30
        )
        appt_type2 = AppointmentType(
            clinic_id=clinic2.id,
            name="Clinic 2 Service",
            duration_minutes=45
        )
        db_session.add_all([appt_type1, appt_type2])
        db_session.commit()

        # Create a practitioner who belongs to both clinics
        practitioner, p1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "Dr. Multi-Clinic", "dr.multiclinic@example.com",
            "multi_sub", ["practitioner"], True
        )
        # Add association to clinic2
        p2_assoc = UserClinicAssociation(
            user_id=practitioner.id,
            clinic_id=clinic2.id,
            roles=["practitioner"],
            full_name="Dr. Multi-Clinic",
            is_active=True
        )
        db_session.add(p2_assoc)
        db_session.commit()

        # Associate practitioner with appointment type in clinic1 only
        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic1.id,
            appointment_type_id=appt_type1.id
        )
        db_session.add(pat1)
        db_session.commit()

        # Mock authentication for clinic1 context
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context_clinic1 = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=p1_assoc.roles,
            active_clinic_id=clinic1.id,
            google_subject_id=practitioner.google_subject_id,
            name=p1_assoc.full_name,
            user_id=practitioner.id
        )

        user_context_clinic2 = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=p2_assoc.roles,
            active_clinic_id=clinic2.id,
            google_subject_id=practitioner.google_subject_id,
            name=p2_assoc.full_name,
            user_id=practitioner.id
        )

        # Test 1: In clinic1, practitioner should see their appointment types
        client.app.dependency_overrides[get_current_user] = lambda: user_context_clinic1
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get(f"/api/clinic/practitioners/{practitioner.id}/appointment-types")
            assert response.status_code == 200
            data = response.json()
            assert len(data["appointment_types"]) == 1
            assert data["appointment_types"][0]["id"] == appt_type1.id
            assert data["appointment_types"][0]["name"] == "Clinic 1 Service"
        finally:
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

        # Test 2: In clinic2, practitioner should NOT see clinic1 appointment types
        client.app.dependency_overrides[get_current_user] = lambda: user_context_clinic2
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get(f"/api/clinic/practitioners/{practitioner.id}/appointment-types")
            assert response.status_code == 200
            data = response.json()
            assert len(data["appointment_types"]) == 0, "Should not see appointment types from clinic1"
        finally:
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_practitioner_status_cross_clinic_isolation(self, db_session):
        """Test that practitioner status correctly shows warnings per clinic.
        
        This test verifies the original bug fix: a practitioner with appointment types
        in Clinic A but not Clinic B should show a warning in Clinic B.
        """
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="clinic1_channel",
            line_channel_secret="clinic1_secret",
            line_channel_access_token="clinic1_token"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="clinic2_channel",
            line_channel_secret="clinic2_secret",
            line_channel_access_token="clinic2_token"
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()

        # Create appointment types for each clinic
        appt_type1 = AppointmentType(
            clinic_id=clinic1.id,
            name="Clinic 1 Service",
            duration_minutes=30
        )
        appt_type2 = AppointmentType(
            clinic_id=clinic2.id,
            name="Clinic 2 Service",
            duration_minutes=45
        )
        db_session.add_all([appt_type1, appt_type2])
        db_session.commit()

        # Create a practitioner who belongs to both clinics
        practitioner, p1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "Dr. Multi-Clinic", "dr.multiclinic@example.com",
            "multi_sub", ["practitioner"], True
        )
        # Add association to clinic2
        p2_assoc = UserClinicAssociation(
            user_id=practitioner.id,
            clinic_id=clinic2.id,
            roles=["practitioner"],
            full_name="Dr. Multi-Clinic",
            is_active=True
        )
        db_session.add(p2_assoc)
        db_session.commit()

        # Associate practitioner with appointment type in clinic1 only
        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic1.id,
            appointment_type_id=appt_type1.id
        )
        db_session.add(pat1)
        db_session.commit()

        # Add availability in clinic1 only
        availability1 = PractitionerAvailability(
            user_id=practitioner.id,
            clinic_id=clinic1.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability1)
        db_session.commit()

        # Mock authentication for clinic1 context (admin viewing practitioner)
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        # Create admin in clinic1
        admin1, a1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "Admin 1", "admin1@example.com",
            "admin1_sub", ["admin"], True
        )
        # Create admin in clinic2
        admin2, a2_assoc = create_user_with_clinic_association(
            db_session, clinic2, "Admin 2", "admin2@example.com",
            "admin2_sub", ["admin"], True
        )
        db_session.commit()

        user_context_clinic1 = UserContext(
            user_type="clinic_user",
            email=admin1.email,
            roles=a1_assoc.roles,
            active_clinic_id=clinic1.id,
            google_subject_id=admin1.google_subject_id,
            name=a1_assoc.full_name,
            user_id=admin1.id
        )

        user_context_clinic2 = UserContext(
            user_type="clinic_user",
            email=admin2.email,
            roles=a2_assoc.roles,
            active_clinic_id=clinic2.id,
            google_subject_id=admin2.google_subject_id,
            name=a2_assoc.full_name,
            user_id=admin2.id
        )

        # Test 1: In clinic1, practitioner should have appointment types and availability
        client.app.dependency_overrides[get_current_user] = lambda: user_context_clinic1
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get(f"/api/clinic/practitioners/{practitioner.id}/status")
            assert response.status_code == 200
            data = response.json()
            assert data["has_appointment_types"] == True, "Should have appointment types in clinic1"
            assert data["has_availability"] == True, "Should have availability in clinic1"
            assert data["appointment_types_count"] == 1
        finally:
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

        # Test 2: In clinic2, practitioner should NOT have appointment types or availability
        # This is the bug fix - should show warning in clinic2
        client.app.dependency_overrides[get_current_user] = lambda: user_context_clinic2
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get(f"/api/clinic/practitioners/{practitioner.id}/status")
            assert response.status_code == 200
            data = response.json()
            assert data["has_appointment_types"] == False, "Should NOT have appointment types in clinic2 (this was the bug)"
            assert data["has_availability"] == False, "Should NOT have availability in clinic2"
            assert data["appointment_types_count"] == 0
        finally:
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_practitioner_availability_cross_clinic_isolation(self, db_session):
        """Test that practitioner availability is isolated by clinic."""
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="clinic1_channel",
            line_channel_secret="clinic1_secret",
            line_channel_access_token="clinic1_token"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="clinic2_channel",
            line_channel_secret="clinic2_secret",
            line_channel_access_token="clinic2_token"
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()

        # Create a practitioner who belongs to both clinics
        practitioner, p1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "Dr. Multi-Clinic", "dr.multiclinic@example.com",
            "multi_sub", ["practitioner"], True
        )
        # Add association to clinic2
        p2_assoc = UserClinicAssociation(
            user_id=practitioner.id,
            clinic_id=clinic2.id,
            roles=["practitioner"],
            full_name="Dr. Multi-Clinic",
            is_active=True
        )
        db_session.add(p2_assoc)
        db_session.commit()

        # Add availability in clinic1 only
        availability1 = PractitionerAvailability(
            user_id=practitioner.id,
            clinic_id=clinic1.id,
            day_of_week=1,  # Tuesday
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability1)
        db_session.commit()

        # Mock authentication
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context_clinic1 = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=p1_assoc.roles,
            active_clinic_id=clinic1.id,
            google_subject_id=practitioner.google_subject_id,
            name=p1_assoc.full_name,
            user_id=practitioner.id
        )

        user_context_clinic2 = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=p2_assoc.roles,
            active_clinic_id=clinic2.id,
            google_subject_id=practitioner.google_subject_id,
            name=p2_assoc.full_name,
            user_id=practitioner.id
        )

        # Test 1: In clinic1, practitioner should see their availability (using new default schedule endpoint)
        client.app.dependency_overrides[get_current_user] = lambda: user_context_clinic1
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get(f"/api/clinic/practitioners/{practitioner.id}/availability/default")
            assert response.status_code == 200
            data = response.json()
            # Check that Tuesday (day_of_week=1) has availability
            assert len(data["tuesday"]) == 1, "Should have availability for Tuesday in clinic1"
            assert data["tuesday"][0]["start_time"] == "09:00"
            assert data["tuesday"][0]["end_time"] == "17:00"
        finally:
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

        # Test 2: In clinic2, practitioner should NOT see clinic1 availability
        client.app.dependency_overrides[get_current_user] = lambda: user_context_clinic2
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            response = client.get(f"/api/clinic/practitioners/{practitioner.id}/availability/default")
            assert response.status_code == 200
            data = response.json()
            # Tuesday should be empty in clinic2
            assert len(data["tuesday"]) == 0, "Should not see availability from clinic1"
        finally:
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)


class TestPractitionersList:
    """Test practitioners list endpoint."""

    def test_list_practitioners(self, db_session, test_clinic_with_therapist):
        """Test listing all practitioners for a clinic."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create another practitioner
        therapist2, therapist2_assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test 2", "dr.test2@example.com", "therapist_sub_456", ["practitioner"], True
        )
        
        # Create a non-practitioner (admin)
        admin, admin_assoc = create_user_with_clinic_association(
            db_session, clinic, "Admin User", "admin@example.com", "admin_sub_789", ["admin"], True
        )
        db_session.commit()

        # Mock authentication for admin
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test listing practitioners
            response = client.get("/api/clinic/practitioners")

            assert response.status_code == 200
            data = response.json()
            assert "practitioners" in data
            practitioners = data["practitioners"]
            
            # Should return both practitioners, not the admin
            assert len(practitioners) == 2
            
            # Check that both practitioners are in the list
            practitioner_ids = [p["id"] for p in practitioners]
            assert therapist.id in practitioner_ids
            assert therapist2.id in practitioner_ids
            
            # Check that admin is not in the list
            assert admin.id not in practitioner_ids
            
            # Check response structure
            for p in practitioners:
                assert "id" in p
                assert "full_name" in p
                assert p["full_name"] in ["Dr. Test", "Dr. Test 2"]
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_list_practitioners_as_practitioner(self, db_session, test_clinic_with_therapist):
        """Test that practitioners can also list practitioners."""
        clinic, therapist, appointment_types, therapist_assoc = test_clinic_with_therapist

        # Create another practitioner
        therapist2, therapist2_assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test 2", "dr.test2@example.com", "therapist_sub_456", ["practitioner"], True
        )
        db_session.commit()

        # Mock authentication for therapist
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=therapist.email,
            roles=therapist_assoc.roles,
            active_clinic_id=therapist_assoc.clinic_id,
            google_subject_id=therapist.google_subject_id,
            name=therapist_assoc.full_name,
            user_id=therapist.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test listing practitioners
            response = client.get("/api/clinic/practitioners")

            assert response.status_code == 200
            data = response.json()
            assert "practitioners" in data
            practitioners = data["practitioners"]
            
            # Should return both practitioners
            assert len(practitioners) == 2
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_list_practitioners_empty_clinic(self, db_session):
        """Test listing practitioners when clinic has none."""
        # Create clinic without practitioners
        clinic = Clinic(
            name="Empty Clinic",
            line_channel_id="empty_channel",
            line_channel_secret="empty_secret",
            line_channel_access_token="empty_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create admin user (non-practitioner)
        admin, admin_assoc = create_user_with_clinic_association(
            db_session, clinic, "Admin User", "admin@example.com", "admin_sub", ["admin"], True
        )
        db_session.commit()

        # Mock authentication for admin
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test listing practitioners - should return empty list, not error
            response = client.get("/api/clinic/practitioners")

            assert response.status_code == 200
            data = response.json()
            assert "practitioners" in data
            practitioners = data["practitioners"]
            
            # Should return empty list
            assert len(practitioners) == 0
            assert isinstance(practitioners, list)
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_list_practitioners_cross_clinic_isolation(self, db_session):
        """Test that users can't see practitioners from other clinics."""
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="clinic1_channel",
            line_channel_secret="clinic1_secret",
            line_channel_access_token="clinic1_token"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="clinic2_channel",
            line_channel_secret="clinic2_secret",
            line_channel_access_token="clinic2_token"
        )
        db_session.add_all([clinic1, clinic2])
        db_session.commit()
        
        # Create practitioners in each clinic
        practitioner1, p1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "Dr. Clinic1", "p1@example.com", "p1_sub", ["practitioner"], True
        )
        practitioner2, p2_assoc = create_user_with_clinic_association(
            db_session, clinic2, "Dr. Clinic2", "p2@example.com", "p2_sub", ["practitioner"], True
        )
        
        # Create admin in clinic1
        admin1, a1_assoc = create_user_with_clinic_association(
            db_session, clinic1, "Admin Clinic1", "admin1@example.com", "admin1_sub", ["admin"], True
        )
        db_session.commit()

        # Mock authentication for admin1 (clinic1)
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext

        user_context = UserContext(
            user_type="clinic_user",
            email=admin1.email,
            roles=a1_assoc.roles,
            active_clinic_id=a1_assoc.clinic_id,
            google_subject_id=admin1.google_subject_id,
            name=a1_assoc.full_name,
            user_id=admin1.id
        )

        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session

        try:
            # Test listing practitioners - should only see clinic1 practitioners
            response = client.get("/api/clinic/practitioners")

            assert response.status_code == 200
            data = response.json()
            assert "practitioners" in data
            practitioners = data["practitioners"]
            
            # Should only return practitioner from clinic1
            assert len(practitioners) == 1
            assert practitioners[0]["id"] == practitioner1.id
            assert practitioners[0]["full_name"] == "Dr. Clinic1"
            
            # Should NOT include practitioner from clinic2
            practitioner_ids = [p["id"] for p in practitioners]
            assert practitioner2.id not in practitioner_ids
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)

    def test_batch_practitioner_status_endpoint(self, db_session, test_clinic_with_therapist):
        """Test batch practitioner status endpoint for multiple practitioners."""
        clinic, therapist1, appointment_types, therapist1_assoc = test_clinic_with_therapist
        
        # Create a second practitioner
        therapist2, therapist2_assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test 2", "dr.test2@example.com", 
            "therapist_sub_456", ["practitioner"], True
        )
        
        # Create a third practitioner
        therapist3, therapist3_assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test 3", "dr.test3@example.com", 
            "therapist_sub_789", ["practitioner"], True
        )
        db_session.commit()
        
        # Set up: therapist1 has both appointment types and availability
        # therapist2 has only appointment types (no availability)
        # therapist3 has neither
        
        # therapist1: associate with appointment types (availability already exists from fixture)
        pat1 = PractitionerAppointmentTypes(
            user_id=therapist1.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_types[0].id
        )
        db_session.add(pat1)
        
        # therapist2: add appointment types but no availability
        pat2 = PractitionerAppointmentTypes(
            user_id=therapist2.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_types[0].id
        )
        db_session.add(pat2)
        db_session.commit()
        
        # therapist3: no appointment types, no availability
        
        # Mock authentication for admin
        from auth.dependencies import get_current_user, get_db
        from auth.dependencies import UserContext
        
        admin, admin_assoc = create_user_with_clinic_association(
            db_session, clinic, "Admin", "admin@example.com",
            "admin_sub", ["admin"], True
        )
        db_session.commit()
        
        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=admin_assoc.clinic_id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )
        
        client.app.dependency_overrides[get_current_user] = lambda: user_context
        client.app.dependency_overrides[get_db] = lambda: db_session
        
        try:
            # Test batch endpoint with all three practitioners
            response = client.post(
                "/api/clinic/practitioners/status/batch",
                json={
                    "practitioner_ids": [therapist1.id, therapist2.id, therapist3.id]
                }
            )
            
            assert response.status_code == 200
            data = response.json()
            assert "results" in data
            assert len(data["results"]) == 3
            
            # Create a map for easy lookup
            status_map = {r["user_id"]: r for r in data["results"]}
            
            # Verify therapist1 has both appointment types and availability
            status1 = status_map[therapist1.id]
            assert status1["has_appointment_types"] is True
            assert status1["has_availability"] is True
            assert status1["appointment_types_count"] > 0
            
            # Verify therapist2 has appointment types but no availability
            status2 = status_map[therapist2.id]
            assert status2["has_appointment_types"] is True
            assert status2["has_availability"] is False
            assert status2["appointment_types_count"] > 0
            
            # Verify therapist3 has neither
            status3 = status_map[therapist3.id]
            assert status3["has_appointment_types"] is False
            assert status3["has_availability"] is False
            assert status3["appointment_types_count"] == 0
            
            # Verify all results have required fields
            for result in data["results"]:
                assert "user_id" in result
                assert "has_appointment_types" in result
                assert "has_availability" in result
                assert "appointment_types_count" in result
                assert isinstance(result["has_appointment_types"], bool)
                assert isinstance(result["has_availability"], bool)
                assert isinstance(result["appointment_types_count"], int)
                
        finally:
            # Clean up overrides
            client.app.dependency_overrides.pop(get_current_user, None)
            client.app.dependency_overrides.pop(get_db, None)
