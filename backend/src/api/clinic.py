# pyright: reportMissingTypeStubs=false
"""
Clinic management API endpoints.

Provides clinic-specific operations for admins and practitioners,
including member management, settings, patients, and appointments.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from core.database import get_db
from core.config import FRONTEND_URL
from auth.dependencies import require_admin_role, require_authenticated, require_practitioner_or_admin, UserContext
from models import User, SignupToken, Clinic, AppointmentType, PractitionerAvailability, CalendarEvent
from models.clinic import ClinicSettings
from services import PatientService, AppointmentService, PractitionerService, AppointmentTypeService, ReminderService
from services.availability_service import AvailabilityService
from services.notification_service import NotificationService, CancellationSource
from utils.appointment_type_queries import count_active_appointment_types_for_practitioner
from api.responses import (
    ClinicPatientResponse, ClinicPatientListResponse,
    AppointmentTypeResponse, PractitionerAppointmentTypesResponse, PractitionerStatusResponse,
    AppointmentTypeDeletionErrorResponse
)

router = APIRouter()


class MemberResponse(BaseModel):
    """Response model for team member information."""
    id: int
    email: str
    full_name: str
    roles: List[str]
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


class BookingRestrictionSettings(BaseModel):
    """Booking restriction settings for clinic."""
    booking_restriction_type: str = "same_day_disallowed"
    minimum_booking_hours_ahead: int = 24


class ClinicInfoSettings(BaseModel):
    """Clinic information settings for display in calendar events and LINE reminders."""
    display_name: Optional[str] = None
    address: Optional[str] = None
    phone_number: Optional[str] = None
    appointment_type_instructions: Optional[str] = None


class ChatSettings(BaseModel):
    """Chat/chatbot settings for clinic."""
    chat_enabled: bool = False
    clinic_description: Optional[str] = None
    therapist_info: Optional[str] = None
    treatment_details: Optional[str] = None
    operating_hours: Optional[str] = None
    location_details: Optional[str] = None
    booking_policy: Optional[str] = None
    payment_methods: Optional[str] = None
    equipment_facilities: Optional[str] = None
    common_questions: Optional[str] = None
    other_info: Optional[str] = None


class SettingsResponse(BaseModel):
    """Response model for clinic settings."""
    clinic_id: int
    clinic_name: str
    business_hours: Dict[str, Dict[str, Any]]
    appointment_types: List[AppointmentTypeResponse]
    notification_settings: NotificationSettings
    booking_restriction_settings: BookingRestrictionSettings
    clinic_info_settings: ClinicInfoSettings
    chat_settings: ChatSettings


class PractitionerAvailabilityRequest(BaseModel):
    """Request model for practitioner availability."""
    day_of_week: int  # 0=Monday, 1=Tuesday, ..., 6=Sunday
    start_time: str  # HH:MM format
    end_time: str    # HH:MM format


class PractitionerAppointmentTypesUpdateRequest(BaseModel):
    """Request model for updating practitioner's appointment types."""
    appointment_type_ids: List[int]


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
    current_user: UserContext = Depends(require_authenticated),
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
                is_active=member.is_active,
                created_at=member.created_at
            )
            for member in members
        ]

        return {"members": member_list}

    except Exception as e:
        logger.exception(f"Error getting members list: {e}")
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
    except Exception as e:
        logger.exception(f"Error inviting member: {e}")
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
            is_active=member.is_active,
            created_at=member.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating member roles for user {user_id}: {e}")
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
    except Exception as e:
        logger.exception(f"Error removing member {user_id}: {e}")
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
    except Exception as e:
        logger.exception(f"Error reactivating member {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法重新啟用成員"
        )


@router.get("/settings", summary="Get clinic settings")
async def get_settings(
    current_user: UserContext = Depends(require_authenticated),
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

        # require_authenticated ensures clinic_user or system_admin
        # For clinic members, clinic_id should be set
        # Type narrowing for clinic_id
        clinic_id: int
        if current_user.clinic_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要診所存取權限"
            )
        clinic_id = current_user.clinic_id
        
        appointment_types = AppointmentTypeService.list_appointment_types_for_clinic(
            db, clinic_id
        )

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

        # Get validated settings to access chat_settings
        validated_settings = clinic.get_validated_settings()
        
        return SettingsResponse(
            clinic_id=clinic.id,
            clinic_name=clinic.name,
            business_hours=business_hours,
            appointment_types=appointment_type_list,
           notification_settings=NotificationSettings(
               reminder_hours_before=clinic.reminder_hours_before
           ),
           booking_restriction_settings=BookingRestrictionSettings(
               booking_restriction_type=clinic.booking_restriction_type,
               minimum_booking_hours_ahead=clinic.minimum_booking_hours_ahead
           ),
           clinic_info_settings=ClinicInfoSettings(
               display_name=clinic.display_name,
               address=clinic.address,
               phone_number=clinic.phone_number,
               appointment_type_instructions=clinic.appointment_type_instructions
           ),
           chat_settings=ChatSettings(
               chat_enabled=validated_settings.chat_settings.chat_enabled,
               clinic_description=validated_settings.chat_settings.clinic_description,
               therapist_info=validated_settings.chat_settings.therapist_info,
               treatment_details=validated_settings.chat_settings.treatment_details,
               operating_hours=validated_settings.chat_settings.operating_hours,
               location_details=validated_settings.chat_settings.location_details,
               booking_policy=validated_settings.chat_settings.booking_policy,
               payment_methods=validated_settings.chat_settings.payment_methods,
               equipment_facilities=validated_settings.chat_settings.equipment_facilities,
               common_questions=validated_settings.chat_settings.common_questions,
               other_info=validated_settings.chat_settings.other_info
           )
        )

    except Exception as e:
        logger.exception(f"Error getting clinic settings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得設定"
        )


class AppointmentTypeDeletionValidationRequest(BaseModel):
    """Request model for validating appointment type deletion."""
    appointment_type_ids: List[int]


@router.post("/appointment-types/validate-deletion", summary="Validate appointment type deletion")
async def validate_appointment_type_deletion(
    request: AppointmentTypeDeletionValidationRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Validate if appointment types can be deleted.
    
    Checks if any practitioners reference the appointment types.
    Returns list of appointment types that cannot be deleted with their practitioner names.
    Only clinic admins can validate deletion.
    """
    try:
        # Ensure clinic_id is set
        if current_user.clinic_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要診所存取權限"
            )
        clinic_id = current_user.clinic_id

        # Check for practitioner references
        blocked_types: List[Dict[str, Any]] = []
        for appointment_type_id in request.appointment_type_ids:
            # Verify appointment type exists and belongs to clinic
            appointment_type = db.query(AppointmentType).filter(
                AppointmentType.id == appointment_type_id,
                AppointmentType.clinic_id == clinic_id
            ).first()

            if not appointment_type:
                continue  # Skip non-existent types

            # Check for practitioner references
            practitioners = AvailabilityService.get_practitioners_for_appointment_type(
                db=db,
                appointment_type_id=appointment_type_id,
                clinic_id=clinic_id
            )

            # Check for future appointments (warnings)
            from utils.appointment_queries import count_future_appointments_for_appointment_type
            future_appointment_count = count_future_appointments_for_appointment_type(
                db, appointment_type_id
            )

            # Check for past appointments (just informational)
            from utils.appointment_queries import count_past_appointments_for_appointment_type
            past_appointment_count = count_past_appointments_for_appointment_type(
                db, appointment_type_id
            )

            # Practitioners block deletion, future appointments are warnings
            has_blocking_issues = bool(practitioners)
            has_warnings = future_appointment_count > 0

            if has_blocking_issues or has_warnings:
                warning_info = {}
                if practitioners:
                    warning_info["practitioners"] = [p.full_name for p in practitioners]
                if future_appointment_count > 0:
                    warning_info["future_appointment_count"] = future_appointment_count
                if past_appointment_count > 0:
                    warning_info["past_appointment_count"] = past_appointment_count

                blocked_types.append({
                    "id": appointment_type.id,
                    "name": appointment_type.name,
                    "is_blocked": has_blocking_issues,
                    "has_warnings": has_warnings,
                    **warning_info
                })

        # Separate blocked types from types with warnings
        blocked_types_list = [t for t in blocked_types if t["is_blocked"]]
        warning_types_list = [t for t in blocked_types if not t["is_blocked"] and t["has_warnings"]]

        # If any appointment types are blocked by practitioners, return error
        if blocked_types_list:
            error_response = AppointmentTypeDeletionErrorResponse(
                error="cannot_delete_appointment_types",
                message="無法刪除某些預約類型，因為有治療師正在提供此服務",
                appointment_types=blocked_types_list
            )
            return {
                "can_delete": False,
                "error": error_response.model_dump()
            }

        # Return warnings for future appointments
        response: Dict[str, Any] = {
            "can_delete": True,
            "warnings": []
        }

        if warning_types_list:
            response["warnings"] = warning_types_list
            response["message"] = f"有{len(warning_types_list)}個預約類型有即將到來的預約，確認要刪除嗎？"

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error validating appointment type deletion: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="驗證刪除失敗"
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
    Prevents deletion of appointment types that are referenced by practitioners.
    """
    try:
        # Ensure clinic_id is set
        if current_user.clinic_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要診所存取權限"
            )
        clinic_id = current_user.clinic_id

        # Update appointment types
        appointment_types_data = settings.get("appointment_types", [])

        # Get existing appointment types before deletion
        existing_appointment_types = AppointmentTypeService.list_appointment_types_for_clinic(
            db, clinic_id
        )

        # Determine which appointment types are being deleted
        # Match by name + duration_minutes (since IDs change with delete-all-then-recreate pattern)
        incoming_types = {
            (at_data.get("name"), at_data.get("duration_minutes"))
            for at_data in appointment_types_data
            if at_data.get("name") and at_data.get("duration_minutes")
        }

        types_to_delete = [
            at for at in existing_appointment_types
            if (at.name, at.duration_minutes) not in incoming_types
        ]

        # Check for practitioner references before deletion
        # Note: Since we use delete-all-then-recreate pattern, we need to check ALL existing types
        # that have practitioner references, not just ones being deleted, because the delete operation
        # will attempt to delete ALL types first (including ones we're recreating)
        blocked_types: List[Dict[str, Any]] = []
        for appointment_type in existing_appointment_types:
            practitioners = AvailabilityService.get_practitioners_for_appointment_type(
                db=db,
                appointment_type_id=appointment_type.id,
                clinic_id=clinic_id
            )
            
            if practitioners:
                # Check if this type is being kept (same name + duration) or deleted
                is_being_kept = (appointment_type.name, appointment_type.duration_minutes) in incoming_types
                
                # If being kept, we still need to prevent deletion because delete-all-then-recreate
                # will delete ALL types first before recreating, which violates FK constraints
                # Only allow if NO types are being deleted (just additions/modifications)
                if not is_being_kept or types_to_delete:
                    practitioner_names = [p.full_name for p in practitioners]
                    blocked_types.append({
                        "id": appointment_type.id,
                        "name": appointment_type.name,
                        "practitioners": practitioner_names
                    })

        # If any appointment types cannot be deleted, return error
        if blocked_types:
            error_response = AppointmentTypeDeletionErrorResponse(
                error="cannot_delete_appointment_types",
                message="無法刪除某些預約類型，因為有治療師正在提供此服務或存在相關預約",
                appointment_types=blocked_types
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_response.model_dump()
            )

        # Process appointment types: update existing, create new, soft delete removed ones
        incoming_types_dict = {
            (at_data.get("name"), at_data.get("duration_minutes")): at_data
            for at_data in appointment_types_data
            if at_data.get("name") and at_data.get("duration_minutes")
        }

        # Update existing appointment types or mark for soft deletion
        for existing_type in existing_appointment_types:
            key = (existing_type.name, existing_type.duration_minutes)
            if key in incoming_types_dict:
                # Type exists in incoming data - ensure it's not soft deleted
                if existing_type.is_deleted:
                    existing_type.is_deleted = False
                    existing_type.deleted_at = None
                # Could update other fields here if needed
            elif not existing_type.is_deleted:
                # Type not in incoming data and not already deleted - check if safe to soft delete
                practitioners = AvailabilityService.get_practitioners_for_appointment_type(
                    db=db,
                    appointment_type_id=existing_type.id,
                    clinic_id=clinic_id
                )
                if not practitioners:
                    # Safe to soft delete
                    from datetime import datetime, timezone
                    existing_type.is_deleted = True
                    existing_type.deleted_at = datetime.now(timezone.utc)

        # Create new appointment types
        for (name, duration), _ in incoming_types_dict.items():
            # Check if this type already exists (maybe was soft deleted)
            existing = db.query(AppointmentType).filter(
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.name == name,
                AppointmentType.duration_minutes == duration
            ).first()

            if existing:
                # Reactivate if it was soft deleted
                if existing.is_deleted:
                    existing.is_deleted = False
                    existing.deleted_at = None
            else:
                # Create new
                appointment_type = AppointmentType(
                    clinic_id=clinic_id,
                    name=name,
                    duration_minutes=duration
                )
                db.add(appointment_type)

        # Get clinic and update settings with validation
        clinic = db.query(Clinic).get(clinic_id)
        if clinic:
            try:
                # Validate incoming settings data
                validated_settings = ClinicSettings.model_validate(settings)
                # Set the validated settings on the clinic
                clinic.set_validated_settings(validated_settings)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid settings format: {str(e)}"
                )

        db.commit()

        return {"message": "設定更新成功"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating clinic settings: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新設定"
        )


class ReminderPreviewRequest(BaseModel):
    """Request model for generating reminder message preview."""
    appointment_type: str
    appointment_time: str
    therapist_name: str


class CancellationPreviewRequest(BaseModel):
    """Request model for generating cancellation message preview."""
    appointment_type: str
    appointment_time: str
    therapist_name: str
    patient_name: str
    note: str | None = None


@router.post("/reminder-preview", summary="Generate reminder message preview")
async def generate_reminder_preview(
    request: ReminderPreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Generate a preview of what a LINE reminder message would look like.

    This endpoint allows clinic admins to see exactly how their reminder
    messages will appear to patients before they are sent.
    """
    try:
        clinic_id = current_user.clinic_id
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).get(clinic_id)
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Generate preview using the same service that sends actual reminders
        reminder_service = ReminderService()
        preview_message = reminder_service.format_reminder_message(
            appointment_type=request.appointment_type,
            appointment_time=request.appointment_time,
            therapist_name=request.therapist_name,
            clinic=clinic
        )

        return {"preview_message": preview_message}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating reminder preview: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生預覽訊息"
        )


@router.post("/cancellation-preview", summary="Generate cancellation message preview")
async def generate_cancellation_preview(
    request: CancellationPreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Generate a preview of what a LINE cancellation message would look like.

    This endpoint allows clinic admins to see exactly how their cancellation
    messages will appear to patients before they are sent.
    """
    try:
        clinic_id = current_user.clinic_id
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).get(clinic_id)
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Generate preview using the same service that sends actual cancellations
        from services.notification_service import NotificationService, CancellationSource
        preview_message = NotificationService.generate_cancellation_preview(
            appointment_type=request.appointment_type,
            appointment_time=request.appointment_time,
            therapist_name=request.therapist_name,
            patient_name=request.patient_name,
            source=CancellationSource.CLINIC,  # Always clinic-initiated for preview
            clinic=clinic,
            note=request.note
        )

        return {"preview_message": preview_message}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating cancellation preview: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生取消預覽訊息"
        )


@router.get("/patients", summary="List all patients", response_model=ClinicPatientListResponse)
async def get_patients(
    current_user: UserContext = Depends(require_authenticated),
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

        # Format for clinic response (includes line_user_id and display_name)
        patient_list = [
            ClinicPatientResponse(
                id=patient.id,
                full_name=patient.full_name,
                phone_number=patient.phone_number,
                line_user_id=patient.line_user.line_user_id if patient.line_user else None,
                line_user_display_name=patient.line_user.display_name if patient.line_user else None,
                created_at=patient.created_at
            )
            for patient in patients
        ]

        return ClinicPatientListResponse(patients=patient_list)

    except Exception as e:
        logger.exception(f"Error getting patients list: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患列表"
        )



@router.get("/practitioners/{user_id}/availability", summary="Get practitioner availability")
async def get_practitioner_availability(
    user_id: int,
    current_user: UserContext = Depends(require_authenticated),
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


@router.delete("/appointments/{appointment_id}", summary="Cancel appointment by clinic admin or practitioner")
async def cancel_clinic_appointment(
    appointment_id: int,
    note: str | None = None,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Cancel an appointment by clinic admin or practitioner.

    Practitioners can only cancel their own appointments.
    Admins can cancel any appointment in their clinic.
    
    Updates appointment status to 'canceled_by_clinic'
    and sends LINE notification to patient.
    """
    try:
        # Check permissions before calling service
        # Practitioners can only cancel their own appointments; admins can cancel any in their clinic
        if not current_user.has_role('admin'):
            # For practitioners, verify they own this appointment
            calendar_event = db.query(CalendarEvent).filter(
                CalendarEvent.id == appointment_id,
                CalendarEvent.user_id == current_user.user_id
            ).first()
            
            if not calendar_event:
                # Either appointment doesn't exist or practitioner doesn't own it
                # Check if appointment exists but belongs to someone else
                existing_event = db.query(CalendarEvent).filter(
                    CalendarEvent.id == appointment_id
                ).first()
                
                if existing_event:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="您只能取消自己的預約"
                    )
                # If event doesn't exist, let service handle 404
        
        # Cancel appointment using service (will verify appointment exists, clinic matches, etc.)
        assert current_user.clinic_id is not None, "Clinic ID required for clinic members"
        result = AppointmentService.cancel_appointment_by_clinic_admin(
            db=db,
            appointment_id=appointment_id,
            clinic_id=current_user.clinic_id
        )

        appointment = result['appointment']
        practitioner = result['practitioner']
        already_cancelled = result.get('already_cancelled', False)


        # Send LINE notification to patient (skip if already cancelled to avoid duplicate notifications)
        if not already_cancelled:
            try:
                NotificationService.send_appointment_cancellation(
                    db, appointment, practitioner, CancellationSource.CLINIC, note
                )
            except Exception as e:
                logger.exception(f"Failed to send LINE notification for clinic cancellation of appointment {appointment_id}: {e}")
                # Continue with cancellation even if LINE notification fails
        else:
            logger.info(f"Skipping LINE notification for already-cancelled appointment {appointment_id}")

        db.commit()

        # Return appropriate message based on whether it was already cancelled
        if already_cancelled:
            return {
                "success": True,
                "message": "預約已被取消",
                "appointment_id": appointment_id
            }
        else:
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


# ===== Practitioner Appointment Type Management =====

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
        appointment_types = PractitionerService.get_practitioner_appointment_types(
            db=db,
            practitioner_id=user_id
        )

        return PractitionerAppointmentTypesResponse(
            practitioner_id=user_id,
            appointment_types=[
                AppointmentTypeResponse(
                    id=at.id,
                    clinic_id=at.clinic_id,
                    name=at.name,
                    duration_minutes=at.duration_minutes
                ) for at in appointment_types
            ]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get practitioner appointment types for user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        # Validate that the practitioner exists and belongs to the same clinic
        practitioner = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id
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
                    db, type_id, clinic_id=current_user.clinic_id
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
            appointment_type_ids=request.appointment_type_ids
        )

        if success:
            return {"success": True, "message": "治療師預約類型已更新"}
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="更新治療師預約類型失敗"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update practitioner appointment types for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新治療師預約類型失敗"
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
    # Check permissions - clinic members can view practitioner status
    practitioner = db.query(User).filter(User.id == user_id).first()
    if not practitioner or current_user.clinic_id != practitioner.clinic_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="無權限查看此治療師的狀態"
        )

    try:
        practitioner = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == current_user.clinic_id,
            User.is_active == True
        ).first()

        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="治療師不存在或已停用"
            )

        # Check if practitioner has appointment types configured
        appointment_types_count = count_active_appointment_types_for_practitioner(db, user_id)

        # Check if practitioner has availability configured
        availability_count = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="獲取治療師狀態失敗"
        )


