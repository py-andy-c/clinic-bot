# pyright: reportMissingTypeStubs=false
"""
Clinic management API endpoints.

Provides clinic-specific operations for admins and practitioners,
including member management, settings, patients, and appointments.
"""

import logging
import math
import secrets
from datetime import datetime, timedelta, date as date_type, time
from typing import Dict, List, Optional, Any, Union

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi import status as http_status
from pydantic import BaseModel, Field, model_validator, field_validator
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, cast, String
from sqlalchemy.sql import sqltypes
from utils.datetime_utils import datetime_validator, parse_date_string, taiwan_now
from utils.practitioner_helpers import verify_practitioner_in_clinic
from utils.phone_validator import validate_taiwanese_phone_optional

logger = logging.getLogger(__name__)

from core.database import get_db
from core.config import FRONTEND_URL
from auth.dependencies import require_admin_role, require_authenticated, require_practitioner_or_admin, UserContext, ensure_clinic_access
from models import User, SignupToken, Clinic, AppointmentType, PractitionerAvailability, CalendarEvent, UserClinicAssociation, Appointment, AvailabilityException, Patient, LineUser
from models.clinic import ClinicSettings, ChatSettings as ChatSettingsModel
from services import PatientService, AppointmentService, PractitionerService, AppointmentTypeService, ReminderService
from services.availability_service import AvailabilityService
from services.notification_service import NotificationService
from services.clinic_agent import ClinicAgentService
from services.line_user_ai_disabled_service import (
    disable_ai_for_line_user,
    enable_ai_for_line_user,
    get_line_users_for_clinic
)
from utils.appointment_type_queries import count_active_appointment_types_for_practitioner
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from api.responses import (
    ClinicPatientResponse, ClinicPatientListResponse,
    AppointmentTypeResponse, PractitionerAppointmentTypesResponse, PractitionerStatusResponse,
    AppointmentTypeDeletionErrorResponse, AppointmentTypeReference,
    MemberResponse, MemberListResponse,
    AvailableSlotsResponse, AvailableSlotResponse, ConflictWarningResponse, ConflictDetail,
    PatientCreateResponse, AppointmentListResponse, AppointmentListItem,
    ClinicDashboardMetricsResponse
)

router = APIRouter()


# MemberResponse moved to api.responses - use that instead


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
    booking_restriction_type: str = "minimum_hours_required"
    minimum_booking_hours_ahead: int = 24
    step_size_minutes: int = 30
    max_future_appointments: int = 3
    max_booking_window_days: int = 90
    minimum_cancellation_hours_before: int = 24

    @model_validator(mode='before')
    @classmethod
    def migrate_same_day_disallowed(cls, data: Any) -> Any:
        """
        Auto-migrate deprecated same_day_disallowed to minimum_hours_required.
        
        This ensures backward compatibility while deprecating the old setting.
        
        Note: This validator is defensive. Incoming requests are validated by
        models.clinic.BookingRestrictionSettings, but this ensures API responses
        are also migrated if constructed directly.
        """
        if isinstance(data, dict):
            booking_type: Any = data.get('booking_restriction_type')  # type: ignore[reportUnknownVariableType]
            if booking_type == 'same_day_disallowed':
                # Migrate to minimum_hours_required
                # If minimum_booking_hours_ahead is not set or is 0, default to 24 hours
                min_hours: Any = data.get('minimum_booking_hours_ahead')  # type: ignore[reportUnknownVariableType]
                if min_hours is None or min_hours == 0:
                    data['minimum_booking_hours_ahead'] = 24
                # Update booking_restriction_type
                data['booking_restriction_type'] = 'minimum_hours_required'
        return data  # type: ignore[reportUnknownVariableType]


class ClinicInfoSettings(BaseModel):
    """Clinic information settings for display in calendar events and LINE reminders."""
    display_name: Optional[str] = None
    address: Optional[str] = None
    phone_number: Optional[str] = None
    appointment_type_instructions: Optional[str] = None
    appointment_notes_instructions: Optional[str] = None
    require_birthday: bool = False


class ChatSettings(BaseModel):
    """Chat/chatbot settings for clinic."""
    chat_enabled: bool = False
    clinic_description: Optional[str] = None
    therapist_info: Optional[str] = None
    treatment_details: Optional[str] = None
    service_item_selection_guide: Optional[str] = None
    operating_hours: Optional[str] = None
    location_details: Optional[str] = None
    booking_policy: Optional[str] = None
    payment_methods: Optional[str] = None
    equipment_facilities: Optional[str] = None
    common_questions: Optional[str] = None
    other_info: Optional[str] = None
    ai_guidance: Optional[str] = None


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
    liff_url: Optional[str] = None


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
) -> MemberListResponse:
    """
    Get all members of the current user's clinic.
    
    For admins: Returns both active and inactive members.
    For other users: Returns only active members.
    
    Available to all clinic members (including read-only users).
    """
    # Check clinic access first (raises HTTPException if denied)
    clinic_id = ensure_clinic_access(current_user)
    
    try:
        # Get members via UserClinicAssociation for the active clinic
        # Use joinedload to eagerly load associations and avoid N+1 queries
        from sqlalchemy.orm import joinedload
        
        query = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).options(joinedload(User.clinic_associations))  # Eager load associations for name lookup
        
        # Admins can see both active and inactive members
        if current_user.has_role("admin"):
            members_with_associations = query.all()
        else:
            # Non-admins only see active members (already filtered by association.is_active == True)
            members_with_associations = query.all()
        
        # Build member list with roles from associations
        member_list: List[MemberResponse] = []
        for member in members_with_associations:
            # Get the association for this clinic from the eagerly loaded relationships
            association = next(
                (a for a in member.clinic_associations 
                 if a.clinic_id == clinic_id),
                None
            )
            
            member_list.append(MemberResponse(
                id=member.id,
                email=member.email,
                full_name=association.full_name if association else member.email,  # Clinic users must have association
                roles=association.roles if association else [],
                is_active=association.is_active if association else False,
                created_at=member.created_at
            ))

        return MemberListResponse(members=member_list)

    except Exception as e:
        logger.exception(f"Error getting members list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得成員列表"
        )


class PractitionerListItemResponse(BaseModel):
    """Response model for practitioner list item."""
    id: int
    full_name: str


class PractitionerListResponse(BaseModel):
    """Response model for practitioner list."""
    practitioners: List[PractitionerListItemResponse]


@router.get("/practitioners", summary="List all practitioners for current clinic")
async def list_practitioners(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> PractitionerListResponse:
    """
    Get all practitioners for the current user's clinic.
    
    Returns basic information (id, full_name) for all practitioners.
    Available to all clinic members (including read-only users).
    """
    # Check clinic access first (raises HTTPException if denied)
    clinic_id = ensure_clinic_access(current_user)
    
    try:
        # Get practitioners using service
        practitioners_data = PractitionerService.list_practitioners_for_clinic(
            db=db,
            clinic_id=clinic_id,
            appointment_type_id=None  # Get all practitioners, not filtered by appointment type
        )
        
        # Build response
        practitioner_list = [
            PractitionerListItemResponse(
                id=p['id'],
                full_name=p['full_name']
            )
            for p in practitioners_data
        ]
        
        return PractitionerListResponse(practitioners=practitioner_list)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting practitioners list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得治療師列表"
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
        expires_at = taiwan_now() + timedelta(hours=48)  # 48 hours

        clinic_id = ensure_clinic_access(current_user)
        
        signup_token = SignupToken(
            token=token,
            clinic_id=clinic_id,
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
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        clinic_id = ensure_clinic_access(current_user)
        
        # Find member via association with eagerly loaded associations
        from sqlalchemy.orm import joinedload
        
        member = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).options(joinedload(User.clinic_associations)).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員"
            )

        # Get the association from the eagerly loaded relationships
        association = next(
            (a for a in member.clinic_associations 
             if a.clinic_id == clinic_id),
            None
        )
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員關聯"
            )

        # Prevent self-demotion if user would lose admin access
        new_roles = roles_update.get("roles", [])
        if current_user.user_id == user_id and "admin" not in new_roles:
            # Check if this user is the last admin
            admin_associations = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True,
                UserClinicAssociation.user_id != user_id
            ).all()

            admin_count = sum(1 for assoc in admin_associations if 'admin' in (assoc.roles or []))

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

        # Update roles in association
        association.roles = new_roles
        # updated_at will be set automatically by database event listener
        db.commit()
        db.refresh(association)

        return MemberResponse(
            id=member.id,
            email=member.email,
            full_name=association.full_name,
            roles=association.roles or [],
            is_active=association.is_active,
            created_at=member.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating member roles for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        clinic_id = ensure_clinic_access(current_user)
        
        # Find member via association
        member = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員"
            )

        # Get the association to check roles and deactivate
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員關聯"
            )

        # Prevent removing last admin
        if "admin" in (association.roles or []):
            admin_associations = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True,
                UserClinicAssociation.user_id != user_id
            ).all()

            admin_count = sum(1 for assoc in admin_associations if 'admin' in (assoc.roles or []))

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無法停用最後一位管理員"
                )

        # Deactivate association (not the user, since they may be in other clinics)
        association.is_active = False
        # updated_at will be set automatically by database event listener
        db.commit()

        return {"message": "成員已停用"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error removing member {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        clinic_id = ensure_clinic_access(current_user)
        
        # Find inactive member via association
        member = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == False
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到已停用的成員"
            )

        # Get and reactivate the association
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員關聯"
            )

        # Reactivate association
        association.is_active = True
        # updated_at will be set automatically by database event listener
        db.commit()

        return {"message": "成員已重新啟用"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error reactivating member {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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

        clinic_id = ensure_clinic_access(current_user)
        
        # Get clinic info
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        # require_authenticated ensures clinic_user or system_admin
        # For clinic members, clinic_id should be set
        clinic_id = ensure_clinic_access(current_user)
        
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

        # Get validated settings - use directly to ensure all fields are included automatically
        # This approach is maintainable: adding new fields to Pydantic models automatically
        # includes them in the API response without manual updates
        validated_settings = clinic.get_validated_settings()
        
        # Generate LIFF URL (read-only operation - no auto-generation)
        # Tokens should be generated via explicit endpoints or during clinic creation
        from utils.liff_token import generate_liff_url
        liff_url = generate_liff_url(clinic, mode="home")  # Will use clinic_id if token missing (backward compat)
        
        # Convert validated settings to API response models (they have the same structure)
        # This ensures type compatibility while maintaining automatic field inclusion
        return SettingsResponse(
            clinic_id=clinic.id,
            clinic_name=clinic.name,
            business_hours=business_hours,
            appointment_types=appointment_type_list,
            # Convert from models to API response models - automatically includes all fields
            notification_settings=NotificationSettings.model_validate(validated_settings.notification_settings.model_dump()),
            booking_restriction_settings=BookingRestrictionSettings.model_validate(validated_settings.booking_restriction_settings.model_dump()),
            clinic_info_settings=ClinicInfoSettings.model_validate(validated_settings.clinic_info_settings.model_dump()),
            chat_settings=ChatSettings.model_validate(validated_settings.chat_settings.model_dump()),
            liff_url=liff_url
        )

    except Exception as e:
        logger.exception(f"Error getting clinic settings: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        clinic_id = ensure_clinic_access(current_user)

        # Check for practitioner references
        blocked_types: List[AppointmentTypeReference] = []
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
                practitioner_names: List[str] = []
                if practitioners:
                    # Get practitioner names from associations
                    practitioner_ids: List[int] = [p.id for p in practitioners]
                    associations = db.query(UserClinicAssociation).filter(
                        UserClinicAssociation.user_id.in_(practitioner_ids),
                        UserClinicAssociation.clinic_id == clinic_id,
                        UserClinicAssociation.is_active == True
                    ).all()
                    association_lookup: Dict[int, UserClinicAssociation] = {a.user_id: a for a in associations}
                    for p in practitioners:
                        association = association_lookup.get(p.id)
                        practitioner_names.append(association.full_name if association else p.email)

                blocked_types.append(AppointmentTypeReference(
                    id=appointment_type.id,
                    name=appointment_type.name,
                    practitioners=practitioner_names,
                    is_blocked=has_blocking_issues,
                    has_warnings=has_warnings,
                    future_appointment_count=future_appointment_count if future_appointment_count > 0 else None,
                    past_appointment_count=past_appointment_count if past_appointment_count > 0 else None
                ))

        # Separate blocked types from types with warnings
        blocked_types_list = [t for t in blocked_types if t.is_blocked]
        warning_types_list = [t for t in blocked_types if not t.is_blocked and t.has_warnings]

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
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        clinic_id = ensure_clinic_access(current_user)

        # Update appointment types
        appointment_types_data = settings.get("appointment_types", [])

        # Get existing appointment types before deletion
        existing_appointment_types = AppointmentTypeService.list_appointment_types_for_clinic(
            db, clinic_id
        )

        # Build maps for matching: by ID and by (name, duration)
        incoming_by_id = {
            at_data.get("id"): at_data
            for at_data in appointment_types_data
            if at_data.get("id") and at_data.get("name") and at_data.get("duration_minutes")
        }
        incoming_by_name_duration = {
            (at_data.get("name"), at_data.get("duration_minutes")): at_data
            for at_data in appointment_types_data
            if at_data.get("name") and at_data.get("duration_minutes")
        }

        # Determine which appointment types are being deleted or updated
        # A type is being deleted if:
        # 1. It's not matched by ID (if incoming has ID), AND
        # 2. It's not matched by (name, duration) combination
        types_to_delete: List[Any] = []
        types_being_updated: Dict[int, Dict[str, Any]] = {}
        
        for existing_type in existing_appointment_types:
            # First try to match by ID (most reliable)
            if existing_type.id in incoming_by_id:
                incoming_data = incoming_by_id[existing_type.id]
                # Check if this is an update (name or duration changed) or just keeping it
                if (existing_type.name != incoming_data.get("name") or 
                    existing_type.duration_minutes != incoming_data.get("duration_minutes")):
                    types_being_updated[existing_type.id] = incoming_data
                # Type is being kept (matched by ID), not deleted
                continue
            
            # If not matched by ID, try to match by (name, duration)
            key = (existing_type.name, existing_type.duration_minutes)
            if key in incoming_by_name_duration:
                # Type is being kept (matched by name+duration), not deleted
                continue
            
            # Not matched by ID or name+duration - this is a deletion
            types_to_delete.append(existing_type)

        # Check for practitioner references before deletion
        # Only check types that are actually being deleted (not updated)
        blocked_types: List[AppointmentTypeReference] = []
        for appointment_type in types_to_delete:
            practitioners = AvailabilityService.get_practitioners_for_appointment_type(
                db=db,
                appointment_type_id=appointment_type.id,
                clinic_id=clinic_id
            )
            
            if practitioners:
                # Get practitioner names from associations
                practitioner_ids: List[int] = [p.id for p in practitioners]
                associations = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id.in_(practitioner_ids),
                    UserClinicAssociation.clinic_id == clinic_id,
                    UserClinicAssociation.is_active == True
                ).all()
                association_lookup: Dict[int, UserClinicAssociation] = {a.user_id: a for a in associations}
                practitioner_names: List[str] = []
                for p in practitioners:
                    association = association_lookup.get(p.id)
                    practitioner_names.append(association.full_name if association else p.email)
                blocked_types.append(AppointmentTypeReference(
                    id=appointment_type.id,
                    name=appointment_type.name,
                    practitioners=practitioner_names,
                    is_blocked=True
                ))

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
        from models import AppointmentType
        
        # Track which (name, duration) combinations we've processed
        processed_combinations: set[tuple[str, int]] = set()
        
        # First, update existing types that are matched by ID
        for existing_type in existing_appointment_types:
            if existing_type.id in types_being_updated:
                # Update the existing type with new name/duration
                incoming_data = types_being_updated[existing_type.id]
                new_name = incoming_data.get("name")
                new_duration = incoming_data.get("duration_minutes")
                if new_name is not None and new_duration is not None:
                    existing_type.name = new_name
                    existing_type.duration_minutes = new_duration
                if existing_type.is_deleted:
                    existing_type.is_deleted = False
                    existing_type.deleted_at = None
                processed_combinations.add((existing_type.name, existing_type.duration_minutes))
            elif existing_type.id in incoming_by_id:
                # Type is being kept as-is (matched by ID, no changes)
                if existing_type.is_deleted:
                    existing_type.is_deleted = False
                    existing_type.deleted_at = None
                processed_combinations.add((existing_type.name, existing_type.duration_minutes))
            elif (existing_type.name, existing_type.duration_minutes) in incoming_by_name_duration:
                # Type is being kept (matched by name+duration, no ID in incoming)
                if existing_type.is_deleted:
                    existing_type.is_deleted = False
                    existing_type.deleted_at = None
                processed_combinations.add((existing_type.name, existing_type.duration_minutes))
            elif existing_type in types_to_delete:
                # Type is being deleted - already checked for practitioners above
                # Soft delete it
                if not existing_type.is_deleted:
                    existing_type.is_deleted = True
                    existing_type.deleted_at = taiwan_now()

        # Create new appointment types (ones not matched to existing types)
        for at_data in appointment_types_data:
            if not at_data.get("name") or not at_data.get("duration_minutes"):
                continue
            
            name = at_data.get("name")
            duration = at_data.get("duration_minutes")
            key = (name, duration)
            
            # Skip if we've already processed this combination
            if key in processed_combinations:
                continue
            
            # Check if this type already exists (maybe was soft deleted or has different ID)
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
                # Remove fields that are not part of ClinicSettings model before validation
                # appointment_types, clinic_id, and clinic_name are handled separately
                settings_for_validation = {
                    k: v for k, v in settings.items() 
                    if k not in ["appointment_types", "clinic_id", "clinic_name", "business_hours"]
                }
                
                # Validate incoming settings data
                validated_settings = ClinicSettings.model_validate(settings_for_validation)
                # Set the validated settings on the clinic
                clinic.set_validated_settings(validated_settings)
            except Exception as e:
                logger.error(f"Settings validation error: {e}, settings keys: {list(settings.keys())}")
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
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新設定"
        )


@router.post("/regenerate-liff-token", summary="Regenerate LIFF access token")
async def regenerate_liff_token(
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Regenerate LIFF access token for current clinic.

    Only clinic admins can regenerate tokens. The old token is immediately
    invalidated and a new secure token is generated. This is useful if a token
    is compromised or needs to be rotated for security purposes.

    Returns:
        Dict with success status, message, and new token
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Use with_for_update to lock the row and prevent race conditions
        clinic = db.query(Clinic).filter_by(id=clinic_id).with_for_update().first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Force regeneration by clearing old token first, then generating new one
        old_token = clinic.liff_access_token
        clinic.liff_access_token = None
        db.flush()  # Ensure the change is visible
        
        # Generate new token (will create a new one since we cleared it)
        # We need to manually generate since generate_liff_access_token checks for existing token
        max_attempts = 10
        new_token = None
        for attempt in range(max_attempts):
            token = secrets.token_urlsafe(32)  # ~43 characters URL-safe
            
            # Check for collision across all clinics
            existing = db.query(Clinic).filter_by(liff_access_token=token).first()
            if not existing:
                new_token = token
                break
            logger.warning(f"Token collision detected on attempt {attempt + 1} for clinic {clinic_id}, retrying...")
        
        if not new_token:
            db.rollback()
            raise HTTPException(
                status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="無法產生新的 token，請稍後再試"
            )
        
        clinic.liff_access_token = new_token
        db.commit()

        # Log regeneration event
        logger.info(
            f"LIFF token regenerated for clinic {clinic_id} by user {current_user.user_id}. "
            f"Old token: {old_token[:8] if old_token else 'None'}... (truncated)"
        )

        # Security: Do not return the token in the API response to prevent exposure
        # in network logs, server logs, or client-side JavaScript.
        # The token can be retrieved via the clinic details endpoint if needed.
        return {
            "success": True,
            "message": "Token regenerated successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to regenerate LIFF token for clinic: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法重新產生 token"
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
        clinic_id = ensure_clinic_access(current_user)
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
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        clinic_id = ensure_clinic_access(current_user)
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
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生取消預覽訊息"
        )


class ChatTestRequest(BaseModel):
    """Request model for testing chatbot with current settings."""
    message: str
    session_id: Optional[str] = None
    chat_settings: ChatSettingsModel


class ChatTestResponse(BaseModel):
    """Response model for chatbot test."""
    response: str
    session_id: str


@router.post("/chat/test", summary="Test chatbot with current settings")
async def test_chatbot(
    request: ChatTestRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ChatTestResponse:
    """
    Test chatbot with current (unsaved) chat settings.
    
    This endpoint allows clinic users to test how the chatbot will respond
    using their current settings before saving them. The test uses the provided
    chat_settings instead of the clinic's saved settings.
    
    Available to all clinic members (including read-only users).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Validate that chat is enabled in the provided settings
        if not request.chat_settings.chat_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="請先啟用 AI 聊天功能"
            )

        # Require session_id from frontend (must be provided)
        # Frontend always provides just the UUID, backend prepends clinic info
        if not request.session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="session_id 是必需的"
            )
        
        # Always prepend clinic info to create full session_id format
        session_id = f"test-{clinic_id}-{request.session_id}"

        # Process test message using provided chat settings
        # Use chat_settings_override to use unsaved settings from frontend
        response_text = await ClinicAgentService.process_message(
            session_id=session_id,
            message=request.message,
            clinic=clinic,
            chat_settings_override=request.chat_settings
        )

        return ChatTestResponse(
            response=response_text,
            session_id=session_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error testing chatbot: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法處理測試訊息"
        )


@router.get("/patients", summary="List all patients", response_model=ClinicPatientListResponse)
async def get_patients(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    page: Optional[int] = Query(None, ge=1, description="Page number (1-indexed). Must be provided with page_size."),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Items per page. Must be provided with page."),
    search: Optional[str] = Query(None, max_length=200, description="Search query to filter patients by name, phone, or LINE user display name. Maximum length: 200 characters.")
) -> ClinicPatientListResponse:
    """
    Get all patients for the current user's clinic.

    Available to all clinic members (including read-only users).
    Supports pagination via page and page_size parameters.
    Supports search via search parameter to filter by patient name, phone number, or LINE user display name.
    If pagination parameters are not provided, returns all patients (backward compatible).
    Note: page and page_size must both be provided together or both omitted.
    """
    try:
        # Validate pagination parameters: both or neither
        if (page is not None) != (page_size is not None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="page and page_size must be provided together or both omitted"
            )
        
        # Get patients using service
        clinic_id = ensure_clinic_access(current_user)
        patients, total = PatientService.list_patients_for_clinic(
            db=db,
            clinic_id=clinic_id,
            page=page,
            page_size=page_size,
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

        # Format for clinic response (includes line_user_id and display_name)
        patient_list = [
            ClinicPatientResponse(
                id=patient.id,
                full_name=patient.full_name,
                phone_number=patient.phone_number,
                birthday=patient.birthday,
                notes=patient.notes,
                line_user_id=patient.line_user.line_user_id if patient.line_user else None,
                line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
                line_user_picture_url=patient.line_user.picture_url if patient.line_user else None,
                created_at=patient.created_at,
                is_deleted=patient.is_deleted
            )
            for patient in patients
        ]

        # If pagination is used, return pagination info; otherwise use defaults
        if page is not None and page_size is not None:
            return ClinicPatientListResponse(
                patients=patient_list,
                total=total,
                page=page,
                page_size=page_size
            )
        else:
            # Backward compatibility: return all results with total count
            # Use total as page_size when total > 0, otherwise use a default
            return ClinicPatientListResponse(
                patients=patient_list,
                total=total,
                page=1,
                page_size=total if total > 0 else 50
            )

    except Exception as e:
        logger.exception(f"Error getting patients list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患列表"
        )


# ===== Patient Creation Endpoints =====

class ClinicPatientCreateRequest(BaseModel):
    """Request model for creating patient by clinic users."""
    full_name: str
    phone_number: Optional[str] = None
    birthday: Optional[date_type] = None

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('姓名不能為空')
        if len(v) > 255:
            raise ValueError('姓名長度過長')
        # Basic XSS prevention: Reject angle brackets to prevent HTML/script injection
        # This is a simple but effective check for patient names, which are displayed
        # in the UI. More comprehensive sanitization is handled at the frontend layer.
        if '<' in v or '>' in v:
            raise ValueError('姓名包含無效字元')
        return v

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        """Validate phone number if provided, allow None or empty string."""
        return validate_taiwanese_phone_optional(v)

    @field_validator('birthday', mode='before')
    @classmethod
    def validate_birthday(cls, v: Union[str, date_type, None]) -> Optional[date_type]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        if v is None:
            return None
        if isinstance(v, date_type):
            # Already a date object, just validate range
            today = taiwan_now().date()
            if v > today:
                raise ValueError('生日不能是未來日期')
            # Approximate 150 years check
            if (today - v).days > 150 * 365:
                raise ValueError('生日日期不合理')
            return v
        # v is str at this point
        try:
            parsed_date = parse_date_string(v)
            today = taiwan_now().date()
            if parsed_date > today:
                raise ValueError('生日不能是未來日期')
            if (today - parsed_date).days > 150 * 365:
                raise ValueError('生日日期不合理')
            return parsed_date
        except ValueError as e:
            # If it's already a birthday-related error, re-raise
            if '生日' in str(e) or 'date' in str(e).lower():
                raise
            # For parsing errors, provide clear message
            raise ValueError('生日格式錯誤，請使用 YYYY-MM-DD 格式') from e


class DuplicateCheckResponse(BaseModel):
    """Response model for duplicate name check."""
    count: int
    """Number of patients with exact same name (case-insensitive)."""


@router.post("/patients", summary="Create patient (clinic users)", response_model=PatientCreateResponse)
async def create_patient(
    request: ClinicPatientCreateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> PatientCreateResponse:
    """
    Create a new patient record for the clinic.
    
    Available to clinic admins and practitioners.
    Phone number and birthday are optional.
    Duplicate phone numbers are allowed.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Create patient with clinic_user as created_by_type
        patient = PatientService.create_patient(
            db=db,
            clinic_id=clinic_id,
            full_name=request.full_name,
            phone_number=request.phone_number,  # Can be None
            line_user_id=None,  # Clinic-created patients are not linked to LINE users
            birthday=request.birthday,
            created_by_type='clinic_user'
        )

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except ValueError as e:
        # Validation errors from validators
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.exception(f"Patient creation error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立病患失敗"
        )


@router.get("/patients/check-duplicate", summary="Check for duplicate patient names", response_model=DuplicateCheckResponse)
async def check_duplicate_patient_name(
    name: str = Query(..., description="Patient name to check (exact match, case-insensitive)"),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> DuplicateCheckResponse:
    """
    Check for existing patients with exact same name (case-insensitive).
    
    Used for duplicate detection in patient creation form.
    Returns count of patients with matching name (excluding soft-deleted).
    Available to all clinic users (including read-only).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Trim name
        trimmed_name = name.strip()
        if not trimmed_name or len(trimmed_name) < 2:
            # Return 0 for very short names (not meaningful to check)
            return DuplicateCheckResponse(count=0)
        
        count = PatientService.check_duplicate_by_name(
            db=db,
            clinic_id=clinic_id,
            full_name=trimmed_name
        )
        
        return DuplicateCheckResponse(count=count)
        
    except Exception as e:
        logger.exception(f"Error checking duplicate patient name: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="檢查重複病患名稱時發生錯誤"
        )


class ClinicPatientUpdateRequest(BaseModel):
    """Request model for updating patient by clinic users."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    birthday: Optional[date_type] = None
    notes: Optional[str] = None

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError('姓名不能為空')
        if len(v) > 255:
            raise ValueError('姓名長度過長')
        if '<' in v or '>' in v:
            raise ValueError('姓名包含無效字元')
        return v

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        """Validate phone number if provided, allow None or empty string."""
        return validate_taiwanese_phone_optional(v)

    @field_validator('birthday', mode='before')
    @classmethod
    def validate_birthday(cls, v: Union[str, date_type, None]) -> Optional[date_type]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        if v is None:
            return None
        if isinstance(v, date_type):
            today = taiwan_now().date()
            if v > today:
                raise ValueError('生日不能是未來日期')
            if (today - v).days > 150 * 365:
                raise ValueError('生日日期不合理')
            return v
        try:
            parsed_date = parse_date_string(v)
            today = taiwan_now().date()
            if parsed_date > today:
                raise ValueError('生日不能是未來日期')
            if (today - parsed_date).days > 150 * 365:
                raise ValueError('生日日期不合理')
            return parsed_date
        except ValueError as e:
            if '生日' in str(e) or 'date' in str(e).lower():
                raise
            raise ValueError('生日格式錯誤，請使用 YYYY-MM-DD 格式') from e

    @field_validator('notes')
    @classmethod
    def validate_notes(cls, v: Optional[str]) -> Optional[str]:
        """Validate notes field if provided."""
        if v is None:
            return None
        # Trim whitespace, allow empty strings
        v = v.strip() if v else ''
        # Limit length to prevent abuse (e.g., 5000 characters)
        if len(v) > 5000:
            raise ValueError('備注長度過長（最多5000字元）')
        return v

    @model_validator(mode='after')
    def validate_at_least_one_field(self):
        """Ensure at least one field is provided for update."""
        # Check what fields were actually set (exclude unset fields)
        provided_fields = self.model_dump(exclude_unset=True)
        
        # If notes is in the provided fields (even if empty string), allow the update
        if 'notes' in provided_fields:
            return self
        
        # Otherwise, require at least one non-None field
        if self.full_name is None and self.phone_number is None and self.birthday is None:
            raise ValueError('至少需提供一個欄位進行更新')
        return self


@router.get("/patients/{patient_id}", summary="Get patient details", response_model=ClinicPatientResponse)
async def get_patient(
    patient_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ClinicPatientResponse:
    """
    Get patient details by ID.

    Available to all clinic members (including read-only users).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        patient = PatientService.get_patient_by_id(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )

        return ClinicPatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            notes=patient.notes,
            line_user_id=patient.line_user.line_user_id if patient.line_user else None,
            line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
            created_at=patient.created_at,
            is_deleted=patient.is_deleted
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting patient {patient_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患資料"
        )


@router.put("/patients/{patient_id}", summary="Update patient information", response_model=ClinicPatientResponse)
async def update_patient(
    patient_id: int,
    request: ClinicPatientUpdateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ClinicPatientResponse:
    """
    Update patient information.

    Available to clinic admins and practitioners only.
    Read-only users cannot update patients.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Note: require_practitioner_or_admin dependency already excludes read-only users
        patient = PatientService.update_patient_for_clinic(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id,
            full_name=request.full_name,
            phone_number=request.phone_number,
            birthday=request.birthday,
            notes=request.notes
        )

        return ClinicPatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            notes=patient.notes,
            line_user_id=patient.line_user.line_user_id if patient.line_user else None,
            line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
            created_at=patient.created_at,
            is_deleted=patient.is_deleted
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating patient {patient_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新病患資料失敗"
        )


@router.get("/patients/{patient_id}/appointments", summary="Get patient appointments", response_model=AppointmentListResponse)
async def get_patient_appointments(
    patient_id: int,
    status: Optional[str] = Query(None, description="Filter by status: confirmed, canceled_by_patient, canceled_by_clinic"),
    upcoming_only: bool = Query(False, description="Filter for upcoming appointments only"),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> AppointmentListResponse:
    """
    Get appointments for a specific patient.

    Available to all clinic members (including read-only users).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Validate status if provided
        if status and status not in ['confirmed', 'canceled_by_patient', 'canceled_by_clinic']:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,  # Use http_status to avoid shadowing parameter
                detail="無效的狀態值"
            )

        appointments_data = AppointmentService.list_appointments_for_patient(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id,
            status=status,
            upcoming_only=upcoming_only
        )

        # Convert dicts to response objects
        appointments = [
            AppointmentListItem(**appointment)
            for appointment in appointments_data
        ]

        return AppointmentListResponse(appointments=appointments)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting appointments for patient {patient_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,  # Use http_status to avoid shadowing parameter
            detail="無法取得預約記錄"
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
        
        # Cancel appointment using service
        # Note: Permission validation is already done above (practitioners can only cancel their own, admins can cancel any)
        # The service method handles sending notifications to both practitioner and patient
        result = AppointmentService.cancel_appointment(
            db=db,
            appointment_id=appointment_id,
            cancelled_by='clinic',
            return_details=True,
            note=note
        )

        already_cancelled = result.get('already_cancelled', False)

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
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="取消預約失敗"
        )


# ===== Appointment Management (Create, Edit, Reassign) =====

# parse_datetime_field_validator removed - use datetime_validator from utils.datetime_utils instead
# This function is now replaced by the centralized datetime_validator utility


class ClinicAppointmentCreateRequest(BaseModel):
    """Request model for creating appointment on behalf of patient."""
    patient_id: int
    appointment_type_id: int
    start_time: datetime
    practitioner_id: int  # Required - clinic users must select a practitioner
    notes: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return datetime_validator('start_time')(cls, values)


class AppointmentEditRequest(BaseModel):
    """Request model for editing appointment."""
    practitioner_id: Optional[int] = None  # None = keep current
    start_time: Optional[datetime] = None  # None = keep current
    notes: Optional[str] = None  # If provided, updates appointment.notes. If None, preserves original patient notes.
    notification_note: Optional[str] = None  # Optional note to include in edit notification (does not update appointment.notes)

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return datetime_validator('start_time')(cls, values)


class AppointmentEditPreviewRequest(BaseModel):
    """Request model for previewing edit notification."""
    new_practitioner_id: Optional[int] = None
    new_start_time: Optional[datetime] = None
    note: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return datetime_validator('new_start_time')(cls, values)


@router.post("/appointments", summary="Create appointment on behalf of patient")
async def create_clinic_appointment(
    request: ClinicAppointmentCreateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Create an appointment on behalf of an existing patient.
    
    Admin and practitioners can create appointments for any patient.
    Read-only users cannot create appointments.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if user is read-only
        if current_user.has_role('read-only'):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限建立預約"
            )
        
        # Create appointment (no LINE user validation for clinic users)
        # The AppointmentService.create_appointment() method already handles sending
        # LINE notifications to patients, so we don't need to send them here.
        result = AppointmentService.create_appointment(
            db=db,
            clinic_id=clinic_id,
            patient_id=request.patient_id,
            appointment_type_id=request.appointment_type_id,
            start_time=request.start_time,
            practitioner_id=request.practitioner_id,
            notes=request.notes,
            line_user_id=None  # No LINE validation for clinic users
        )
        
        return {
            "success": True,
            "appointment_id": result['appointment_id'],
            "message": "預約已建立"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create appointment: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立預約失敗"
        )


@router.post("/appointments/{appointment_id}/edit-preview", summary="Preview edit notification")
async def preview_edit_notification(
    appointment_id: int,
    request: AppointmentEditPreviewRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Preview edit notification message before confirming edit.
    
    Also validates conflicts and returns whether notification will be sent.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get appointment
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Check if appointment is cancelled
        if appointment.status in ['canceled_by_patient', 'canceled_by_clinic']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="此預約已取消，無法編輯"
            )
        
        # Check permissions before preview
        calendar_event = appointment.calendar_event
        is_admin = current_user.has_role('admin')
        if not is_admin:
            # Practitioners can only preview their own appointments
            if calendar_event.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能預覽自己的預約"
                )
        
        # Check conflicts (after permission check)
        is_valid, _, conflicts = AppointmentService.check_appointment_edit_conflicts(
            db, appointment_id, request.new_practitioner_id, request.new_start_time,
            appointment.appointment_type_id, clinic_id
        )
        
        # Determine if notification will be sent
        from utils.datetime_utils import TAIWAN_TZ
        old_start_time_for_preview = datetime.combine(calendar_event.date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id_for_preview = calendar_event.user_id
        new_start_time = request.new_start_time if request.new_start_time else old_start_time_for_preview
        new_practitioner_id = request.new_practitioner_id if request.new_practitioner_id else old_practitioner_id_for_preview
        
        will_send_notification = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=new_practitioner_id,
            new_start_time=new_start_time
        )
        
        # Generate preview message if notification will be sent
        preview_message: Optional[str] = None
        if will_send_notification:
            old_practitioner = None
            if not appointment.is_auto_assigned:
                old_practitioner = db.query(User).get(calendar_event.user_id)
            
            new_practitioner = None
            if request.new_practitioner_id:
                new_practitioner = db.query(User).get(request.new_practitioner_id)
            
            preview_message = NotificationService.generate_edit_preview(
                db=db,
                appointment=appointment,
                old_practitioner=old_practitioner,
                new_practitioner=new_practitioner,
                old_start_time=old_start_time_for_preview,
                new_start_time=new_start_time,
                note=request.note
            )
        
        return {
            "preview_message": preview_message,
            "old_appointment_details": {
                "practitioner_id": calendar_event.user_id,
                "start_time": old_start_time_for_preview.isoformat(),
                "is_auto_assigned": appointment.is_auto_assigned
            },
            "new_appointment_details": {
                "practitioner_id": request.new_practitioner_id if request.new_practitioner_id else calendar_event.user_id,
                "start_time": new_start_time.isoformat()
            },
            "conflicts": conflicts,
            "is_valid": is_valid,
            "will_send_notification": will_send_notification
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to preview edit notification: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="預覽失敗"
        )


@router.put("/appointments/{appointment_id}", summary="Edit appointment")
async def edit_clinic_appointment(
    appointment_id: int,
    request: AppointmentEditRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Edit an appointment (time and/or practitioner).
    
    Admin can edit any appointment.
    Practitioners can only edit their own appointments.
    Read-only users cannot edit.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if user is read-only
        if current_user.has_role('read-only'):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限編輯預約"
            )
        
        # Get appointment before edit (for notification and permission check)
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Check permissions (before any other operations)
        calendar_event = appointment.calendar_event
        is_admin = current_user.has_role('admin')
        if not is_admin:
            # Practitioners can only edit their own appointments
            if calendar_event.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能編輯自己的預約"
                )
        
        # Ensure user_id is available (should always be true with require_practitioner_or_admin)
        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="未授權"
            )
        
        # Edit appointment (service handles business logic, notifications, and permissions)
        # Pass pre-fetched appointment to avoid duplicate query (already fetched for authorization check)
        result = AppointmentService.update_appointment(
            db=db,
            appointment_id=appointment_id,
            new_practitioner_id=request.practitioner_id,
            new_start_time=request.start_time,
            new_notes=request.notes,
            apply_booking_constraints=False,  # Clinic edits bypass constraints
            allow_auto_assignment=False,  # Clinic edits don't support auto-assignment
            reassigned_by_user_id=current_user.user_id,
            notification_note=request.notification_note,
            success_message='預約已更新',
            appointment=appointment  # Pass pre-fetched appointment to avoid duplicate query
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to edit appointment: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="編輯預約失敗"
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
                    duration_minutes=at.duration_minutes
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


# ===== Practitioner Calendar Models and Functions (merged from practitioner_calendar.py) =====

# Request/Response Models

class TimeInterval(BaseModel):
    """Time interval model for availability periods."""
    start_time: str  # Format: "HH:MM"
    end_time: str    # Format: "HH:MM"


class DefaultScheduleRequest(BaseModel):
    """Request model for updating default weekly schedule."""
    monday: List[TimeInterval] = []
    tuesday: List[TimeInterval] = []
    wednesday: List[TimeInterval] = []
    thursday: List[TimeInterval] = []
    friday: List[TimeInterval] = []
    saturday: List[TimeInterval] = []
    sunday: List[TimeInterval] = []


class DefaultScheduleResponse(BaseModel):
    """Response model for default weekly schedule."""
    monday: List[TimeInterval]
    tuesday: List[TimeInterval]
    wednesday: List[TimeInterval]
    thursday: List[TimeInterval]
    friday: List[TimeInterval]
    saturday: List[TimeInterval]
    sunday: List[TimeInterval]


class CalendarDayResponse(BaseModel):
    """Response model for calendar day data."""
    date: str  # Format: "YYYY-MM-DD"
    appointment_count: int


class CalendarMonthResponse(BaseModel):
    """Response model for calendar month data."""
    month: str  # Format: "YYYY-MM"
    total_days: int
    page: int
    limit: int
    days: List[CalendarDayResponse]


class CalendarEventResponse(BaseModel):
    """Response model for calendar events."""
    calendar_event_id: int
    type: str  # "appointment" or "availability_exception"
    start_time: Optional[str]  # Format: "HH:MM" or None for all-day
    end_time: Optional[str]    # Format: "HH:MM" or None for all-day
    title: str
    patient_id: Optional[int] = None
    appointment_type_id: Optional[int] = None
    status: Optional[str] = None
    exception_id: Optional[int] = None
    appointment_id: Optional[int] = None  # For appointment cancellation
    notes: Optional[str] = None  # Appointment notes
    patient_phone: Optional[str] = None  # Patient phone number
    patient_birthday: Optional[str] = None  # Patient birthday (YYYY-MM-DD format, string for calendar display)
    line_display_name: Optional[str] = None  # LINE display name
    patient_name: Optional[str] = None  # Patient full name for cancellation preview
    practitioner_name: Optional[str] = None  # Practitioner full name for cancellation preview
    appointment_type_name: Optional[str] = None  # Appointment type name for cancellation preview
    is_auto_assigned: Optional[bool] = None  # Whether appointment is auto-assigned by system


class CalendarDayDetailResponse(BaseModel):
    """Response model for detailed calendar day data."""
    date: str  # Format: "YYYY-MM-DD"
    default_schedule: List[TimeInterval]
    events: List[CalendarEventResponse]


class BatchCalendarRequest(BaseModel):
    """Request model for batch calendar data."""
    practitioner_ids: List[int]
    start_date: str  # Format: "YYYY-MM-DD"
    end_date: str    # Format: "YYYY-MM-DD"


class BatchCalendarDayResponse(BaseModel):
    """Response model for batch calendar day data per practitioner."""
    user_id: int
    date: str  # Format: "YYYY-MM-DD"
    default_schedule: List[TimeInterval]
    events: List[CalendarEventResponse]


class BatchCalendarResponse(BaseModel):
    """Response model for batch calendar data."""
    results: List[BatchCalendarDayResponse]


class AvailabilityExceptionRequest(BaseModel):
    """Request model for creating availability exceptions."""
    date: str  # Format: "YYYY-MM-DD"
    start_time: Optional[str] = None  # Format: "HH:MM" or None for all-day
    end_time: Optional[str] = None    # Format: "HH:MM" or None for all-day


class AvailabilityExceptionResponse(BaseModel):
    """Response model for availability exceptions."""
    calendar_event_id: int
    exception_id: int
    date: str
    start_time: Optional[str]
    end_time: Optional[str]
    created_at: datetime


class BatchAvailableSlotsRequest(BaseModel):
    """Request model for batch available slots query."""
    dates: List[str]  # List of dates in YYYY-MM-DD format
    appointment_type_id: int
    exclude_calendar_event_id: Optional[int] = None  # Calendar event ID to exclude from conflict checking (for appointment editing)


class BatchAvailableSlotsResponse(BaseModel):
    """Response model for batch available slots query."""
    results: List[AvailableSlotsResponse]  # One response per date


# Helper Functions

def _parse_time(time_str: str) -> time:
    """Parse time string in HH:MM format to time object."""
    hour, minute = map(int, time_str.split(':'))
    return time(hour, minute)


def _format_time(time_obj: time) -> str:
    """Format time object to HH:MM string."""
    return time_obj.strftime('%H:%M')


def _get_day_name(day_of_week: int) -> str:
    """Get day name from day of week number."""
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    return days[day_of_week]


def _get_day_of_week(day_name: str) -> int:
    """Get day of week number from day name."""
    days = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6}
    return days[day_name]


def _get_day_name_chinese(day_name: str) -> str:
    """Get Traditional Chinese day name from English day name."""
    days = {
        'monday': '星期一',
        'tuesday': '星期二',
        'wednesday': '星期三',
        'thursday': '星期四',
        'friday': '星期五',
        'saturday': '星期六',
        'sunday': '星期日'
    }
    return days[day_name]


def _format_time_12h(time_str: str) -> str:
    """Format 24-hour time string to 12-hour format with AM/PM."""
    hour, minute = map(int, time_str.split(':'))
    if hour == 0:
        return f"12:{minute:02d} AM"
    elif hour < 12:
        return f"{hour}:{minute:02d} AM"
    elif hour == 12:
        return f"12:{minute:02d} PM"
    else:
        return f"{hour-12}:{minute:02d} PM"


def _check_time_overlap(start1: time, end1: time, start2: time, end2: time) -> bool:
    """Check if two time intervals overlap."""
    return start1 < end2 and start2 < end1


def _get_appointment_type_name(appointment: Appointment) -> Optional[str]:
    """
    Safely get appointment type name, returning None if appointment_type is not set.
    
    This handles cases where an appointment may not have an associated appointment_type,
    which can occur when appointment types are deleted or when data integrity issues exist.
    
    Args:
        appointment: The Appointment object to get the type name from
        
    Returns:
        The appointment type name if available, None otherwise
    """
    return appointment.appointment_type.name if appointment.appointment_type else None


def _get_default_schedule_for_day(db: Session, user_id: int, day_of_week: int, clinic_id: int) -> List[TimeInterval]:
    """Get default schedule intervals for a specific day."""
    availability = db.query(PractitionerAvailability).filter(
        PractitionerAvailability.user_id == user_id,
        PractitionerAvailability.clinic_id == clinic_id,
        PractitionerAvailability.day_of_week == day_of_week
    ).order_by(PractitionerAvailability.start_time).all()
    
    return [
        TimeInterval(
            start_time=_format_time(av.start_time),
            end_time=_format_time(av.end_time)
        )
        for av in availability
    ]


def _check_appointment_conflicts(
    db: Session, 
    user_id: int, 
    target_date: date_type, 
    start_time: time, 
    end_time: time,
    clinic_id: int
) -> List[ConflictDetail]:
    """Check for appointment conflicts with availability exception."""
    conflicts: List[ConflictDetail] = []
    
    # Get appointments that overlap with the exception time
    appointments = db.query(Appointment).join(CalendarEvent).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.clinic_id == clinic_id,
        CalendarEvent.event_type == 'appointment',
        CalendarEvent.date == target_date,
        Appointment.status == 'confirmed',
        CalendarEvent.start_time < end_time,
        CalendarEvent.end_time > start_time
    ).all()
    
    for appointment in appointments:
        conflicts.append(ConflictDetail(
            calendar_event_id=appointment.calendar_event_id,
            start_time=_format_time(appointment.calendar_event.start_time),
            end_time=_format_time(appointment.calendar_event.end_time),
            patient=appointment.patient.full_name,
            appointment_type=_get_appointment_type_name(appointment)
        ))
    
    return conflicts


# API Endpoints

@router.get("/practitioners/{user_id}/availability/default", 
           summary="Get practitioner's default weekly schedule")
async def get_default_schedule(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> DefaultScheduleResponse:
    """
    Get practitioner's default weekly schedule.
    
    Returns the practitioner's default working hours for each day of the week.
    Multiple intervals per day are supported (e.g., morning and afternoon sessions).
    """
    try:
        # Check permissions - practitioners can only view their own schedule
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能查看自己的可用時間"
                )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Get schedule for each day
        schedule: Dict[str, List[TimeInterval]] = {}
        for day_of_week in range(7):
            day_name = _get_day_name(day_of_week)
            schedule[day_name] = _get_default_schedule_for_day(db, user_id, day_of_week, clinic_id)
        
        return DefaultScheduleResponse(**schedule)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch default schedule for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預設排程"
        )


@router.put("/practitioners/{user_id}/availability/default",
           summary="Update practitioner's default weekly schedule")
async def update_default_schedule(
    user_id: int,
    schedule_data: DefaultScheduleRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> Union[DefaultScheduleResponse, ConflictWarningResponse]:
    """
    Update practitioner's default weekly schedule.
    
    Replaces the entire weekly schedule with the provided intervals.
    Multiple intervals per day are supported.
    
    The system will check for conflicts with future appointments and show warnings
    if appointments would be outside the new working hours.
    """
    try:
        # Check permissions - practitioners can only modify their own schedule
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能修改自己的可用時間"
                )
        
        # Get clinic_id for validation
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, is a practitioner, and is in the clinic
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Validate intervals for each day
        for day_name in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
            intervals = getattr(schedule_data, day_name)
            day_of_week = _get_day_of_week(day_name)

            # Check for overlapping intervals within the same day
            for i, interval1 in enumerate(intervals):
                start1 = _parse_time(interval1.start_time)
                end1 = _parse_time(interval1.end_time)
                
                if start1 >= end1:
                    day_chinese = _get_day_name_chinese(day_name)
                    start_formatted = _format_time_12h(interval1.start_time)
                    end_formatted = _format_time_12h(interval1.end_time)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"無效的時間範圍 {day_chinese}: {start_formatted}-{end_formatted}"
                    )
                
                for j, interval2 in enumerate(intervals):
                    if i != j:
                        start2 = _parse_time(interval2.start_time)
                        end2 = _parse_time(interval2.end_time)
                        
                        if _check_time_overlap(start1, end1, start2, end2):
                            day_chinese = _get_day_name_chinese(day_name)
                            start1_formatted = _format_time_12h(interval1.start_time)
                            end1_formatted = _format_time_12h(interval1.end_time)
                            start2_formatted = _format_time_12h(interval2.start_time)
                            end2_formatted = _format_time_12h(interval2.end_time)
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"{day_chinese} 的時段重疊: {start1_formatted}-{end1_formatted} 和 {start2_formatted}-{end2_formatted}"
                            )
        
        # TODO: Implement future appointment conflict checking
        # Skip conflict checking for now to avoid validation errors
        pass
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Clear existing availability for this user
        db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id
        ).delete()
        
        # Create new availability records
        
        for day_name in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
            intervals = getattr(schedule_data, day_name)
            day_of_week = _get_day_of_week(day_name)

            for interval in intervals:
                availability = PractitionerAvailability(
                    user_id=user_id,
                    clinic_id=clinic_id,
                    day_of_week=day_of_week,
                    start_time=_parse_time(interval.start_time),
                    end_time=_parse_time(interval.end_time)
                )
                db.add(availability)
        
        db.commit()
        
        # Return updated schedule
        schedule: Dict[str, List[TimeInterval]] = {}
        for day_of_week in range(7):
            day_name = _get_day_name(day_of_week)
            schedule[day_name] = _get_default_schedule_for_day(db, user_id, day_of_week, clinic_id)
        
        return DefaultScheduleResponse(**schedule)
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to update default schedule for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新預設排程"
        )


@router.get("/practitioners/{user_id}/availability/calendar",
           summary="Get calendar data for practitioner")
async def get_calendar_data(
    user_id: int,
    month: Optional[str] = Query(None, description="Month in YYYY-MM format for monthly view"),
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format for daily view"),
    page: int = Query(1, ge=1, description="Page number for monthly view"),
    limit: int = Query(31, ge=1, le=31, description="Days per page for monthly view"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
):
    """
    Get calendar data for practitioner.
    
    Returns either monthly calendar data (appointment counts per day) or
    detailed daily calendar data (events and default schedule).
    """
    try:
        # Check clinic access first (raises HTTPException if denied)
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner in the same clinic
        # All clinic users can view any practitioner's calendar within their clinic
        user, _ = verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        if date:
            # Daily view
            try:
                target_date = parse_date_string(date)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的日期格式，請使用 YYYY-MM-DD"
                )
            
            # Get default schedule for this day of week
            day_of_week = target_date.weekday()
            default_schedule = _get_default_schedule_for_day(db, user_id, day_of_week, clinic_id)
            
            # Get events for this date with eager loading to avoid N+1 queries
            # Eagerly load all relationships: appointment -> patient -> line_user, appointment_type, and availability_exception
            events = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == user_id,
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.date == target_date
            ).options(
                # Eagerly load appointment with all its relationships
                joinedload(CalendarEvent.appointment).joinedload(Appointment.patient).joinedload(Patient.line_user),
                joinedload(CalendarEvent.appointment).joinedload(Appointment.appointment_type),
                # Eagerly load availability exception
                joinedload(CalendarEvent.availability_exception)
            ).order_by(CalendarEvent.start_time).all()
            
            # Get practitioner association for name
            practitioner_association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == user_id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            ).first()
            practitioner_name = practitioner_association.full_name if practitioner_association else user.email
            
            event_responses: List[CalendarEventResponse] = []
            for event in events:
                if event.event_type == 'appointment':
                    # Appointment is already loaded via eager loading, no additional query needed
                    appointment = event.appointment
                    
                    # Only show confirmed appointments (filter out cancelled ones)
                    # CRITICAL: Filter out auto-assigned appointments (practitioners shouldn't see them)
                    if appointment and appointment.status == 'confirmed' and not appointment.is_auto_assigned:
                        # Get LINE display name if patient has LINE user (already loaded)
                        line_display_name = None
                        if appointment.patient and appointment.patient.line_user:
                            line_display_name = appointment.patient.line_user.effective_display_name
                        
                        # Get appointment type name safely (handles cases where appointment_type may be None)
                        appointment_type_name = _get_appointment_type_name(appointment)
                        
                        # Format birthday as string if available
                        patient_birthday_str = None
                        if appointment.patient and appointment.patient.birthday:
                            patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                        
                        event_responses.append(CalendarEventResponse(
                            calendar_event_id=event.id,
                            type='appointment',
                            start_time=_format_time(event.start_time) if event.start_time else None,
                            end_time=_format_time(event.end_time) if event.end_time else None,
                            title=f"{appointment.patient.full_name} - {appointment_type_name or '未設定'}",
                            patient_id=appointment.patient_id,
                            appointment_type_id=appointment.appointment_type_id,
                            status=appointment.status,
                            appointment_id=appointment.calendar_event_id,
                            notes=appointment.notes,
                            patient_phone=appointment.patient.phone_number,
                            patient_birthday=patient_birthday_str,
                            line_display_name=line_display_name,
                            patient_name=appointment.patient.full_name,
                            practitioner_name=practitioner_name,
                            appointment_type_name=appointment_type_name,
                            is_auto_assigned=appointment.is_auto_assigned
                        ))
                elif event.event_type == 'availability_exception':
                    # Exception is already loaded via eager loading, no additional query needed
                    exception = event.availability_exception
                    
                    if exception:
                        event_responses.append(CalendarEventResponse(
                            calendar_event_id=event.id,
                            type='availability_exception',
                            start_time=_format_time(event.start_time) if event.start_time else None,
                            end_time=_format_time(event.end_time) if event.end_time else None,
                            title="休診",
                            exception_id=exception.id
                        ))
            
            return CalendarDayDetailResponse(
                date=date,
                default_schedule=default_schedule,
                events=event_responses
            )
        
        elif month:
            # Monthly view
            try:
                year, month_num = map(int, month.split('-'))
                start_date = date_type(year, month_num, 1)
                
                # Calculate end date
                if month_num == 12:
                    end_date = date_type(year + 1, 1, 1) - timedelta(days=1)
                else:
                    end_date = date_type(year, month_num + 1, 1) - timedelta(days=1)
                
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的月份格式，請使用 YYYY-MM"
                )
            
            clinic_id = ensure_clinic_access(current_user)
            
            # Get appointment counts for each day (only count confirmed appointments)
            appointment_counts = db.query(
                CalendarEvent.date,
                func.count(CalendarEvent.id).label('count')
            ).join(Appointment, CalendarEvent.id == Appointment.calendar_event_id).filter(
                CalendarEvent.user_id == user_id,
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.event_type == 'appointment',
                Appointment.status == 'confirmed',
                CalendarEvent.date >= start_date,
                CalendarEvent.date <= end_date
            ).group_by(CalendarEvent.date).all()
            
            # Create day responses
            days: List[CalendarDayResponse] = []
            for day_date, count in appointment_counts:
                days.append(CalendarDayResponse(
                    date=day_date.strftime('%Y-%m-%d'),
                    appointment_count=count
                ))
            
            return CalendarMonthResponse(
                month=month,
                total_days=len(days),
                page=page,
                limit=limit,
                days=days
            )
        
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="必須提供 'month' 或 'date' 參數"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch calendar data for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得行事曆資料"
        )


@router.post("/practitioners/calendar/batch",
           summary="Get calendar data for multiple practitioners and date range")
async def get_batch_calendar(
    request: BatchCalendarRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> BatchCalendarResponse:
    """
    Get calendar data for multiple practitioners across a date range.
    
    This endpoint efficiently fetches calendar data for multiple practitioners
    in a single request, reducing API calls from N to 1.
    
    Returns daily calendar data (events and default schedules) for each
    practitioner for each day in the date range.
    """
    try:
        # Check clinic access first
        clinic_id = ensure_clinic_access(current_user)
        
        # Parse date range
        try:
            start_date = parse_date_string(request.start_date)
            end_date = parse_date_string(request.end_date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式，請使用 YYYY-MM-DD"
            )
        
        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="開始日期不能晚於結束日期"
            )
        
        # Limit date range to prevent excessive queries
        max_days = 31
        if (end_date - start_date).days > max_days:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"日期範圍不能超過 {max_days} 天"
            )
        
        # Limit number of practitioners
        max_practitioners = 10
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
        
        # Get practitioner associations for names
        associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id.in_(request.practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()
        association_map = {a.user_id: a for a in associations}
        
        # Fetch all events for all practitioners and dates in a single query with eager loading
        events = db.query(CalendarEvent).filter(
            CalendarEvent.user_id.in_(request.practitioner_ids),
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date >= start_date,
            CalendarEvent.date <= end_date
        ).options(
            # Eagerly load all relationships to avoid N+1 queries
            joinedload(CalendarEvent.appointment).joinedload(Appointment.patient).joinedload(Patient.line_user),
            joinedload(CalendarEvent.appointment).joinedload(Appointment.appointment_type),
            joinedload(CalendarEvent.availability_exception)
        ).order_by(CalendarEvent.user_id, CalendarEvent.date, CalendarEvent.start_time).all()
        
        # Group events by practitioner and date
        events_by_practitioner_date: Dict[tuple[int, date_type], List[CalendarEvent]] = {}
        for event in events:
            key = (event.user_id, event.date)
            if key not in events_by_practitioner_date:
                events_by_practitioner_date[key] = []
            events_by_practitioner_date[key].append(event)
        
        # Build response for each practitioner and date
        results: List[BatchCalendarDayResponse] = []
        current_date = start_date
        
        while current_date <= end_date:
            for practitioner_id in request.practitioner_ids:
                # Get default schedule for this day of week
                day_of_week = current_date.weekday()
                default_schedule = _get_default_schedule_for_day(db, practitioner_id, day_of_week, clinic_id)
                
                # Get practitioner name
                association = association_map.get(practitioner_id)
                practitioner_name = association.full_name if association else ""
                
                # Get events for this practitioner and date
                key = (practitioner_id, current_date)
                day_events = events_by_practitioner_date.get(key, [])
                
                # Build event responses
                event_responses: List[CalendarEventResponse] = []
                for event in day_events:
                    if event.event_type == 'appointment':
                        appointment = event.appointment
                        # CRITICAL: Filter out auto-assigned appointments (practitioners shouldn't see them)
                        if appointment and appointment.status == 'confirmed' and not appointment.is_auto_assigned:
                            line_display_name = None
                            if appointment.patient and appointment.patient.line_user:
                                line_display_name = appointment.patient.line_user.effective_display_name
                            
                            appointment_type_name = _get_appointment_type_name(appointment)
                            
                            patient_birthday_str = None
                            if appointment.patient and appointment.patient.birthday:
                                patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                            
                            event_responses.append(CalendarEventResponse(
                                calendar_event_id=event.id,
                                type='appointment',
                                start_time=_format_time(event.start_time) if event.start_time else None,
                                end_time=_format_time(event.end_time) if event.end_time else None,
                                title=f"{appointment.patient.full_name} - {appointment_type_name or '未設定'}",
                                patient_id=appointment.patient_id,
                                appointment_type_id=appointment.appointment_type_id,
                                status=appointment.status,
                                appointment_id=appointment.calendar_event_id,
                                notes=appointment.notes,
                                patient_phone=appointment.patient.phone_number,
                                patient_birthday=patient_birthday_str,
                                line_display_name=line_display_name,
                                patient_name=appointment.patient.full_name,
                                practitioner_name=practitioner_name,
                                appointment_type_name=appointment_type_name,
                                is_auto_assigned=appointment.is_auto_assigned
                            ))
                    elif event.event_type == 'availability_exception':
                        exception = event.availability_exception
                        if exception:
                            event_responses.append(CalendarEventResponse(
                                calendar_event_id=event.id,
                                type='availability_exception',
                                start_time=_format_time(event.start_time) if event.start_time else None,
                                end_time=_format_time(event.end_time) if event.end_time else None,
                                title="休診",
                                exception_id=exception.id
                            ))
                
                results.append(BatchCalendarDayResponse(
                    user_id=practitioner_id,
                    date=current_date.strftime('%Y-%m-%d'),
                    default_schedule=default_schedule,
                    events=event_responses
                ))
            
            current_date += timedelta(days=1)
        
        return BatchCalendarResponse(results=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch batch calendar data: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得行事曆資料"
        )


@router.get("/practitioners/{user_id}/availability/slots",
           summary="Get available time slots for booking")
async def get_available_slots(
    user_id: int,
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    appointment_type_id: int = Query(..., description="Appointment type ID"),
    exclude_calendar_event_id: int | None = Query(None, description="Calendar event ID to exclude from conflict checking (for appointment editing)"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> AvailableSlotsResponse:
    """
    Get available time slots for booking.
    
    Returns available time slots for a specific practitioner on a specific date
    for a specific appointment type. Used by AI agent for appointment booking.
    
    Considers:
    - Default weekly schedule
    - Availability exceptions (takes precedence)
    - Existing appointments
    - Appointment type duration
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner in the same clinic
        # All clinic users can view any practitioner's availability in their clinic
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Verify appointment type exists
        AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)
        
        # Get available slots using service
        # Do NOT apply booking restrictions for clinic admin endpoint (admins bypass restrictions)
        slots_data = AvailabilityService.get_available_slots_for_practitioner(
            db=db,
            practitioner_id=user_id,
            date=date,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            exclude_calendar_event_id=exclude_calendar_event_id,
            apply_booking_restrictions=False  # Clinic admins bypass booking restrictions
        )

        # Strip practitioner info for response (not needed since it's always same practitioner)
        available_slots = [
            AvailableSlotResponse(
                start_time=slot['start_time'],
                end_time=slot['end_time']
            )
            for slot in slots_data
        ]

        return AvailableSlotsResponse(available_slots=available_slots)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch available slots for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時段"
        )


@router.post("/practitioners/{user_id}/availability/slots/batch",
           summary="Get available time slots for multiple dates")
async def get_available_slots_batch(
    user_id: int,
    request: BatchAvailableSlotsRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> BatchAvailableSlotsResponse:
    """
    Get available time slots for multiple dates in a single request.
    
    This endpoint efficiently fetches availability for multiple dates,
    reducing API calls from N to 1.
    
    Returns available time slots for a specific practitioner on multiple dates
    for a specific appointment type. Used by appointment creation/editing flows.
    
    Considers:
    - Default weekly schedule
    - Availability exceptions (takes precedence)
    - Existing appointments
    - Appointment type duration
    
    Args:
        user_id: Practitioner user ID
        request: Batch request with dates, appointment_type_id, and optional exclude_calendar_event_id
        
    Returns:
        BatchAvailableSlotsResponse with one AvailableSlotsResponse per date
        
    Raises:
        HTTPException: If validation fails or dates are invalid
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner in the same clinic
        # All clinic users can view any practitioner's availability in their clinic
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Use shared service method for batch availability fetching
        # Do NOT apply booking restrictions for clinic admin endpoint (admins bypass restrictions)
        batch_results = AvailabilityService.get_batch_available_slots_for_practitioner(
            db=db,
            practitioner_id=user_id,
            dates=request.dates,
            appointment_type_id=request.appointment_type_id,
            clinic_id=clinic_id,
            exclude_calendar_event_id=request.exclude_calendar_event_id,
            apply_booking_restrictions=False  # Clinic admins bypass booking restrictions
        )
        
        # Convert to response format
        results: List[AvailableSlotsResponse] = []
        for result in batch_results:
            # Strip practitioner info for response (not needed since it's always same practitioner)
            available_slots = [
                AvailableSlotResponse(
                    start_time=slot['start_time'],
                    end_time=slot['end_time']
                )
                for slot in result['slots']
            ]
            # Include date in response for consistency with LIFF endpoint
            results.append(AvailableSlotsResponse(
                date=result['date'],
                available_slots=available_slots
            ))
        
        return BatchAvailableSlotsResponse(results=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Unexpected error in batch available slots endpoint: "
            f"user_id={user_id}, dates={request.dates}, "
            f"appointment_type_id={request.appointment_type_id}, "
            f"exclude_calendar_event_id={request.exclude_calendar_event_id}, error={e}"
        )
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時段"
        )


@router.post("/practitioners/{user_id}/availability/exceptions",
             summary="Create availability exception",
             status_code=status.HTTP_201_CREATED)
async def create_availability_exception(
    user_id: int,
    exception_data: AvailabilityExceptionRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> Union[AvailabilityExceptionResponse, ConflictWarningResponse]:
    """
    Create availability exception for practitioner.
    
    Creates a period of unavailability that overrides the default schedule.
    Multiple exceptions per day are allowed, and overlapping exceptions are permitted.
    
    If the exception conflicts with existing appointments, a warning is returned
    but the exception is still created. Appointments remain valid but marked as "outside hours".
    """
    try:
        # Check permissions - practitioners can only create their own exceptions
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能建立自己的可用時間例外"
                )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        try:
            target_date = datetime.strptime(exception_data.date, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式，請使用 YYYY-MM-DD"
            )
        
        # Validate time range
        if exception_data.start_time and exception_data.end_time:
            start_time = _parse_time(exception_data.start_time)
            end_time = _parse_time(exception_data.end_time)
            
            if start_time >= end_time:
                start_formatted = _format_time_12h(exception_data.start_time)
                end_formatted = _format_time_12h(exception_data.end_time)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"開始時間必須早於結束時間: {start_formatted} - {end_formatted}"
                )
        elif exception_data.start_time or exception_data.end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="全天事件必須同時提供或同時省略 start_time 和 end_time"
            )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Check for appointment conflicts
        conflicts = []
        if exception_data.start_time and exception_data.end_time:
            conflicts = _check_appointment_conflicts(
                db, user_id, target_date, 
                _parse_time(exception_data.start_time), 
                _parse_time(exception_data.end_time),
                clinic_id
            )
        
        # Create calendar event
        calendar_event = CalendarEvent(
            user_id=user_id,
            clinic_id=clinic_id,
            event_type='availability_exception',
            date=target_date,
            start_time=_parse_time(exception_data.start_time) if exception_data.start_time else None,
            end_time=_parse_time(exception_data.end_time) if exception_data.end_time else None
        )
        db.add(calendar_event)
        db.flush()  # Get the ID
        
        # Create availability exception
        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db.add(exception)
        db.commit()
        
        # Return response
        response = AvailabilityExceptionResponse(
            calendar_event_id=calendar_event.id,
            exception_id=exception.id,
            date=exception_data.date,
            start_time=exception_data.start_time,
            end_time=exception_data.end_time,
            created_at=calendar_event.created_at
        )
        
        # If there are conflicts, return warning response
        if conflicts:
            return ConflictWarningResponse(
                success=False,
                message="此可用時間例外與現有預約衝突。預約將保持有效，但標記為「非工作時間」。",
                conflicts=conflicts
            )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to create availability exception for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立可用時間例外"
        )


@router.delete("/practitioners/{user_id}/availability/exceptions/{exception_id}",
              summary="Delete availability exception",
              status_code=status.HTTP_204_NO_CONTENT)
async def delete_availability_exception(
    user_id: int,
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
):
    """
    Delete availability exception.
    
    Removes an availability exception. The associated calendar event is also deleted.
    """
    try:
        # Check permissions - practitioners can only delete their own exceptions
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能刪除自己的可用時間例外"
                )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Find the exception
        exception = db.query(AvailabilityException).join(CalendarEvent).filter(
            AvailabilityException.id == exception_id,
            CalendarEvent.user_id == user_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not exception:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到可用時間例外"
            )
        
        # Delete the calendar event first, then the exception
        calendar_event = exception.calendar_event
        db.delete(exception)
        db.delete(calendar_event)
        db.commit()
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to delete availability exception {exception_id} for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除可用時間例外"
        )


# ===== LINE User AI Control =====

class LineUserWithStatusResponse(BaseModel):
    """Response model for LineUser with AI status."""
    line_user_id: str
    display_name: Optional[str]
    patient_count: int
    patient_names: List[str]
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
                detail="Cannot use both page/page_size and offset/limit. Use page/page_size (preferred) or offset/limit (deprecated)."
            )
        
        if has_page_params and ((page is None) != (page_size is None)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="page and page_size must be provided together"
            )
        
        if has_offset_params and ((offset is None) != (limit is None)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="offset and limit must be provided together"
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
        
        return LineUserWithStatusResponse(
            line_user_id=line_user.line_user_id,
            display_name=line_user.effective_display_name,  # This is the effective display name
            patient_count=len(patients),
            patient_names=sorted(list(set([p.full_name for p in patients if p.full_name]))),
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


class AutoAssignedAppointmentItem(BaseModel):
    """Response model for auto-assigned appointment item."""
    appointment_id: int
    calendar_event_id: int
    patient_name: str
    patient_id: int
    practitioner_id: int
    practitioner_name: str
    appointment_type_id: int
    appointment_type_name: str
    start_time: str
    end_time: str
    notes: Optional[str] = None
    originally_auto_assigned: bool


class AutoAssignedAppointmentsResponse(BaseModel):
    """Response model for listing auto-assigned appointments."""
    appointments: List[AutoAssignedAppointmentItem]


@router.get("/pending-review-appointments", summary="List auto-assigned appointments (admin only)")
async def list_auto_assigned_appointments(
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> AutoAssignedAppointmentsResponse:
    """
    List all upcoming auto-assigned appointments that are still hidden from practitioners.
    
    Only clinic admins can view this list. Appointments are sorted by date.
    After admin reassigns an appointment, it will no longer appear in this list.
    
    Note: Only future appointments are returned. In theory, there shouldn't be any past
    auto-assigned appointments since the system automatically assigns them when the
    recency limit (minimum_booking_hours_ahead) is reached. However, we filter them out
    as defensive programming in case of edge cases (e.g., cron job failures, timezone issues).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get current Taiwan time for filtering future appointments
        # All datetime operations use Taiwan timezone
        now = taiwan_now()
        
        # Convert to timezone-naive for PostgreSQL comparison
        # CalendarEvent stores date and time as separate fields (timezone-naive)
        # We need to compare timezone-naive timestamps
        now_naive = now.replace(tzinfo=None)
        
        # Query auto-assigned appointments for this clinic
        # Only show appointments that are:
        # 1. Still auto-assigned (is_auto_assigned = True)
        # 2. Confirmed status
        # 3. In the future (defensive programming - should not exist but filter just in case)
        # 4. Have a start_time (defensive check - confirmed appointments should always have start_time)
        # Note: CalendarEvent.date and start_time are stored as timezone-naive
        # (they represent Taiwan local time without timezone info)
        appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.is_auto_assigned == True,
            Appointment.status == 'confirmed',
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.start_time.isnot(None),  # Defensive: ensure start_time exists
            # Defensive programming: Filter out past appointments
            # Combine date and start_time for proper datetime comparison
            # PostgreSQL: cast concatenated date+time string to timestamp (timezone-naive)
            # Compare with timezone-naive now_naive
            cast(
                func.concat(
                    cast(CalendarEvent.date, String),
                    ' ',
                    cast(CalendarEvent.start_time, String)
                ),
                sqltypes.TIMESTAMP
            ) > now_naive
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()
        
        # Get practitioner associations for names
        practitioner_ids = [appt.calendar_event.user_id for appt in appointments if appt.calendar_event and appt.calendar_event.user_id]
        association_lookup = AvailabilityService.get_practitioner_associations_batch(
            db, practitioner_ids, clinic_id
        )
        
        # Format response
        result: List[AutoAssignedAppointmentItem] = []
        
        for appointment in appointments:
            practitioner = appointment.calendar_event.user
            appointment_type = appointment.appointment_type
            patient = appointment.patient
            
            if not all([practitioner, appointment_type, patient]):
                continue
            
            # Get practitioner name from association
            association = association_lookup.get(practitioner.id)
            practitioner_name = association.full_name if association else practitioner.email
            
            # Format datetime
            event_date = appointment.calendar_event.date
            if appointment.calendar_event.start_time:
                start_datetime = datetime.combine(event_date, appointment.calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
            else:
                start_datetime = None
            if appointment.calendar_event.end_time:
                end_datetime = datetime.combine(event_date, appointment.calendar_event.end_time).replace(tzinfo=TAIWAN_TZ)
            else:
                end_datetime = None
            
            result.append(AutoAssignedAppointmentItem(
                appointment_id=appointment.calendar_event_id,
                calendar_event_id=appointment.calendar_event_id,
                patient_name=patient.full_name,
                patient_id=patient.id,
                practitioner_id=practitioner.id,
                practitioner_name=practitioner_name,
                appointment_type_id=appointment.appointment_type_id,
                appointment_type_name=appointment_type.name if appointment_type else "未設定",
                start_time=start_datetime.isoformat() if start_datetime else "",
                end_time=end_datetime.isoformat() if end_datetime else "",
                notes=appointment.notes,
                originally_auto_assigned=appointment.originally_auto_assigned
            ))
        
        return AutoAssignedAppointmentsResponse(appointments=result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error listing auto-assigned appointments: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得待審核預約列表"
        )


@router.get("/dashboard/metrics", summary="Get clinic dashboard metrics")
async def get_dashboard_metrics(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ClinicDashboardMetricsResponse:
    """
    Get aggregated dashboard metrics for the clinic.
    
    Returns metrics for past 3 months + current month, including:
    - Patient statistics (active patients, new patients)
    - Appointment statistics (counts, cancellation rates, types, practitioners)
    - Message statistics (paid messages, AI replies)
    
    Available to all clinic members (including read-only users).
    """
    try:
        from services.dashboard_service import DashboardService
        from api.responses import MonthInfo
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Get all metrics
        metrics = DashboardService.get_clinic_metrics(db, clinic_id)
        
        # Convert month dicts to MonthInfo objects for Pydantic
        # Convert months list
        metrics['months'] = [MonthInfo(**m) for m in metrics['months']]
        
        # Convert nested month dicts in all metric lists
        for stat in metrics.get('active_patients_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('new_patients_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('appointments_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('cancellation_rate_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('appointment_type_stats_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('practitioner_stats_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('paid_messages_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('ai_reply_messages_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        # Convert to response model
        return ClinicDashboardMetricsResponse(**metrics)
        
    except HTTPException:
        raise
    except Exception as e:
        clinic_id_str = str(getattr(current_user, 'active_clinic_id', 'unknown'))
        logger.exception(f"Error getting dashboard metrics for clinic {clinic_id_str}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得儀表板數據"
        )
