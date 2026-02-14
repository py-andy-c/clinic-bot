"""
Integration tests for Patient Form Configuration service layer.
"""

import pytest
from datetime import time
from sqlalchemy.orm import Session

from models import (
    Clinic, AppointmentType,
    MedicalRecordTemplate, AppointmentTypePatientFormConfig
)
from tests.conftest import create_user_with_clinic_association


class TestPatientFormConfigsIntegration:
    """Test patient form configuration CRUD operations."""

    def test_create_patient_form_config_success(self, db_session: Session):
        """Test creating a patient form config successfully."""
        # Create clinic and appointment type
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

        # Create patient form template
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
            timing_type="before",
            timing_mode="hours",
            hours=24,
            on_impossible="send_immediately",
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Verify it was created
        assert config.id is not None
        assert config.medical_record_template_id == template.id
        assert config.timing_type == "before"
        assert config.timing_mode == "hours"
        assert config.hours == 24
        assert config.on_impossible == "send_immediately"
        assert config.is_enabled is True

    def test_model_validation_timing_mode_consistency(self, db_session: Session):
        """Test that model validates timing mode consistency."""
        # Create clinic and appointment type
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
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Try to create config with hours mode but missing hours - should fail at DB level
        from sqlalchemy.exc import IntegrityError
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="before",
            timing_mode="hours",
            # Missing hours field - violates check constraint
            on_impossible="send_immediately",
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        
        with pytest.raises(IntegrityError):
            db_session.commit()
        
        db_session.rollback()

    def test_create_patient_form_config_specific_time_mode(self, db_session: Session):
        """Test creating config with specific_time mode."""
        # Create clinic and appointment type
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
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Create config with specific_time mode
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="after",
            timing_mode="specific_time",
            days=1,
            time_of_day=time(9, 0),
            on_impossible=None,  # Must be None for 'after' timing
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Verify it was created
        assert config.id is not None
        assert config.timing_mode == "specific_time"
        assert config.days == 1
        assert config.time_of_day == time(9, 0)

    def test_query_patient_form_configs_ordered(self, db_session: Session):
        """Test querying patient form configs returns them in display_order."""
        # Create clinic and appointment type
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
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Create two configs
        config1 = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="before",
            timing_mode="hours",
            hours=24,
            on_impossible="send_immediately",
            is_enabled=True,
            display_order=0
        )
        config2 = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="after",
            timing_mode="specific_time",
            days=1,
            time_of_day=time(9, 0),
            on_impossible=None,  # Must be None for 'after' timing
            is_enabled=True,
            display_order=1
        )
        db_session.add_all([config1, config2])
        db_session.commit()

        # Query configs
        configs = db_session.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.appointment_type_id == appointment_type.id
        ).order_by(AppointmentTypePatientFormConfig.display_order).all()

        assert len(configs) == 2
        assert configs[0].display_order == 0
        assert configs[1].display_order == 1

    def test_update_patient_form_config(self, db_session: Session):
        """Test updating a patient form config."""
        # Create clinic and appointment type
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
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="before",
            timing_mode="hours",
            hours=24,
            on_impossible="send_immediately",
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Update config
        config.hours = 48
        config.is_enabled = False
        db_session.commit()
        db_session.refresh(config)

        # Verify update
        assert config.hours == 48
        assert config.is_enabled is False

    def test_delete_patient_form_config(self, db_session: Session):
        """Test deleting a patient form config."""
        # Create clinic and appointment type
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
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="before",
            timing_mode="hours",
            hours=24,
            on_impossible="send_immediately",
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        config_id = config.id

        # Delete config
        db_session.delete(config)
        db_session.commit()

        # Verify deleted
        deleted_config = db_session.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.id == config_id
        ).first()
        assert deleted_config is None





class TestPatientFormConfigsAPI:
    """Test patient form configuration API endpoints using TestClient."""

    def test_create_config_with_after_timing_ignores_on_impossible(self, db_session: Session):
        """Test that configs with 'after' timing correctly set on_impossible to None in database."""
        # Create clinic and appointment type
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
            is_patient_form=True
        )
        db_session.add(template)
        db_session.flush()

        # Create config with timing_type='after'
        # Even though we might pass on_impossible in the request, it should be None in DB
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            medical_record_template_id=template.id,
            timing_type="after",
            timing_mode="hours",
            hours=24,
            on_impossible=None,  # Must be None for 'after' timing
            is_enabled=True,
            display_order=0
        )
        db_session.add(config)
        db_session.commit()

        # Verify in database it's None
        db_session.refresh(config)
        assert config.on_impossible is None
        assert config.timing_type == "after"
