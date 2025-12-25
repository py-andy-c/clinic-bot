# pyright: reportMissingTypeStubs=false
"""
Follow-Up Message Management API endpoints.
"""

import logging
from datetime import datetime, time
from typing import Dict, List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from core.database import get_db
from core.constants import TEMPORARY_ID_THRESHOLD
from auth.dependencies import require_admin_role, UserContext, ensure_clinic_access
from models import AppointmentType, FollowUpMessage, Clinic

logger = logging.getLogger(__name__)

router = APIRouter()


class FollowUpMessageCreateRequest(BaseModel):
    """Request model for creating a follow-up message."""
    timing_mode: Literal['hours_after', 'specific_time'] = Field(..., description="Timing mode: 'hours_after' or 'specific_time'")
    hours_after: Optional[int] = Field(None, ge=0, description="For Mode A: hours after appointment end (x >= 0)")
    days_after: Optional[int] = Field(None, ge=0, description="For Mode B: days after appointment date (y >= 0)")
    time_of_day: Optional[str] = Field(None, description="For Mode B: specific time in HH:MM format (e.g., '21:00')")
    message_template: str = Field(..., min_length=1, max_length=3500, description="Message template with placeholders")
    is_enabled: bool = Field(True, description="Whether this follow-up message is enabled")
    display_order: int = Field(0, ge=0, description="Display order for sorting multiple follow-up messages")

    @model_validator(mode='after')
    def validate_timing_mode_consistency(self):
        """Validate that timing mode fields are consistent."""
        if self.timing_mode == 'hours_after':
            if self.hours_after is None:
                raise ValueError("hours_after is required when timing_mode is 'hours_after'")
            if self.days_after is not None or self.time_of_day is not None:
                raise ValueError("days_after and time_of_day should not be set when timing_mode is 'hours_after'")
        elif self.timing_mode == 'specific_time':
            if self.days_after is None or self.time_of_day is None:
                raise ValueError("days_after and time_of_day are required when timing_mode is 'specific_time'")
            if self.hours_after is not None:
                raise ValueError("hours_after should not be set when timing_mode is 'specific_time'")
            # Validate time_of_day format
            try:
                time.fromisoformat(self.time_of_day)
            except (ValueError, AttributeError):
                raise ValueError("time_of_day must be in HH:MM format (e.g., '21:00')")
        return self


class FollowUpMessageUpdateRequest(BaseModel):
    """Request model for updating a follow-up message."""
    timing_mode: Optional[Literal['hours_after', 'specific_time']] = None
    hours_after: Optional[int] = Field(None, ge=0)
    days_after: Optional[int] = Field(None, ge=0)
    time_of_day: Optional[str] = None
    message_template: Optional[str] = Field(None, min_length=1, max_length=3500)
    is_enabled: Optional[bool] = None
    display_order: Optional[int] = Field(None, ge=0)

    @model_validator(mode='after')
    def validate_timing_mode_consistency(self):
        """Validate that timing mode fields are consistent if timing_mode is provided."""
        if self.timing_mode is None:
            # Partial update - validate only if timing_mode fields are provided
            if self.hours_after is not None or self.days_after is not None or self.time_of_day is not None:
                raise ValueError("timing_mode must be provided when setting timing fields")
            return self
        
        if self.timing_mode == 'hours_after':
            if self.hours_after is None:
                raise ValueError("hours_after is required when timing_mode is 'hours_after'")
            if self.days_after is not None or self.time_of_day is not None:
                raise ValueError("days_after and time_of_day should not be set when timing_mode is 'hours_after'")
        elif self.timing_mode == 'specific_time':
            if self.days_after is None or self.time_of_day is None:
                raise ValueError("days_after and time_of_day are required when timing_mode is 'specific_time'")
            if self.hours_after is not None:
                raise ValueError("hours_after should not be set when timing_mode is 'specific_time'")
            # Validate time_of_day format
            try:
                time.fromisoformat(self.time_of_day)
            except (ValueError, AttributeError):
                raise ValueError("time_of_day must be in HH:MM format (e.g., '21:00')")
        return self


class FollowUpMessageResponse(BaseModel):
    """Response model for a follow-up message."""
    id: int
    appointment_type_id: int
    clinic_id: int
    timing_mode: str
    hours_after: Optional[int]
    days_after: Optional[int]
    time_of_day: Optional[str]
    message_template: str
    is_enabled: bool
    display_order: int
    created_at: datetime
    updated_at: datetime


class FollowUpMessageListResponse(BaseModel):
    """Response model for list of follow-up messages."""
    follow_up_messages: List[FollowUpMessageResponse]


class FollowUpMessagePreviewRequest(BaseModel):
    """Request model for previewing a follow-up message."""
    appointment_type_id: Optional[int] = Field(None, description="Appointment type ID (optional for new items with temporary IDs)")
    appointment_type_name: Optional[str] = Field(None, description="Appointment type name (required if appointment_type_id is not provided or is a temporary ID)")
    timing_mode: Literal['hours_after', 'specific_time']
    hours_after: Optional[int] = Field(None, ge=0)
    days_after: Optional[int] = Field(None, ge=0)
    time_of_day: Optional[str] = None
    message_template: str
    
    @model_validator(mode='after')
    def validate_appointment_type(self):
        """Ensure at least one of appointment_type_id or appointment_type_name is provided."""
        if not self.appointment_type_id and not self.appointment_type_name:
            raise ValueError("Either appointment_type_id or appointment_type_name must be provided")
        return self


class FollowUpMessagePreviewResponse(BaseModel):
    """Response model for follow-up message preview."""
    preview_message: str
    used_placeholders: Dict[str, str]
    completeness_warnings: Optional[List[str]] = None


@router.get("/appointment-types/{appointment_type_id}/follow-up-messages", summary="Get follow-up messages for an appointment type")
async def get_follow_up_messages(
    appointment_type_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> FollowUpMessageListResponse:
    """Get all follow-up messages for an appointment type."""
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
        
        follow_up_messages = db.query(FollowUpMessage).filter(
            FollowUpMessage.appointment_type_id == appointment_type_id
        ).order_by(FollowUpMessage.display_order).all()
        
        return FollowUpMessageListResponse(
            follow_up_messages=[
                FollowUpMessageResponse(
                    id=msg.id,
                    appointment_type_id=msg.appointment_type_id,
                    clinic_id=msg.clinic_id,
                    timing_mode=msg.timing_mode,
                    hours_after=msg.hours_after,
                    days_after=msg.days_after,
                    time_of_day=str(msg.time_of_day) if msg.time_of_day else None,
                    message_template=msg.message_template,
                    is_enabled=msg.is_enabled,
                    display_order=msg.display_order,
                    created_at=msg.created_at,
                    updated_at=msg.updated_at
                )
                for msg in follow_up_messages
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get follow-up messages: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得追蹤訊息"
        )


@router.post("/appointment-types/{appointment_type_id}/follow-up-messages", summary="Create a follow-up message")
async def create_follow_up_message(
    appointment_type_id: int,
    request: FollowUpMessageCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> FollowUpMessageResponse:
    """Create a follow-up message for an appointment type."""
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
        
        # Check for display_order conflict
        existing = db.query(FollowUpMessage).filter(
            FollowUpMessage.appointment_type_id == appointment_type_id,
            FollowUpMessage.display_order == request.display_order
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
                    detail="time_of_day 格式錯誤，應為 HH:MM (例如: 21:00)"
                )
        
        # Create follow-up message
        follow_up_message = FollowUpMessage(
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            timing_mode=request.timing_mode,
            hours_after=request.hours_after,
            days_after=request.days_after,
            time_of_day=time_of_day_obj,
            message_template=request.message_template,
            is_enabled=request.is_enabled,
            display_order=request.display_order
        )
        
        db.add(follow_up_message)
        db.commit()
        db.refresh(follow_up_message)
        
        return FollowUpMessageResponse(
            id=follow_up_message.id,
            appointment_type_id=follow_up_message.appointment_type_id,
            clinic_id=follow_up_message.clinic_id,
            timing_mode=follow_up_message.timing_mode,
            hours_after=follow_up_message.hours_after,
            days_after=follow_up_message.days_after,
            time_of_day=str(follow_up_message.time_of_day) if follow_up_message.time_of_day else None,
            message_template=follow_up_message.message_template,
            is_enabled=follow_up_message.is_enabled,
            display_order=follow_up_message.display_order,
            created_at=follow_up_message.created_at,
            updated_at=follow_up_message.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create follow-up message: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立追蹤訊息"
        )


@router.put("/appointment-types/{appointment_type_id}/follow-up-messages/{message_id}", summary="Update a follow-up message")
async def update_follow_up_message(
    appointment_type_id: int,
    message_id: int,
    request: FollowUpMessageUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> FollowUpMessageResponse:
    """Update a follow-up message."""
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
        
        # Get follow-up message
        follow_up_message = db.query(FollowUpMessage).filter(
            FollowUpMessage.id == message_id,
            FollowUpMessage.appointment_type_id == appointment_type_id
        ).first()
        
        if not follow_up_message:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="追蹤訊息不存在"
            )
        
        # Check for display_order conflict if changing
        if request.display_order is not None and request.display_order != follow_up_message.display_order:
            existing = db.query(FollowUpMessage).filter(
                FollowUpMessage.appointment_type_id == appointment_type_id,
                FollowUpMessage.display_order == request.display_order,
                FollowUpMessage.id != message_id
            ).first()
            
            if existing:
                raise HTTPException(
                    status_code=http_status.HTTP_409_CONFLICT,
                    detail=f"顯示順序 {request.display_order} 已被使用"
                )
        
        # Update fields
        if request.timing_mode is not None:
            follow_up_message.timing_mode = request.timing_mode
        if request.hours_after is not None:
            follow_up_message.hours_after = request.hours_after
        if request.days_after is not None:
            follow_up_message.days_after = request.days_after
        if request.time_of_day is not None:
            try:
                follow_up_message.time_of_day = time.fromisoformat(request.time_of_day)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="time_of_day 格式錯誤，應為 HH:MM (例如: 21:00)"
                )
        if request.message_template is not None:
            follow_up_message.message_template = request.message_template
        if request.is_enabled is not None:
            follow_up_message.is_enabled = request.is_enabled
        if request.display_order is not None:
            follow_up_message.display_order = request.display_order
        
        db.commit()
        db.refresh(follow_up_message)
        
        return FollowUpMessageResponse(
            id=follow_up_message.id,
            appointment_type_id=follow_up_message.appointment_type_id,
            clinic_id=follow_up_message.clinic_id,
            timing_mode=follow_up_message.timing_mode,
            hours_after=follow_up_message.hours_after,
            days_after=follow_up_message.days_after,
            time_of_day=str(follow_up_message.time_of_day) if follow_up_message.time_of_day else None,
            message_template=follow_up_message.message_template,
            is_enabled=follow_up_message.is_enabled,
            display_order=follow_up_message.display_order,
            created_at=follow_up_message.created_at,
            updated_at=follow_up_message.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update follow-up message: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新追蹤訊息"
        )


@router.delete("/appointment-types/{appointment_type_id}/follow-up-messages/{message_id}", summary="Delete a follow-up message")
async def delete_follow_up_message(
    appointment_type_id: int,
    message_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Delete a follow-up message."""
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
        
        # Get follow-up message
        follow_up_message = db.query(FollowUpMessage).filter(
            FollowUpMessage.id == message_id,
            FollowUpMessage.appointment_type_id == appointment_type_id
        ).first()
        
        if not follow_up_message:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="追蹤訊息不存在"
            )
        
        db.delete(follow_up_message)
        db.commit()
        
        return {"success": True, "message": "追蹤訊息已刪除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete follow-up message: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除追蹤訊息"
        )


@router.post("/follow-up-message-preview", summary="Preview a follow-up message")
async def preview_follow_up_message(
    request: FollowUpMessagePreviewRequest,
    current_user: UserContext = Depends(require_admin_role),  # Require admin role for preview
    db: Session = Depends(get_db)
) -> FollowUpMessagePreviewResponse:
    """Preview a follow-up message with sample data."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if appointment_type_id is a temporary ID (large timestamp > TEMPORARY_ID_THRESHOLD)
        is_temporary_id = request.appointment_type_id and request.appointment_type_id > TEMPORARY_ID_THRESHOLD
        
        appointment_type = None
        appointment_type_name = None
        
        if request.appointment_type_id and not is_temporary_id:
            # Try to load from database for real IDs
            appointment_type = db.query(AppointmentType).filter(
                AppointmentType.id == request.appointment_type_id,
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.is_deleted == False
            ).first()
            if appointment_type:
                appointment_type_name = appointment_type.name
        
        # For temporary IDs or if not found in DB, use provided name or default
        if not appointment_type:
            appointment_type_name = request.appointment_type_name or "服務項目"
        
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )
        
        # Build preview context
        from services.message_template_service import MessageTemplateService
        if appointment_type:
            # Use existing appointment type
            context = MessageTemplateService.build_preview_context(
                appointment_type=appointment_type,
                current_user=current_user,
                clinic=clinic,
                db=db
            )
        else:
            # For new items (temporary IDs), build context with provided name
            context = MessageTemplateService.build_preview_context(
                appointment_type=None,
                current_user=current_user,
                clinic=clinic,
                db=db,
                sample_appointment_type_name=appointment_type_name
            )
        
        # Render message
        preview_message = MessageTemplateService.render_message(
            request.message_template,
            context
        )
        
        # Extract used placeholders
        used_placeholders = MessageTemplateService.extract_used_placeholders(
            request.message_template,
            context
        )
        
        # Validate placeholder completeness
        completeness_warnings = MessageTemplateService.validate_placeholder_completeness(
            request.message_template,
            context,
            clinic
        )
        
        return FollowUpMessagePreviewResponse(
            preview_message=preview_message,
            used_placeholders=used_placeholders,
            completeness_warnings=completeness_warnings if completeness_warnings else None
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to preview follow-up message: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法預覽追蹤訊息"
        )

