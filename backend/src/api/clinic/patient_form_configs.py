# pyright: reportMissingTypeStubs=false
"""
Patient Form Configuration Management API endpoints.
"""

import logging
from datetime import datetime, time
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_admin_role, UserContext, ensure_clinic_access
from models import AppointmentType, AppointmentTypePatientFormConfig, MedicalRecordTemplate

logger = logging.getLogger(__name__)

router = APIRouter()


class PatientFormConfigCreateRequest(BaseModel):
    """Request model for creating a patient form config."""
    medical_record_template_id: int = Field(..., description="Medical record template ID")
    timing_type: Literal['before', 'after'] = Field(..., description="Timing type: 'before' or 'after'")
    timing_mode: Literal['hours', 'specific_time'] = Field(..., description="Timing mode: 'hours' or 'specific_time'")
    hours: Optional[int] = Field(None, ge=0, description="For hours mode: hours before/after appointment")
    days: Optional[int] = Field(None, ge=0, description="For specific_time mode: days before/after appointment")
    time_of_day: Optional[str] = Field(None, description="For specific_time mode: time in HH:MM format")
    on_impossible: Literal['send_immediately', 'skip'] = Field('send_immediately', description="Action when timing is impossible")
    is_enabled: bool = Field(True, description="Whether this config is enabled")
    display_order: int = Field(0, ge=0, description="Display order for sorting")

    @model_validator(mode='after')
    def validate_timing_mode_consistency(self):
        """Validate that timing mode fields are consistent."""
        if self.timing_mode == 'hours':
            if self.hours is None:
                raise ValueError("hours is required when timing_mode is 'hours'")
            if self.days is not None or self.time_of_day is not None:
                raise ValueError("days and time_of_day should not be set when timing_mode is 'hours'")
        elif self.timing_mode == 'specific_time':
            if self.days is None or self.time_of_day is None:
                raise ValueError("days and time_of_day are required when timing_mode is 'specific_time'")
            if self.hours is not None:
                raise ValueError("hours should not be set when timing_mode is 'specific_time'")
            # Validate time_of_day format
            try:
                time.fromisoformat(self.time_of_day)
            except (ValueError, AttributeError):
                raise ValueError("time_of_day must be in HH:MM format (e.g., '09:00')")
        return self


class PatientFormConfigUpdateRequest(BaseModel):
    """Request model for updating a patient form config."""
    medical_record_template_id: Optional[int] = None
    timing_type: Optional[Literal['before', 'after']] = None
    timing_mode: Optional[Literal['hours', 'specific_time']] = None
    hours: Optional[int] = Field(None, ge=0)
    days: Optional[int] = Field(None, ge=0)
    time_of_day: Optional[str] = None
    on_impossible: Optional[Literal['send_immediately', 'skip']] = None
    is_enabled: Optional[bool] = None
    display_order: Optional[int] = Field(None, ge=0)

    @model_validator(mode='after')
    def validate_timing_mode_consistency(self):
        """Validate that timing mode fields are consistent if timing_mode is provided."""
        if self.timing_mode is None:
            # Partial update - validate only if timing_mode fields are provided
            if self.hours is not None or self.days is not None or self.time_of_day is not None:
                raise ValueError("timing_mode must be provided when setting timing fields")
            return self
        
        if self.timing_mode == 'hours':
            if self.hours is None:
                raise ValueError("hours is required when timing_mode is 'hours'")
            if self.days is not None or self.time_of_day is not None:
                raise ValueError("days and time_of_day should not be set when timing_mode is 'hours'")
        elif self.timing_mode == 'specific_time':
            if self.days is None or self.time_of_day is None:
                raise ValueError("days and time_of_day are required when timing_mode is 'specific_time'")
            if self.hours is not None:
                raise ValueError("hours should not be set when timing_mode is 'specific_time'")
            # Validate time_of_day format
            try:
                time.fromisoformat(self.time_of_day)
            except (ValueError, AttributeError):
                raise ValueError("time_of_day must be in HH:MM format (e.g., '09:00')")
        return self


class PatientFormConfigResponse(BaseModel):
    """Response model for a patient form config."""
    id: int
    appointment_type_id: int
    clinic_id: int
    medical_record_template_id: int
    timing_type: str
    timing_mode: str
    hours: Optional[int]
    days: Optional[int]
    time_of_day: Optional[str]
    on_impossible: str
    is_enabled: bool
    display_order: int
    created_at: datetime
    updated_at: datetime


class PatientFormConfigListResponse(BaseModel):
    """Response model for list of patient form configs."""
    patient_form_configs: List[PatientFormConfigResponse]


@router.get("/appointment-types/{appointment_type_id}/patient-form-configs", summary="Get patient form configs for an appointment type")
async def get_patient_form_configs(
    appointment_type_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> PatientFormConfigListResponse:
    """Get all patient form configs for an appointment type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment type belongs to clinic
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
        
        configs = db.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.appointment_type_id == appointment_type_id
        ).order_by(AppointmentTypePatientFormConfig.display_order).all()
        
        return PatientFormConfigListResponse(
            patient_form_configs=[
                PatientFormConfigResponse(
                    id=config.id,
                    appointment_type_id=config.appointment_type_id,
                    clinic_id=config.clinic_id,
                    medical_record_template_id=config.medical_record_template_id,
                    timing_type=config.timing_type,
                    timing_mode=config.timing_mode,
                    hours=config.hours,
                    days=config.days,
                    time_of_day=str(config.time_of_day) if config.time_of_day else None,
                    on_impossible=config.on_impossible if config.on_impossible else 'send_immediately',
                    is_enabled=config.is_enabled,
                    display_order=config.display_order,
                    created_at=config.created_at,
                    updated_at=config.updated_at
                )
                for config in configs
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get patient form configs: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患表單設定"
        )


@router.post("/appointment-types/{appointment_type_id}/patient-form-configs", summary="Create a patient form config")
async def create_patient_form_config(
    appointment_type_id: int,
    request: PatientFormConfigCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> PatientFormConfigResponse:
    """Create a patient form config for an appointment type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment type belongs to clinic
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
        
        # Verify template exists and is a patient form
        template = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == request.medical_record_template_id,
            MedicalRecordTemplate.clinic_id == clinic_id,
            MedicalRecordTemplate.is_deleted == False
        ).first()
        
        if not template:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="病歷模板不存在"
            )
        
        if not template.is_patient_form:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="只能使用病患表單模板"
            )
        
        # Check for display_order conflict
        existing = db.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.appointment_type_id == appointment_type_id,
            AppointmentTypePatientFormConfig.display_order == request.display_order
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"顯示順序 {request.display_order} 已被使用"
            )
        
        # Parse time_of_day if provided
        time_of_day_obj = None
        if request.time_of_day:
            try:
                time_of_day_obj = time.fromisoformat(request.time_of_day)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="time_of_day 格式錯誤，應為 HH:MM (例如: 09:00)"
                )
        
        # Handle on_impossible: must be None for 'after' timing per DB constraint
        on_impossible_value = None if request.timing_type == 'after' else request.on_impossible
        
        # Create config
        config = AppointmentTypePatientFormConfig(
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            medical_record_template_id=request.medical_record_template_id,
            timing_type=request.timing_type,
            timing_mode=request.timing_mode,
            hours=request.hours,
            days=request.days,
            time_of_day=time_of_day_obj,
            on_impossible=on_impossible_value,
            is_enabled=request.is_enabled,
            display_order=request.display_order
        )
        
        db.add(config)
        db.commit()
        db.refresh(config)
        
        return PatientFormConfigResponse(
            id=config.id,
            appointment_type_id=config.appointment_type_id,
            clinic_id=config.clinic_id,
            medical_record_template_id=config.medical_record_template_id,
            timing_type=config.timing_type,
            timing_mode=config.timing_mode,
            hours=config.hours,
            days=config.days,
            time_of_day=str(config.time_of_day) if config.time_of_day else None,
            on_impossible=config.on_impossible if config.on_impossible else 'send_immediately',
            is_enabled=config.is_enabled,
            display_order=config.display_order,
            created_at=config.created_at,
            updated_at=config.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create patient form config: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立病患表單設定"
        )


@router.put("/appointment-types/{appointment_type_id}/patient-form-configs/{config_id}", summary="Update a patient form config")
async def update_patient_form_config(
    appointment_type_id: int,
    config_id: int,
    request: PatientFormConfigUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> PatientFormConfigResponse:
    """Update a patient form config."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment type belongs to clinic
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
        
        # Get config
        config = db.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.id == config_id,
            AppointmentTypePatientFormConfig.appointment_type_id == appointment_type_id
        ).first()
        
        if not config:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="病患表單設定不存在"
            )
        
        # Verify template if changing
        if request.medical_record_template_id is not None:
            template = db.query(MedicalRecordTemplate).filter(
                MedicalRecordTemplate.id == request.medical_record_template_id,
                MedicalRecordTemplate.clinic_id == clinic_id,
                MedicalRecordTemplate.is_deleted == False
            ).first()
            
            if not template:
                raise HTTPException(
                    status_code=http_status.HTTP_404_NOT_FOUND,
                    detail="病歷模板不存在"
                )
            
            if not template.is_patient_form:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="只能使用病患表單模板"
                )
        
        # Check for display_order conflict if changing
        if request.display_order is not None and request.display_order != config.display_order:
            existing = db.query(AppointmentTypePatientFormConfig).filter(
                AppointmentTypePatientFormConfig.appointment_type_id == appointment_type_id,
                AppointmentTypePatientFormConfig.display_order == request.display_order,
                AppointmentTypePatientFormConfig.id != config_id
            ).first()
            
            if existing:
                raise HTTPException(
                    status_code=http_status.HTTP_409_CONFLICT,
                    detail=f"顯示順序 {request.display_order} 已被使用"
                )
        
        # Update fields
        if request.medical_record_template_id is not None:
            config.medical_record_template_id = request.medical_record_template_id
        if request.timing_type is not None:
            config.timing_type = request.timing_type
            # If changing to 'after', must set on_impossible to None per DB constraint
            if request.timing_type == 'after':
                config.on_impossible = None
        if request.timing_mode is not None:
            config.timing_mode = request.timing_mode
        if request.hours is not None:
            config.hours = request.hours
        if request.days is not None:
            config.days = request.days
        if request.time_of_day is not None:
            try:
                config.time_of_day = time.fromisoformat(request.time_of_day)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="time_of_day 格式錯誤，應為 HH:MM (例如: 09:00)"
                )
        if request.on_impossible is not None:
            # Only set on_impossible if timing_type is 'before' (or not being changed to 'after')
            if config.timing_type == 'before':
                config.on_impossible = request.on_impossible
            # If timing_type is 'after', ignore the on_impossible value (keep it None)
        if request.is_enabled is not None:
            config.is_enabled = request.is_enabled
        if request.display_order is not None:
            config.display_order = request.display_order
        
        db.commit()
        db.refresh(config)
        
        return PatientFormConfigResponse(
            id=config.id,
            appointment_type_id=config.appointment_type_id,
            clinic_id=config.clinic_id,
            medical_record_template_id=config.medical_record_template_id,
            timing_type=config.timing_type,
            timing_mode=config.timing_mode,
            hours=config.hours,
            days=config.days,
            time_of_day=str(config.time_of_day) if config.time_of_day else None,
            on_impossible=config.on_impossible if config.on_impossible else 'send_immediately',
            is_enabled=config.is_enabled,
            display_order=config.display_order,
            created_at=config.created_at,
            updated_at=config.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update patient form config: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新病患表單設定"
        )


@router.delete("/appointment-types/{appointment_type_id}/patient-form-configs/{config_id}", summary="Delete a patient form config")
async def delete_patient_form_config(
    appointment_type_id: int,
    config_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Delete a patient form config."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment type belongs to clinic
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
        
        # Get config
        config = db.query(AppointmentTypePatientFormConfig).filter(
            AppointmentTypePatientFormConfig.id == config_id,
            AppointmentTypePatientFormConfig.appointment_type_id == appointment_type_id
        ).first()
        
        if not config:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="病患表單設定不存在"
            )
        
        db.delete(config)
        db.commit()
        
        return {"success": True, "message": "病患表單設定已刪除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete patient form config: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除病患表單設定"
        )
