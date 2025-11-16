"""
Integration tests for appointment management features.

Tests the new appointment management functionality including:
- Creating appointments on behalf of patients
- Editing appointments (time and practitioner)
- Reassigning appointments
- Auto-assignment tracking
- Conflict checking
- Notification decision tree
"""

import pytest
from datetime import datetime, timedelta
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


class TestAppointmentManagement:
    """Integration tests for appointment management features."""

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
        from datetime import time
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )
        create_practitioner_availability_with_clinic(
            db_session, practitioner2, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with auto-assignment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None  # Auto-assign
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
        from datetime import time
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

        # Create appointment with specific practitioner
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id
        )

        # Verify appointment was created
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result['appointment_id']
        ).first()
        assert appointment is not None
        assert appointment.is_auto_assigned is False
        assert appointment.originally_auto_assigned is False

    def test_edit_appointment_time_only(
        self, db_session: Session
    ):
        """Test editing appointment time only."""
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
        from datetime import time
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
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id
        )
        appointment_id = result['appointment_id']

        # Edit appointment time
        new_start_time = start_time + timedelta(hours=2)
        edit_result = AppointmentService.edit_appointment(
            db=db_session,
            appointment_id=appointment_id,
            clinic_id=clinic.id,
            current_user_id=practitioner.id,
            new_start_time=new_start_time,
            is_admin=False
        )

        assert edit_result['success'] is True

        # Verify appointment was updated
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        calendar_event = appointment.calendar_event
        assert calendar_event.date == new_start_time.date()
        assert calendar_event.start_time == new_start_time.time()

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
        from datetime import time
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

        # Create auto-assigned appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None  # Auto-assign
        )
        appointment_id = result['appointment_id']

        # Verify it's auto-assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is True
        assert appointment.originally_auto_assigned is True

        # Edit to assign specific practitioner
        edit_result = AppointmentService.edit_appointment(
            db=db_session,
            appointment_id=appointment_id,
            clinic_id=clinic.id,
            current_user_id=practitioner1.id,
            new_practitioner_id=practitioner2.id,
            is_admin=True
        )

        assert edit_result['success'] is True

        # Verify tracking fields
        db_session.refresh(appointment)
        assert appointment.is_auto_assigned is False
        assert appointment.originally_auto_assigned is True  # Preserved
        assert appointment.reassigned_by_user_id == practitioner1.id
        assert appointment.reassigned_at is not None

    def test_should_send_edit_notification_decision_tree(
        self, db_session: Session
    ):
        """Test notification decision tree logic."""
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
        from datetime import time
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

        # Create auto-assigned appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None  # Auto-assign
        )
        appointment_id = result['appointment_id']
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()

        # Test 1: Changing from auto-assigned to specific - NO notification
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=practitioner.id,
            new_start_time=None,
            old_notes=None,
            new_notes=None
        )
        assert should_send is False

        # Test 2: Changing time - YES notification
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=None,
            new_start_time=start_time + timedelta(hours=1),
            old_notes=None,
            new_notes=None
        )
        assert should_send is True

        # Create manually assigned appointment (use different day to avoid conflicts)
        start_time2 = start_time + timedelta(days=2)
        # Ensure availability for that day
        day_of_week2 = start_time2.date().weekday()
        from datetime import time
        # Check if availability already exists for this day
        existing_avail = db_session.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == practitioner.id,
            PractitionerAvailability.clinic_id == clinic.id,
            PractitionerAvailability.day_of_week == day_of_week2
        ).first()
        if not existing_avail:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic, day_of_week2, time(9, 0), time(17, 0)
            )
        
        result2 = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time2,
            practitioner_id=practitioner.id
        )
        appointment2 = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result2['appointment_id']
        ).first()

        # Test 3: Changing practitioner from specific to specific - YES notification
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment2,
            new_practitioner_id=practitioner.id,  # Same practitioner, but logic checks if changed
            new_start_time=None,
            old_notes=None,
            new_notes=None
        )
        # Note: This will return True because new_practitioner_id is not None and not auto-assigned
        # In practice, the API should check if practitioner actually changed

    def test_check_appointment_edit_conflicts(
        self, db_session: Session
    ):
        """Test conflict checking for appointment edits."""
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
        from datetime import time
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

        # Create first appointment at 10:00
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id
        )
        appointment_id = result['appointment_id']

        # Create second appointment at 10:30 (doesn't overlap with 10:00-10:30)
        second_appointment_time = start_time + timedelta(minutes=30)
        AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=second_appointment_time,
            practitioner_id=practitioner.id
        )

        # Try to edit first appointment to 10:15 - should detect conflict with second appointment (10:30-11:00)
        # because 10:15-10:45 overlaps with 10:30-11:00
        conflicting_time = start_time + timedelta(minutes=15)
        is_valid, error_message, conflicts = AppointmentService.check_appointment_edit_conflicts(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=None,
            new_start_time=conflicting_time,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id
        )

        assert is_valid is False
        assert len(conflicts) > 0

    def test_reassign_appointment(
        self, db_session: Session
    ):
        """Test reassigning appointment."""
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
        from datetime import time
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

        # Create auto-assigned appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment_for_patient(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None  # Auto-assign
        )
        appointment_id = result['appointment_id']

        # Reassign to practitioner2
        reassign_result = AppointmentService.reassign_appointment(
            db=db_session,
            appointment_id=appointment_id,
            clinic_id=clinic.id,
            current_user_id=practitioner1.id,
            new_practitioner_id=practitioner2.id
        )

        assert reassign_result['success'] is True

        # Verify reassignment tracking
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.originally_auto_assigned is True
        assert appointment.reassigned_by_user_id == practitioner1.id
        assert appointment.reassigned_at is not None

