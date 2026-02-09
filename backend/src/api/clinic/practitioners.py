# pyright: reportMissingTypeStubs=false
"""
Practitioner Management API endpoints.
"""

import logging
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.database import get_db
from auth.dependencies import require_authenticated, require_admin_role, UserContext, ensure_clinic_access
from models import User, AppointmentType, PractitionerAvailability, UserClinicAssociation
from services import PractitionerService, AppointmentTypeService
from utils.appointment_type_queries import count_active_appointment_types_for_practitioner
from utils.datetime_utils import taiwan_now
from api.responses import (
    AppointmentTypeResponse, PractitionerAppointmentTypesResponse, PractitionerStatusResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class PractitionerListItemResponse(BaseModel):
    """Response model for practitioner list item."""
    id: int
    full_name: str
    offered_types: List[int]
    patient_booking_allowed: bool


class PractitionerListResponse(BaseModel):
    """Response model for practitioner list."""
    practitioners: List[PractitionerListItemResponse]


class PractitionerAppointmentTypesUpdateRequest(BaseModel):
    """Request model for updating practitioner's appointment types."""
    appointment_type_ids: List[int]


class PractitionerSettingsUpdateRequest(BaseModel):
    """Request model for updating practitioner settings."""
    settings: Dict[str, Any]  # PractitionerSettings fields


class BatchPractitionerStatusRequest(BaseModel):
    """Request model for batch practitioner status query."""
    practitioner_ids: List[int]


class BatchPractitionerStatusItemResponse(BaseModel):
    """Response model for a single practitioner's status."""
    user_id: int
    has_appointment_types: bool
    has_availability: bool
    appointment_types_count: int


class BatchPractitionerStatusResponse(BaseModel):
    """Response model for batch practitioner status query."""
    results: List[BatchPractitionerStatusItemResponse]


# ===== API Endpoints =====

@router.get("/practitioners", summary="List all practitioners for current clinic")
async def list_practitioners(
    request: Request,
    appointment_type_id: Optional[int] = Query(None, description="Optional appointment type ID to filter practitioners"),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> PractitionerListResponse:
    """
    Get all practitioners for the current user's clinic.

    Optionally filter by appointment type to get only practitioners who offer that type.

    Returns basic information (id, full_name) for all practitioners (or filtered list).
    Available to all clinic members (including read-only users).
    """
    # Check clinic access first (raises HTTPException if denied)
    clinic_id = ensure_clinic_access(current_user)

    try:
        # Get practitioners using service
        practitioners_data = PractitionerService.list_practitioners_for_clinic(
            db=db,
            clinic_id=clinic_id,
            appointment_type_id=appointment_type_id  # Filter by appointment type if provided
        )

        # Build response
        practitioner_list = [
            PractitionerListItemResponse(
                id=p['id'],
                full_name=p['full_name'],
                offered_types=p.get('offered_types', []),
                patient_booking_allowed=p.get('patient_booking_allowed', True)
            )
            for p in practitioners_data
        ]

        response = PractitionerListResponse(practitioners=practitioner_list)
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting practitioners list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得治療師列表"
        )


@router.get("/practitioners/{user_id}/appointment-types", summary="Get practitioner's appointment types")
async def get_practitioner_appointment_types(
    user_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> PractitionerAppointmentTypesResponse:
    """
    Get all appointment types offered by a practitioner.

    Practitioners can view their own appointment types.
    Clinic admins can view any practitioner's appointment types.
    """
    # Check permissions - practitioners can only view their own, admins can view anyone's
    if not current_user.has_role('admin') and current_user.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="無權限查看其他治療師的設定"
        )

    try:
        clinic_id = ensure_clinic_access(current_user)
        appointment_types = PractitionerService.get_practitioner_appointment_types(
            db=db,
            practitioner_id=user_id,
            clinic_id=clinic_id
        )

        return PractitionerAppointmentTypesResponse(
            practitioner_id=user_id,
            appointment_types=[
                AppointmentTypeResponse(
                    id=at.id,
                    clinic_id=at.clinic_id,
                    name=at.name,
                    duration_minutes=at.duration_minutes,
                    receipt_name=at.receipt_name,
                    allow_patient_booking=at.allow_patient_booking,
                    allow_new_patient_booking=at.allow_new_patient_booking,
                    allow_existing_patient_booking=at.allow_existing_patient_booking,
                    allow_patient_practitioner_selection=at.allow_patient_practitioner_selection,
                    allow_multiple_time_slot_selection=at.allow_multiple_time_slot_selection,
                    description=at.description,
                    scheduling_buffer_minutes=at.scheduling_buffer_minutes,
                    service_type_group_id=at.service_type_group_id,
                    display_order=at.display_order,
                    send_patient_confirmation=at.send_patient_confirmation,
                    send_clinic_confirmation=at.send_clinic_confirmation,
                    send_reminder=at.send_reminder,
                    send_recurrent_clinic_confirmation=at.send_recurrent_clinic_confirmation,
                    patient_confirmation_message=at.patient_confirmation_message,
                    clinic_confirmation_message=at.clinic_confirmation_message,
                    reminder_message=at.reminder_message,
                    recurrent_clinic_confirmation_message=at.recurrent_clinic_confirmation_message,
                    require_notes=at.require_notes,
                    notes_instructions=at.notes_instructions
                ) for at in appointment_types
            ]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get practitioner appointment types for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="獲取治療師預約類型失敗"
        )


@router.put("/practitioners/{user_id}/appointment-types", summary="Update practitioner's appointment types")
async def update_practitioner_appointment_types(
    user_id: int,
    request: PractitionerAppointmentTypesUpdateRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    """
    Update the appointment types offered by a practitioner.

    Practitioners can only update their own appointment types.
    Clinic admins can update any practitioner's appointment types.
    """
    # Check permissions - practitioners can only update their own, admins can update anyone's
    if not current_user.has_role('admin') and current_user.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="無權限修改其他治療師的設定"
        )

    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Validate that the practitioner exists and belongs to the same clinic
        practitioner = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="治療師不存在"
            )

        # Validate that all appointment type IDs exist and belong to the clinic
        for type_id in request.appointment_type_ids:
            try:
                AppointmentTypeService.get_appointment_type_by_id(
                    db, type_id, clinic_id=clinic_id
                )
            except HTTPException:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"預約類型 ID {type_id} 不存在或不屬於此診所"
                )

        # Update the practitioner's appointment types
        success = PractitionerService.update_practitioner_appointment_types(
            db=db,
            practitioner_id=user_id,
            appointment_type_ids=request.appointment_type_ids,
            clinic_id=clinic_id
        )

        if success:
            return {"success": True, "message": "治療師預約類型已更新"}
        else:
            raise HTTPException(
                status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="更新治療師預約類型失敗"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update practitioner appointment types for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新治療師預約類型失敗"
        )


@router.put("/practitioners/{user_id}/settings", summary="Update practitioner settings")
async def update_practitioner_settings(
    user_id: int,
    request: PractitionerSettingsUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Update practitioner settings (admin only).
    
    Only clinic admins can update practitioner settings.
    This includes settings like patient_booking_allowed.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get the practitioner's association
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="治療師不存在"
            )

        # Validate and update settings
        from models.user_clinic_association import PractitionerSettings
        
        try:
            # Get current settings and merge with new settings
            current_settings = association.get_validated_settings()
            # Merge: update only provided fields, keep existing values for others
            merged_settings_dict = current_settings.model_dump()
            merged_settings_dict.update(request.settings)
            # Validate merged settings
            validated_settings = PractitionerSettings.model_validate(merged_settings_dict)
            association.set_validated_settings(validated_settings)
            association.updated_at = taiwan_now()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"無效的設定格式: {str(e)}"
            )

        db.commit()
        return {"success": True, "message": "治療師設定已更新"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update practitioner settings for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新治療師設定失敗"
        )


@router.get("/practitioners/{user_id}/status", summary="Get practitioner's configuration status")
async def get_practitioner_status(
    user_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> PractitionerStatusResponse:
    """
    Get practitioner's configuration status for warnings.

    This endpoint checks if a practitioner has configured appointment types
    and availability settings, used for displaying warnings to admins.
    """
    clinic_id = ensure_clinic_access(current_user)
    
    # Check permissions - clinic members can view practitioner status
    # Verify practitioner is in the active clinic
    practitioner = db.query(User).join(UserClinicAssociation).filter(
        User.id == user_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).first()
    
    if not practitioner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="無權限查看此治療師的狀態"
        )

    try:

        # Check if practitioner has appointment types configured for this clinic
        appointment_types_count = count_active_appointment_types_for_practitioner(db, user_id, clinic_id)

        # Check if practitioner has availability configured
        availability_count = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id
        ).count()

        return PractitionerStatusResponse(
            has_appointment_types=appointment_types_count > 0,
            has_availability=availability_count > 0,
            appointment_types_count=appointment_types_count
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get practitioner status for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="獲取治療師狀態失敗"
        )


@router.post("/practitioners/status/batch", summary="Get practitioner status for multiple practitioners")
async def get_batch_practitioner_status(
    request: BatchPractitionerStatusRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> BatchPractitionerStatusResponse:
    """
    Get configuration status for multiple practitioners in a single request.

    This endpoint efficiently fetches status for multiple practitioners,
    reducing API calls from N to 1. Used for displaying warnings to admins.

    Args:
        request: Batch request with list of practitioner IDs

    Returns:
        BatchPractitionerStatusResponse with status for each practitioner

    Raises:
        HTTPException: If validation fails or practitioners don't exist
    """
    clinic_id = ensure_clinic_access(current_user)
    
    # Limit number of practitioners to prevent excessive queries
    max_practitioners = 50
    if len(request.practitioner_ids) > max_practitioners:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"一次最多只能查詢 {max_practitioners} 個治療師"
        )
    
    # Verify all practitioners exist and belong to the clinic
    practitioners = db.query(User).join(UserClinicAssociation).filter(
        User.id.in_(request.practitioner_ids),
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).all()
    
    if len(practitioners) != len(request.practitioner_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="部分治療師不存在或不在您的診所"
        )
    
    practitioner_ids = [p.id for p in practitioners]
    
    try:
        from models import PractitionerAppointmentTypes
        
        # Batch query: Get appointment type counts for all practitioners at once
        # Group by practitioner_id and count distinct appointment_type_id
        appointment_type_counts = db.query(
            PractitionerAppointmentTypes.user_id,
            func.count(PractitionerAppointmentTypes.appointment_type_id).label('count')
        ).join(
            AppointmentType,
            PractitionerAppointmentTypes.appointment_type_id == AppointmentType.id
        ).filter(
            PractitionerAppointmentTypes.user_id.in_(practitioner_ids),
            PractitionerAppointmentTypes.clinic_id == clinic_id,
            PractitionerAppointmentTypes.is_deleted == False,
            AppointmentType.is_deleted == False
        ).group_by(PractitionerAppointmentTypes.user_id).all()
        
        # Convert to dict for easy lookup
        appointment_type_count_map = {user_id: count for user_id, count in appointment_type_counts}
        
        # Batch query: Get availability counts for all practitioners at once
        availability_counts = db.query(
            PractitionerAvailability.user_id,
            func.count(PractitionerAvailability.id).label('count')
        ).filter(
            PractitionerAvailability.user_id.in_(practitioner_ids),
            PractitionerAvailability.clinic_id == clinic_id
        ).group_by(PractitionerAvailability.user_id).all()
        
        # Convert to dict for easy lookup
        availability_count_map = {user_id: count for user_id, count in availability_counts}
        
        # Build response for each practitioner
        results: List[BatchPractitionerStatusItemResponse] = []
        for practitioner_id in practitioner_ids:
            appointment_types_count = appointment_type_count_map.get(practitioner_id, 0)
            availability_count = availability_count_map.get(practitioner_id, 0)
            
            results.append(BatchPractitionerStatusItemResponse(
                user_id=practitioner_id,
                has_appointment_types=appointment_types_count > 0,
                has_availability=availability_count > 0,
                appointment_types_count=appointment_types_count
            ))
        
        return BatchPractitionerStatusResponse(results=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Failed to get batch practitioner status: "
            f"practitioner_ids={request.practitioner_ids}, clinic_id={clinic_id}, error={e}"
        )
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="獲取治療師狀態失敗"
        )

