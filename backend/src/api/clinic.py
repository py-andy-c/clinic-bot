# pyright: reportMissingTypeStubs=false
"""
Clinic management API endpoints.

Provides clinic-specific operations for admins and practitioners,
including member management, settings, patients, and appointments.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session
from utils.datetime_utils import parse_datetime_string_to_taiwan

logger = logging.getLogger(__name__)

from core.database import get_db
from core.config import FRONTEND_URL
from auth.dependencies import require_admin_role, require_authenticated, require_practitioner_or_admin, UserContext, ensure_clinic_access
from models import User, SignupToken, Clinic, AppointmentType, PractitionerAvailability, CalendarEvent, UserClinicAssociation, Appointment
from models.clinic import ClinicSettings, ChatSettings as ChatSettingsModel
from services import PatientService, AppointmentService, PractitionerService, AppointmentTypeService, ReminderService
from services.availability_service import AvailabilityService
from services.notification_service import NotificationService, CancellationSource
from services.clinic_agent import ClinicAgentService
from utils.appointment_type_queries import count_active_appointment_types_for_practitioner
from utils.datetime_utils import taiwan_now
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

        return {"members": member_list}

    except Exception as e:
        logger.exception(f"Error getting members list: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
               appointment_type_instructions=clinic.appointment_type_instructions,
               require_birthday=validated_settings.clinic_info_settings.require_birthday
           ),
           chat_settings=ChatSettings.model_validate(validated_settings.chat_settings.model_dump())
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
        clinic_id = ensure_clinic_access(current_user)

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
                    warning_info["practitioners"] = practitioner_names
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
        blocked_types: List[Dict[str, Any]] = []
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法處理測試訊息"
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
        clinic_id = ensure_clinic_access(current_user)
        patients = PatientService.list_patients_for_clinic(
            db=db,
            clinic_id=clinic_id
        )

        # Format for clinic response (includes line_user_id and display_name)
        patient_list = [
            ClinicPatientResponse(
                id=patient.id,
                full_name=patient.full_name,
                phone_number=patient.phone_number,
                birthday=patient.birthday,
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
        clinic_id = ensure_clinic_access(current_user)
        
        # Get practitioner with association
        result = db.query(User, UserClinicAssociation).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        # Check if user has practitioner role
        if not result or 'practitioner' not in (result[1].roles or []):
            practitioner = None
        else:
            practitioner = result[0]

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

        # Get availability for this clinic
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id
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
        clinic_id = ensure_clinic_access(current_user)
        
        # Get practitioner with association
        result = db.query(User, UserClinicAssociation).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        # Check if user has practitioner role
        if not result or 'practitioner' not in (result[1].roles or []):
            practitioner = None
        else:
            practitioner = result[0]

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

        # Check if availability already exists for this day in this clinic
        existing = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id,
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
            clinic_id=clinic_id,
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

        # Verify the practitioner belongs to current clinic
        clinic_id = ensure_clinic_access(current_user)
        
        # Find the availability for this clinic
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.id == availability_id,
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id
        ).first()

        if not availability:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到可用時間"
            )
        
        # Get practitioner with association
        result = db.query(User, UserClinicAssociation).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        # Check if user has practitioner role
        if not result or 'practitioner' not in (result[1].roles or []):
            practitioner = None
        else:
            practitioner = result[0]

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
                PractitionerAvailability.clinic_id == clinic_id,
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
        # Verify the practitioner belongs to current clinic
        clinic_id = ensure_clinic_access(current_user)
        
        # Find the availability for this clinic
        availability = db.query(PractitionerAvailability).filter(
            PractitionerAvailability.id == availability_id,
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id
        ).first()

        if not availability:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到可用時間"
            )
        
        # Get practitioner with association
        result = db.query(User, UserClinicAssociation).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        # Check if user has practitioner role
        if not result or 'practitioner' not in (result[1].roles or []):
            practitioner = None
        else:
            practitioner = result[0]

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
        clinic_id = ensure_clinic_access(current_user)
        result = AppointmentService.cancel_appointment_by_clinic_admin(
            db=db,
            appointment_id=appointment_id,
            clinic_id=clinic_id
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


# ===== Appointment Management (Create, Edit, Reassign) =====

def parse_datetime_field_validator(values: Dict[str, Any], field_name: str) -> Dict[str, Any]:
    """
    Shared validator to parse datetime string fields to Taiwan timezone.
    
    This function is used by Pydantic model validators to convert datetime strings
    to timezone-aware datetime objects in Taiwan timezone.
    
    Args:
        values: Dictionary of field values (from Pydantic model_validator)
        field_name: Name of the datetime field to parse
        
    Returns:
        Updated values dictionary with parsed datetime
    """
    if field_name in values and values.get(field_name):
        if isinstance(values[field_name], str):
            try:
                values[field_name] = parse_datetime_string_to_taiwan(values[field_name])
            except ValueError:
                pass  # Let Pydantic handle the error
    return values


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
        return parse_datetime_field_validator(values, 'start_time')


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
        return parse_datetime_field_validator(values, 'start_time')


class AppointmentEditPreviewRequest(BaseModel):
    """Request model for previewing edit notification."""
    new_practitioner_id: Optional[int] = None
    new_start_time: Optional[datetime] = None
    note: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return parse_datetime_field_validator(values, 'new_start_time')


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
        
        # Create appointment
        result = AppointmentService.create_appointment_for_patient(
            db=db,
            clinic_id=clinic_id,
            patient_id=request.patient_id,
            appointment_type_id=request.appointment_type_id,
            start_time=request.start_time,
            practitioner_id=request.practitioner_id,
            notes=request.notes
        )
        
        # Send LINE notification
        try:
            appointment = db.query(Appointment).filter(
                Appointment.calendar_event_id == result['appointment_id']
            ).first()
            if appointment and appointment.patient:
                patient = appointment.patient
                if patient.line_user:
                    # Format appointment time for notification
                    from utils.datetime_utils import format_datetime
                    appointment_time = format_datetime(request.start_time)
                    # Get appointment type name from appointment object (more reliable)
                    appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else '預約'
                    
                    # Get practitioner name (practitioner_id is always provided for clinic-initiated appointments)
                    practitioner = db.query(User).get(request.practitioner_id)
                    if practitioner:
                        # Get practitioner name from association
                        association = db.query(UserClinicAssociation).filter(
                            UserClinicAssociation.user_id == practitioner.id,
                            UserClinicAssociation.clinic_id == clinic_id,
                            UserClinicAssociation.is_active == True
                        ).first()
                        practitioner_name = association.full_name if association else practitioner.email
                    else:
                        practitioner_name = "未知治療師"
                    
                    # Generate and send notification
                    from services.line_service import LINEService
                    clinic = patient.clinic
                    line_service = LINEService(
                        channel_secret=clinic.line_channel_secret,
                        channel_access_token=clinic.line_channel_access_token
                    )
                    message = f"{patient.full_name}，您的預約已建立：\n\n{appointment_time} - 【{appointment_type_name}】{practitioner_name}治療師"
                    if request.notes:
                        message += f"\n\n備註：{request.notes}"
                    message += "\n\n期待為您服務！"
                    line_service.send_text_message(patient.line_user.line_user_id, message)
        except Exception as e:
            logger.exception(f"Failed to send LINE notification for appointment creation: {e}")
            # Don't fail the request if notification fails
        
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        
        # Store old values for notification (before edit)
        from utils.datetime_utils import TAIWAN_TZ
        old_start_time = datetime.combine(calendar_event.date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id = calendar_event.user_id
        old_is_auto_assigned = appointment.is_auto_assigned
        
        # Determine if notification should be sent BEFORE updating appointment
        # Calculate actual values (use current if None provided)
        new_practitioner_id = request.practitioner_id if request.practitioner_id is not None else old_practitioner_id
        new_start_time = request.start_time if request.start_time is not None else old_start_time
        
        should_send = AppointmentService.should_send_edit_notification(
            old_appointment=appointment,
            new_practitioner_id=new_practitioner_id,
            new_start_time=new_start_time
        )
        
        # Edit appointment (service handles business logic, not permissions)
        result = AppointmentService.edit_appointment(
            db=db,
            appointment_id=appointment_id,
            clinic_id=clinic_id,
            current_user_id=current_user.user_id,
            new_practitioner_id=request.practitioner_id,
            new_start_time=request.start_time,
            new_notes=request.notes
        )
        
        # Refresh appointment to get updated values for notification
        db.refresh(appointment)
                
        # Send notification if needed
        # Note: Notification failures are caught and logged but don't fail the request.
        # This ensures appointment edits succeed even if LINE service is temporarily unavailable.
        if should_send:
            try:
                # Get practitioners for notification
                old_practitioner = None
                if not old_is_auto_assigned:
                    old_practitioner = db.query(User).get(old_practitioner_id)
                
                new_practitioner = None
                if request.practitioner_id:
                    new_practitioner = db.query(User).get(request.practitioner_id)
                elif not appointment.is_auto_assigned:
                    new_practitioner = db.query(User).get(appointment.calendar_event.user_id)
                
                notification_sent = NotificationService.send_appointment_edit_notification(
                    db=db,
                    appointment=appointment,
                    old_practitioner=old_practitioner,
                    new_practitioner=new_practitioner,
                    old_start_time=old_start_time,
                    new_start_time=new_start_time,
                    note=request.notification_note  # Use separate notification note, not appointment notes
                )
                if not notification_sent:
                    logger.warning(f"Failed to send edit notification for appointment {appointment_id} (check logs above)")
            except Exception as e:
                logger.exception(f"Failed to send LINE notification for appointment edit: {e}")
                # Don't fail the request if notification fails
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to edit appointment: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="獲取治療師狀態失敗"
        )


