"""
Clinic management API endpoints.

Provides clinic-specific operations for admins and practitioners,
including member management, settings, patients, and appointments.
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import FRONTEND_URL
from auth.dependencies import require_admin_role, require_practitioner_role, UserContext
from models import User, Patient, Appointment, AppointmentType, SignupToken
from services.google_oauth import GoogleOAuthService

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


class PatientResponse(BaseModel):
    """Response model for patient information."""
    id: int
    full_name: str
    phone_number: str
    line_user_id: Optional[str]
    created_at: datetime


class AppointmentTypeRequest(BaseModel):
    """Request model for appointment type."""
    name: str
    duration_minutes: int


class AppointmentTypeResponse(BaseModel):
    """Response model for appointment type."""
    id: int
    name: str
    duration_minutes: int


class SettingsResponse(BaseModel):
    """Response model for clinic settings."""
    appointment_types: List[AppointmentTypeResponse]
    reminder_hours_before: int
    clinic_hours_start: str
    clinic_hours_end: str
    holidays: List[str]


@router.get("/members", summary="List all clinic members")
async def list_members(
    current_user: UserContext = Depends(require_practitioner_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get all active members of the current user's clinic.

    Requires practitioner role or higher.
    """
    try:
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch members"
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
    """
    try:
        # Validate roles
        valid_roles = {"admin", "practitioner"}
        if not all(role in valid_roles for role in invite_data.default_roles):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid role specified"
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
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate invitation"
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
                detail="Member not found"
            )

        # Prevent self-demotion if user would lose admin access
        new_roles = roles_update.get("roles", [])
        if current_user.user_id == user_id and "admin" not in new_roles:
            # Check if this user is the last admin
            admin_count = db.query(User).filter(
                User.clinic_id == current_user.clinic_id,
                User.roles.contains(["admin"]),
                User.is_active == True,
                User.id != user_id
            ).count()

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot remove admin access from the last administrator"
                )

        # Validate roles
        valid_roles = {"admin", "practitioner"}
        if not all(role in valid_roles for role in new_roles):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid role specified"
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
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update member roles"
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
                detail="Member not found"
            )

        # Prevent removing self
        if current_user.user_id == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove yourself"
            )

        # Prevent removing last admin
        if "admin" in member.roles:
            admin_count = db.query(User).filter(
                User.clinic_id == current_user.clinic_id,
                User.roles.contains(["admin"]),
                User.is_active == True,
                User.id != user_id
            ).count()

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot remove the last administrator"
                )

        # Soft delete
        member.is_active = False
        db.commit()

        return {"message": "Member removed successfully"}

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove member"
        )


@router.get("/settings", summary="Get clinic settings")
async def get_settings(
    current_user: UserContext = Depends(require_practitioner_role),
    db: Session = Depends(get_db)
) -> SettingsResponse:
    """
    Get clinic settings including appointment types.

    Requires practitioner role or higher.
    """
    try:
        appointment_types = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == current_user.clinic_id
        ).all()

        appointment_type_list = [
            AppointmentTypeResponse(
                id=at.id,
                name=at.name,
                duration_minutes=at.duration_minutes
            )
            for at in appointment_types
        ]

        return SettingsResponse(
            appointment_types=appointment_type_list,
            reminder_hours_before=24,  # Default for now
            clinic_hours_start="09:00",
            clinic_hours_end="18:00",
            holidays=[]  # Placeholder
        )

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch settings"
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

        db.commit()

        return {"message": "Settings updated successfully"}

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update settings"
        )


@router.get("/patients", summary="List all patients")
async def get_patients(
    current_user: UserContext = Depends(require_practitioner_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get all patients for the current user's clinic.

    Requires practitioner role or higher.
    """
    try:
        patients = db.query(Patient).filter(
            Patient.clinic_id == current_user.clinic_id
        ).all()

        patient_list = [
            PatientResponse(
                id=patient.id,
                full_name=patient.full_name,
                phone_number=patient.phone_number,
                line_user_id=patient.line_user.line_user_id if patient.line_user else None,
                created_at=patient.created_at
            )
            for patient in patients
        ]

        return {"patients": patient_list}

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch patients"
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
                detail="Team member not found"
            )

        # Check if user has practitioner role
        if not user.is_practitioner:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User must have practitioner role to set up Google Calendar"
            )

        # Generate OAuth URL
        oauth_service = GoogleOAuthService()
        assert current_user.clinic_id is not None  # Should always be set for clinic users
        auth_url = oauth_service.get_authorization_url(user_id, current_user.clinic_id)

        return {"auth_url": auth_url}

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate Google Calendar OAuth"
        )


@router.get("/members/{user_id}/gcal/callback", summary="Handle member calendar OAuth callback")
async def handle_member_gcal_callback(
    user_id: int,
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
        # Verify user exists and belongs to current clinic
        user = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Team member not found"
            )

        # Handle OAuth callback
        oauth_service = GoogleOAuthService()
        updated_user = await oauth_service.handle_oauth_callback(db, code, state)

        # Update user's calendar sync settings
        updated_user.gcal_sync_enabled = True
        db.commit()

        return {
            "message": "Google Calendar integration enabled successfully",
            "user_id": updated_user.id,
            "gcal_sync_enabled": True
        }

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to complete Google Calendar OAuth"
        )


@router.get("/dashboard", summary="Get clinic dashboard statistics")
async def get_dashboard_stats(
    current_user: UserContext = Depends(require_practitioner_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get dashboard statistics for the current user's clinic.

    Requires practitioner role or higher.
    """
    try:
        clinic_id = current_user.clinic_id

        # Total appointments
        total_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id)
        ).count()

        # Upcoming appointments (next 7 days)
        week_from_now = datetime.now(timezone.utc) + timedelta(days=7)
        upcoming_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.start_time >= datetime.now(timezone.utc),
            Appointment.start_time <= week_from_now,
            Appointment.status == "confirmed"
        ).count()

        # New patients (last 30 days)
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        new_patients = db.query(Patient).filter(
            Patient.clinic_id == clinic_id,
            Patient.created_at >= thirty_days_ago
        ).count()

        # Cancellation rate (last 30 days)
        recent_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.created_at >= thirty_days_ago
        ).count()

        cancelled_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.created_at >= thirty_days_ago,
            Appointment.status.in_(["canceled_by_patient", "canceled_by_clinic"])
        ).count()

        cancellation_rate = cancelled_appointments / recent_appointments if recent_appointments > 0 else 0

        return {
            "total_appointments": total_appointments,
            "upcoming_appointments": upcoming_appointments,
            "new_patients": new_patients,
            "cancellation_rate": cancellation_rate
        }

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch dashboard statistics"
        )
