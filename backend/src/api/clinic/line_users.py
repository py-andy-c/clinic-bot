# pyright: reportMissingTypeStubs=false
"""
LINE User Management API endpoints.
"""

import logging
import math
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi import status as http_status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from models import LineUser, Patient
from services.line_user_ai_disabled_service import (
    disable_ai_for_line_user,
    enable_ai_for_line_user,
    get_line_users_for_clinic
)

logger = logging.getLogger(__name__)

router = APIRouter()


class PatientInfo(BaseModel):
    """Patient information with ID and name."""
    id: int
    name: str


class LineUserWithStatusResponse(BaseModel):
    """Response model for LineUser with AI status."""
    line_user_id: str
    display_name: Optional[str]
    patient_count: int
    patient_names: List[str]
    patient_info: List[PatientInfo]  # List of patient info with id and name
    ai_disabled: bool
    disabled_at: Optional[datetime]
    picture_url: Optional[str] = None


class LineUserListResponse(BaseModel):
    """Response model for list of LineUsers with AI status."""
    line_users: List[LineUserWithStatusResponse]
    total: int
    page: int
    page_size: int


class DisableAiRequest(BaseModel):
    """Request model for disabling AI."""
    reason: Optional[str] = None


class UpdateLineUserDisplayNameRequest(BaseModel):
    """Request model for updating LINE user clinic display name."""
    clinic_display_name: Optional[str] = Field(None, max_length=255, description="Clinic display name (clinic internal only). Set to null to clear.")


@router.get("/line-users", summary="List all LINE users for clinic with AI status", response_model=LineUserListResponse)
async def get_line_users(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    page: Optional[int] = Query(None, ge=1, description="Page number (1-indexed). Must be provided with page_size. Takes precedence over offset/limit."),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Items per page. Must be provided with page. Takes precedence over offset/limit."),
    offset: Optional[int] = Query(None, ge=0, description="Offset for pagination (deprecated, use page/page_size instead). Must be provided with limit."),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Limit for pagination (deprecated, use page/page_size instead). Must be provided with offset."),
    search: Optional[str] = Query(None, max_length=200, description="Search query to filter LINE users by display_name or patient names. Maximum length: 200 characters.")
) -> LineUserListResponse:
    """
    Get all LINE users who have patients or messages in this clinic, with AI status.
    
    Any authenticated clinic user can access this endpoint.
    Returns LINE users with their patient count, patient names, and AI disable status.
    Includes users who have sent messages but haven't created patients yet.
    Supports pagination via page and page_size parameters (preferred) or offset/limit (deprecated).
    Supports search via search parameter to filter by LINE user display_name or patient names.
    If pagination parameters are not provided, returns all line users (backward compatible).
    Note: page and page_size must both be provided together, or offset and limit together, or all omitted.
    """
    try:
        # Validate pagination parameters
        has_page_params = (page is not None) or (page_size is not None)
        has_offset_params = (offset is not None) or (limit is not None)
        
        if has_page_params and has_offset_params:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不支援同時使用 page/page_size 和 offset/limit。請使用 page/page_size（建議項目）或 offset/limit（舊版項目）。"
            )
        
        if has_page_params and ((page is None) != (page_size is None)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="必須同時提供 page 和 page_size"
            )
        
        if has_offset_params and ((offset is None) != (limit is None)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="必須同時提供 offset 和 limit"
            )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Get line users with status
        line_users, total = get_line_users_for_clinic(
            db=db,
            clinic_id=clinic_id,
            page=page,
            page_size=page_size,
            offset=offset,
            limit=limit,
            search=search
        )
        
        # Validate page number doesn't exceed total pages
        if page is not None and page_size is not None and total > 0:
            max_page = math.ceil(total / page_size)
            if page > max_page:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Page {page} exceeds maximum page {max_page}"
                )
        elif offset is not None and limit is not None and total > 0:
            max_page = math.ceil(total / limit)
            calculated_page = (offset // limit) + 1 if limit > 0 else 1
            if calculated_page > max_page:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Offset {offset} with limit {limit} results in page {calculated_page} which exceeds maximum page {max_page}"
                )
        
        # Format response
        line_user_responses = [
            LineUserWithStatusResponse(
                line_user_id=lu.line_user_id,
                display_name=lu.display_name,
                patient_count=lu.patient_count,
                patient_names=lu.patient_names,
                patient_info=[PatientInfo(id=pi['id'], name=pi['name']) for pi in lu.patient_info],
                ai_disabled=lu.ai_disabled,
                disabled_at=lu.disabled_at,
                picture_url=lu.picture_url
            )
            for lu in line_users
        ]
        
        # If pagination is used, return pagination info; otherwise use defaults
        if page is not None and page_size is not None:
            return LineUserListResponse(
                line_users=line_user_responses,
                total=total,
                page=page,
                page_size=page_size
            )
        elif offset is not None and limit is not None:
            # Backward compatibility for offset/limit
            # Calculate page number: page = (offset / limit) + 1, rounded up
            calculated_page = (offset // limit) + 1 if limit > 0 else 1
            return LineUserListResponse(
                line_users=line_user_responses,
                total=total,
                page=calculated_page,
                page_size=limit
            )
        else:
            # Backward compatibility: return all results with total count
            # Use total as page_size when total > 0, otherwise use a default
            return LineUserListResponse(
                line_users=line_user_responses,
                total=total,
                page=1,
                page_size=total if total > 0 else 50
            )
        
    except Exception as e:
        logger.exception(f"Error getting LINE users list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得LINE使用者列表"
        )


@router.post("/line-users/{line_user_id}/disable-ai", summary="Disable AI for a LINE user")
async def disable_ai_for_line_user_endpoint(
    line_user_id: str,
    request: DisableAiRequest = DisableAiRequest(),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Permanently disable AI auto response for a LINE user.
    
    Any authenticated clinic user can disable AI. The setting persists until manually changed.
    This is different from the temporary opt-out system which expires after 24 hours.
    
    Args:
        line_user_id: LINE user ID string (from LINE platform)
        request: Optional reason for audit trail
    """
    try:
        # Validate line_user_id format (basic check - should be non-empty string)
        if not line_user_id or not line_user_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的LINE使用者ID"
            )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Disable AI (service will raise ValueError if LineUser doesn't exist)
        try:
            disable_ai_for_line_user(
                db=db,
                line_user_id=line_user_id,
                clinic_id=clinic_id,
                disabled_by_user_id=current_user.user_id,
                reason=request.reason
            )
        except ValueError as e:
            # LineUser doesn't exist for this clinic
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此LINE使用者"
            ) from e
        
        logger.info(
            f"AI disabled for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}, disabled_by_user_id={current_user.user_id}"
        )
        
        return {"status": "ok", "message": "AI已停用"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error disabling AI for line_user_id={line_user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法停用AI"
        )


@router.post("/line-users/{line_user_id}/enable-ai", summary="Enable AI for a LINE user")
async def enable_ai_for_line_user_endpoint(
    line_user_id: str,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Re-enable AI auto response for a LINE user.
    
    Any authenticated clinic user can enable AI. This removes the permanent disable setting.
    
    Args:
        line_user_id: LINE user ID string (from LINE platform)
    """
    try:
        # Validate line_user_id format (basic check - should be non-empty string)
        if not line_user_id or not line_user_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的LINE使用者ID"
            )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Enable AI (clears disable fields on LineUser)
        # Returns None if LineUser doesn't exist
        result = enable_ai_for_line_user(
            db=db,
            line_user_id=line_user_id,
            clinic_id=clinic_id
        )
        
        if result is None:
            # LineUser doesn't exist for this clinic
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此LINE使用者"
            )
        
        logger.info(
            f"AI enabled for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}, enabled_by_user_id={current_user.user_id}"
        )
        
        return {"status": "ok", "message": "AI已啟用"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error enabling AI for line_user_id={line_user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法啟用AI"
        )


@router.put("/line-users/{line_user_id}/display-name", summary="Update LINE user clinic display name", response_model=LineUserWithStatusResponse)
async def update_line_user_display_name(
    line_user_id: str,
    request: UpdateLineUserDisplayNameRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> LineUserWithStatusResponse:
    """
    Update the clinic display name for a LINE user (clinic internal only).
    
    Any authenticated clinic user can update the display name. This allows clinics
    to customize how they see LINE users internally. If clinic_display_name is set,
    it will be shown everywhere instead of the original display_name. Set to null
    to clear and fall back to the original display_name.
    
    Args:
        line_user_id: LINE user ID string (from LINE platform)
        request: New clinic display name (or null to clear)
    """
    try:
        # Validate line_user_id format
        if not line_user_id or not line_user_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的LINE使用者ID"
            )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Get LineUser for this clinic
        line_user = db.query(LineUser).filter(
            LineUser.line_user_id == line_user_id,
            LineUser.clinic_id == clinic_id
        ).first()
        
        if not line_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此LINE使用者"
            )
        
        # Update clinic_display_name
        # Allow empty string to clear (normalize to None)
        new_display_name = request.clinic_display_name.strip() if request.clinic_display_name else None
        if new_display_name == "":
            new_display_name = None
        
        line_user.clinic_display_name = new_display_name
        db.commit()
        db.refresh(line_user)
        
        logger.info(
            f"Updated clinic_display_name for line_user_id={line_user_id}, "
            f"clinic_id={clinic_id}, new_name={new_display_name}"
        )
        
        # Get patient count and names for response
        patients = db.query(Patient).filter(
            Patient.line_user_id == line_user.id,
            Patient.clinic_id == clinic_id,
            Patient.is_deleted == False
        ).all()
        
        # Build patient_info list (filter out None names)
        patient_info_list = [
            PatientInfo(id=p.id, name=p.full_name)
            for p in patients
            if p.full_name
        ]
        # Sort by ID for consistency
        patient_info_list.sort(key=lambda x: x.id)
        
        return LineUserWithStatusResponse(
            line_user_id=line_user.line_user_id,
            display_name=line_user.effective_display_name,  # This is the effective display name
            patient_count=len(patients),
            patient_names=sorted(list(set([p.full_name for p in patients if p.full_name]))),
            patient_info=patient_info_list,
            ai_disabled=line_user.ai_disabled,
            disabled_at=line_user.ai_disabled_at,
            picture_url=line_user.picture_url
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating display name for line_user_id={line_user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新顯示名稱"
        )

