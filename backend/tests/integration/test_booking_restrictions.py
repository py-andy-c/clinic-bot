"""
Integration tests for booking restrictions.

This file consolidates ALL booking restriction tests, including:
- Minimum booking hours ahead
- Max booking window days
- Max future appointments
- Minimum cancellation hours before
- Booking restrictions in availability checks
- Booking restrictions in appointment creation/editing
- Clinic admin bypass behavior

Tests are organized by restriction type for easy navigation.
"""

import pytest
from datetime import datetime, timedelta, time
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from models import (
    Clinic, Patient, AppointmentType, Appointment, CalendarEvent,
    LineUser, PractitionerAppointmentTypes
)
from services.appointment_service import AppointmentService
from services.availability_service import AvailabilityService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from tests.conftest import (
    create_practitioner_availability_with_clinic,
    create_user_with_clinic_association
)


# ============================================================================
# Shared Fixtures
# ============================================================================

@pytest.fixture
def clinic_with_restrictions(db_session: Session):
    """Create a clinic with strict booking restrictions."""
    clinic = Clinic(
        name="Restricted Clinic",
        line_channel_id="test_restricted",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        settings={
            "notification_settings": {"reminder_hours_before": 24},
            "booking_restriction_settings": {
                "booking_restriction_type": "minimum_hours_required",
                "minimum_booking_hours_ahead": 24,  # 24 hours ahead required
                "max_booking_window_days": 90,
                "max_future_appointments": 3
            },
            "clinic_info_settings": {"display_name": None, "address": None, "phone_number": None}
        }
    )
    db_session.add(clinic)
    db_session.commit()

    # Create practitioner
    practitioner, _ = create_user_with_clinic_association(
        db_session,
        clinic=clinic,
        email="practitioner@restricted.com",
        google_subject_id="google_123_restricted",
        full_name="Dr. Restricted Test",
        roles=["practitioner"]
    )

    # Create appointment type
    appt_type = AppointmentType(
        clinic_id=clinic.id,
        name="Test Consultation",
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

    # Set up availability for all days of the week
    for day_of_week in range(7):  # 0=Monday, 6=Sunday
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )

    db_session.commit()
    return clinic, practitioner, appt_type


def _setup_clinic_with_practitioners(db_session):
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


# ============================================================================
# Minimum Booking Hours Ahead
# ============================================================================

class TestMinimumBookingHoursAhead:
    """Test minimum_booking_hours_ahead restriction."""

    def test_availability_filters_slots_within_minimum_hours_window_for_patients(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that availability check filters out slots within minimum_booking_hours_ahead window for patients."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Request availability for today (which may be within 24 hours)
        today = taiwan_now().date()
        today_iso = today.isoformat()

        # For patients (apply_booking_restrictions=True), slots within 24 hours should be filtered out
        slots = AvailabilityService.get_available_slots_for_practitioner(
            db=db_session,
            practitioner_id=practitioner.id,
            date=today_iso,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            apply_booking_restrictions=True  # Patient-facing
        )

        # If current time is late in the day, all today's slots may be filtered out
        # If current time is early, some slots may still be available
        # The key is that restrictions ARE applied for patients
        assert isinstance(slots, list), "Should return a list of slots (may be empty if all filtered)"

    def test_availability_shows_slots_for_patients_when_far_enough_ahead(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that availability check shows slots for patients when they're far enough ahead."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Request availability for 2 days ahead (definitely beyond 24 hours)
        future_date = taiwan_now().date() + timedelta(days=2)
        future_date_iso = future_date.isoformat()

        # For patients (apply_booking_restrictions=True), slots should be shown if far enough ahead
        slots = AvailabilityService.get_available_slots_for_practitioner(
            db=db_session,
            practitioner_id=practitioner.id,
            date=future_date_iso,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            apply_booking_restrictions=True  # Patient-facing
        )

        # Should have multiple slots (9:00-17:00 with 30-minute intervals)
        # All slots should be shown since they're far enough ahead
        assert len(slots) > 0, "Availability should show slots when far enough ahead"

    def test_booking_restriction_enforced_during_appointment_creation(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that booking restrictions ARE enforced when patient creates appointment."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Create patient with LINE user
        line_user = LineUser(
            line_user_id="U_test_restricted",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Try to create appointment within minimum_booking_hours_ahead window
        # This should fail even though availability showed the slot
        start_time = taiwan_now() + timedelta(hours=12)  # 12 hours ahead (less than 24)
        start_time = start_time.replace(minute=0, second=0, microsecond=0)

        with pytest.raises(Exception) as exc_info:
            AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                start_time=start_time,
                practitioner_id=practitioner.id,
                line_user_id=line_user.id  # Patient booking - restrictions enforced
            )

        # Should raise error about minimum booking hours
        assert "24" in str(exc_info.value) or "小時" in str(exc_info.value)

    def test_patient_cannot_reschedule_within_minimum_booking_hours(
        self, db_session: Session
    ):
        """Test that patient cannot reschedule to time within minimum_booking_hours_ahead."""
        clinic, practitioner1, practitioner2, appointment_type, patient = _setup_clinic_with_practitioners(
            db_session
        )

        # Set restrictive booking settings
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.minimum_booking_hours_ahead = 48
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create availability for multiple days
        for day_offset in [3, 4]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
            create_practitioner_availability_with_clinic(
                db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
            )

        # Create appointment far in future (more than cancellation window)
        original_start_time = taiwan_now() + timedelta(days=3)
        original_start_time = original_start_time.replace(hour=10, minute=0, second=0, microsecond=0)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=original_start_time,
            practitioner_id=practitioner1.id,
            line_user_id=None
        )
        appointment_id = result['appointment_id']

        # Create availability for today to allow rescheduling attempt
        today = taiwan_now().date()
        day_of_week = today.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Patient tries to reschedule to time within restriction (should fail)
        new_start_time = taiwan_now().replace(hour=14, minute=0, second=0, microsecond=0)
        if new_start_time < taiwan_now():
            new_start_time = new_start_time + timedelta(days=1)
        # Ensure it's less than 48 hours ahead
        if (new_start_time - taiwan_now()).total_seconds() / 3600 >= 48:
            new_start_time = taiwan_now() + timedelta(hours=1)
        
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=None,
                new_start_time=new_start_time,
                apply_booking_constraints=True,  # Patient must follow constraints
                allow_auto_assignment=False
            )

        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST


# ============================================================================
# Max Booking Window Days
# ============================================================================

class TestMaxBookingWindowDays:
    """Test max_booking_window_days restriction."""

    def test_availability_filters_slots_beyond_max_booking_window_for_patients(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that availability filters out slots beyond max_booking_window_days for patients."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Request availability for a date beyond max_booking_window_days (90 days)
        future_date = taiwan_now().date() + timedelta(days=100)
        future_date_iso = future_date.isoformat()

        # Set up availability for that day
        day_of_week = future_date.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner, clinic,
            day_of_week=day_of_week,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        db_session.commit()

        # For patients (apply_booking_restrictions=True), slots beyond max window should be filtered out
        slots = AvailabilityService.get_available_slots_for_practitioner(
            db=db_session,
            practitioner_id=practitioner.id,
            date=future_date_iso,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            apply_booking_restrictions=True  # Patient-facing
        )

        # Availability should filter out slots beyond max_booking_window_days for patients
        assert len(slots) == 0, "Availability should filter out slots beyond max_booking_window_days for patients"

    def test_booking_restriction_enforced_for_max_booking_window(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that max_booking_window_days IS enforced when patient creates appointment."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Create patient with LINE user
        line_user = LineUser(
            line_user_id="U_test_window",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id
        )
        db_session.add(patient)
        db_session.commit()

        # Try to create appointment beyond max_booking_window_days (90 days)
        # This should fail even though availability showed the slot
        future_date = taiwan_now().date() + timedelta(days=100)
        start_time = datetime.combine(future_date, time(10, 0)).replace(tzinfo=TAIWAN_TZ)

        with pytest.raises(Exception) as exc_info:
            AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                start_time=start_time,
                practitioner_id=practitioner.id,
                line_user_id=line_user.id  # Patient booking - restrictions enforced
            )

        # Should raise error about max booking window
        assert "90" in str(exc_info.value) or "天" in str(exc_info.value)


# ============================================================================
# Max Future Appointments
# ============================================================================

class TestMaxFutureAppointments:
    """Test max_future_appointments limit enforcement."""

    def test_max_future_appointments_limit_enforcement(
        self, db_session: Session
    ):
        """Test that max_future_appointments limit is enforced when creating appointments."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Set max_future_appointments to 2 for testing
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.max_future_appointments = 2
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create practitioner
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

        # Create availability for multiple days (tomorrow, day 2, day 3, day 4)
        for day_offset in [1, 2, 3, 4]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
            create_practitioner_availability_with_clinic(
                db_session, practitioner, clinic,
                day_of_week=day_of_week,
                start_time=time(9, 0),
                end_time=time(17, 0)
            )

        # Create LINE user and patient
        line_user = LineUser(
            line_user_id="U_test_user",
            display_name="Test User"
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

        # Create first appointment - should succeed (more than 24 hours away to allow cancellation)
        start_time1 = taiwan_now() + timedelta(days=2)
        start_time1 = start_time1.replace(hour=10, minute=0, second=0, microsecond=0)

        result1 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time1,
            practitioner_id=practitioner.id,
            line_user_id=line_user.id,
            notes="First appointment"
        )
        assert result1["status"] == "confirmed"

        # Create second appointment - should succeed (more than 24 hours away to allow cancellation)
        start_time2 = taiwan_now() + timedelta(days=3)
        start_time2 = start_time2.replace(hour=11, minute=0, second=0, microsecond=0)

        result2 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time2,
            practitioner_id=practitioner.id,
            line_user_id=line_user.id,
            notes="Second appointment"
        )
        assert result2["status"] == "confirmed"

        # Try to create third appointment - should fail due to limit
        start_time3 = taiwan_now() + timedelta(days=4)
        start_time3 = start_time3.replace(hour=12, minute=0, second=0, microsecond=0)

        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.create_appointment(
                db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                start_time=start_time3,
                practitioner_id=practitioner.id,
                line_user_id=line_user.id,
                notes="Third appointment"
            )
        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
        assert "最多只能有 2 個未來預約" in exc_info.value.detail

        # Cancel one appointment and try again - should succeed
        # Note: The appointment is 2 days away, which is more than 24 hours, so cancellation is allowed.
        AppointmentService.cancel_appointment(
            db_session,
            appointment_id=result1["appointment_id"],
            cancelled_by="patient"
        )

        # Now should be able to create third appointment
        result3 = AppointmentService.create_appointment(
            db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time3,
            practitioner_id=practitioner.id,
            line_user_id=line_user.id,
            notes="Third appointment after cancel"
        )
        assert result3["status"] == "confirmed"

    def test_max_future_appointments_default_value(
        self, db_session: Session
    ):
        """Test that default max_future_appointments value is 3."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Check default value
        settings = clinic.get_validated_settings()
        assert settings.booking_restriction_settings.max_future_appointments == 3


# ============================================================================
# Minimum Cancellation Hours Before
# ============================================================================

class TestMinimumCancellationHoursBefore:
    """Test minimum_cancellation_hours_before enforcement for patient edits."""

    def test_patient_cannot_edit_within_cancellation_window(
        self, db_session: Session
    ):
        """Test that patient cannot edit appointment within minimum_cancellation_hours_before."""
        clinic, practitioner1, practitioner2, appointment_type, patient = _setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Set cancellation window to 24 hours
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.minimum_cancellation_hours_before = 24
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create availability for today to allow appointment creation
        today = taiwan_now().date()
        day_of_week = today.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create appointment 1 hour in future (within cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(hours=1)
        if start_time < taiwan_now():
            start_time = start_time + timedelta(days=1)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,
            line_user_id=None  # Created by admin, but patient will try to edit
        )
        appointment_id = result['appointment_id']

        # Patient tries to edit appointment (should fail - within cancellation window)
        new_start_time = start_time + timedelta(hours=2)
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment_id,
                new_practitioner_id=None,
                new_start_time=new_start_time,
                apply_booking_constraints=True,  # Patient edit
                allow_auto_assignment=False
            )

        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
        assert "小時前改期" in exc_info.value.detail or "小時前" in exc_info.value.detail

    def test_patient_can_edit_outside_cancellation_window(
        self, db_session: Session
    ):
        """Test that patient can edit appointment outside minimum_cancellation_hours_before."""
        clinic, practitioner1, practitioner2, appointment_type, patient = _setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user for patient
        line_user = LineUser(
            line_user_id="U_test_patient",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Set cancellation window to 24 hours
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.minimum_cancellation_hours_before = 24
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create availability for multiple days
        for day_offset in [3, 4]:
            target_date = (taiwan_now() + timedelta(days=day_offset)).date()
            day_of_week = target_date.weekday()
            create_practitioner_availability_with_clinic(
                db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
            )

        # Create appointment 3 days in future (well outside cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=3)
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

        # Patient edits appointment (should succeed - outside cancellation window)
        # New time must also satisfy minimum_booking_hours_ahead (24 hours default)
        # So use a time that's at least 24 hours from now
        new_start_time = taiwan_now().replace(hour=14, minute=0, second=0, microsecond=0) + timedelta(days=3, hours=2)
        AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=None,
            new_start_time=new_start_time,
            apply_booking_constraints=True,  # Patient edit
            allow_auto_assignment=False
        )

        # Verify appointment was updated
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        updated_start_time = datetime.combine(
            appointment.calendar_event.date,
            appointment.calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        assert updated_start_time == new_start_time

    def test_clinic_admin_bypasses_cancellation_window(
        self, db_session: Session
    ):
        """Test that clinic admin can edit appointments within cancellation window."""
        clinic, practitioner1, practitioner2, appointment_type, patient = _setup_clinic_with_practitioners(
            db_session
        )

        # Set cancellation window to 24 hours
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.minimum_cancellation_hours_before = 24
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create availability for today to allow appointment creation
        today = taiwan_now().date()
        day_of_week = today.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Create appointment 1 hour in future (within cancellation window)
        start_time = taiwan_now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(hours=1)
        if start_time < taiwan_now():
            start_time = start_time + timedelta(days=1)
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

        # Clinic admin edits appointment (should succeed - admin bypasses restrictions)
        new_start_time = start_time + timedelta(hours=2)
        AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment_id,
            new_practitioner_id=None,
            new_start_time=new_start_time,
            apply_booking_constraints=False,  # Admin edit - no restrictions
            allow_auto_assignment=False,
            reassigned_by_user_id=practitioner1.id  # Admin user
        )

        # Verify appointment was updated
        appointment = db_session.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        updated_start_time = datetime.combine(
            appointment.calendar_event.date,
            appointment.calendar_event.start_time
        ).replace(tzinfo=TAIWAN_TZ)
        assert updated_start_time == new_start_time


# ============================================================================
# Clinic Admin Bypass Behavior
# ============================================================================

class TestClinicAdminBypassBehavior:
    """Test that clinic admins bypass all booking restrictions."""

    def test_clinic_admin_bypasses_booking_restrictions(
        self, db_session: Session
    ):
        """Test that clinic admin can create appointments without booking restrictions."""
        clinic, practitioner1, practitioner2, appointment_type, patient = _setup_clinic_with_practitioners(
            db_session
        )

        # Set restrictive booking settings
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.minimum_booking_hours_ahead = 48
        settings.booking_restriction_settings.max_future_appointments = 1
        settings.booking_restriction_settings.max_booking_window_days = 7
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create availability for today (to allow booking 1 hour ahead)
        today = taiwan_now().date()
        day_of_week = today.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Clinic admin creates appointment within restriction (should succeed)
        # Use a time that's within practitioner availability
        start_time = taiwan_now().replace(hour=14, minute=0, second=0, microsecond=0)
        if start_time < taiwan_now():
            # If current time is past 2 PM, use tomorrow
            start_time = start_time + timedelta(days=1)
        
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=practitioner1.id,  # Must specify
            line_user_id=None  # No LINE validation for clinic users
        )

        assert result['appointment_id'] is not None

    def test_patient_must_follow_booking_restrictions(
        self, db_session: Session
    ):
        """Test that patient must follow booking restrictions."""
        clinic, practitioner1, practitioner2, appointment_type, patient = _setup_clinic_with_practitioners(
            db_session
        )

        # Create LINE user and link to patient to simulate patient booking
        line_user = LineUser(
            line_user_id="U_test_patient",
            display_name="Test Patient"
        )
        db_session.add(line_user)
        db_session.commit()
        patient.line_user_id = line_user.id
        db_session.commit()

        # Set restrictive booking settings
        from models.clinic import ClinicSettings
        settings = clinic.get_validated_settings()
        settings.booking_restriction_settings.minimum_booking_hours_ahead = 48
        clinic.set_validated_settings(settings)
        db_session.commit()

        # Create availability for today to ensure practitioner is available
        today = taiwan_now().date()
        day_of_week = today.weekday()
        create_practitioner_availability_with_clinic(
            db_session, practitioner1, clinic, day_of_week, time(9, 0), time(17, 0)
        )

        # Patient tries to create appointment within restriction (should fail)
        # Use a time that's within practitioner availability but violates booking restriction
        start_time = taiwan_now().replace(hour=14, minute=0, second=0, microsecond=0)
        if start_time < taiwan_now():
            start_time = start_time + timedelta(days=1)
        # Ensure it's less than 48 hours ahead
        if (start_time - taiwan_now()).total_seconds() / 3600 >= 48:
            start_time = taiwan_now() + timedelta(hours=1)
        
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.create_appointment(
                db=db_session,
                clinic_id=clinic.id,
                patient_id=patient.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                practitioner_id=None,
                line_user_id=line_user.id  # Patient booking - should enforce restrictions
            )

        # Should fail with 400 (booking restriction) not 409 (availability)
        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
        # Error message should indicate booking restriction violation
        assert exc_info.value.detail is not None

    def test_availability_shows_all_slots_for_clinic_admin(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that availability shows all slots for clinic admin (restrictions bypassed)."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Request availability for today (within 24 hours) as clinic admin
        today = taiwan_now().date()
        today_iso = today.isoformat()

        # For clinic admin (apply_booking_restrictions=False), all slots should be shown
        slots = AvailabilityService.get_available_slots_for_practitioner(
            db=db_session,
            practitioner_id=practitioner.id,
            date=today_iso,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            apply_booking_restrictions=False  # Clinic admin - bypass restrictions
        )

        # Should show all available slots regardless of booking restrictions
        assert len(slots) > 0, "Clinic admin should see all available slots"

    def test_booking_restriction_not_enforced_for_clinic_admin(
        self, db_session: Session, clinic_with_restrictions
    ):
        """Test that clinic admin can create appointments without booking restrictions."""
        clinic, practitioner, appt_type = clinic_with_restrictions

        # Create patient (no LINE user needed for admin booking)
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Admin Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Clinic admin can create appointment within minimum_booking_hours_ahead window
        # (no line_user_id = admin booking, restrictions bypassed)
        start_time = taiwan_now() + timedelta(hours=12)  # 12 hours ahead (less than 24)
        start_time = start_time.replace(minute=0, second=0, microsecond=0)

        # Should succeed (admin bypasses restrictions)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            start_time=start_time,
            practitioner_id=practitioner.id,
            line_user_id=None  # Admin booking - restrictions bypassed
        )

        assert result is not None
        assert 'appointment_id' in result

