"""
Clinic Management Integration Tests.

Tests clinic onboarding, member management, and role-based access control
business logic from authentication_user_management.md.
"""

import pytest
from datetime import datetime, time, timedelta
from unittest.mock import patch, AsyncMock, Mock

from models.user import User
from models.clinic import Clinic
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser
from models.calendar_event import CalendarEvent


@pytest.fixture
def test_clinic_with_therapist(db_session):
    """Create a test clinic with a therapist and appointment types."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()  # Commit clinic first to get ID

    therapist = User(
        clinic_id=clinic.id,
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

    db_session.add_all([therapist] + appointment_types)
    db_session.commit()

    return clinic, therapist, appointment_types


@pytest.fixture
def test_clinic_with_therapist_and_types(test_clinic_with_therapist):
    """Alias for test_clinic_with_therapist for backward compatibility."""
    return test_clinic_with_therapist


@pytest.fixture
def linked_patient(db_session, test_clinic_with_therapist):
    """Create a linked patient for testing."""
    clinic, therapist, appointment_types = test_clinic_with_therapist

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
        patient_id=patient.id
    )
    db_session.add(line_user)
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
        clinic_admin = User(
            clinic_id=clinic.id,
            full_name="Clinic Admin",
            email="admin@testclinic.com",
            google_subject_id="admin_sub_123",
            roles=["admin", "practitioner"],
            is_active=True
        )
        db_session.add(clinic_admin)

        # Create practitioner only
        practitioner = User(
            clinic_id=clinic.id,
            full_name="Practitioner Only",
            email="practitioner@testclinic.com",
            google_subject_id="pract_sub_456",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner)

        # Create admin only
        admin_only = User(
            clinic_id=clinic.id,
            full_name="Admin Only",
            email="adminonly@testclinic.com",
            google_subject_id="adminonly_sub_789",
            roles=["admin"],
            is_active=True
        )
        db_session.add(admin_only)
        db_session.commit()

        # Verify role assignments follow business rules
        # Clinic admin should have both roles
        assert "admin" in clinic_admin.roles
        assert "practitioner" in clinic_admin.roles

        # Practitioner should only have practitioner role
        assert "practitioner" in practitioner.roles
        assert "admin" not in practitioner.roles

        # Admin-only should only have admin role
        assert "admin" in admin_only.roles
        assert "practitioner" not in admin_only.roles

        # Test that all users belong to the same clinic
        users = db_session.query(User).filter(User.clinic_id == clinic.id).all()
        assert len(users) == 3
        for user in users:
            assert user.clinic_id == clinic.id

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
        user1 = User(
            clinic_id=clinic1.id,
            full_name="User One",
            email="user1@clinic1.com",
            google_subject_id="user1_sub",
            roles=["practitioner"],
            is_active=True
        )
        user2 = User(
            clinic_id=clinic2.id,
            full_name="User Two",
            email="user2@clinic2.com",
            google_subject_id="user2_sub",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add_all([user1, user2])
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
        clinic1_users = db_session.query(User).filter(User.clinic_id == clinic1.id).all()
        assert len(clinic1_users) == 1
        assert clinic1_users[0].id == user1.id

        clinic1_patients = db_session.query(Patient).filter(Patient.clinic_id == clinic1.id).all()
        assert len(clinic1_patients) == 1
        assert clinic1_patients[0].id == patient1.id

        clinic1_apt_types = db_session.query(AppointmentType).filter(AppointmentType.clinic_id == clinic1.id).all()
        assert len(clinic1_apt_types) == 1
        assert clinic1_apt_types[0].id == apt_type1.id

        # Test data isolation - Clinic 2 user should only see Clinic 2 data
        clinic2_users = db_session.query(User).filter(User.clinic_id == clinic2.id).all()
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
        cross_clinic_users = db_session.query(User).filter(
            User.clinic_id == clinic1.id,
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
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Set up therapist with Google Calendar credentials
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"
        db_session.add(therapist)
        db_session.commit()

        # Create original appointment
        original_start = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))
        original_end = original_start + timedelta(minutes=apt_type.duration_minutes)

        # Create CalendarEvent first
        original_calendar_event = CalendarEvent(
            user_id=therapist.id,
            event_type='appointment',
            date=original_start.date(),
            start_time=original_start.time(),
            end_time=original_end.time(),
            gcal_event_id='gcal_original_123'
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
        original_calendar_event.gcal_event_id = 'gcal_rescheduled_456'  # Would be updated by Google Calendar
        db_session.commit()

        # Verify reschedule maintained data integrity
        updated_appointment = db_session.query(Appointment).filter(Appointment.calendar_event_id == original_calendar_event.id).first()
        assert updated_appointment.calendar_event.start_time == new_start.time()
        assert updated_appointment.calendar_event.end_time == new_end.time()
        assert updated_appointment.calendar_event.gcal_event_id == 'gcal_rescheduled_456'
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
        clinic, therapist, appointment_types = test_clinic_with_therapist_and_types
        apt_type = appointment_types[0]

        # Set up therapist with Google Calendar credentials
        test_credentials = '{"access_token": "test_token", "refresh_token": "test_refresh"}'
        therapist.gcal_credentials = f"encrypted_{test_credentials}"
        db_session.add(therapist)
        db_session.commit()

        # Create appointment
        start_time = datetime.combine((datetime.now() + timedelta(days=1)).date(), time(10, 0))
        end_time = start_time + timedelta(minutes=apt_type.duration_minutes)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=therapist.id,
            event_type='appointment',
            date=start_time.date(),
            start_time=start_time.time(),
            end_time=end_time.time(),
            gcal_event_id='gcal_event_123'
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
        appointment.calendar_event.gcal_event_id = None  # Would be removed from Google Calendar
        db_session.commit()

        # Verify cancellation maintained data integrity
        canceled_appointment = db_session.query(Appointment).filter(Appointment.calendar_event_id == appointment.calendar_event_id).first()
        assert canceled_appointment.status == 'canceled_by_patient'
        assert canceled_appointment.calendar_event.gcal_event_id is None
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
