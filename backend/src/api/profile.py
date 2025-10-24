"""
Profile management API endpoints.

Provides endpoints for users to view and update their own profile information.
Email cannot be changed as it's tied to the Google account used for signup.
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from core.database import get_db
from auth.dependencies import get_current_user, UserContext
from models import User

router = APIRouter()


class ProfileResponse(BaseModel):
    """Response model for user profile information."""
    id: int
    email: str  # Read-only, cannot be changed
    full_name: str
    roles: list[str]
    gcal_sync_enabled: bool
    clinic_id: int
    created_at: datetime
    last_login_at: Optional[datetime]


class ProfileUpdateRequest(BaseModel):
    """Request model for updating user profile."""
    full_name: Optional[str] = None
    # Note: email is intentionally excluded - cannot be changed


class CalendarSettingsResponse(BaseModel):
    """Response model for calendar settings."""
    gcal_sync_enabled: bool
    gcal_watch_resource_id: Optional[str]


class CalendarSettingsUpdateRequest(BaseModel):
    """Request model for updating calendar settings."""
    gcal_sync_enabled: Optional[bool] = None


@router.get("/profile", summary="Get current user's profile")
async def get_profile(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> ProfileResponse:
    """
    Get current user's profile information.
    
    Available to all authenticated users (system admins and clinic users).
    """
    try:
        # For system admins, return basic info
        if current_user.is_system_admin():
            return ProfileResponse(
                id=0,  # System admins don't have database IDs
                email=current_user.email,
                full_name=current_user.name,
                roles=[],  # System admins don't have clinic roles
                gcal_sync_enabled=False,
                clinic_id=0,  # System admins don't belong to clinics
                created_at=datetime.now(),
                last_login_at=None
            )
        
        # For clinic users, get from database
        user = db.query(User).filter(
            User.id == current_user.user_id,
            User.is_active == True
        ).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        return ProfileResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            roles=user.roles,
            gcal_sync_enabled=user.gcal_sync_enabled,
            clinic_id=user.clinic_id,
            created_at=user.created_at,
            last_login_at=user.last_login_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting profile: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得個人資料"
        )


@router.put("/profile", summary="Update current user's profile")
async def update_profile(
    profile_data: ProfileUpdateRequest,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> ProfileResponse:
    """
    Update current user's profile information.
    
    Email cannot be changed as it's tied to the Google account used for signup.
    Only full_name can be updated.
    
    Available to all authenticated users.
    """
    try:
        # System admins cannot update profile (no database record)
        if current_user.is_system_admin():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System admins cannot update profile information"
            )
        
        # Find user
        user = db.query(User).filter(
            User.id == current_user.user_id,
            User.is_active == True
        ).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Update allowed fields only
        if profile_data.full_name is not None:
            user.full_name = profile_data.full_name
        
        # Update timestamp
        user.updated_at = datetime.now()
        
        db.commit()
        db.refresh(user)
        
        return ProfileResponse(
            id=user.id,
            email=user.email,  # Email cannot be changed
            full_name=user.full_name,
            roles=user.roles,
            gcal_sync_enabled=user.gcal_sync_enabled,
            clinic_id=user.clinic_id,
            created_at=user.created_at,
            last_login_at=user.last_login_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating profile: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新個人資料"
        )


@router.get("/profile/calendar", summary="Get current user's calendar settings")
async def get_calendar_settings(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> CalendarSettingsResponse:
    """
    Get current user's Google Calendar settings.
    
    Available to clinic users only (system admins don't have calendar integration).
    """
    try:
        # System admins don't have calendar settings
        if current_user.is_system_admin():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System admins do not have calendar settings"
            )
        
        # Find user
        user = db.query(User).filter(
            User.id == current_user.user_id,
            User.is_active == True
        ).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        return CalendarSettingsResponse(
            gcal_sync_enabled=user.gcal_sync_enabled,
            gcal_watch_resource_id=user.gcal_watch_resource_id
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting calendar settings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得行事曆設定"
        )


@router.put("/profile/calendar", summary="Update current user's calendar settings")
async def update_calendar_settings(
    calendar_data: CalendarSettingsUpdateRequest,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> CalendarSettingsResponse:
    """
    Update current user's Google Calendar settings.
    
    Available to clinic users only.
    Note: This only updates the sync enabled flag. 
    Actual calendar connection is handled through OAuth endpoints.
    """
    try:
        # System admins don't have calendar settings
        if current_user.is_system_admin():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System admins do not have calendar settings"
            )
        
        # Find user
        user = db.query(User).filter(
            User.id == current_user.user_id,
            User.is_active == True
        ).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Update allowed fields
        if calendar_data.gcal_sync_enabled is not None:
            user.gcal_sync_enabled = calendar_data.gcal_sync_enabled
        
        # Update timestamp
        user.updated_at = datetime.now()
        
        db.commit()
        db.refresh(user)
        
        return CalendarSettingsResponse(
            gcal_sync_enabled=user.gcal_sync_enabled,
            gcal_watch_resource_id=user.gcal_watch_resource_id
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating calendar settings: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新行事曆設定"
        )
