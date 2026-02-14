"""
Unit tests for AppointmentTypePatientFormConfig model.

Tests model creation, validation, and constraints.
"""

import pytest
from datetime import time as time_type
from sqlalchemy.exc import IntegrityError

from models import (
    AppointmentTypePatientFormConfig,
    AppointmentType,
    Clinic,
    MedicalRecordTemplate
)


class TestAppointmentTypePatientFormConfigModel:
    """Test cases for AppointmentTypePatientFormConfig model."""

    def test_create_config_hours_mode_before(self, db_session):
        """Test creating a patient form config with hours mode (before)."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Intake Form",
            fields=[],
            is_patient_form=True,
            message_template="請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create config
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=2,
            on_impossible='send_immediately',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Verify
        assert config.id is not None
        assert config.timing_type == 'before'
        assert config.timing_mode == 'hours'
        assert config.hours == 2
        assert config.on_impossible == 'send_immediately'
        assert config.is_enabled is True

    def test_create_config_specific_time_mode_after(self, db_session):
        """Test creating a patient form config with specific_time mode (after)."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Satisfaction Survey",
            fields=[],
            is_patient_form=True,
            message_template="請填寫{模板名稱}"
        )
        db_session.add(template)
        db_session.flush()

        # Create config
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='after',
            timing_mode='specific_time',
            days=1,
            time_of_day=time_type(21, 0),
            on_impossible=None,  # Should be NULL for 'after'
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Verify
        assert config.id is not None
        assert config.timing_type == 'after'
        assert config.timing_mode == 'specific_time'
        assert config.days == 1
        assert config.time_of_day == time_type(21, 0)
        assert config.on_impossible is None

    def test_relationship_to_appointment_type(self, db_session):
        """Test relationship between config and appointment type."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Test Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=1,
            on_impossible='skip',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Verify relationship
        assert config.appointment_type == appointment_type
        assert config in appointment_type.patient_form_configs

    def test_cascade_delete_with_appointment_type(self, db_session):
        """Test that config is deleted when appointment type is deleted."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Test Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=1,
            on_impossible='skip',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        config_id = config.id

        # Delete appointment type
        db_session.delete(appointment_type)
        db_session.commit()

        # Verify config is also deleted
        deleted_config = db_session.query(AppointmentTypePatientFormConfig).filter_by(id=config_id).first()
        assert deleted_config is None

    def test_unique_constraint_display_order(self, db_session):
        """Test unique constraint on appointment_type_id + display_order."""
        # Create test data
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Test Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Create first config
        config1 = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='before',
            timing_mode='hours',
            hours=1,
            on_impossible='skip',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config1)
        db_session.commit()

        # Try to create second config with same display_order
        config2 = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='after',
            timing_mode='hours',
            hours=2,
            on_impossible=None,
            is_enabled=True,
            display_order=0  # Same display_order
        )
        db_session.add(config2)

        # Should raise IntegrityError
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_check_constraint_timing_type(self, db_session):
        """Test check constraint on timing_type values."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Test Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Try to create config with invalid timing_type
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='invalid',  # Invalid value
            timing_mode='hours',
            hours=1,
            on_impossible='skip',
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)

        # Should raise IntegrityError
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_check_constraint_on_impossible_consistency(self, db_session):
        """Test check constraint that on_impossible is only set for 'before' timing."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="trial"
        )
        db_session.add(clinic)
        db_session.flush()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        template = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Test Form",
            fields=[],
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Try to create 'after' config with on_impossible set (should fail)
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type='after',
            timing_mode='hours',
            hours=1,
            on_impossible='send_immediately',  # Should be NULL for 'after'
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)

        # Should raise IntegrityError
        with pytest.raises(IntegrityError):
            db_session.commit()
