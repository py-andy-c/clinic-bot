"""
Integration tests for max_future_appointments limit enforcement.
"""

import pytest
from datetime import timedelta, time
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import (
    Clinic, Patient, AppointmentType, Appointment, CalendarEvent,
    LineUser, PractitionerAppointmentTypes
)
from services.appointment_service import AppointmentService
from utils.datetime_utils import taiwan_now
from tests.conftest import (
    create_practitioner_availability_with_clinic,
    create_user_with_clinic_association
)


class TestMaxFutureAppointmentsLimit:
    """Integration tests for max_future_appointments limit enforcement."""

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

        # Create availability for multiple days (tomorrow, day 2, day 3)
        for day_offset in [1, 2, 3]:
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

        # Create first appointment - should succeed
        start_time1 = taiwan_now() + timedelta(days=1)
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

        # Create second appointment - should succeed
        start_time2 = taiwan_now() + timedelta(days=2)
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
        start_time3 = taiwan_now() + timedelta(days=3)
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

