# pyright: reportMissingTypeStubs=false
"""
Clinic management API endpoints.

Provides clinic-specific operations for admins and practitioners,
including member management, settings, patients, and appointments.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from core.database import get_db
from core.config import FRONTEND_URL
from auth.dependencies import require_admin_role, require_clinic_member, require_practitioner_or_admin, UserContext
from models import User, SignupToken, Clinic, AppointmentType, PractitionerAvailability
from services import PatientService, AppointmentService
from services.google_oauth import GoogleOAuthService
from services.notification_service import NotificationService, CancellationSource
from api.responses import (
    ClinicPatientResponse, ClinicPatientListResponse,
    ClinicAppointmentResponse, ClinicAppointmentsResponse,
    AppointmentTypeResponse
)

router = APIRouter()


class MemberResponse(BaseModel):
    """Response model for team member information."""
    id: int
    email: str
    full_name: str
    roles: List[str]
    gcal_sync_enabled: bool
    is_active: bool
    created_at: datetime


class MemberInviteRequest(BaseModel):
    """Request model for inviting a new team member."""
    default_roles: List[str]  # e.g., ["practitioner"] or ["admin", "practitioner"]


class MemberInviteResponse(BaseModel):
    """Response model for member invitation."""
    signup_url: str
    expires_at: datetime
    token_id: int




class AppointmentTypeRequest(BaseModel):
    """Request model for appointment type."""
    name: str
    duration_minutes: int


class NotificationSettings(BaseModel):
    """Notification settings for clinic."""
    reminder_hours_before: int = 24


class SettingsResponse(BaseModel):
    """Response model for clinic settings."""
    clinic_id: int
    clinic_name: str
    business_hours: Dict[str, Dict[str, Any]]
    appointment_types: List[AppointmentTypeResponse]
    notification_settings: NotificationSettings


class PractitionerAvailabilityRequest(BaseModel):
    """Request model for practitioner availability."""
    day_of_week: int  # 0=Monday, 1=Tuesday, ..., 6=Sunday
    start_time: str  # HH:MM format
    end_time: str    # HH:MM format


class PractitionerAvailabilityResponse(BaseModel):
    """Response model for practitioner availability."""
    id: int
    user_id: int
    day_of_week: int
    day_name: str
    day_name_zh: str
    start_time: str
    end_time: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None




@router.get("/members", summary="List all clinic members")
async def list_members(
    current_user: UserContext = Depends(require_clinic_member),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get all members of the current user's clinic.
    
    For admins: Returns both active and inactive members.
    For other users: Returns only active members.
    
    Available to all clinic members (including read-only users).
    """
    try:
        # Admins can see both active and inactive members
        if current_user.has_role("admin"):
            members = db.query(User).filter(
                User.clinic_id == current_user.clinic_id
            ).all()
        else:
            # Non-admins only see active members
            members = db.query(User).filter(
                User.clinic_id == current_user.clinic_id,
                User.is_active == True
            ).all()

        member_list = [
            MemberResponse(
                id=member.id,
                email=member.email,
                full_name=member.full_name,
                roles=member.roles,
                gcal_sync_enabled=member.gcal_sync_enabled,
                is_active=member.is_active,
                created_at=member.created_at
            )
            for member in members
        ]

        return {"members": member_list}

    except Exception:
        logger.exception("Error getting members list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得成員列表"
        )


@router.post("/members/invite", summary="Invite a new team member")
async def invite_member(
    invite_data: MemberInviteRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> MemberInviteResponse:
    """
    Generate a secure signup link for inviting a new team member.

    Only clinic admins can invite members.
    Supports inviting users with no roles for read-only access.
    """
    try:
        # Validate roles - allow empty list for read-only access
        valid_roles = {"admin", "practitioner"}
        if invite_data.default_roles and not all(role in valid_roles for role in invite_data.default_roles):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="指定的角色無效"
            )

        # Generate secure token
        import secrets
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=48)  # 48 hours

        signup_token = SignupToken(
            token=token,
            clinic_id=current_user.clinic_id,
            default_roles=invite_data.default_roles,
            expires_at=expires_at
        )

        db.add(signup_token)
        db.commit()
        db.refresh(signup_token)

        signup_url = f"{FRONTEND_URL}/signup/member?token={token}"

        return MemberInviteResponse(
            signup_url=signup_url,
            expires_at=expires_at,
            token_id=signup_token.id
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error inviting member")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生邀請"
        )


@router.put("/members/{user_id}/roles", summary="Update member roles")
async def update_member_roles(
    user_id: int,
    roles_update: Dict[str, Any],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> MemberResponse:
    """
    Update roles for a team member.

    Only clinic admins can update member roles.
    """
    try:
        # Find member
        member = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員"
            )

        # Prevent self-demotion if user would lose admin access
        new_roles = roles_update.get("roles", [])
        if current_user.user_id == user_id and "admin" not in new_roles:
            # Check if this user is the last admin
            admin_users = db.query(User).filter(
                User.clinic_id == current_user.clinic_id,
                User.is_active == True,
                User.id != user_id
            ).all()

            admin_count = sum(1 for user in admin_users if 'admin' in user.roles)

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無法從最後一位管理員停用管理員權限"
                )

        # Validate roles
        valid_roles = {"admin", "practitioner"}
        if not all(role in valid_roles for role in new_roles):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="指定的角色無效"
            )

        # Update roles
        member.roles = new_roles
        db.commit()
        db.refresh(member)

        return MemberResponse(
            id=member.id,
            email=member.email,
            full_name=member.full_name,
            roles=member.roles,
            gcal_sync_enabled=member.gcal_sync_enabled,
            is_active=member.is_active,
            created_at=member.created_at
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error updating member roles")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新成員角色"
        )


@router.delete("/members/{user_id}", summary="Remove a team member")
async def remove_member(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Soft delete a team member by marking them as inactive.

    Only clinic admins can remove members.
    """
    try:
        # Find member
        member = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員"
            )

        # Prevent removing last admin
        if "admin" in member.roles:
            admin_users = db.query(User).filter(
                User.clinic_id == current_user.clinic_id,
                User.is_active == True,
                User.id != user_id
            ).all()

            admin_count = sum(1 for user in admin_users if 'admin' in user.roles)

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無法停用最後一位管理員"
                )

        # Soft delete
        member.is_active = False
        db.commit()

        return {"message": "成員已停用"}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error removing member")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法停用成員"
        )


@router.post("/members/{user_id}/reactivate", summary="Reactivate a team member")
async def reactivate_member(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Reactivate a previously removed team member.

    Only clinic admins can reactivate members.
    """
    try:
        # Find inactive member
        member = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == False
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到已停用的成員"
            )

        # Reactivate member
        member.is_active = True
        db.commit()

        return {"message": "成員已重新啟用"}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error reactivating member")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法重新啟用成員"
        )


@router.get("/settings", summary="Get clinic settings")
async def get_settings(
    current_user: UserContext = Depends(require_clinic_member),
    db: Session = Depends(get_db)
) -> SettingsResponse:
    """
    Get clinic settings including appointment types.

    Available to all clinic members (including read-only users).
    """
    try:
        from models import Clinic

        # Get clinic info
        clinic = db.query(Clinic).filter(Clinic.id == current_user.clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        appointment_types = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == current_user.clinic_id
        ).all()

        appointment_type_list = [
            AppointmentTypeResponse(
                id=at.id,
                clinic_id=at.clinic_id,
                name=at.name,
                duration_minutes=at.duration_minutes
            )
            for at in appointment_types
        ]

        # Default business hours
        business_hours = {
            "monday": {"start": "09:00", "end": "18:00", "enabled": True},
            "tuesday": {"start": "09:00", "end": "18:00", "enabled": True},
            "wednesday": {"start": "09:00", "end": "18:00", "enabled": True},
            "thursday": {"start": "09:00", "end": "18:00", "enabled": True},
            "friday": {"start": "09:00", "end": "18:00", "enabled": True},
            "saturday": {"start": "09:00", "end": "18:00", "enabled": False},
            "sunday": {"start": "09:00", "end": "18:00", "enabled": False},
        }

        return SettingsResponse(
            clinic_id=clinic.id,
            clinic_name=clinic.name,
            business_hours=business_hours,
            appointment_types=appointment_type_list,
           notification_settings=NotificationSettings(
               reminder_hours_before=clinic.reminder_hours_before
           )
        )

    except Exception:
        logger.exception("Error getting clinic settings")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得設定"
        )


@router.put("/settings", summary="Update clinic settings")
async def update_settings(
    settings: Dict[str, Any],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update clinic settings including appointment types.

    Only clinic admins can update settings.
    """
    try:
        # Update appointment types
        appointment_types_data = settings.get("appointment_types", [])

        # Delete existing appointment types
        db.query(AppointmentType).filter(
            AppointmentType.clinic_id == current_user.clinic_id
        ).delete()

        # Add new appointment types
        for at_data in appointment_types_data:
            if at_data.get("name") and at_data.get("duration_minutes"):
                appointment_type = AppointmentType(
                    clinic_id=current_user.clinic_id,
                    name=at_data["name"],
                    duration_minutes=at_data["duration_minutes"]
                )
                db.add(appointment_type)

        # Update notification settings
        notification_settings = settings.get("notification_settings", {})
        if notification_settings:
            clinic = db.query(Clinic).get(current_user.clinic_id)
            if clinic:
                clinic.reminder_hours_before = notification_settings.get("reminder_hours_before", clinic.reminder_hours_before)

        db.commit()

        return {"message": "設定更新成功"}

    except Exception:
        logger.exception("Error updating clinic settings")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新設定"
        )


@router.get("/patients", summary="List all patients", response_model=ClinicPatientListResponse)
async def get_patients(
    current_user: UserContext = Depends(require_clinic_member),
    db: Session = Depends(get_db)
) -> ClinicPatientListResponse:
    """
    Get all patients for the current user's clinic.

    Available to all clinic members (including read-only users).
    """
    try:
        # Get patients using service
        assert current_user.clinic_id is not None, "Clinic ID required for clinic members"
        patients = PatientService.list_patients_for_clinic(
            db=db,
            clinic_id=current_user.clinic_id
        )

        # Format for clinic response (includes line_user_id)
        patient_list = [
            ClinicPatientResponse(
                id=patient.id,
                full_name=patient.full_name,
                phone_number=patient.phone_number,
                line_user_id=patient.line_user.line_user_id if patient.line_user else None,
                created_at=patient.created_at
            )
            for patient in patients
        ]

        return ClinicPatientListResponse(patients=patient_list)

    except Exception:
        logger.exception("Error getting patients list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患列表"
        )


@router.get("/members/{user_id}/gcal/auth", summary="Initiate member Google Calendar OAuth")
async def initiate_member_gcal_oauth(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Initiate Google Calendar OAuth flow for a team member.

    Returns authorization URL for the member to authenticate with Google.
    """
    try:
        # Verify user exists and belongs to current clinic
        user = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到團隊成員"
            )

        # Check if user has practitioner role
        if not user.is_practitioner:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者必須具有治療師角色才能設定 Google 日曆"
            )

        # Generate OAuth URL
        oauth_service = GoogleOAuthService()
        assert current_user.clinic_id is not None  # Should always be set for clinic users
        auth_url = oauth_service.get_authorization_url(user_id, current_user.clinic_id)

        return {"auth_url": auth_url}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error initiating Google Calendar OAuth")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法啟動 Google 日曆 OAuth"
        )


@router.get("/members/gcal/callback", summary="Handle member calendar OAuth callback")
async def handle_member_gcal_callback(
    code: str = Query(..., description="Authorization code from Google"),
    state: str = Query(..., description="State parameter"),
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Handle Google Calendar OAuth callback for team member.

    Exchanges authorization code for tokens and stores encrypted credentials.
    """
    try:
        # Handle OAuth callback (user validation is done inside the service)
        oauth_service = GoogleOAuthService()
        updated_user = await oauth_service.handle_oauth_callback(db, code, state)

        # Verify the updated user belongs to current clinic (additional security check)
        if updated_user.clinic_id != current_user.clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="存取被拒絕：使用者不屬於您的診所"
            )

        # Update user's calendar sync settings
        updated_user.gcal_sync_enabled = True
        db.commit()

        return {
            "message": "Google 日曆整合啟用成功",
            "user_id": updated_user.id,
            "gcal_sync_enabled": True
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error completing Google Calendar OAuth")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法完成 Google 日曆 OAuth"
        )




@router.get("/practitioners/{user_id}/availability", summary="Get practitioner availability")
async def get_practitioner_availability(
    user_id: int,
    current_user: UserContext = Depends(require_clinic_member),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get availability hours for a specific practitioner.

    Both practitioners and admins can view availability.
    Practitioners can only view their own availability.
    Admins can view any practitioner's availability.
    """
    try:
        # Find the practitioner
        practitioner = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        # Check if user has practitioner role
        if not practitioner or 'practitioner' not in practitioner.roles:
            practitioner = None

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到治療師"
            )

        # Check permissions - practitioners can only view their own availability
        if not current_user.has_role('admin') and current_user.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="存取被拒絕：您只能查看自己的可用時間"
            )

        # Get availability
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id
        ).order_by(PractitionerAvailability.day_of_week).all()

        availability_list = [
            PractitionerAvailabilityResponse(
                id=avail.id,
                user_id=avail.user_id,
                day_of_week=avail.day_of_week,
                day_name=avail.day_name,
                day_name_zh=avail.day_name_zh,
                start_time=avail.start_time.strftime("%H:%M"),
                end_time=avail.end_time.strftime("%H:%M"),
                created_at=avail.created_at,
                updated_at=avail.updated_at
            )
            for avail in availability
        ]

        return {"availability": availability_list}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch practitioner availability for user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得治療師可用時間"
        )


@router.post("/practitioners/{user_id}/availability", summary="Create practitioner availability", status_code=status.HTTP_201_CREATED)
async def create_practitioner_availability(
    user_id: int,
    availability_data: PractitionerAvailabilityRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> PractitionerAvailabilityResponse:
    """
    Create availability hours for a practitioner.

    Both practitioners and admins can create availability.
    Practitioners can only create their own availability.
    Admins can create availability for any practitioner.
    """
    try:
        from datetime import time

        # Find the practitioner
        practitioner = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        # Check if user has practitioner role
        if not practitioner or 'practitioner' not in practitioner.roles:
            practitioner = None

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到治療師"
            )

        # Check permissions - practitioners can only modify their own availability
        if not current_user.has_role('admin') and current_user.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="存取被拒絕：您只能修改自己的可用時間"
            )

        # Check if availability already exists for this day
        existing = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.day_of_week == availability_data.day_of_week
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{existing.day_name} 的可用時間已存在"
            )

        # Validate time format and logic
        try:
            start_time = time.fromisoformat(availability_data.start_time)
            end_time = time.fromisoformat(availability_data.end_time)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的時間格式。請使用 HH:MM 格式"
            )

        if start_time >= end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="開始時間必須早於結束時間"
            )

        # Create availability
        availability = PractitionerAvailability(
            user_id=user_id,
            day_of_week=availability_data.day_of_week,
            start_time=start_time,
            end_time=end_time
        )

        db.add(availability)
        db.commit()
        db.refresh(availability)

        return PractitionerAvailabilityResponse(
            id=availability.id,
            user_id=availability.user_id,
            day_of_week=availability.day_of_week,
            day_name=availability.day_name,
            day_name_zh=availability.day_name_zh,
            start_time=availability.start_time.strftime("%H:%M"),
            end_time=availability.end_time.strftime("%H:%M"),
            created_at=availability.created_at,
            updated_at=availability.updated_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create practitioner availability for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立治療師可用時間"
        )


@router.put("/practitioners/{user_id}/availability/{availability_id}", summary="Update practitioner availability")
async def update_practitioner_availability(
    user_id: int,
    availability_id: int,
    availability_data: PractitionerAvailabilityRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> PractitionerAvailabilityResponse:
    """
    Update availability hours for a practitioner.

    Both practitioners and admins can update availability.
    Practitioners can only update their own availability.
    Admins can update availability for any practitioner.
    """
    try:
        from datetime import time

        # Find the availability
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.id == availability_id,
            PractitionerAvailability.user_id == user_id
        ).first()

        if not availability:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到可用時間"
            )

        # Verify the practitioner belongs to current clinic
        practitioner = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        # Check if user has practitioner role
        if not practitioner or 'practitioner' not in practitioner.roles:
            practitioner = None

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到治療師"
            )

        # Check permissions - practitioners can only modify their own availability
        if not current_user.has_role('admin') and current_user.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="存取被拒絕：您只能修改自己的可用時間"
            )

        # Check for conflicts if changing day_of_week
        if availability_data.day_of_week != availability.day_of_week:
            existing = db.query(PractitionerAvailability).filter(
                PractitionerAvailability.user_id == user_id,
                PractitionerAvailability.day_of_week == availability_data.day_of_week,
                PractitionerAvailability.id != availability_id
            ).first()

            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{existing.day_name} 的可用時間已存在"
                )

        # Validate time format and logic
        try:
            start_time = time.fromisoformat(availability_data.start_time)
            end_time = time.fromisoformat(availability_data.end_time)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的時間格式。請使用 HH:MM 格式"
            )

        if start_time >= end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="開始時間必須早於結束時間"
            )

        # Update availability
        availability.day_of_week = availability_data.day_of_week
        availability.start_time = start_time
        availability.end_time = end_time

        db.commit()
        db.refresh(availability)

        return PractitionerAvailabilityResponse(
            id=availability.id,
            user_id=availability.user_id,
            day_of_week=availability.day_of_week,
            day_name=availability.day_name,
            day_name_zh=availability.day_name_zh,
            start_time=availability.start_time.strftime("%H:%M"),
            end_time=availability.end_time.strftime("%H:%M"),
            created_at=availability.created_at,
            updated_at=availability.updated_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update practitioner availability {availability_id} for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新治療師可用時間"
        )


@router.delete("/practitioners/{user_id}/availability/{availability_id}", summary="Delete practitioner availability", status_code=status.HTTP_204_NO_CONTENT)
async def delete_practitioner_availability(
    user_id: int,
    availability_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> None:
    """
    Delete availability hours for a practitioner.

    Both practitioners and admins can delete availability.
    Practitioners can only delete their own availability.
    Admins can delete availability for any practitioner.
    """
    try:
        # Find the availability
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.id == availability_id,
            PractitionerAvailability.user_id == user_id
        ).first()

        if not availability:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到可用時間"
            )

        # Verify the practitioner belongs to current clinic
        practitioner = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        # Check if user has practitioner role
        if not practitioner or 'practitioner' not in practitioner.roles:
            practitioner = None

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到治療師"
            )

        # Check permissions - practitioners can only modify their own availability
        if not current_user.has_role('admin') and current_user.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="存取被拒絕：您只能修改自己的可用時間"
            )

        # Delete availability
        db.delete(availability)
        db.commit()

        # 204 No Content - no response body needed

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete practitioner availability {availability_id} for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除治療師可用時間"
        )


@router.get("/appointments", response_model=ClinicAppointmentsResponse, summary="List all clinic appointments")
async def list_clinic_appointments(
    current_user: UserContext = Depends(require_clinic_member),
    date: Optional[str] = Query(None, description="Filter by specific date (YYYY-MM-DD)"),
    practitioner_id: Optional[int] = Query(None, description="Filter by practitioner ID"),
    status_filter: Optional[str] = Query(None, description="Filter by status ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')"),
    db: Session = Depends(get_db)
) -> ClinicAppointmentsResponse:
    """
    Get all appointments for the current user's clinic.

    Available to all clinic members. Admins can see all appointments.
    Practitioners can see appointments they're involved in.
    """
    try:
        # For non-admin users, only show appointments they're involved in
        practitioner_filter = practitioner_id
        if not current_user.has_role('admin'):
            practitioner_filter = current_user.user_id

        # Get appointments using service
        assert current_user.clinic_id is not None, "Clinic ID required for clinic members"
        appointments_data = AppointmentService.list_appointments_for_clinic(
            db=db,
            clinic_id=current_user.clinic_id,
            date_filter=date,
            practitioner_id=practitioner_filter,
            status_filter=status_filter
        )

        # Convert dicts to response objects
        appointments = [
            ClinicAppointmentResponse(**appointment)
            for appointment in appointments_data
        ]

        return ClinicAppointmentsResponse(appointments=appointments)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to list clinic appointments for user {current_user.user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預約列表"
        )


@router.delete("/appointments/{appointment_id}", summary="Cancel appointment by clinic admin")
async def cancel_clinic_appointment(
    appointment_id: int,
    current_user: UserContext = Depends(require_admin_role),  # Only admins can cancel appointments
    db: Session = Depends(get_db)
):
    """
    Cancel an appointment by clinic admin.

    Updates appointment status to 'canceled_by_clinic', deletes Google Calendar event,
    and sends LINE notification to patient.
    """
    try:
        # Cancel appointment using service
        assert current_user.clinic_id is not None, "Clinic ID required for clinic members"
        result = AppointmentService.cancel_appointment_by_clinic_admin(
            db=db,
            appointment_id=appointment_id,
            clinic_id=current_user.clinic_id
        )

        appointment = result['appointment']
        practitioner = result['practitioner']

        # Google Calendar event deletion is handled by the service

        # Send LINE notification to patient
        try:
            NotificationService.send_appointment_cancellation(
                db, appointment, practitioner, CancellationSource.CLINIC
            )
        except Exception as e:
            logger.exception(f"Failed to send LINE notification for clinic cancellation of appointment {appointment_id}: {e}")
            # Continue with cancellation even if LINE notification fails

        db.commit()

        return {
            "success": True,
            "message": "預約已取消，已通知患者",
            "appointment_id": appointment_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to cancel appointment {appointment_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="取消預約失敗"
        )


