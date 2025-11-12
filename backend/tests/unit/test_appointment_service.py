"""
Unit and integration tests for AppointmentService.

Comprehensive tests for appointment operations including:
- Eager loading verification
- Load balancing optimization
- Appointment listing with relationships
- Edge cases
"""

import pytest
from datetime import datetime, timedelta, time, timezone
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import (
    Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent,
    LineUser, PractitionerAvailability, PractitionerAppointmentTypes
)
from services.appointment_service import AppointmentService
from services.patient_service import PatientService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


class TestAppointmentServiceListAppointments:
    """Test appointment listing methods with eager loading."""

    def test_list_appointments_for_line_user_with_eager_loading(
        self, db_session: Session
    ):
        """Test that eager loading prevents N+1 queries."""
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
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Practitioner",
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

        # Create LINE user
        line_user = LineUser(
            line_user_id="U_test_user",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointments
        tomorrow = (taiwan_now() + timedelta(days=1)).date()

        for i in range(3):
            start_hour = 10 + i
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                event_type="appointment",
                event_date=tomorrow,
                start_time=time(start_hour, 0),
                end_time=time(start_hour, 30)
            )
            db_session.flush()

            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                status="confirmed",
                notes=f"Appointment {i + 1}"
            )
            db_session.add(appointment)

        db_session.commit()

        # List appointments - should eagerly load relationships
        appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id, upcoming_only=True
        )

        assert len(appointments) == 3

        # Verify all relationships are loaded (no AttributeError)
        for appt in appointments:
            assert "patient_name" in appt
            assert "practitioner_name" in appt
            assert "appointment_type_name" in appt
            assert appt["patient_name"] == "Test Patient"
            assert appt["practitioner_name"] == "Dr. Practitioner"
            assert appt["appointment_type_name"] == "Consultation"

    def test_list_appointments_for_clinic_with_eager_loading(
        self, db_session: Session
    ):
        """Test clinic appointment listing with eager loading."""
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
            db_session,
            clinic=clinic,
            email="practitioner@test.com",
            google_subject_id="practitioner_123",
            full_name="Dr. Practitioner",
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

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment
        today = taiwan_now().date()
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=today,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # List appointments
        appointments = AppointmentService.list_appointments_for_clinic(
            db_session, clinic.id
        )

        assert len(appointments) >= 1

        # Verify relationships are loaded
        appt = appointments[0]
        assert "patient_name" in appt
        assert "practitioner_name" in appt
        assert "appointment_type_name" in appt

    def test_list_appointments_upcoming_only_filter(
        self, db_session: Session
    ):
        """Test upcoming_only filter works correctly."""
        # Setup similar to above
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

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
        assert appointments[0]["status"] == "confirmed"

        # List all
        all_appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id, upcoming_only=False
        )
        assert len(all_appointments) == 2


class TestAppointmentServiceLoadBalancing:
    """Test practitioner load balancing optimization."""

    def test_practitioner_assignment_load_balancing(
        self, db_session: Session
    ):
        """Test that load balancing assigns to practitioner with least appointments."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
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

        # Associate both practitioners with appointment type
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
            availability = PractitionerAvailability(
                user_id=practitioner.id,
                clinic_id=clinic.id,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )
            db_session.add(availability)

        # Create 2 appointments for practitioner1 on tomorrow
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        for i in range(2):
            start_hour = 10 + i
            event = create_calendar_event_with_clinic(
                db_session, practitioner1, clinic,
                event_type="appointment",
                event_date=tomorrow,
                start_time=time(start_hour, 0),
                end_time=time(start_hour, 30)
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
        # Should assign to practitioner2 (has fewer appointments)
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

        # Should be assigned to practitioner2 (has 0 vs 2 appointments)
        assert result["practitioner_id"] == practitioner2.id
        assert result["practitioner_name"] == "Dr. Two"


class TestAppointmentServiceEdgeCases:
    """Test edge cases and error handling."""

    def test_create_appointment_with_specific_practitioner(
        self, db_session: Session
    ):
        """Test creating appointment with specific practitioner."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

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
        db_session.commit()

        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)

        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=10, minute=0, second=0, microsecond=0)

        result = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            notes="Test"
        )

        assert result["practitioner_id"] == practitioner.id
        assert result["status"] == "confirmed"

    def test_create_appointment_invalid_practitioner(
        self, db_session: Session
    ):
        """Test creating appointment with invalid practitioner raises error."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()  # Get clinic.id before creating AppointmentType
        
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=10, minute=0, second=0, microsecond=0)

        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.create_appointment(
                db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                start_time=start_time,
                practitioner_id=99999,  # Non-existent practitioner
                notes="Test"
            )

        assert exc_info.value.status_code in [404, 409]

    def test_list_appointments_empty_result(
        self, db_session: Session
    ):
        """Test listing appointments when none exist."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        line_user = LineUser(
            line_user_id="U_test",
            display_name="Test"
        )
        db_session.add(line_user)
        db_session.commit()

        appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id
        )

        assert appointments == []


class TestAppointmentServiceTaiwanTimezone:
    """Test Taiwan timezone handling in AppointmentService."""

    def test_list_appointments_uses_taiwan_timezone_for_comparison(
        self, db_session: Session
    ):
        """Test that upcoming_only filter uses Taiwan timezone."""
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
        db_session.flush()

        line_user = LineUser(
            line_user_id="U_test",
            display_name="Test"
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

        # Create appointment for today at a future time (Taiwan time)
        taiwan_current = taiwan_now()
        today = taiwan_current.date()
        future_hour = taiwan_current.hour + 1 if taiwan_current.hour < 23 else 22
        future_minute = 0

        # Create appointment today at future time
        today_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=today,
            start_time=time(future_hour, future_minute),
            end_time=time(future_hour, future_minute + 30)
        )
        db_session.flush()
        today_appt = Appointment(
            calendar_event_id=today_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(today_appt)

        # Create appointment for tomorrow
        tomorrow = (taiwan_current + timedelta(days=1)).date()
        tomorrow_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=tomorrow,
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.flush()
        tomorrow_appt = Appointment(
            calendar_event_id=tomorrow_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(tomorrow_appt)

        # Create past appointment
        yesterday = (taiwan_current - timedelta(days=1)).date()
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
        db_session.commit()

        # List upcoming appointments - should use Taiwan timezone for comparison
        appointments = AppointmentService.list_appointments_for_line_user(
            db_session, line_user.id, clinic.id, upcoming_only=True
        )

        # Should include today's future appointment and tomorrow's appointment
        # but not yesterday's past appointment
        assert len(appointments) >= 1
        
        # Parse dates from start_time strings
        appointment_dates = []
        for appt in appointments:
            if appt["start_time"]:
                # Parse ISO datetime string and extract date
                start_dt = datetime.fromisoformat(appt["start_time"])
                appointment_dates.append(start_dt.date())
        
        assert today in appointment_dates or tomorrow in appointment_dates
        assert yesterday not in appointment_dates

    def test_canceled_at_uses_taiwan_timezone(
        self, db_session: Session
    ):
        """Test that canceled_at timestamp uses Taiwan timezone."""
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
        db_session.flush()

        line_user = LineUser(
            line_user_id="U_test",
            display_name="Test"
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

        # Create appointment
        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            event_type="appointment",
            event_date=tomorrow,
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
        db_session.refresh(appointment)

        # Cancel appointment
        before_cancel = taiwan_now()
        AppointmentService.cancel_appointment_by_patient(
            db_session, event.id, line_user.id, clinic.id
        )
        after_cancel = taiwan_now()
        db_session.refresh(appointment)

        # Verify canceled_at is set
        assert appointment.canceled_at is not None
        
        # Handle timezone-aware vs naive datetime from database
        canceled_at = appointment.canceled_at
        if canceled_at.tzinfo is None:
            # If naive, assume it's Taiwan time and localize it
            canceled_at = canceled_at.replace(tzinfo=TAIWAN_TZ)
        else:
            # If timezone-aware, convert to Taiwan timezone
            canceled_at = canceled_at.astimezone(TAIWAN_TZ)
        
        assert before_cancel <= canceled_at <= after_cancel

    def test_create_appointment_uses_taiwan_timezone(
        self, db_session: Session
    ):
        """Test that create_appointment properly handles Taiwan timezone."""
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
        db_session.commit()

        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id
        )
        db_session.add(pat)

        tomorrow = (taiwan_now() + timedelta(days=1)).date()
        availability = PractitionerAvailability(
            user_id=practitioner.id,
            clinic_id=clinic.id,
            day_of_week=tomorrow.weekday(),
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.add(availability)

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment with Taiwan timezone datetime
        start_time = taiwan_now() + timedelta(days=1)
        start_time = start_time.replace(hour=14, minute=0, second=0, microsecond=0)

        result = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            notes="Test"
        )

        # Verify the appointment was created with correct timezone handling
        assert result["status"] == "confirmed"
        assert result["practitioner_id"] == practitioner.id
        
        # Verify the stored date/time matches Taiwan timezone
        db_appointment = db_session.query(Appointment).filter_by(
            calendar_event_id=result["calendar_event_id"]
        ).first()
        assert db_appointment is not None
        assert db_appointment.calendar_event.date == start_time.date()
        assert db_appointment.calendar_event.start_time == start_time.time()

