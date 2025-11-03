"""
Unit tests for AppointmentTypeService.

Tests for appointment type management and validation.
"""

import pytest
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.appointment_type import AppointmentType
from models.clinic import Clinic
from services.appointment_type_service import AppointmentTypeService


class TestAppointmentTypeService:
    """Test AppointmentTypeService methods."""

    def test_get_appointment_type_by_id_success(self, db_session: Session):
        """Test getting appointment type by ID successfully."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Get appointment type
        result = AppointmentTypeService.get_appointment_type_by_id(
            db_session, appt_type.id
        )

        assert result.id == appt_type.id
        assert result.name == "Consultation"
        assert result.duration_minutes == 30
        assert result.clinic_id == clinic.id

    def test_get_appointment_type_by_id_not_found(self, db_session: Session):
        """Test getting non-existent appointment type returns 404."""
        with pytest.raises(HTTPException) as exc_info:
            AppointmentTypeService.get_appointment_type_by_id(
                db_session, 99999
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "Appointment type not found" in exc_info.value.detail

    def test_get_appointment_type_by_id_with_clinic_validation_success(
        self, db_session: Session
    ):
        """Test getting appointment type with clinic validation succeeds."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Get appointment type with clinic validation
        result = AppointmentTypeService.get_appointment_type_by_id(
            db_session, appt_type.id, clinic_id=clinic.id
        )

        assert result.id == appt_type.id
        assert result.clinic_id == clinic.id

    def test_get_appointment_type_by_id_with_clinic_validation_fails(
        self, db_session: Session
    ):
        """Test getting appointment type with wrong clinic returns 404."""
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="channel1",
            line_channel_secret="secret1",
            line_channel_access_token="token1"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="channel2",
            line_channel_secret="secret2",
            line_channel_access_token="token2"
        )
        db_session.add(clinic1)
        db_session.add(clinic2)
        db_session.commit()

        # Create appointment type for clinic1
        appt_type = AppointmentType(
            clinic_id=clinic1.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        # Try to get with clinic2's ID - should fail
        with pytest.raises(HTTPException) as exc_info:
            AppointmentTypeService.get_appointment_type_by_id(
                db_session, appt_type.id, clinic_id=clinic2.id
            )

        assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
        assert "Appointment type not found" in exc_info.value.detail

    def test_list_appointment_types_for_clinic_success(
        self, db_session: Session
    ):
        """Test listing appointment types for a clinic."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create multiple appointment types
        appt_types = []
        for i, name in enumerate(["Consultation", "Follow-up", "Therapy"]):
            appt_type = AppointmentType(
                clinic_id=clinic.id,
                name=name,
                duration_minutes=30 * (i + 1)
            )
            db_session.add(appt_type)
            appt_types.append(appt_type)

        db_session.commit()

        # List appointment types
        result = AppointmentTypeService.list_appointment_types_for_clinic(
            db_session, clinic.id
        )

        assert len(result) == 3
        assert {at.name for at in result} == {"Consultation", "Follow-up", "Therapy"}

    def test_list_appointment_types_for_clinic_empty(
        self, db_session: Session
    ):
        """Test listing appointment types for clinic with no types."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # List appointment types
        result = AppointmentTypeService.list_appointment_types_for_clinic(
            db_session, clinic.id
        )

        assert len(result) == 0
        assert result == []

    def test_list_appointment_types_for_clinic_isolation(
        self, db_session: Session
    ):
        """Test appointment types are isolated by clinic."""
        # Create two clinics
        clinic1 = Clinic(
            name="Clinic 1",
            line_channel_id="channel1",
            line_channel_secret="secret1",
            line_channel_access_token="token1"
        )
        clinic2 = Clinic(
            name="Clinic 2",
            line_channel_id="channel2",
            line_channel_secret="secret2",
            line_channel_access_token="token2"
        )
        db_session.add(clinic1)
        db_session.add(clinic2)
        db_session.commit()

        # Create appointment types for each clinic
        appt_type1 = AppointmentType(
            clinic_id=clinic1.id,
            name="Clinic 1 Type",
            duration_minutes=30
        )
        appt_type2 = AppointmentType(
            clinic_id=clinic2.id,
            name="Clinic 2 Type",
            duration_minutes=60
        )
        db_session.add(appt_type1)
        db_session.add(appt_type2)
        db_session.commit()

        # List for clinic1
        result1 = AppointmentTypeService.list_appointment_types_for_clinic(
            db_session, clinic1.id
        )
        assert len(result1) == 1
        assert result1[0].name == "Clinic 1 Type"

        # List for clinic2
        result2 = AppointmentTypeService.list_appointment_types_for_clinic(
            db_session, clinic2.id
        )
        assert len(result2) == 1
        assert result2[0].name == "Clinic 2 Type"

