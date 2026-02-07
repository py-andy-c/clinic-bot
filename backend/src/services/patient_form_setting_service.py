from typing import List, Optional, Dict, Any  # type: ignore
from datetime import datetime, timezone, time
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.patient_form_setting import PatientFormSetting
from models.medical_record_template import MedicalRecordTemplate
from core.constants import PATIENT_FORM_TEMPLATE_TYPE

class PatientFormSettingService:
    @staticmethod
    def _validate_timing_params(timing_mode: str, hours_after: Optional[int], days_after: Optional[int], time_of_day: Optional[time]) -> None:
        """Validate timing parameters based on timing mode."""
        if timing_mode == 'hours_after':
            if hours_after is None:
                raise HTTPException(status_code=400, detail="hours_after is required for timing_mode='hours_after'")
        elif timing_mode == 'specific_time':
            if days_after is None or time_of_day is None:
                raise HTTPException(status_code=400, detail="days_after and time_of_day are required for timing_mode='specific_time'")

    @staticmethod
    def create_setting(
        db: Session,
        clinic_id: int,
        appointment_type_id: int,
        template_id: int,
        timing_mode: str,
        message_template: str,
        hours_after: Optional[int] = None,
        days_after: Optional[int] = None,
        time_of_day: Optional[time] = None,
        flex_button_text: str = '填寫表單',
        notify_admin: bool = False,
        notify_appointment_practitioner: bool = False,
        notify_assigned_practitioner: bool = False,
        is_enabled: bool = True,
        display_order: int = 0
    ) -> PatientFormSetting:
        # Validate message template
        if "{表單連結}" not in message_template:
            raise HTTPException(status_code=400, detail="Message template must contain {表單連結}")

        # Validate timing parameters
        PatientFormSettingService._validate_timing_params(timing_mode, hours_after, days_after, time_of_day)

        # Verify template exists and belongs to clinic
        template = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id,
            MedicalRecordTemplate.template_type == PATIENT_FORM_TEMPLATE_TYPE,
            MedicalRecordTemplate.is_deleted == False
        ).first()
        if not template:
            raise HTTPException(status_code=404, detail="Patient form template not found")

        setting = PatientFormSetting(
            clinic_id=clinic_id,
            appointment_type_id=appointment_type_id,
            template_id=template_id,
            timing_mode=timing_mode,
            hours_after=hours_after,
            days_after=days_after,
            time_of_day=time_of_day,
            message_template=message_template,
            flex_button_text=flex_button_text,
            notify_admin=notify_admin,
            notify_appointment_practitioner=notify_appointment_practitioner,
            notify_assigned_practitioner=notify_assigned_practitioner,
            is_enabled=is_enabled,
            display_order=display_order
        )
        db.add(setting)
        db.commit()
        db.refresh(setting)
        return setting

    @staticmethod
    def get_setting(db: Session, setting_id: int, clinic_id: int) -> Optional[PatientFormSetting]:
        return db.query(PatientFormSetting).filter(
            PatientFormSetting.id == setting_id,
            PatientFormSetting.clinic_id == clinic_id
        ).first()

    @staticmethod
    def list_settings_by_appointment_type(
        db: Session, 
        clinic_id: int, 
        appointment_type_id: int
    ) -> List[PatientFormSetting]:
        return db.query(PatientFormSetting).filter(
            PatientFormSetting.clinic_id == clinic_id,
            PatientFormSetting.appointment_type_id == appointment_type_id
        ).order_by(PatientFormSetting.display_order).all()

    @staticmethod
    def update_setting(
        db: Session,
        setting_id: int,
        clinic_id: int,
        **kwargs: Any
    ) -> PatientFormSetting:
        setting = PatientFormSettingService.get_setting(db, setting_id, clinic_id)
        if not setting:
            raise HTTPException(status_code=404, detail="Setting not found")

        if "message_template" in kwargs and "{表單連結}" not in kwargs["message_template"]:  # type: ignore
            raise HTTPException(status_code=400, detail="Message template must contain {表單連結}")

        if "template_id" in kwargs:
            template = db.query(MedicalRecordTemplate).filter(
                MedicalRecordTemplate.id == kwargs["template_id"],  # type: ignore
                MedicalRecordTemplate.clinic_id == clinic_id,
                MedicalRecordTemplate.template_type == PATIENT_FORM_TEMPLATE_TYPE,
                MedicalRecordTemplate.is_deleted == False
            ).first()
            if not template:
                raise HTTPException(status_code=404, detail="Patient form template not found")

        # Validate timing parameters if any are being updated
        new_timing_mode = kwargs.get("timing_mode", setting.timing_mode)
        new_hours_after = kwargs.get("hours_after", setting.hours_after)
        new_days_after = kwargs.get("days_after", setting.days_after)
        new_time_of_day = kwargs.get("time_of_day", setting.time_of_day)
        PatientFormSettingService._validate_timing_params(new_timing_mode, new_hours_after, new_days_after, new_time_of_day)

        for key, value in kwargs.items():
            if hasattr(setting, key):
                setattr(setting, key, value)

        setting.updated_at = datetime.now(timezone.utc)  # type: ignore
        db.commit()
        db.refresh(setting)
        return setting  # type: ignore

    @staticmethod
    def delete_setting(db: Session, setting_id: int, clinic_id: int) -> bool:
        setting = PatientFormSettingService.get_setting(db, setting_id, clinic_id)
        if not setting:
            return False
        db.delete(setting)
        db.commit()
        return True
