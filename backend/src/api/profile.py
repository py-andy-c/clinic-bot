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
from pydantic import BaseModel, field_validator
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
    title: str = ""  # Title/honorific (e.g., "治療師") - used in external displays
    roles: list[str]  # Roles at active clinic (from UserClinicAssociation)
    active_clinic_id: Optional[int]  # Currently active clinic ID (None for system admins)
    created_at: datetime
    last_login_at: Optional[datetime]
    settings: Optional[Dict[str, Any]] = None  # Practitioner/admin settings (for practitioners and admins)
    line_linked: bool = False  # Whether LINE account is linked for notifications


class ProfileUpdateRequest(BaseModel):
    """Request model for updating user profile."""
    full_name: Optional[str] = None
    title: Optional[str] = None  # Title/honorific (e.g., "治療師") - max 50 characters
    settings: Optional[Dict[str, Any]] = None  # Practitioner/admin settings (for practitioners and admins)
    # Note: email is intentionally excluded - cannot be changed
    
    @field_validator('title')
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        """Validate title length and content."""
        if v is None:
            return v
        # Strip whitespace and validate length
        v = v.strip() if v else ""
        if len(v) > 50:
            raise ValueError("稱謂長度不能超過 50 個字元")
        return v




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

        line_linked = False
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
                # Include settings if user is a practitioner or admin (admins need settings for admin-only fields)
                if 'practitioner' in roles or 'admin' in roles:
                    settings = association.get_validated_settings().model_dump()
                # Check if LINE account is linked for this clinic
                line_linked = bool(association.line_user_id)

        # Get title from association if available
        title = ""
        if current_user.active_clinic_id:
            association = next(
                (a for a in user.clinic_associations
                 if a.clinic_id == current_user.active_clinic_id and a.is_active),
                None
            )
            if association:
                title = association.title or ""

        return ProfileResponse(
            id=user.id,
            email=user.email,
            full_name=current_user.name,  # Use clinic-specific name
            title=title,
            roles=roles,
            active_clinic_id=active_clinic_id,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            settings=settings,
            line_linked=line_linked  # Check if LINE account is linked for this clinic
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

            # Update title if provided
            if profile_data.title is not None:
                association.title = profile_data.title
                association.updated_at = taiwan_now()

            # Update settings if provided (for practitioners and admins)
            if profile_data.settings is not None:
                # Allow both practitioners and admins to update settings
                # Practitioners can update compact_schedule_enabled and next_day_notification_time
                # Admins can update auto_assigned_notification_time
                if not (association.roles or []):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="使用者必須有角色才能更新設定"
                    )
                try:
                    # Validate settings schema
                    validated_settings = PractitionerSettings.model_validate(profile_data.settings)
                    
                    # Backend validation: Check if user has admin role before allowing admin-only fields
                    is_admin = 'admin' in (association.roles or [])
                    admin_only_fields = [
                        'subscribe_to_appointment_changes',
                        'admin_daily_reminder_enabled',
                        'admin_daily_reminder_time',
                        'auto_assigned_notification_mode'
                    ]
                    
                    # Check if non-admin is trying to set admin-only fields
                    settings_dict = profile_data.settings
                    for field in admin_only_fields:
                        if field in settings_dict and settings_dict[field] is not None:
                            # Check if value is different from default (indicates user is trying to set it)
                            default_value = PractitionerSettings.model_fields[field].default
                            if settings_dict[field] != default_value:
                                if not is_admin:
                                    raise ValueError(f"只有管理員可以設定 {field}")
                    
                    # Ensure practitioner step size is not smaller than clinic default
                    if validated_settings.step_size_minutes is not None:
                        # Fetch clinic settings
                        clinic = db.query(Clinic).filter(Clinic.id == current_user.active_clinic_id).first()
                        if clinic:
                            clinic_step = clinic.get_validated_settings().booking_restriction_settings.step_size_minutes
                            if validated_settings.step_size_minutes < clinic_step:
                                raise ValueError(f"個人預約起始時間間隔不能小於診所預設值 ({clinic_step} 分鐘)")

                    association.set_validated_settings(validated_settings)
                    association.updated_at = taiwan_now()
                except Exception as e:
                    detail = str(e)
                    if "Validator" in detail or "value_error" in detail:
                        # Clean up Pydantic error messages if possible or use generic one
                        detail = "無效的設定格式" if not str(e).startswith("個人") and not str(e).startswith("只有管理員") else str(e)
                        
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=detail
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
        line_linked = False

        if current_user.active_clinic_id:
            # Use association from eagerly loaded relationships (already loaded above)
            # No need for additional query

            if association:
                roles = association.roles or []
                active_clinic_id = association.clinic_id
                clinic_full_name = association.full_name  # Clinic users always have association.full_name
                clinic_title = association.title or ""  # Get title from association
                # Include settings if user is a practitioner or admin (admins need settings for admin-only fields)
                if 'practitioner' in roles or 'admin' in roles:
                    settings = association.get_validated_settings().model_dump()
                # Check if LINE account is linked for this clinic
                line_linked = bool(association.line_user_id)
            else:
                # Clinic users must have an association
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="找不到診所關聯"
                )
        else:
            clinic_title = ""  # System admins don't have title

        return ProfileResponse(
            id=user.id,
            email=user.email,  # Email cannot be changed
            full_name=clinic_full_name,  # Use updated clinic-specific name
            title=clinic_title,
            roles=roles,
            active_clinic_id=active_clinic_id,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            settings=settings,
            line_linked=line_linked  # Check if LINE account is linked for this clinic
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
        clinic_id = ensure_clinic_access(current_user)

        # Get user with association
        user = db.query(User).options(
            joinedload(User.clinic_associations)
        ).filter(User.id == current_user.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到使用者"
            )

        # Find association for this clinic
        association = next(
            (a for a in user.clinic_associations
             if a.clinic_id == clinic_id and a.is_active),
            None
        )
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所關聯"
            )

        # Unlink LINE account for this clinic
        association.line_user_id = None
        association.updated_at = taiwan_now()
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


