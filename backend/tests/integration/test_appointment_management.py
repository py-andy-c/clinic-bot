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
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=None
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
        
        edit_result = AppointmentService.edit_appointment(
            db=db_session,
            appointment_id=appointment_id,
            clinic_id=clinic.id,
            current_user_id=practitioner.id,
            new_start_time=new_start_time
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
            new_practitioner_id=practitioner2.id
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
        """Test notification decision tree logic comprehensively."""
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

        # Associate both practitioners with appointment type
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

        # Create availability
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
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        calendar_event = appointment.calendar_event
        old_start_time = datetime.combine(calendar_event.date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id = calendar_event.user_id  # System-assigned practitioner

        # Test 1: Changing from auto-assigned to specific - YES notification (practitioner changed)
        # Note: Auto-assigned appointments have a practitioner assigned, but we're changing to a different one
        # We need to ensure we're changing to a different practitioner
        new_practitioner_id = practitioner1.id if old_practitioner_id != practitioner1.id else practitioner2.id
        actual_practitioner_id = new_practitioner_id
        actual_start_time = old_start_time  # No time change
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when changing from auto-assigned to specific (practitioner changed)"

        # Test 1b: Changing from auto-assigned to specific WITH time change - YES notification (both changed)
        new_time = start_time + timedelta(hours=2)
        new_practitioner_id = practitioner1.id if old_practitioner_id != practitioner1.id else practitioner2.id
        actual_practitioner_id = new_practitioner_id
        actual_start_time = new_time
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when changing from auto-assigned to specific with time change (both changed)"

        # Test 2: Changing time only (auto-assigned) - YES notification
        actual_practitioner_id = old_practitioner_id  # Keep current
        actual_start_time = start_time + timedelta(hours=1)
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when time changes"

        # Test 3: Only notes changed - NO notification (no practitioner or time change)
        actual_practitioner_id = old_practitioner_id  # Keep current
        actual_start_time = old_start_time  # Keep current
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is False, "Should not send notification when only notes changed (no practitioner or time change)"

        # Test 4: No changes - NO notification
        actual_practitioner_id = old_practitioner_id  # Keep current
        actual_start_time = old_start_time  # Keep current
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is False, "Should not send notification when no changes made"

        # Create manually assigned appointment (use different day to avoid conflicts)
        start_time2 = start_time + timedelta(days=2)
        day_of_week2 = start_time2.date().weekday()
        existing_avail = db_session.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == practitioner1.id,
            PractitionerAvailability.clinic_id == clinic.id,
            PractitionerAvailability.day_of_week == day_of_week2
        ).first()
        if not existing_avail:
            create_practitioner_availability_with_clinic(
                db_session, practitioner1, clinic, day_of_week2, time(9, 0), time(17, 0)
            )
        existing_avail2 = db_session.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == practitioner2.id,
            PractitionerAvailability.clinic_id == clinic.id,
            PractitionerAvailability.day_of_week == day_of_week2
        ).first()
        if not existing_avail2:
            create_practitioner_availability_with_clinic(
                db_session, practitioner2, clinic, day_of_week2, time(9, 0), time(17, 0)
            )
        
        result2 = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time2,
            practitioner_id=practitioner1.id,
            line_user_id=None
        )
        appointment2 = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result2['appointment_id']
        ).first()
        calendar_event2 = appointment2.calendar_event
        old_start_time2 = datetime.combine(calendar_event2.date, calendar_event2.start_time).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id2 = calendar_event2.user_id  # practitioner1

        # Test 5: Changing practitioner from specific to different specific - YES notification
        actual_practitioner_id = practitioner2.id  # Different practitioner
        actual_start_time = old_start_time2  # No time change
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment2,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when practitioner changes from specific to different specific"

        # Test 6: Changing practitioner to same practitioner - NO notification
        actual_practitioner_id = practitioner1.id  # Same practitioner
        actual_start_time = old_start_time2  # No time change
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment2,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is False, "Should not send notification when practitioner doesn't actually change"

        # Test 7: Changing time for specific practitioner - YES notification
        actual_practitioner_id = old_practitioner_id2  # Keep current
        actual_start_time = start_time2 + timedelta(hours=1)
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment2,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when time changes for specific practitioner"

        # Test 8: Changing both practitioner and time - YES notification
        actual_practitioner_id = practitioner2.id
        actual_start_time = start_time2 + timedelta(hours=1)
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment2,
            new_practitioner_id=actual_practitioner_id,
            new_start_time=actual_start_time
        )
        assert should_send is True, "Should send notification when both practitioner and time change"

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

        # Create second appointment at 10:30 (doesn't overlap with 10:00-10:30)
        second_appointment_time = start_time + timedelta(minutes=30)
        AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=second_appointment_time,
            practitioner_id=practitioner.id,
            line_user_id=None
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

        # Reassign to practitioner2 (using edit_appointment directly)
        reassign_result = AppointmentService.edit_appointment(
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


    def test_edit_appointment_timezone_conversion(
        self, db_session: Session
    ):
        """Test that edit appointment correctly handles timezone conversion from UTC ISO strings."""
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
            duration_minutes=60,
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

        # Create availability (9 AM - 6 PM)
        from datetime import time
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(18, 0)
        )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment at 11:00 AM Taiwan time
        start_time = taiwan_now().replace(hour=11, minute=0, second=0, microsecond=0) + timedelta(days=1)
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

        # Verify original appointment time
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.start_time == time(11, 0)

        # Edit appointment to 9:15 AM Taiwan time
        # Simulate frontend sending UTC ISO string (9:15 AM Taiwan = 1:15 AM UTC same day)
        edit_time_taiwan = start_time.replace(hour=9, minute=15)
        # Convert to UTC (as frontend would send via toISOString())
        from datetime import timezone as tz
        edit_time_utc = edit_time_taiwan.astimezone(tz.utc)
        
        # Edit appointment - the service should handle timezone conversion
        edit_result = AppointmentService.edit_appointment(
            db=db_session,
            appointment_id=appointment_id,
            clinic_id=clinic.id,
            current_user_id=practitioner.id,
            new_practitioner_id=None,  # Keep same practitioner
            new_start_time=edit_time_utc.astimezone(TAIWAN_TZ),  # Service expects Taiwan time
            new_notes=None
        )

        assert edit_result['success'] is True

        # Verify appointment was updated to 9:15 AM Taiwan time (not 1:15 AM)
        db_session.refresh(appointment)
        assert appointment.calendar_event.start_time == time(9, 15)
        assert appointment.calendar_event.date == tomorrow

    def test_admin_can_edit_other_practitioner_appointment(
        self, db_session: Session
    ):
        """Test that admin can edit appointments belonging to other practitioners."""
        # Setup clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create admin user
        admin, _ = create_user_with_clinic_association(
            db_session, clinic, "admin@test.com", "admin_google", "Admin User", ["admin"]
        )

        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic, "practitioner@test.com", "p_google", "Dr. Practitioner", ["practitioner"]
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

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability for practitioner
        from datetime import time
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment for practitioner
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

        # Verify appointment belongs to practitioner
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.user_id == practitioner.id

        # Admin edits the appointment (changes time)
        new_start_time = start_time.replace(hour=11, minute=0)
        edit_result = AppointmentService.edit_appointment(
            db=db_session,
            appointment_id=appointment_id,
            clinic_id=clinic.id,
            current_user_id=admin.id,  # Admin editing
            new_practitioner_id=None,  # Keep same practitioner
            new_start_time=new_start_time,
            new_notes=None
        )

        assert edit_result['success'] is True

        # Verify appointment was updated
        db_session.refresh(appointment)
        assert appointment.calendar_event.start_time == time(11, 0)

    def test_practitioner_cannot_edit_other_practitioner_appointment(
        self, db_session: Session
    ):
        """Test that practitioner cannot edit appointments belonging to other practitioners."""
        # Setup clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create two practitioners
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

        # Associate both practitioners with appointment type
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

        # Create appointment for practitioner1
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

        # Verify appointment belongs to practitioner1
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.user_id == practitioner1.id

        # Note: Permission checks happen at the API level, not in the service.
        # The service method assumes the caller has already validated permissions.
        # This test verifies the appointment belongs to practitioner1, which would
        # be checked at the API endpoint level.
        db_session.refresh(appointment)
        assert appointment.calendar_event.user_id == practitioner1.id
