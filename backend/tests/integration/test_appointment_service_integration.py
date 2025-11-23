"""
Integration tests for AppointmentService.

Tests the complete appointment service functionality including:
- Appointment creation with practitioner assignment
- Appointment listing with eager loading
- Load balancing
- Edge cases
"""

import pytest
from datetime import datetime, timedelta, time, timezone
from sqlalchemy.orm import Session

from models import (
    Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent,
    LineUser, PractitionerAvailability, PractitionerAppointmentTypes
)
from services.appointment_service import AppointmentService
from services.appointment_type_service import AppointmentTypeService
from utils.datetime_utils import taiwan_now
from tests.conftest import (
    create_practitioner_availability_with_clinic,
    create_calendar_event_with_clinic,
    create_user_with_clinic_association
)


class TestAppointmentServiceIntegration:
    """Integration tests for AppointmentService."""

    def test_complete_appointment_flow_with_eager_loading(
        self, db_session: Session
    ):
        """Test complete appointment flow and verify eager loading prevents N+1 queries."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner with clinic association
        practitioner, _ = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Dr. Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            roles=["practitioner"],
            is_active=True
        )
        db_session.commit()

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)

        # Create availability for the appointment day (days=2)
        appointment_date = (taiwan_now() + timedelta(days=2)).date()
        day_of_week = appointment_date.weekday()
        availability = create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_user",
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()  # Flush to get line_user.id
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment
        # Use time far enough in the future to satisfy minimum_booking_hours_ahead (24 hours by default)
        start_time = taiwan_now() + timedelta(days=2)
        start_time = start_time.replace(hour=10, minute=0, second=0, microsecond=0)

        result = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=line_user.id,
            notes="Integration test appointment"
        )

        assert result["patient_name"] == "Test Patient"
        assert result["practitioner_name"] == "Dr. Test Practitioner"
        assert result["appointment_type_name"] == "Consultation"
        assert result["status"] == "confirmed"
        assert result["notes"] == "Integration test appointment"

        # List appointments - should use eager loading
        appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id
        )

        assert len(appointments) == 1
        appt = appointments[0]
        assert appt["patient_name"] == "Test Patient"
        assert appt["practitioner_name"] == "Dr. Test Practitioner"
        assert appt["appointment_type_name"] == "Consultation"

    def test_load_balancing_assigns_least_loaded_practitioner(
        self, db_session: Session
    ):
        """Test that auto-assignment chooses practitioner with least appointments."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Set max_future_appointments to 10 for this test to avoid hitting limit
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.max_future_appointments = 10
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create two practitioners with clinic associations
        practitioner1, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner1@test.com",
            google_subject_id="practitioner1",
            full_name="Dr. One",
            roles=["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@test.com",
            google_subject_id="practitioner2",
            full_name="Dr. Two",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate both practitioners
        for practitioner in [practitioner1, practitioner2]:
            pat = PractitionerAppointmentTypes(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        # Create availability for tomorrow
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()

        for practitioner in [practitioner1, practitioner2]:
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create 3 appointments for practitioner1 on tomorrow
        for i in range(3):
            event = create_calendar_event_with_clinic(
                db_session, practitioner1, clinic,
                event_type="appointment",
                event_date=tomorrow,
                start_time=time(10 + i, 0),
                end_time=time(10 + i, 30)
            )
            db_session.flush()
            appointment = Appointment(
                calendar_event_id=event.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                status="confirmed"
            )
            db_session.add(appointment)

        db_session.commit()

        # Create new appointment without specifying practitioner
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=14, minute=0, second=0, microsecond=0)

        result = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=None,  # Auto-assign
            notes="Load balancing test"
        )

        # Should be assigned to practitioner2 (has 0 vs 3 appointments)
        assert result["practitioner_id"] == practitioner2.id

    def test_appointment_listing_filters_by_upcoming_only(
        self, db_session: Session
    ):
        """Test that appointment listing correctly filters upcoming appointments."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()  # Get clinic.id before creating AppointmentType
        
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Practitioner",
            roles=["practitioner"]
        )
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.flush()  # Ensure appt_type.id is available
        line_user = LineUser(
            line_user_id="U_test",
            clinic_id=clinic.id,
            display_name="Test"
        )
        db_session.add(line_user)
        db_session.flush()  # Ensure line_user.id is available before creating patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Create past appointment
        yesterday = (taiwan_now() - timedelta(days=1)).date()
        past_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=yesterday,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()
        past_appt = Appointment(
            calendar_event_id=past_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(past_appt)

        # Create future appointment
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        future_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=tomorrow,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()
        future_appt = Appointment(
            calendar_event_id=future_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(future_appt)
        db_session.commit()

        # List upcoming only
        appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id, upcoming_only=True
        )

        # Should only include future appointment
        assert len(appointments) == 1

        # List all
        all_appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id, upcoming_only=False
        )
        assert len(all_appointments) == 2

    def test_appointment_cancellation_by_patient(
        self, db_session: Session
    ):
        """Test appointment cancellation by patient."""
        from unittest.mock import patch
        from services.notification_service import NotificationService, CancellationSource
        
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()  # Get clinic.id before creating AppointmentType
        
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Practitioner",
            roles=["practitioner"]
        )
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.flush()  # Ensure appt_type.id is available
        line_user = LineUser(
            line_user_id="U_test",
            clinic_id=clinic.id,
            display_name="Test"
        )
        db_session.add(line_user)
        db_session.flush()  # Ensure line_user.id is available
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()
        db_session.refresh(patient)  # Refresh to ensure patient.id is set

        # Create appointment (more than 24 hours in the future to allow cancellation)
        future_date = (taiwan_now() + timedelta(days=2)).date()
        event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=future_date,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()
        appointment = Appointment(
            calendar_event_id=event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        db_session.refresh(appointment)  # Refresh to ensure appointment.patient_id is set

        # Cancel appointment with mocked notifications
        with patch.object(NotificationService, 'send_practitioner_cancellation_notification') as mock_practitioner_notify, \
             patch.object(NotificationService, 'send_appointment_cancellation') as mock_patient_notify:
            
            result = AppointmentService.cancel_appointment(
                db_session, event.id, cancelled_by='patient'
            )

            assert result["success"] is True
            assert "預約已取消" in result["message"]

            # Verify status updated
            db_session.refresh(appointment)
            assert appointment.status == "canceled_by_patient"
            assert appointment.canceled_at is not None

            # Verify practitioner notification was sent
            mock_practitioner_notify.assert_called_once()
            call_args = mock_practitioner_notify.call_args
            assert call_args[0][1] == practitioner  # Second arg is practitioner
            assert call_args[0][3] == clinic  # Fourth arg is clinic
            assert call_args[0][4] == 'patient'  # Fifth arg is cancelled_by

            # Verify patient notification was sent
            mock_patient_notify.assert_called_once()
            call_args = mock_patient_notify.call_args
            assert call_args[0][1] == appointment  # Second arg is appointment
            assert call_args[0][2] == practitioner  # Third arg is practitioner
            assert call_args[0][3] == CancellationSource.PATIENT  # Fourth arg is CancellationSource

    def test_appointment_booking_constraint_prevents_double_booking(
        self, db_session: Session
    ):
        """Test that appointment booking prevents double booking of the same time slot."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # First appointment booking should succeed
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=10, minute=0, second=0, microsecond=0)

        result1 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            notes="First appointment"
        )

        assert result1["appointment_id"] is not None
        assert result1["status"] == "confirmed"

        # Second appointment booking at the same time should fail
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.create_appointment(
                db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                start_time=start_time,  # Same time slot
                practitioner_id=practitioner.id,
                notes="Second appointment"
            )

        assert exc_info.value.status_code == 409
        assert "時段不可用" in exc_info.value.detail

        # Verify only one appointment exists
        appointments = db_session.query(Appointment).filter(
            Appointment.patient_id == patient.id
        ).all()
        assert len(appointments) == 1

    def test_appointment_booking_allows_different_practitioners_same_time(
        self, db_session: Session
    ):
        """Test that different practitioners can book appointments at the same time."""
        # Create clinic
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
            db_session,
            clinic=clinic,
            email="practitioner1@test.com",
            google_subject_id="practitioner_1",
            full_name="Dr. Test Practitioner 1",
            roles=["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner2@test.com",
            google_subject_id="practitioner_2",
            full_name="Dr. Test Practitioner 2",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate both practitioners with appointment type
        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner1.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        pat2 = PractitionerAppointmentTypes(
            user_id=practitioner2.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add_all([pat1, pat2])
        db_session.commit()

        # Create availability for both practitioners
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        create_practitioner_availability_with_clinic(
            db_session, practitioner2, clinic,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 1",
            phone_number="0912345678"
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 2",
            phone_number="0912345679"
        )
        db_session.add_all([patient1, patient2])
        db_session.commit()

        # Both practitioners can book at the same time
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=10, minute=0, second=0, microsecond=0)

        result1 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient1.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,
            notes="Appointment with practitioner 1"
        )

        result2 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,  # Same time
            practitioner_id=practitioner2.id,  # Different practitioner
            notes="Appointment with practitioner 2"
        )

        # Both should succeed
        assert result1["appointment_id"] is not None
        assert result1["status"] == "confirmed"
        assert result2["appointment_id"] is not None
        assert result2["status"] == "confirmed"

        # Verify two appointments exist
        appointments = db_session.query(Appointment).filter(
            Appointment.patient_id.in_([patient1.id, patient2.id])
        ).all()
        assert len(appointments) == 2

    def test_patient_soft_delete_and_utility_functions(
        self, db_session: Session
    ):
        """Test patient soft delete functionality and utility functions."""
        from utils.patient_queries import (
            get_active_patients_for_line_user,
            get_active_patients_for_clinic,
            get_patient_by_id_with_soft_delete_check,
            soft_delete_patient
        )
        from services.patient_service import PatientService

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user_123",
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient One",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Two",
            phone_number="0912345679",
            line_user_id=line_user.id
        )
        patient3 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Three",
            phone_number="0912345680"
            # No line_user_id - represents unlinked patient
        )
        patient4 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Four",
            phone_number="0912345681",
            line_user_id=line_user.id  # Another patient for the LINE user
        )
        db_session.add_all([patient1, patient2, patient3, patient4])
        db_session.commit()

        # Test: Initially all patients are active
        active_patients_line = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(active_patients_line) == 3
        assert patient1 in active_patients_line
        assert patient2 in active_patients_line
        assert patient4 in active_patients_line

        active_patients_clinic, total = get_active_patients_for_clinic(db_session, clinic.id)
        assert len(active_patients_clinic) == 4  # All patients are active (patient1, patient2, patient3, patient4)
        assert total == 4

        # Test: Soft delete patient1 using the service method
        PatientService.delete_patient_for_line_user(
            db_session, patient1.id, line_user.id, clinic.id
        )

        # Refresh patient1 from database
        db_session.refresh(patient1)
        assert patient1.is_deleted == True
        assert patient1.deleted_at is not None
        assert patient1.line_user_id is None  # Also unlinked

        # Test: After soft delete, patient1 should not appear in active queries
        active_patients_line_after = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(active_patients_line_after) == 2  # patient2 and patient4 remain
        assert patient2 in active_patients_line_after
        assert patient4 in active_patients_line_after
        assert patient1 not in active_patients_line_after

        active_patients_clinic_after, total_after = get_active_patients_for_clinic(db_session, clinic.id)
        assert len(active_patients_clinic_after) == 3  # patient1 removed, patient2, patient3, patient4 remain
        assert total_after == 3
        assert patient1 not in active_patients_clinic_after

        # Test: Can still retrieve deleted patient with include_deleted=True
        deleted_patient_retrieved = get_patient_by_id_with_soft_delete_check(
            db_session, patient1.id, clinic.id, include_deleted=True
        )
        assert deleted_patient_retrieved.is_deleted == True

        # Test: Cannot retrieve deleted patient with include_deleted=False (default)
        with pytest.raises(ValueError, match="Patient not found"):
            get_patient_by_id_with_soft_delete_check(
                db_session, patient1.id, clinic.id, include_deleted=False
            )

        # Test: Patient service still works with the updated soft delete logic
        # Create a future appointment for patient2 to test deletion prevention
        from utils.datetime_utils import taiwan_now
        from models import CalendarEvent, Appointment, User
        from datetime import timedelta, time

        # Create practitioner for appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        from models import PractitionerAppointmentTypes
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create future appointment for patient2
        future_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=future_time.date(),
            start_time=future_time.time(),
            end_time=(future_time + timedelta(minutes=30)).time()
        )
        db_session.commit()

        future_appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(future_appointment)
        db_session.commit()

        # Test: Cannot delete patient2 due to future appointment
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            PatientService.delete_patient_for_line_user(
                db_session, patient2.id, line_user.id, clinic.id
            )
        assert "Cannot delete patient with future appointments" in exc_info.value.detail

        # Test: Can delete patient2 after canceling the appointment
        future_appointment.status = 'canceled_by_patient'
        db_session.commit()

        # Now deletion should work
        PatientService.delete_patient_for_line_user(
            db_session, patient2.id, line_user.id, clinic.id
        )

        # Verify patient2 is now soft deleted
        patient2_retrieved = get_patient_by_id_with_soft_delete_check(
            db_session, patient2.id, clinic.id, include_deleted=True
        )
        assert patient2_retrieved.is_deleted == True
        assert patient2_retrieved.line_user_id is None

        # Test: Active patients for LINE user now shows patient1 and patient4 only
        final_active_patients = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(final_active_patients) == 1  # only patient4 remains

    def test_appointment_booking_allows_same_practitioner_different_times(
        self, db_session: Session
    ):
        """Test that the same practitioner can book appointments at different times."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 1",
            phone_number="0912345678"
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 2",
            phone_number="0912345679"
        )
        db_session.add_all([patient1, patient2])
        db_session.commit()

        # Same practitioner can book at different times
        base_time = taiwan_now() + timedelta(days=1)

        time1 = base_time.replace(hour=10, minute=0, second=0, microsecond=0)
        time2 = base_time.replace(hour=11, minute=0, second=0, microsecond=0)  # Different time

        result1 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient1.id,
            appointment_type_id=appt_type.id,
            start_time=time1,
            practitioner_id=practitioner.id,
            notes="First appointment"
        )

        result2 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            start_time=time2,  # Different time
            practitioner_id=practitioner.id,  # Same practitioner
            notes="Second appointment"
        )

        # Both should succeed
        assert result1["appointment_id"] is not None
        assert result1["status"] == "confirmed"
        assert result2["appointment_id"] is not None
        assert result2["status"] == "confirmed"

        # Verify two appointments exist
        appointments = db_session.query(Appointment).filter(
            Appointment.patient_id.in_([patient1.id, patient2.id])
        ).all()
        assert len(appointments) == 2

    def test_patient_soft_delete_and_utility_functions(
        self, db_session: Session
    ):
        """Test patient soft delete functionality and utility functions."""
        from utils.patient_queries import (
            get_active_patients_for_line_user,
            get_active_patients_for_clinic,
            get_patient_by_id_with_soft_delete_check,
            soft_delete_patient
        )
        from services.patient_service import PatientService

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user_123",
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient One",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Two",
            phone_number="0912345679",
            line_user_id=line_user.id
        )
        patient3 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Three",
            phone_number="0912345680"
            # No line_user_id - represents unlinked patient
        )
        patient4 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Four",
            phone_number="0912345681",
            line_user_id=line_user.id  # Another patient for the LINE user
        )
        db_session.add_all([patient1, patient2, patient3, patient4])
        db_session.commit()

        # Test: Initially all patients are active
        active_patients_line = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(active_patients_line) == 3
        assert patient1 in active_patients_line
        assert patient2 in active_patients_line
        assert patient4 in active_patients_line

        active_patients_clinic, total = get_active_patients_for_clinic(db_session, clinic.id)
        assert len(active_patients_clinic) == 4  # All patients are active (patient1, patient2, patient3, patient4)
        assert total == 4

        # Test: Soft delete patient1 using the service method
        PatientService.delete_patient_for_line_user(
            db_session, patient1.id, line_user.id, clinic.id
        )

        # Refresh patient1 from database
        db_session.refresh(patient1)
        assert patient1.is_deleted == True
        assert patient1.deleted_at is not None
        assert patient1.line_user_id is None  # Also unlinked

        # Test: After soft delete, patient1 should not appear in active queries
        active_patients_line_after = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(active_patients_line_after) == 2  # patient2 and patient4 remain
        assert patient2 in active_patients_line_after
        assert patient4 in active_patients_line_after
        assert patient1 not in active_patients_line_after

        active_patients_clinic_after, total_after = get_active_patients_for_clinic(db_session, clinic.id)
        assert len(active_patients_clinic_after) == 3  # patient1 removed, patient2, patient3, patient4 remain
        assert total_after == 3
        assert patient1 not in active_patients_clinic_after

        # Test: Can still retrieve deleted patient with include_deleted=True
        deleted_patient_retrieved = get_patient_by_id_with_soft_delete_check(
            db_session, patient1.id, clinic.id, include_deleted=True
        )
        assert deleted_patient_retrieved.is_deleted == True

        # Test: Cannot retrieve deleted patient with include_deleted=False (default)
        with pytest.raises(ValueError, match="Patient not found"):
            get_patient_by_id_with_soft_delete_check(
                db_session, patient1.id, clinic.id, include_deleted=False
            )

        # Test: Patient service still works with the updated soft delete logic
        # Create a future appointment for patient2 to test deletion prevention
        from utils.datetime_utils import taiwan_now
        from models import CalendarEvent, Appointment, User
        from datetime import timedelta, time

        # Create practitioner for appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        from models import PractitionerAppointmentTypes
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create future appointment for patient2
        future_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=future_time.date(),
            start_time=future_time.time(),
            end_time=(future_time + timedelta(minutes=30)).time()
        )
        db_session.commit()

        future_appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(future_appointment)
        db_session.commit()

        # Test: Cannot delete patient2 due to future appointment
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            PatientService.delete_patient_for_line_user(
                db_session, patient2.id, line_user.id, clinic.id
            )
        assert "Cannot delete patient with future appointments" in exc_info.value.detail

        # Test: Can delete patient2 after canceling the appointment
        future_appointment.status = 'canceled_by_patient'
        db_session.commit()

        # Now deletion should work
        PatientService.delete_patient_for_line_user(
            db_session, patient2.id, line_user.id, clinic.id
        )

        # Verify patient2 is now soft deleted
        patient2_retrieved = get_patient_by_id_with_soft_delete_check(
            db_session, patient2.id, clinic.id, include_deleted=True
        )
        assert patient2_retrieved.is_deleted == True
        assert patient2_retrieved.line_user_id is None

        # Test: Active patients for LINE user now shows patient1 and patient4 only
        final_active_patients = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(final_active_patients) == 1  # only patient4 remains

    def test_appointment_booking_allows_same_practitioner_different_days(
        self, db_session: Session
    ):
        """Test that the same practitioner can book appointments on different days."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create availability for multiple days
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_after = (taiwan_now() + timedelta(days=2)).date()

        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_after.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 1",
            phone_number="0912345678"
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient 2",
            phone_number="0912345679"
        )
        db_session.add_all([patient1, patient2])
        db_session.commit()

        # Same practitioner can book on different days at same time
        time1 = (taiwan_now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        time2 = (taiwan_now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)  # Different day, same time

        result1 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient1.id,
            appointment_type_id=appt_type.id,
            start_time=time1,
            practitioner_id=practitioner.id,
            notes="First day appointment"
        )

        result2 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            start_time=time2,  # Different day
            practitioner_id=practitioner.id,  # Same practitioner
            notes="Second day appointment"
        )

        # Both should succeed
        assert result1["appointment_id"] is not None
        assert result1["status"] == "confirmed"
        assert result2["appointment_id"] is not None
        assert result2["status"] == "confirmed"

        # Verify two appointments exist
        appointments = db_session.query(Appointment).filter(
            Appointment.patient_id.in_([patient1.id, patient2.id])
        ).all()
        assert len(appointments) == 2

    def test_patient_soft_delete_and_utility_functions(
        self, db_session: Session
    ):
        """Test patient soft delete functionality and utility functions."""
        from utils.patient_queries import (
            get_active_patients_for_line_user,
            get_active_patients_for_clinic,
            get_patient_by_id_with_soft_delete_check,
            soft_delete_patient
        )
        from services.patient_service import PatientService

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create LINE user
        line_user = LineUser(
            line_user_id="test_line_user_123",
            clinic_id=clinic.id,
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient One",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Two",
            phone_number="0912345679",
            line_user_id=line_user.id
        )
        patient3 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Three",
            phone_number="0912345680"
            # No line_user_id - represents unlinked patient
        )
        patient4 = Patient(
            clinic_id=clinic.id,
            full_name="Patient Four",
            phone_number="0912345681",
            line_user_id=line_user.id  # Another patient for the LINE user
        )
        db_session.add_all([patient1, patient2, patient3, patient4])
        db_session.commit()

        # Test: Initially all patients are active
        active_patients_line = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(active_patients_line) == 3
        assert patient1 in active_patients_line
        assert patient2 in active_patients_line
        assert patient4 in active_patients_line

        active_patients_clinic, total = get_active_patients_for_clinic(db_session, clinic.id)
        assert len(active_patients_clinic) == 4  # All patients are active (patient1, patient2, patient3, patient4)
        assert total == 4

        # Test: Soft delete patient1 using the service method
        PatientService.delete_patient_for_line_user(
            db_session, patient1.id, line_user.id, clinic.id
        )

        # Refresh patient1 from database
        db_session.refresh(patient1)
        assert patient1.is_deleted == True
        assert patient1.deleted_at is not None
        assert patient1.line_user_id is None  # Also unlinked

        # Test: After soft delete, patient1 should not appear in active queries
        active_patients_line_after = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(active_patients_line_after) == 2  # patient2 and patient4 remain
        assert patient2 in active_patients_line_after
        assert patient4 in active_patients_line_after
        assert patient1 not in active_patients_line_after

        active_patients_clinic_after, total_after = get_active_patients_for_clinic(db_session, clinic.id)
        assert len(active_patients_clinic_after) == 3  # patient1 removed, patient2, patient3, patient4 remain
        assert total_after == 3
        assert patient1 not in active_patients_clinic_after

        # Test: Can still retrieve deleted patient with include_deleted=True
        deleted_patient_retrieved = get_patient_by_id_with_soft_delete_check(
            db_session, patient1.id, clinic.id, include_deleted=True
        )
        assert deleted_patient_retrieved.is_deleted == True

        # Test: Cannot retrieve deleted patient with include_deleted=False (default)
        with pytest.raises(ValueError, match="Patient not found"):
            get_patient_by_id_with_soft_delete_check(
                db_session, patient1.id, clinic.id, include_deleted=False
            )

        # Test: Patient service still works with the updated soft delete logic
        # Create a future appointment for patient2 to test deletion prevention
        from utils.datetime_utils import taiwan_now
        from models import CalendarEvent, Appointment, User
        from datetime import timedelta, time

        # Create practitioner for appointment
        practitioner, _ = create_user_with_clinic_association(
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Associate practitioner with appointment type
        from models import PractitionerAppointmentTypes
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create future appointment for patient2
        future_time = taiwan_now() + timedelta(days=1)
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type='appointment',
            event_date=future_time.date(),
            start_time=future_time.time(),
            end_time=(future_time + timedelta(minutes=30)).time()
        )
        db_session.commit()

        future_appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            status='confirmed'
        )
        db_session.add(future_appointment)
        db_session.commit()

        # Test: Cannot delete patient2 due to future appointment
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            PatientService.delete_patient_for_line_user(
                db_session, patient2.id, line_user.id, clinic.id
            )
        assert "Cannot delete patient with future appointments" in exc_info.value.detail

        # Test: Can delete patient2 after canceling the appointment
        future_appointment.status = 'canceled_by_patient'
        db_session.commit()

        # Now deletion should work
        PatientService.delete_patient_for_line_user(
            db_session, patient2.id, line_user.id, clinic.id
        )

        # Verify patient2 is now soft deleted
        patient2_retrieved = get_patient_by_id_with_soft_delete_check(
            db_session, patient2.id, clinic.id, include_deleted=True
        )
        assert patient2_retrieved.is_deleted == True
        assert patient2_retrieved.line_user_id is None

        # Test: Active patients for LINE user now shows patient1 and patient4 only
        final_active_patients = get_active_patients_for_line_user(
            db_session, line_user.id, clinic.id
        )
        assert len(final_active_patients) == 1  # only patient4 remains

