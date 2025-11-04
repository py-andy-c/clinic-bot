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
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)
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
        practitioner1 = User(
            clinic_id=clinic.id,
            email="practitioner1@test.com",
            google_subject_id="practitioner_1",
            full_name="Dr. Test Practitioner 1",
            roles=["practitioner"]
        )
        practitioner2 = User(
            clinic_id=clinic.id,
            email="practitioner2@test.com",
            google_subject_id="practitioner_2",
            full_name="Dr. Test Practitioner 2",
            roles=["practitioner"]
        )
        db_session.add_all([practitioner1, practitioner2])
        db_session.commit()

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
            appointment_type_id=appt_type.id
        )
        pat2 = PractitionerAppointmentTypes(
            user_id=practitioner2.id,
            appointment_type_id=appt_type.id
        )
        db_session.add_all([pat1, pat2])
        db_session.commit()

        # Create availability for both practitioners
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        availability1 = PractitionerAvailability(
            user_id=practitioner1.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        availability2 = PractitionerAvailability(
            user_id=practitioner2.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add_all([availability1, availability2])
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
        db_session.commit()

        # Create availability
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)
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
        db_session.commit()

        # Create availability for multiple days
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        day_after = (taiwan_now() + timedelta(days=2)).date()

        availability1 = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        availability2 = PractitionerAvailability(
            user_id=practitioner.id,
            day_of_week=day_after.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add_all([availability1, availability2])
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

