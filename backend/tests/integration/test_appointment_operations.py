"""
Integration tests for appointment CRUD operations.

This file contains tests for appointment creation, editing, cancellation, and reassignment.
These are the core operational tests that verify the appointment service works correctly.

Business logic principles are tested in test_appointment_business_logic.py.
Booking restrictions are tested in test_booking_restrictions.py.
"""

import pytest
from datetime import datetime, timedelta, time
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import (
    Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent,
    LineUser, PractitionerAvailability, PractitionerAppointmentTypes,
    UserClinicAssociation
)
from services.appointment_service import AppointmentService
from services.notification_service import NotificationService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from tests.conftest import (
    create_practitioner_availability_with_clinic,
    create_user_with_clinic_association
)


class TestAppointmentCreation:
    """Test appointment creation operations."""

    def test_create_appointment_for_patient_with_auto_assignment(
        self, db_session: Session
    ):
        """Test creating appointment for patient with auto-assignment."""
        # Setup clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioners
        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner1@test.com", "p1_google", "Dr. One", ["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner2@test.com", "p2_google", "Dr. Two", ["practitioner"]
        )

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioners with appointment type
        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner1.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        pat2 = PractitionerAppointmentTypes(
            user_id=practitioner2.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat1)
        db_session.add(pat2)
        db_session.commit()

        # Create availability for both practitioners
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )
        create_practitioner_availability_with_clinic(
            db_session, practitioner2, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with auto-assignment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None,  # Auto-assign
            line_user_id=None
        )

        # Verify appointment was created
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result['appointment_id']
        ).first()
        assert appointment is not None
        assert appointment.is_auto_assigned is True
        assert appointment.originally_auto_assigned is True
        assert appointment.reassigned_by_user_id is None
        assert appointment.reassigned_at is None

    def test_create_appointment_for_patient_with_specific_practitioner(
        self, db_session: Session
    ):
        """Test creating appointment for patient with specific practitioner."""
        # Setup (same as above)
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner@test.com", "p_google", "Dr. Test", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with specific practitioner and clinic notes
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        clinic_notes = "Test clinic internal notes"
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            clinic_notes=clinic_notes,
            line_user_id=None
        )

        # Verify appointment was created
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result['appointment_id']
        ).first()
        assert appointment is not None
        assert appointment.is_auto_assigned is False
        assert appointment.originally_auto_assigned is False
        assert appointment.clinic_notes == clinic_notes
        assert result['clinic_notes'] == clinic_notes


class TestAppointmentEditing:
    """Test appointment editing operations."""

    def test_edit_appointment_time_only(
        self, db_session: Session
    ):
        """Test editing appointment time only and verify notification is sent."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner@test.com", "p_google", "Dr. Test", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=None
        )
        appointment_id = result['appointment_id']

        # Get appointment before edit to check notification logic
        appointment_before_edit = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        calendar_event_before = appointment_before_edit.calendar_event
        old_start_time = datetime.combine(calendar_event_before.date, calendar_event_before.start_time).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id = calendar_event_before.user_id

        # Edit appointment time
        new_start_time = start_time + timedelta(hours=2)
        
        # Check notification before editing
        actual_practitioner_id = old_practitioner_id  # Keep current
        actual_start_time = new_start_time  # New time provided
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment_before_edit,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when time changes"
        
        # Update appointment with clinic notes
        new_clinic_notes = "Updated clinic notes"
        edit_result = AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_start_time=new_start_time,
            new_practitioner_id=None,
            new_clinic_notes=new_clinic_notes,
            apply_booking_constraints=False,
            allow_auto_assignment=False,
            reassigned_by_user_id=practitioner.id
        )

        assert edit_result['success'] is True

        # Verify appointment was updated
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        calendar_event = appointment.calendar_event
        assert calendar_event.date == new_start_time.date()
        assert calendar_event.start_time == new_start_time.time()
        assert appointment.clinic_notes == new_clinic_notes

    def test_clinic_notes_not_exposed_to_line_users(
        self, db_session: Session
    ):
        """Test that clinic_notes are not exposed to LINE users via list_appointments_for_line_user."""
        from models.line_user import LineUser

        # Setup clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner (signature: clinic, full_name, email, google_subject_id, roles)
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic, "Dr. Test", "practitioner@test.com", "p_google", ["practitioner"]
        )

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability for practitioner
        tomorrow = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_user",
            clinic_id=clinic.id,
            display_name="Test LINE User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patient linked to LINE user
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with clinic notes
        # Use time far enough in the future to satisfy minimum_booking_hours_ahead (24 hours by default)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        clinic_notes = "Sensitive clinic internal notes"
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            clinic_notes=clinic_notes,
            line_user_id=line_user.id
        )

        appointment_id = result['appointment_id']

        # Verify appointment was created with clinic notes
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.clinic_notes == clinic_notes

        # List appointments for LINE user - clinic_notes should NOT be included
        appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id, upcoming_only=True
        )

        assert len(appointments) == 1
        line_user_appointment = appointments[0]

        # Security check: clinic_notes must not be exposed to LINE users
        # The service explicitly sets clinic_notes to None for LINE users
        assert line_user_appointment.get("clinic_notes") is None, "clinic_notes should be None for LINE users"

        # Verify other fields are still present
        assert line_user_appointment["patient_name"] == "Test Patient"
        assert line_user_appointment["practitioner_name"] == "Dr. Test"
        assert "notes" in line_user_appointment  # Patient notes should still be visible

    def test_edit_appointment_practitioner_from_auto_assigned(
        self, db_session: Session
    ):
        """Test editing appointment practitioner from auto-assigned to specific."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner1@test.com", "p1_google", "Dr. One", ["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner2@test.com", "p2_google", "Dr. Two", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioners with appointment type
        for practitioner in [practitioner1, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appointment_type.id
            )
            db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        for practitioner in [practitioner1, practitioner2]:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
            )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with auto-assignment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None,  # Auto-assign
            line_user_id=None
        )
        appointment_id = result['appointment_id']

        # Verify it was auto-assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is True
        original_practitioner_id = appointment.calendar_event.user_id

        # Edit appointment to assign to specific practitioner
        edit_result = AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=practitioner2.id,
            new_start_time=None,
            apply_booking_constraints=False,
            allow_auto_assignment=False,
            reassigned_by_user_id=practitioner1.id  # Admin user
        )

        assert edit_result['success'] is True

        # Verify appointment was updated
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.calendar_event.user_id == practitioner2.id
        assert appointment.reassigned_by_user_id == practitioner1.id
        assert appointment.reassigned_at is not None


class TestAppointmentReassignment:
    """Test appointment reassignment operations."""

    def test_reassign_appointment(
        self, db_session: Session
    ):
        """Test reassigning appointment from one practitioner to another."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner1@test.com", "p1_google", "Dr. One", ["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner2@test.com", "p2_google", "Dr. Two", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioners with appointment type
        for practitioner in [practitioner1, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appointment_type.id
            )
            db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        for practitioner in [practitioner1, practitioner2]:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
            )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with practitioner1
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,
            line_user_id=None
        )
        appointment_id = result['appointment_id']

        # Reassign to practitioner2
        edit_result = AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=practitioner2.id,
            new_start_time=None,
            apply_booking_constraints=False,
            allow_auto_assignment=False,
            reassigned_by_user_id=practitioner1.id  # Admin user
        )

        assert edit_result['success'] is True

        # Verify appointment was reassigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.user_id == practitioner2.id
        assert appointment.reassigned_by_user_id == practitioner1.id
        assert appointment.reassigned_at is not None


class TestAppointmentConflictChecking:
    """Test appointment conflict checking."""

    def test_check_appointment_edit_conflicts(
        self, db_session: Session
    ):
        """Test that conflict checking works when editing appointments."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner@test.com", "p_google", "Dr. Test", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability for the appointment date (2 days ahead)
        appointment_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = appointment_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create LineUsers for patient bookings (to test conflict prevention)
        from models import LineUser
        line_user1 = LineUser(
            line_user_id="U_test_patient1",
            clinic_id=clinic.id,
            display_name="Test Patient 1"
        )
        line_user2 = LineUser(
            line_user_id="U_test_patient2",
            clinic_id=clinic.id,
            display_name="Test Patient 2"
        )
        db_session.add(line_user1)
        db_session.add(line_user2)
        db_session.flush()

        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 1",
            phone_number="0912345678",
            line_user_id=line_user1.id
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 2",
            phone_number="0912345699",
            line_user_id=line_user2.id
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.commit()

        # Create first appointment (patient booking - should prevent conflicts)
        # Schedule 2 days ahead to satisfy minimum booking hours constraint
        start_time1 = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        result1 = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time1,
            practitioner_id=practitioner.id,
            line_user_id=line_user1.id  # Patient booking - use database ID
        )
        appointment_id1 = result1['appointment_id']

        # Create second appointment at non-overlapping time (1 hour later)
        start_time2 = start_time1 + timedelta(hours=1)  # Non-overlapping
        result2 = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time2,
            practitioner_id=practitioner.id,
            line_user_id=line_user2.id  # Patient booking - use database ID
        )
        appointment_id2 = result2['appointment_id']

        # Try to edit first appointment to overlap with second (should detect conflict)
        # Move first appointment to same time as second appointment
        # Use apply_booking_constraints=True to test patient booking conflict prevention
        new_start_time = start_time2  # Same time as second appointment
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id1,
                new_start_time=new_start_time,
                new_practitioner_id=None,
                apply_booking_constraints=True,  # Patient booking - should prevent conflicts
                allow_auto_assignment=False
            )

        assert exc_info.value.status_code == status.HTTP_409_CONFLICT

    def test_appointment_booking_allows_different_practitioners_same_time(
        self, db_session: Session
    ):
        """Test that different practitioners can have appointments at the same time."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner1@test.com", "p1_google", "Dr. One", ["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner2@test.com", "p2_google", "Dr. Two", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioners with appointment type
        for practitioner in [practitioner1, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appointment_type.id
            )
            db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        for practitioner in [practitioner1, practitioner2]:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
            )

        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 1",
            phone_number="0912345678"
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 2",
            phone_number="0912345699"
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.commit()

        # Create appointments at same time for different practitioners
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result1 = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient1.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,
            line_user_id=None
        )
        result2 = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient2.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner2.id,
            line_user_id=None
        )

        # Both should succeed
        assert result1['appointment_id'] is not None
        assert result2['appointment_id'] is not None


class TestAppointmentTimezoneHandling:
    """Test appointment timezone handling."""

    def test_edit_appointment_timezone_conversion(
        self, db_session: Session
    ):
        """Test that appointment timezone conversion works correctly."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner@test.com", "p_google", "Dr. Test", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=None
        )
        appointment_id = result['appointment_id']

        # Edit appointment with new time
        new_start_time = start_time + timedelta(hours=2)
        edit_result = AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_start_time=new_start_time,
            new_practitioner_id=None,
            apply_booking_constraints=False,
            allow_auto_assignment=False,
            reassigned_by_user_id=practitioner.id
        )

        assert edit_result['success'] is True

        # Verify timezone is preserved
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        calendar_event = appointment.calendar_event
        updated_start_time = datetime.combine(
            calendar_event.date,
            calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        assert updated_start_time == new_start_time


class TestAppointmentAuthorization:
    """Test appointment authorization and access control."""

    def test_admin_can_edit_other_practitioner_appointment(
        self, db_session: Session
    ):
        """Test that admin can edit appointments belonging to other practitioners."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner1@test.com", "p1_google", "Dr. One", ["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner2@test.com", "p2_google", "Dr. Two", ["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Associate practitioners with appointment type
        for practitioner in [practitioner1, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appointment_type.id
            )
            db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        for practitioner in [practitioner1, practitioner2]:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
            )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with practitioner1
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,
            line_user_id=None
        )
        appointment_id = result['appointment_id']

        # Admin (practitioner2) edits appointment belonging to practitioner1
        new_start_time = start_time + timedelta(hours=1)
        edit_result = AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_start_time=new_start_time,
            new_practitioner_id=None,
            apply_booking_constraints=False,
            allow_auto_assignment=False,
            reassigned_by_user_id=practitioner2.id  # Admin user
        )

        assert edit_result['success'] is True

        # Verify appointment was updated
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        calendar_event = appointment.calendar_event
        assert calendar_event.date == new_start_time.date()
        assert calendar_event.start_time == new_start_time.time()

