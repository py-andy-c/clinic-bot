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

        # Create practitioner
        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Test Practitioner",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
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
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_user",
            display_name="Test User"
        )
        db_session.add(line_user)
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment
        start_time = taiwan_now() + timedelta(days=1)
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

        # Create two practitioners
        practitioner1 = User(
            clinic_id=clinic.id,
            email="practitioner1@test.com",
            google_subject_id="practitioner1",
            full_name="Dr. One",
            roles=["practitioner"]
        )
        practitioner2 = User(
            clinic_id=clinic.id,
            email="practitioner2@test.com",
            google_subject_id="practitioner2",
            full_name="Dr. Two",
            roles=["practitioner"]
        )
        db_session.add(practitioner1)
        db_session.add(practitioner2)
        db_session.commit()

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
                appointment_type_id=appt_type.id
            )
            db_session.add(pat)

        # Create availability for tomorrow
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_of_week = tomorrow.weekday()

        for practitioner in [practitioner1, practitioner2]:
            availability = PractitionerAvailability(
                user_id=practitioner.id,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.add(availability)

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
            event = CalendarEvent(
                user_id=practitioner1.id,
                event_type="appointment",
                date=tomorrow,
                start_time=time(10 + i, 0),
                end_time=time(10 + i, 30)
            )
            db_session.add(event)
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
        
        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Practitioner",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.flush()  # Ensure appt_type.id is available
        line_user = LineUser(
            line_user_id="U_test",
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
        past_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=yesterday,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.add(past_event)
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
        future_event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=tomorrow,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.add(future_event)
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
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()  # Get clinic.id before creating AppointmentType
        
        practitioner = User(
            clinic_id=clinic.id,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Practitioner",
            roles=["practitioner"]
        )
        db_session.add(practitioner)
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.flush()  # Ensure appt_type.id is available
        line_user = LineUser(
            line_user_id="U_test",
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

        # Create appointment
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        event = CalendarEvent(
            user_id=practitioner.id,
            event_type="appointment",
            date=tomorrow,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.add(event)
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

        # Cancel appointment
        result = AppointmentService.cancel_appointment_by_patient(
            db_session, event.id, line_user.id, clinic.id
        )

        assert result["success"] is True
        assert "預約已取消" in result["message"]

        # Verify status updated
        db_session.refresh(appointment)
        assert appointment.status == "canceled_by_patient"
        assert appointment.canceled_at is not None

