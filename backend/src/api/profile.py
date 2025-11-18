# pyright: reportMissingTypeStubs=false
"""
Profile management API endpoints.

Provides endpoints for users to view and update their own profile information.
Email cannot be changed as it's tied to the Google account used for signup.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)

from core.database import get_db
from auth.dependencies import get_current_user, UserContext, ensure_clinic_access
from models import User, PractitionerLinkCode, Clinic
from models.user_clinic_association import PractitionerSettings
from utils.datetime_utils import taiwan_now

router = APIRouter()


class ProfileResponse(BaseModel):
    """Response model for user profile information."""
    id: int
    email: str  # Read-only, cannot be changed
    full_name: str
    roles: list[str]  # Roles at active clinic (from UserClinicAssociation)
    active_clinic_id: Optional[int]  # Currently active clinic ID (None for system admins)
    created_at: datetime
    last_login_at: Optional[datetime]
    settings: Optional[Dict[str, Any]] = None  # Practitioner settings (only for practitioners)
    line_linked: bool = False  # Whether LINE account is linked for notifications


class ProfileUpdateRequest(BaseModel):
    """Request model for updating user profile."""
    full_name: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None  # Practitioner settings (only for practitioners)
    # Note: email is intentionally excluded - cannot be changed




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
        # Both system admins and clinic users now have User records
        # Use eager loading to fetch User and UserClinicAssociation in a single query
        user = db.query(User).options(
            joinedload(User.clinic_associations)
        ).filter(
            User.id == current_user.user_id
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到使用者"
            )

        # Get roles and active clinic from UserClinicAssociation
        # Find the association from eagerly loaded relationships (no additional query needed)
        roles: list[str] = []
        active_clinic_id: Optional[int] = None
        settings: Optional[Dict[str, Any]] = None

        if current_user.active_clinic_id:
            # Find association from eagerly loaded clinic_associations
            association = next(
                (a for a in user.clinic_associations
                 if a.clinic_id == current_user.active_clinic_id and a.is_active),
                None
            )
            if association:
                roles = association.roles or []
                active_clinic_id = association.clinic_id
                # Include settings if user is a practitioner
                if 'practitioner' in roles:
                    settings = association.get_validated_settings().model_dump()

        return ProfileResponse(
            id=user.id,
            email=user.email,
            full_name=current_user.name,  # Use clinic-specific name
            roles=roles,
            active_clinic_id=active_clinic_id,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            settings=settings,
            line_linked=bool(user.line_user_id)  # Check if LINE account is linked
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting profile: {e}")
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
        # Both system admins and clinic users now have User records
        # Use eager loading to fetch User and UserClinicAssociation in a single query
        user = db.query(User).options(
            joinedload(User.clinic_associations)
        ).filter(
            User.id == current_user.user_id
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到使用者"
            )

        # Update allowed fields only
        # Note: full_name is clinic-specific, stored in UserClinicAssociation
        # Find association from eagerly loaded relationships (no additional query needed)
        association = None
        if current_user.active_clinic_id:
            association = next(
                (a for a in user.clinic_associations
                 if a.clinic_id == current_user.active_clinic_id and a.is_active),
                None
            )

            if not association:
                # Clinic users must have an association - this shouldn't happen
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="找不到診所關聯"
                )

            # Update full_name if provided
            if profile_data.full_name is not None:
                association.full_name = profile_data.full_name
                association.updated_at = taiwan_now()

            # Update settings if provided (only for practitioners)
            if profile_data.settings is not None:
                if 'practitioner' not in (association.roles or []):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="只有治療師可以更新設定"
                    )
                try:
                    # Validate settings schema
                    validated_settings = PractitionerSettings.model_validate(profile_data.settings)
                    association.set_validated_settings(validated_settings)
                    association.updated_at = taiwan_now()
                except Exception as e:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"無效的設定格式: {str(e)}"
                    )
        elif current_user.is_system_admin():
            # System admins don't have associations - name is not used
            if profile_data.full_name is not None or profile_data.settings is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="系統管理員無法更新這些設定"
                )

        # Update timestamp (Taiwan timezone)
        user.updated_at = taiwan_now()

        db.commit()
        db.refresh(user)

        # Refresh association if it was updated
        if association:
            db.refresh(association)

        # Get roles and active clinic from UserClinicAssociation
        roles: list[str] = []
        active_clinic_id: Optional[int] = None
        clinic_full_name = user.email  # Default to email (for system admins)
        settings: Optional[Dict[str, Any]] = None

        if current_user.active_clinic_id:
            # Use association from eagerly loaded relationships (already loaded above)
            # No need for additional query

            if association:
                roles = association.roles or []
                active_clinic_id = association.clinic_id
                clinic_full_name = association.full_name  # Clinic users always have association.full_name
                # Include settings if user is a practitioner
                if 'practitioner' in roles:
                    settings = association.get_validated_settings().model_dump()
            else:
                # Clinic users must have an association
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="找不到診所關聯"
                )

        return ProfileResponse(
            id=user.id,
            email=user.email,  # Email cannot be changed
            full_name=clinic_full_name,  # Use updated clinic-specific name
            roles=roles,
            active_clinic_id=active_clinic_id,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            settings=settings,
            line_linked=bool(user.line_user_id)  # Check if LINE account is linked
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating profile: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新個人資料"
        )


class LinkCodeResponse(BaseModel):
    """Response model for link code generation."""
    code: str  # Full code including "LINK-" prefix (e.g., "LINK-12345")
    expires_at: datetime


@router.post("/profile/link-code", summary="Generate LINE linking code")
async def generate_link_code(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> LinkCodeResponse:
    """
    Generate a one-time code for linking practitioner's LINE account.

    Practitioner sends this code to the clinic's LINE Official Account
    to link their LINE user ID to their User account.
    Code expires in 10 minutes.

    Only available to clinic users (not system admins).
    """
    try:
        # Ensure user has clinic access (not system admin)
        # ensure_clinic_access raises HTTPException (403) for system admins
        clinic_id = ensure_clinic_access(current_user)

        # Get user and clinic
        user = db.query(User).filter(User.id == current_user.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到使用者"
            )

        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        # Revoke any existing active codes for this user
        now = datetime.now(timezone.utc)
        existing_codes = db.query(PractitionerLinkCode).filter(
            PractitionerLinkCode.user_id == user.id,
            PractitionerLinkCode.clinic_id == clinic_id,
            PractitionerLinkCode.used_at == None,
            PractitionerLinkCode.expires_at > now
        ).all()

        for code in existing_codes:
            code.used_at = now  # Mark as used (effectively revoking)

        # Generate new code (5-digit number)
        code_number = secrets.randbelow(100000)  # 0-99999
        code_string = f"LINK-{code_number:05d}"  # Format as LINK-00000 to LINK-99999

        # Ensure uniqueness (very unlikely collision, but check anyway)
        max_attempts = 10
        for _ in range(max_attempts):
            existing = db.query(PractitionerLinkCode).filter(
                PractitionerLinkCode.code == code_string
            ).first()
            if not existing:
                break
            code_number = secrets.randbelow(100000)
            code_string = f"LINK-{code_number:05d}"
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="無法產生唯一的連結代碼"
            )

        # Create link code (expires in 10 minutes)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

        link_code = PractitionerLinkCode(
            code=code_string,
            user_id=user.id,
            clinic_id=clinic_id,
            expires_at=expires_at
        )
        db.add(link_code)
        db.commit()
        db.refresh(link_code)

        return LinkCodeResponse(
            code=code_string,
            expires_at=expires_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating link code: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生連結代碼"
        )


@router.delete("/profile/unlink-line", summary="Unlink LINE account")
async def unlink_line_account(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Unlink practitioner's LINE account.

    Removes the LINE user ID from the user's account, so they will
    no longer receive appointment notifications via LINE.

    Only available to clinic users (not system admins).
    """
    try:
        # Ensure user has clinic access (not system admin)
        # ensure_clinic_access raises HTTPException (403) for system admins
        ensure_clinic_access(current_user)

        # Get user
        user = db.query(User).filter(User.id == current_user.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到使用者"
            )

        # Unlink LINE account
        user.line_user_id = None
        db.commit()

        return {"message": "LINE 帳號已取消連結"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error unlinking LINE account: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取消連結 LINE 帳號"
        )


