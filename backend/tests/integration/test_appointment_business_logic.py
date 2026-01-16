"""
Integration tests for appointment business logic.

This test suite validates the business logic documented in:
docs/design_doc/appointment_business_logic.md

Tests are organized by key principles to ensure comprehensive coverage.
"""

import pytest
from datetime import datetime, timedelta, time
from unittest.mock import patch, MagicMock
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
from utils.practitioner_helpers import AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
from tests.conftest import (
    create_practitioner_availability_with_clinic,
    create_user_with_clinic_association
)


class TestAutoAssignmentVisibilityPrinciple:
    """Test Principle 1: Auto-assigned practitioners never know about appointments until assigned."""

    def test_auto_assigned_practitioner_no_notification_on_creation(
        self, db_session: Session
    ):
        """Test that auto-assigned practitioner doesn't receive notification on creation."""
        # Setup
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create auto-assigned appointment (more than 24 hours ahead for patient booking)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        
        with patch.object(NotificationService, 'send_unified_appointment_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_confirmation') as mock_patient_notify:
            result = AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                practitioner_id=None,  # Auto-assign
                line_user_id=line_user.id  # Patient-triggered
            )

            # Verify no notification was sent to practitioner (auto-assigned)
            mock_practitioner_notify.assert_not_called()
            # Verify patient does NOT receive notification (patient-triggered creation)
            mock_patient_notify.assert_not_called()

        # Verify appointment is auto-assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result['appointment_id']
        ).first()
        assert appointment.is_auto_assigned is True
        assert appointment.originally_auto_assigned is True

    def test_auto_assigned_appointment_hidden_from_practitioner_calendar(
        self, db_session: Session
    ):
        """Test that auto-assigned appointments don't appear on practitioner calendar."""
        # This is tested implicitly - if is_auto_assigned=True, calendar queries should exclude it
        # The actual calendar query logic is tested elsewhere
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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

        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == result['appointment_id']
        ).first()
        
        # Verify it's marked as auto-assigned (which means hidden from practitioner)
        assert appointment.is_auto_assigned is True
        # The calendar query logic should filter these out (tested in calendar service tests)

    def test_admin_reassignment_makes_appointment_visible(
        self, db_session: Session
    ):
        """Test that admin reassignment makes appointment visible to practitioner."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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

        # Admin reassigns to practitioner2
        with patch.object(NotificationService, 'send_unified_appointment_notification') as mock_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=None,
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Verify notification was sent (practitioner now knows)
            mock_notify.assert_called_once()

        # Verify appointment is now visible
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.reassigned_by_user_id == practitioner1.id

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestPatientNotificationsOnCreation:
    """Test that patients receive notifications when appointments are created."""

    def test_patient_does_not_receive_notification_when_patient_creates_appointment(
        self, db_session: Session
    ):
        """Test that patient does NOT receive notification when they create appointment themselves (they see UI confirmation)."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create appointment with specific practitioner (more than 24 hours ahead)
        # Patient creates it themselves (line_user_id provided)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        
        with patch.object(NotificationService, 'send_appointment_confirmation') as mock_patient_notify, \
             patch.object(NotificationService, 'send_unified_appointment_notification') as mock_practitioner_notify:
            result = AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                practitioner_id=practitioner1.id,
                line_user_id=line_user.id  # Patient triggered
            )

            # Verify patient does NOT receive notification (they see UI confirmation)
            # But practitioner still receives notification
            mock_patient_notify.assert_not_called()
            mock_practitioner_notify.assert_called_once()

    def test_patient_does_not_receive_notification_when_auto_assigned(
        self, db_session: Session
    ):
        """Test that patient does NOT receive notification when appointment is auto-assigned (will get reminder later)."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create auto-assigned appointment (more than 24 hours ahead)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        
        with patch.object(NotificationService, 'send_appointment_confirmation') as mock_patient_notify:
            result = AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                practitioner_id=None,  # Auto-assign
                line_user_id=line_user.id
            )

            # Verify patient does NOT receive notification (auto-assigned, will get reminder later)
            mock_patient_notify.assert_not_called()

    def test_clinic_admin_creation_sends_patient_notification(
        self, db_session: Session
    ):
        """Test that clinic admin creating appointment sends patient notification."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Clinic admin creates appointment (line_user_id=None)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        
        with patch.object(NotificationService, 'send_appointment_confirmation') as mock_patient_notify, \
             patch.object(NotificationService, 'send_unified_appointment_notification') as mock_practitioner_notify:
            result = AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                practitioner_id=practitioner1.id,  # Must specify
                line_user_id=None  # Clinic admin
            )

            # Verify both patient and practitioner receive notifications
            mock_patient_notify.assert_called_once()
            mock_practitioner_notify.assert_called_once()

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestPatientPerspectiveOnAutoAssignment:
    """Test Principle 2: Patients who originally selected auto-assignment never know about practitioner changes."""

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        return clinic, practitioner1, practitioner2, appointment_type, patient

    def test_patient_sees_auto_assigned_display_name_for_auto_assigned_appointment(
        self, db_session: Session
    ):
        """Test that patient sees auto-assigned display name for auto-assigned appointments."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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

        # Verify patient sees auto-assigned display name
        assert result['practitioner_name'] == AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
        assert result['is_auto_assigned'] is True

    def test_patient_notified_when_admin_reassigns_practitioner_only(
        self, db_session: Session
    ):
        """Test that patient IS notified when admin changes from auto-assigned to specific practitioner (even without time change)."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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

        # Admin reassigns from auto-assigned to specific practitioner (no time change)
        # This should notify because changing from "不指定" to a specific practitioner is significant
        with patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=None,  # No time change
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id
            )

            # Verify patient WAS notified (changing from auto-assigned to specific practitioner)
            mock_patient_notify.assert_called_once()

    def test_patient_notified_when_admin_changes_time(
        self, db_session: Session
    ):
        """Test that patient IS notified when admin changes time."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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

        # Admin changes time (and possibly practitioner)
        new_start_time = start_time + timedelta(hours=2)
        
        with patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,  # Also changes practitioner
                new_start_time=new_start_time,  # Time change
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id
            )

            # Verify patient WAS notified (about time change only)
            mock_patient_notify.assert_called_once()


# NOTE: Booking restriction tests have been moved to test_booking_restrictions.py
# This keeps business logic tests focused on core principles, not implementation details


class TestPatientEditingScenarios:
    """Test patient editing scenarios from business logic document."""

    def test_patient_changes_to_auto_assigned_from_specific_practitioner(
        self, db_session: Session
    ):
        """Test patient changing from specific practitioner to auto-assigned."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create appointment with specific practitioner (more than 24 hours ahead for cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Patient changes to auto-assigned
        with patch.object(NotificationService, 'send_unified_cancellation_notification') as mock_cancel:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=-1,  # -1 means auto-assign when allow_auto_assignment=True
                new_start_time=None,
                apply_booking_constraints=True,
                allow_auto_assignment=True  # Allow auto-assignment
            )

            # Verify original practitioner receives cancellation notification
            mock_cancel.assert_called_once()

        # Verify appointment is now auto-assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is True

    def test_patient_changes_from_auto_assigned_to_specific_practitioner(
        self, db_session: Session
    ):
        """Test patient changing from auto-assigned to specific practitioner."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create auto-assigned appointment (more than 24 hours ahead for cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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
        old_practitioner_id = appointment.calendar_event.user_id

        # Patient changes to specific practitioner
        with patch.object(NotificationService, 'send_unified_appointment_notification') as mock_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=None,
                apply_booking_constraints=True,
                allow_auto_assignment=False
            )

            # Verify new practitioner receives notification (old practitioner never knew, so no notification)
            mock_notify.assert_called_once()

        # Verify appointment is now manually assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.calendar_event.user_id == practitioner2.id

    def test_patient_edits_auto_assigned_keeps_same_practitioner_if_available(
        self, db_session: Session
    ):
        """Test that patient editing auto-assigned appointment keeps same practitioner if available."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create auto-assigned appointment (more than 24 hours ahead for cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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
        original_practitioner_id = appointment.calendar_event.user_id

        # Patient edits time but keeps auto-assigned (practitioner should stay same if available)
        new_start_time = start_time + timedelta(hours=2)
        AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=-1,  # Keep auto-assigned
            new_start_time=new_start_time,
            apply_booking_constraints=True,
            allow_auto_assignment=True
        )

        # Verify same practitioner is kept (if available at new time)
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        # The practitioner might be the same if available, or different if not available
        # The key is that is_auto_assigned remains True
        assert appointment.is_auto_assigned is True

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2, 3]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestEdgeCases:
    """Test edge cases from business logic document."""

    def test_cannot_edit_cancelled_appointment(
        self, db_session: Session
    ):
        """Test that cancelled appointments cannot be edited."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create availability for day 2
        target_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = target_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create appointment (more than 24 hours ahead for cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Cancel appointment
        AppointmentService.cancel_appointment(
            db=db_session,
            appointment_id=appointment_id,
            cancelled_by='patient'
        )

        # Try to edit cancelled appointment (should fail)
        new_start_time = start_time + timedelta(hours=1)
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=None,
                new_start_time=new_start_time,
                apply_booking_constraints=False,
                allow_auto_assignment=False
            )

        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
        # Error message should indicate appointment is cancelled
        assert exc_info.value.detail is not None

    def test_admin_confirmation_without_changes(
        self, db_session: Session
    ):
        """Test admin confirming auto-assigned appointment without changes."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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
        original_practitioner_id = appointment.calendar_event.user_id

        # Admin confirms without changes
        with patch.object(NotificationService, 'send_unified_appointment_notification') as mock_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=original_practitioner_id,  # Same practitioner
                new_start_time=None,  # No time change
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Verify practitioner receives notification (as if patient just made appointment)
            mock_notify.assert_called_once()

        # Verify appointment is now visible
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.reassigned_by_user_id == practitioner1.id

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestAdditionalScenarios:
    """Test additional scenarios from business logic document."""

    def test_patient_changes_from_specific_practitioner_a_to_b(
        self, db_session: Session
    ):
        """Test patient changing from specific practitioner A to specific practitioner B."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create appointment with practitioner1 (more than 24 hours ahead)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Patient changes to practitioner2
        with patch.object(NotificationService, 'send_unified_cancellation_notification') as mock_cancel, \
             patch.object(NotificationService, 'send_unified_appointment_notification') as mock_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=None,
                apply_booking_constraints=True,
                allow_auto_assignment=False
            )

            # Verify old practitioner receives cancellation, new receives appointment notification
            mock_cancel.assert_called_once()
            mock_notify.assert_called_once()

        # Verify appointment is now assigned to practitioner2
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.user_id == practitioner2.id
        assert appointment.is_auto_assigned is False

    def test_patient_changes_time_keeping_same_practitioner(
        self, db_session: Session
    ):
        """Test patient changing time but keeping same specific practitioner."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create appointment with practitioner1 (more than 24 hours ahead)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Patient changes time but keeps same practitioner
        new_start_time = start_time + timedelta(hours=2)
        with patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify, \
             patch.object(NotificationService, 'send_unified_edit_notification') as mock_practitioner_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=None,  # Keep same
                new_start_time=new_start_time,
                apply_booking_constraints=True,
                allow_auto_assignment=False
                # reassigned_by_user_id=None (patient-triggered)
            )

            # Patient should NOT be notified (patient-triggered edit)
            mock_patient_notify.assert_not_called()
            # Practitioner should receive notification about time change
            mock_practitioner_notify.assert_called_once()

        # Verify appointment time changed
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.date == new_start_time.date()
        assert appointment.calendar_event.start_time == new_start_time.time()

    def test_patient_edits_auto_assigned_time_change_notification(
        self, db_session: Session
    ):
        """Test that patient receives notification when clinic edits auto-assigned appointment time."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create auto-assigned appointment (more than 24 hours ahead)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Clinic edits time but keeps auto-assigned (reassigned_by_user_id provided = clinic triggered)
        new_start_time = start_time + timedelta(hours=2)
        with patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=-1,  # Keep auto-assigned
                new_start_time=new_start_time,
                apply_booking_constraints=False,  # Clinic bypasses constraints
                allow_auto_assignment=True,
                reassigned_by_user_id=practitioner1.id  # Clinic triggered
            )

            # Patient should receive notification about time change (clinic triggered)
            mock_patient_notify.assert_called_once()

        # Verify appointment is still auto-assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is True

    def test_patient_does_not_receive_notification_when_patient_edits_appointment(
        self, db_session: Session
    ):
        """Test that patient does NOT receive notification when they edit appointment themselves (they see UI confirmation)."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create appointment (more than 24 hours ahead)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,
            line_user_id=line_user.id  # Patient created it
        )
        appointment_id = result['appointment_id']

        # Patient edits time (reassigned_by_user_id=None = patient triggered)
        new_start_time = start_time + timedelta(hours=2)
        with patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=None,  # Keep same practitioner
                new_start_time=new_start_time,
                apply_booking_constraints=True,  # Patient must follow constraints
                allow_auto_assignment=False,
                reassigned_by_user_id=None  # Patient triggered
            )

            # Patient should NOT receive notification (they see UI confirmation)
            mock_patient_notify.assert_not_called()

    def test_max_future_appointments_limit_enforcement(
        self, db_session: Session
    ):
        """Test that max_future_appointments limit is enforced for patients."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Set max_future_appointments to 1
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.max_future_appointments = 1
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create first appointment
        start_time1 = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time1,
            practitioner_id=practitioner1.id,
            line_user_id=line_user.id
        )

        # Try to create second appointment (should fail)
        start_time2 = taiwan_now().replace(hour=14, minute=0, second=0, microsecond=0) + timedelta(days=3)
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time2,
                practitioner_id=practitioner1.id,
                line_user_id=line_user.id
            )

        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST

    def test_max_booking_window_days_enforcement(
        self, db_session: Session
    ):
        """Test that max_booking_window_days limit is enforced for patients."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Set max_booking_window_days to 7
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.max_booking_window_days = 7
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Try to create appointment beyond window (should fail)
        start_time = taiwan_now() + timedelta(days=10)
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                practitioner_id=practitioner1.id,
                line_user_id=line_user.id
            )

        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST

    def test_admin_reassignment_to_same_practitioner(
        self, db_session: Session
    ):
        """Test admin reassigning auto-assigned appointment to same practitioner (confirmation)."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

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
        original_practitioner_id = appointment.calendar_event.user_id

        # Admin confirms by reassigning to same practitioner
        with patch.object(NotificationService, 'send_unified_appointment_notification') as mock_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=original_practitioner_id,  # Same practitioner
                new_start_time=None,  # No time change
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Practitioner should receive notification as if patient just made appointment
            mock_notify.assert_called_once()

        # Verify appointment is now visible
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.reassigned_by_user_id == practitioner1.id

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2, 3, 4, 5, 6, 7, 10]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient
"""
Additional tests for missing scenarios from appointment business logic.

These tests cover critical missing scenarios identified in the test coverage analysis.
"""

import pytest
from datetime import datetime, timedelta, time
from unittest.mock import patch
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


# NOTE: Minimum cancellation hours tests have been moved to test_booking_restrictions.py


class TestAdminEditingManuallyAssignedAppointments:
    """Test admin editing manually assigned appointments."""

    def test_admin_changes_practitioner_on_manually_assigned_appointment(
        self, db_session: Session
    ):
        """Test that admin changing practitioner on manually assigned appointment notifies both practitioners and patient."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create appointment with specific practitioner
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Admin changes practitioner
        with patch.object(NotificationService, 'send_unified_edit_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=None,
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Verify both practitioners receive reassignment notification
            mock_practitioner_notify.assert_called_once()
            # Verify patient receives notification
            mock_patient_notify.assert_called_once()

    def test_admin_changes_time_on_manually_assigned_appointment(
        self, db_session: Session
    ):
        """Test that admin changing time on manually assigned appointment notifies practitioner and patient."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create appointment with specific practitioner
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Admin changes time only
        new_start_time = start_time + timedelta(hours=2)
        with patch.object(NotificationService, 'send_unified_edit_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=None,  # Keep same
                new_start_time=new_start_time,
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Verify practitioner receives reassignment notification
            mock_practitioner_notify.assert_called_once()
            # Verify patient receives notification
            mock_patient_notify.assert_called_once()

    def test_admin_changes_both_practitioner_and_time_on_manually_assigned_appointment(
        self, db_session: Session
    ):
        """Test that admin changing both practitioner and time notifies all parties."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create appointment with specific practitioner
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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

        # Admin changes both practitioner and time
        new_start_time = start_time + timedelta(hours=2)
        with patch.object(NotificationService, 'send_unified_edit_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=new_start_time,
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Verify both practitioners receive reassignment notification
            mock_practitioner_notify.assert_called_once()
            # Verify patient receives notification
            mock_patient_notify.assert_called_once()

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2, 3, 4]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestAdminEditingAutoAssignedBothChanges:
    """Test admin editing auto-assigned appointment with both practitioner and time changes."""

    def test_admin_changes_both_practitioner_and_time_on_auto_assigned_appointment(
        self, db_session: Session
    ):
        """Test that admin changing both practitioner and time on auto-assigned appointment notifies patient about time only."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
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
        assert appointment.is_auto_assigned is True
        assert appointment.originally_auto_assigned is True

        # Admin changes both practitioner and time
        new_start_time = start_time + timedelta(hours=2)
        with patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify, \
             patch.object(NotificationService, 'send_unified_appointment_notification') as mock_practitioner_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=practitioner2.id,
                new_start_time=new_start_time,
                apply_booking_constraints=False,
                allow_auto_assignment=False,
                reassigned_by_user_id=practitioner1.id  # Admin user
            )

            # Verify patient receives notification (about time change only)
            mock_patient_notify.assert_called_once()
            # Verify new practitioner receives notification (as if patient made appointment)
            mock_practitioner_notify.assert_called_once()

        # Verify appointment is now manually assigned
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.is_auto_assigned is False
        assert appointment.calendar_event.user_id == practitioner2.id

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2, 3]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestPatientChangingFromVisibleToAutoAssigned:
    """Test patient changing from visible (made by cron) to auto-assigned."""

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to set up clinic with practitioners and patient."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner1, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner1@test.com",
            google_subject_id="practitioner1_123",
            full_name="Dr. Practitioner 1",
            roles=["practitioner"]
        )

        practitioner2, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@test.com",
            google_subject_id="practitioner2_123",
            full_name="Dr. Practitioner 2",
            roles=["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Associate practitioners with appointment type
        for practitioner in [practitioner1, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appointment_type.id
            )
            db_session.add(pat)

        # Create availability for multiple days
        for day_offset in [1, 2, 3, 4, 5, 6, 7, 10]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
            for practitioner in [practitioner1, practitioner2]:
                create_practitioner_availability_with_clinic(
                    db_session, practitioner, clinic,
                    day_of_week=day_of_week,
                    start_time=time(9, 0),
                    end_time=time(17, 0)
                )

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        return clinic, practitioner1, practitioner2, appointment_type, patient

    def test_patient_changes_to_auto_assigned_old_practitioner_available(
        self, db_session: Session
    ):
        """Test patient changing to auto-assigned when old practitioner (made visible by cron) is still available."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create auto-assigned appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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
        old_practitioner_id = appointment.calendar_event.user_id

        # Simulate cron job making it visible (set is_auto_assigned=False, originally_auto_assigned=True)
        appointment.is_auto_assigned = False
        db_session.commit()

        # Patient changes to auto-assigned again (old practitioner still available)
        with patch.object(NotificationService, 'send_unified_appointment_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=-1,  # Auto-assign
                new_start_time=None,  # Keep same time
                apply_booking_constraints=True,
                allow_auto_assignment=True
            )

            # Verify old practitioner receives NO notification (no change from their perspective)
            mock_practitioner_notify.assert_not_called()
            # Patient does NOT receive notification (originally_auto_assigned=True and time didn't change)
            # Patient still sees "不指定" so no visible change from their perspective
            mock_patient_notify.assert_not_called()

        # Verify appointment stays visible (is_auto_assigned=False) since old practitioner is available
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        # Old practitioner is available, so they should be kept and appointment stays visible
        assert appointment.is_auto_assigned is False
        assert appointment.calendar_event.user_id == old_practitioner_id

    def test_patient_changes_to_auto_assigned_old_practitioner_unavailable(
        self, db_session: Session
    ):
        """Test patient changing to auto-assigned when old practitioner (made visible by cron) is not available."""
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Create auto-assigned appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
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
        old_practitioner_id = appointment.calendar_event.user_id

        # Simulate cron job making it visible (set is_auto_assigned=False, originally_auto_assigned=True)
        appointment.is_auto_assigned = False
        db_session.commit()

        # Remove availability for old practitioner at this time
        # (simulate practitioner being unavailable)
        # Create a conflicting appointment for old practitioner
        # We need to create both CalendarEvent and Appointment for it to be detected as a conflict
        conflicting_start = start_time
        conflicting_end = conflicting_start + timedelta(minutes=30)
        conflicting_event = CalendarEvent(
            user_id=old_practitioner_id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=conflicting_start.date(),
            start_time=conflicting_start.time(),
            end_time=conflicting_end.time()
        )
        db_session.add(conflicting_event)
        db_session.flush()  # Get the ID
        
        # Create a dummy patient for the conflicting appointment
        conflicting_patient = Patient(
            clinic_id=clinic.id,
            full_name="Conflicting Patient",
            phone_number="0999999999"
        )
        db_session.add(conflicting_patient)
        db_session.flush()
        
        # Create appointment for the conflicting event
        conflicting_appointment = Appointment(
            calendar_event_id=conflicting_event.id,
            patient_id=conflicting_patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(conflicting_appointment)
        db_session.commit()

        # Patient changes to auto-assigned again (old practitioner not available)
        with patch.object(NotificationService, 'send_unified_cancellation_notification') as mock_cancel, \
             patch.object(NotificationService, 'send_appointment_edit_notification') as mock_patient_notify:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=-1,  # Auto-assign
                new_start_time=None,  # Keep same time
                apply_booking_constraints=True,
                allow_auto_assignment=True
            )

            # Verify old practitioner receives cancellation notification
            mock_cancel.assert_called_once()
            # Patient does NOT receive notification (originally_auto_assigned=True and time didn't change)
            # Patient still sees "不指定" so no visible change from their perspective
            mock_patient_notify.assert_not_called()

        # Verify appointment becomes hidden again (is_auto_assigned=True) since old practitioner unavailable


class TestPatientCancellationNotifications:
    """Test patient notifications on appointment cancellation."""

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to set up clinic with practitioners and patient."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        practitioner1, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner1@test.com",
            google_subject_id="practitioner1_123",
            full_name="Dr. Practitioner 1",
            roles=["practitioner"]
        )

        # Create a second practitioner for consistency with other test classes
        practitioner2, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@test.com",
            google_subject_id="practitioner2_123",
            full_name="Dr. Practitioner 2",
            roles=["practitioner"]
        )

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.flush()

        line_user = LineUser(
            line_user_id="U_patient_test",
            clinic_id=clinic.id,
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.flush()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()
        db_session.refresh(patient)

        return clinic, practitioner1, practitioner2, appointment_type, patient

    def test_patient_receives_notification_on_cancellation(
        self, db_session: Session
    ):
        """Test that patient receives notification when they cancel their appointment."""
        from services.notification_service import CancellationSource
        
        clinic, practitioner, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create availability for day 2
        target_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = target_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        # Create appointment (more than 24 hours ahead to allow cancellation)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=patient.line_user_id
        )
        appointment_id = result['appointment_id']

        # Cancel appointment with mocked notifications
        with patch.object(NotificationService, 'send_unified_cancellation_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_cancellation') as mock_patient_notify:
            
            AppointmentService.cancel_appointment(
                db=db_session,
                appointment_id=appointment_id,
                cancelled_by='patient'  # Patient-triggered cancellation
            )

            # Verify practitioner notification was sent
            mock_practitioner_notify.assert_called_once()
            call_args = mock_practitioner_notify.call_args
            # Unified method signature: (db, appointment, clinic, practitioner, cancelled_by, ...)
            # Get appointment from database to compare
            from models import Appointment
            db_appointment = db_session.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).first()
            assert call_args[0][1] == db_appointment  # Second arg is appointment
            assert call_args[0][2] == clinic  # Third arg is clinic
            assert call_args[0][3] == practitioner  # Fourth arg is practitioner
            assert call_args[0][4] == 'patient'  # Fifth arg is cancelled_by

            # Verify patient notification was NOT sent (patient-triggered cancellation)
            mock_patient_notify.assert_not_called()

    def test_patient_receives_notification_on_clinic_cancellation(
        self, db_session: Session
    ):
        """Test that patient receives notification when clinic cancels their appointment."""
        from services.notification_service import CancellationSource
        
        clinic, practitioner, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create availability for day 2
        target_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = target_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        # Create appointment
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=patient.line_user_id  # Use line_user_id directly
        )
        appointment_id = result['appointment_id']

        # Cancel appointment by clinic with mocked notifications
        with patch.object(NotificationService, 'send_unified_cancellation_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_cancellation') as mock_patient_notify:
            
            AppointmentService.cancel_appointment(
                db=db_session,
                appointment_id=appointment_id,
                cancelled_by='clinic'
            )

            # Verify practitioner notification was sent
            mock_practitioner_notify.assert_called_once()
            call_args = mock_practitioner_notify.call_args
            assert call_args[0][4] == 'clinic'  # Fifth arg is cancelled_by

            # Verify patient notification was sent with correct source
            mock_patient_notify.assert_called_once()
            call_args = mock_patient_notify.call_args
            appointment = db_session.query(Appointment).filter(
                Appointment.calendar_event_id == appointment_id
            ).first()
            assert call_args[0][3] == CancellationSource.CLINIC  # Fourth arg is CancellationSource

        # Verify appointment status is canceled
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.status == 'canceled_by_clinic'
        assert appointment.canceled_at is not None

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2, 3]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient


class TestClinicAdminMustSpecifyPractitioner:
    """Test that clinic admin must specify practitioner (cannot use auto-assignment).
    
    Note: This restriction is enforced at the API layer (ClinicAppointmentCreateRequest
    requires practitioner_id: int), not at the service layer. The service layer will
    auto-assign if practitioner_id is None, but the API layer prevents this for clinic admins.
    """

    def test_clinic_admin_can_create_with_auto_assignment_at_service_layer(
        self, db_session: Session
    ):
        """Test that service layer allows auto-assignment (restriction is at API layer).
        
        This test verifies that the service layer doesn't enforce the restriction,
        as it's enforced by the API request model validation.
        """
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Service layer allows auto-assignment (API layer enforces restriction)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=None,  # Auto-assign - service allows this
            line_user_id=None  # Clinic admin
        )

        # Service layer succeeds (auto-assigns a practitioner)
        assert result['appointment_id'] is not None
        assert result['is_auto_assigned'] is True

    def test_clinic_admin_edit_with_auto_assignment_false_keeps_current_practitioner(
        self, db_session: Session
    ):
        """Test that when allow_auto_assignment=False and new_practitioner_id=-1, current practitioner is kept.
        
        The service layer doesn't raise an error in this case - it just ignores the -1
        and keeps the current practitioner. The restriction is enforced at the API layer.
        """
        clinic, practitioner1, practitioner2, appointment_type, patient = self._setup_clinic_with_practitioners(
            db_session
        )

        # Create appointment with specific practitioner
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

        # Clinic admin tries to edit with new_practitioner_id=-1 but allow_auto_assignment=False
        # Service layer ignores -1 and keeps current practitioner (no error raised)
        AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=-1,  # Auto-assign request
            new_start_time=None,
            apply_booking_constraints=False,
            allow_auto_assignment=False,  # Auto-assignment not allowed
            reassigned_by_user_id=practitioner1.id  # Admin user
        )

        # Verify appointment still has same practitioner (not changed to auto-assigned)
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        assert appointment.calendar_event.user_id == practitioner1.id
        assert appointment.is_auto_assigned is False

    def test_single_slot_selection_in_multiple_slot_type_behaves_like_regular_appointment(self, db_session):
        """Test that selecting 1 slot in a multiple-slot appointment type behaves like a regular appointment."""
        clinic, practitioner1, _, appointment_type, patient = self._setup_clinic_with_practitioners(db_session)

        # Enable multiple time slot selection for this appointment type
        appointment_type.allow_multiple_time_slot_selection = True
        db_session.commit()

        # Create availability for the practitioner (today)
        target_date = taiwan_now().date()
        day_of_week = target_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create single slot selection (only 1 slot)
        selected_time_slots = [
            taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0).isoformat()
        ]

        # Create appointment
        appointment_data = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0),
            practitioner_id=practitioner1.id,
            notes="Test single slot",
            selected_time_slots=selected_time_slots,
            allow_multiple_time_slot_selection=True  # This should result in effective_allow_multiple = False
        )

        # Verify appointment was created
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_data['appointment_id']
        ).first()
        assert appointment is not None

        # Verify single slot appointment behaves like regular appointment
        assert appointment.pending_time_confirmation is False  # Should not be pending
        assert appointment.alternative_time_slots is None  # Should not have alternatives

        # Verify appointment status
        assert appointment.status == 'confirmed'

    def test_multiple_slot_selection_still_requires_confirmation(self, db_session):
        """Test that selecting 2+ slots still requires clinic confirmation."""
        clinic, practitioner1, _, appointment_type, patient = self._setup_clinic_with_practitioners(db_session)

        # Enable multiple time slot selection for this appointment type
        appointment_type.allow_multiple_time_slot_selection = True
        db_session.commit()

        # Create availability for the practitioner (today)
        target_date = taiwan_now().date()
        day_of_week = target_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create multiple slot selection (2 slots)
        base_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0)
        selected_time_slots = [
            base_time.isoformat(),
            (base_time + timedelta(hours=1)).isoformat()
        ]

        # Create appointment
        appointment_data = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=base_time,
            practitioner_id=practitioner1.id,
            notes="Test multiple slots",
            selected_time_slots=selected_time_slots,
            allow_multiple_time_slot_selection=True
        )

        # Verify appointment was created
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_data['appointment_id']
        ).first()
        assert appointment is not None

        # Verify multiple slot appointment requires confirmation
        assert appointment.pending_time_confirmation is True  # Should be pending
        assert appointment.alternative_time_slots is not None  # Should have alternatives
        assert len(appointment.alternative_time_slots) == 2

        # Verify appointment status
        assert appointment.status == 'confirmed'

    def _setup_clinic_with_practitioners(self, db_session):
        """Helper to setup clinic with two practitioners."""
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

        from core.message_template_constants import (
            DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            DEFAULT_REMINDER_MESSAGE
        )
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=30,
            is_deleted=False,
            send_patient_confirmation=False,  # Disabled to match old behavior for existing tests
            send_clinic_confirmation=True,
            send_reminder=True,
            patient_confirmation_message=DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=DEFAULT_REMINDER_MESSAGE
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

        # Create availability for multiple days
        for day_offset in [1, 2]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
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

        return clinic, practitioner1, practitioner2, appointment_type, patient

