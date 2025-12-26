# pyright: reportMissingTypeStubs=false
"""
Settings Management API endpoints.
"""

import logging
import secrets
import os
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import status as http_status
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.database import get_db
from auth.dependencies import require_admin_role, require_authenticated, UserContext, ensure_clinic_access
from models import Clinic, AppointmentType, UserClinicAssociation
from services import AppointmentTypeService
from services.availability_service import AvailabilityService
from models.clinic import ClinicSettings
from utils.datetime_utils import taiwan_now
from utils.appointment_queries import (
    count_future_appointments_for_appointment_type,
    count_past_appointments_for_appointment_type
)
from api.responses import (
    AppointmentTypeResponse,
    AppointmentTypeDeletionErrorResponse,
    AppointmentTypeReference
)

logger = logging.getLogger(__name__)

router = APIRouter()


class NotificationSettings(BaseModel):
    """Notification settings for clinic."""
    reminder_hours_before: int = 24


class BookingRestrictionSettings(BaseModel):
    """Booking restriction settings for clinic."""
    booking_restriction_type: str = "minimum_hours_required"
    minimum_booking_hours_ahead: int = 24
    deadline_time_day_before: Optional[str] = "08:00"
    deadline_on_same_day: bool = False
    step_size_minutes: int = 30
    max_future_appointments: int = 3
    max_booking_window_days: int = 90
    minimum_cancellation_hours_before: int = 24
    allow_patient_deletion: bool = True

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

    @model_validator(mode='after')
    @classmethod
    def normalize_deadline_time(cls, data: Any) -> Any:
        """
        Normalize deadline_time_day_before to 24-hour format (HH:MM).
        
        Validates and formats the time string to ensure it's in HH:MM format.
        Minutes are always set to 00 for simplicity.
        """
        if isinstance(data, dict):
            deadline_time: Any = data.get('deadline_time_day_before')  # type: ignore[reportUnknownVariableType]
            if deadline_time and isinstance(deadline_time, str):
                # Validate 24-hour format (HH:MM)
                if ':' in deadline_time and ('AM' not in deadline_time.upper() and 'PM' not in deadline_time.upper()):
                    try:
                        hour, minute = map(int, deadline_time.split(':'))
                        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
                            raise ValueError(f"Invalid 24-hour time: {deadline_time}")
                        # Always set minutes to 00 for simplicity
                        data['deadline_time_day_before'] = f"{hour:02d}:00"
                    except ValueError:
                        # If parsing fails, keep original (Pydantic will validate)
                        pass
        return data  # type: ignore[reportUnknownVariableType]


class ClinicInfoSettings(BaseModel):
    """Clinic information settings for display in calendar events and LINE reminders."""
    display_name: Optional[str] = None
    address: Optional[str] = None
    phone_number: Optional[str] = None
    appointment_type_instructions: Optional[str] = None
    appointment_notes_instructions: Optional[str] = None
    require_birthday: bool = False
    require_gender: bool = False


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


class ReceiptSettings(BaseModel):
    """Receipt settings for clinic."""
    custom_notes: Optional[str] = None
    show_stamp: bool = False


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
    receipt_settings: ReceiptSettings
    liff_urls: Optional[Dict[str, str]] = None  # Dictionary of mode -> URL (excluding 'home')


class AppointmentTypeDeletionValidationRequest(BaseModel):
    """Request model for validating appointment type deletion."""
    appointment_type_ids: List[int]


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
        clinic_id = ensure_clinic_access(current_user)
        
        # Get clinic info
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        appointment_types = AppointmentTypeService.list_appointment_types_for_clinic(
            db, clinic_id
        )

        appointment_type_list = [
            AppointmentTypeResponse(
                id=at.id,
                clinic_id=at.clinic_id,
                name=at.name,
                duration_minutes=at.duration_minutes,
                receipt_name=at.receipt_name,
                allow_patient_booking=at.allow_patient_booking,
                allow_patient_practitioner_selection=at.allow_patient_practitioner_selection,
                description=at.description,
                scheduling_buffer_minutes=at.scheduling_buffer_minutes,
                service_type_group_id=at.service_type_group_id,
                display_order=at.display_order,
                send_patient_confirmation=at.send_patient_confirmation,
                send_clinic_confirmation=at.send_clinic_confirmation,
                send_reminder=at.send_reminder,
                patient_confirmation_message=at.patient_confirmation_message,
                clinic_confirmation_message=at.clinic_confirmation_message,
                reminder_message=at.reminder_message
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
        
        # Generate LIFF URLs for all modes except 'home' and 'reschedule' (read-only operation - no auto-generation)
        # 'home' is excluded as it's not shown in the UI (but URL still works if accessed directly)
        # 'reschedule' is excluded as it requires appointmentId parameter and is not a standalone entry point
        # Tokens should be generated via explicit endpoints or during clinic creation
        from utils.liff_token import generate_liff_url
        liff_urls: Optional[Dict[str, str]] = {}
        modes = ['book', 'query', 'settings', 'notifications']  # All modes except 'home' and 'reschedule'
        try:
            for mode in modes:
                try:
                    liff_urls[mode] = generate_liff_url(clinic, mode=mode)  # type: ignore[assignment]
                except ValueError:
                    # Skip this mode if URL generation fails
                    pass
            # If no URLs were generated, set to None
            if not liff_urls:
                liff_urls = None
        except Exception:
            # If there's any error, set to None
            liff_urls = None
        
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
            receipt_settings=ReceiptSettings.model_validate(validated_settings.receipt_settings.model_dump() if hasattr(validated_settings, 'receipt_settings') else {"custom_notes": None, "show_stamp": False}),
            liff_urls=liff_urls
        )

    except Exception as e:
        logger.exception(f"Error getting clinic settings: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得設定"
        )


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
            future_appointment_count = count_future_appointments_for_appointment_type(
                db, appointment_type_id
            )

            # Check for past appointments (just informational)
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
        
        # Helper function to get message or default value
        def get_message_or_default(raw_message: str | None, default_message: str, toggle_on: bool) -> str:
            """Get message from request or use default if empty/whitespace."""
            if toggle_on:
                if not raw_message or not raw_message.strip():
                    return default_message
                return raw_message
            return raw_message if raw_message else default_message

        # Helper function to update notes customization fields
        def update_notes_fields(appointment_type: AppointmentType, data: Dict[str, Any]) -> None:
            """Update notes customization fields from incoming data."""
            if "require_notes" in data:
                appointment_type.require_notes = data.get("require_notes", False)
            if "notes_instructions" in data:
                # Normalize empty string to null
                notes_instructions = data.get("notes_instructions")
                appointment_type.notes_instructions = notes_instructions if notes_instructions and notes_instructions.strip() else None

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
        # Track which (name, duration) combinations we've processed
        processed_combinations: set[tuple[str, int]] = set()
        
        # Helper function to update message customization fields
        def update_message_fields(appointment_type: AppointmentType, incoming_data: Dict[str, Any]) -> None:
            """Update message customization fields from incoming data if provided."""
            if "send_patient_confirmation" in incoming_data:
                appointment_type.send_patient_confirmation = incoming_data.get("send_patient_confirmation", True)
            if "send_clinic_confirmation" in incoming_data:
                appointment_type.send_clinic_confirmation = incoming_data.get("send_clinic_confirmation", True)
            if "send_reminder" in incoming_data:
                appointment_type.send_reminder = incoming_data.get("send_reminder", True)
            if "patient_confirmation_message" in incoming_data:
                message = incoming_data.get("patient_confirmation_message")
                if message is not None:
                    appointment_type.patient_confirmation_message = str(message)
            if "clinic_confirmation_message" in incoming_data:
                message = incoming_data.get("clinic_confirmation_message")
                if message is not None:
                    appointment_type.clinic_confirmation_message = str(message)
            if "reminder_message" in incoming_data:
                message = incoming_data.get("reminder_message")
                if message is not None:
                    appointment_type.reminder_message = str(message)
        
        # First, update existing types that are matched by ID
        for existing_type in existing_appointment_types:
            if existing_type.id in types_being_updated:
                # Update the existing type with new name/duration and billing fields
                incoming_data = types_being_updated[existing_type.id]
                new_name = incoming_data.get("name")
                new_duration = incoming_data.get("duration_minutes")
                if new_name is not None and new_duration is not None:
                    existing_type.name = new_name
                    existing_type.duration_minutes = new_duration
                # Update billing fields if provided
                if "receipt_name" in incoming_data:
                    existing_type.receipt_name = incoming_data.get("receipt_name")
                if "allow_patient_booking" in incoming_data:
                    existing_type.allow_patient_booking = incoming_data.get("allow_patient_booking", True)
                # Only update if explicitly provided (not None/undefined)
                if "allow_patient_practitioner_selection" in incoming_data:
                    raw_value = incoming_data.get("allow_patient_practitioner_selection")
                    if raw_value is not None:
                        existing_type.allow_patient_practitioner_selection = bool(raw_value)
                if "description" in incoming_data:
                    existing_type.description = incoming_data.get("description")
                if "scheduling_buffer_minutes" in incoming_data:
                    existing_type.scheduling_buffer_minutes = incoming_data.get("scheduling_buffer_minutes", 0)
                # Update grouping and ordering if provided
                if "service_type_group_id" in incoming_data:
                    existing_type.service_type_group_id = incoming_data.get("service_type_group_id")
                if "display_order" in incoming_data:
                    existing_type.display_order = incoming_data.get("display_order", 0)
                # Update notes customization fields
                update_notes_fields(existing_type, incoming_data)
                # Update message customization fields if provided
                update_message_fields(existing_type, incoming_data)
                if existing_type.is_deleted:
                    existing_type.is_deleted = False
                    existing_type.deleted_at = None
                processed_combinations.add((existing_type.name, existing_type.duration_minutes))
            elif existing_type.id in incoming_by_id:
                # Type is being kept, but may have billing field updates
                incoming_data = incoming_by_id[existing_type.id]
                # Update billing fields if provided
                if "receipt_name" in incoming_data:
                    existing_type.receipt_name = incoming_data.get("receipt_name")
                if "allow_patient_booking" in incoming_data:
                    existing_type.allow_patient_booking = incoming_data.get("allow_patient_booking", True)
                # Only update if explicitly provided (not None/undefined)
                if "allow_patient_practitioner_selection" in incoming_data:
                    raw_value = incoming_data.get("allow_patient_practitioner_selection")
                    if raw_value is not None:
                        existing_type.allow_patient_practitioner_selection = bool(raw_value)
                if "description" in incoming_data:
                    existing_type.description = incoming_data.get("description")
                if "scheduling_buffer_minutes" in incoming_data:
                    existing_type.scheduling_buffer_minutes = incoming_data.get("scheduling_buffer_minutes", 0)
                # Update grouping and ordering if provided
                if "service_type_group_id" in incoming_data:
                    existing_type.service_type_group_id = incoming_data.get("service_type_group_id")
                if "display_order" in incoming_data:
                    existing_type.display_order = incoming_data.get("display_order", 0)
                # Update notes customization fields
                update_notes_fields(existing_type, incoming_data)
                # Update message customization fields if provided
                update_message_fields(existing_type, incoming_data)
                if existing_type.is_deleted:
                    existing_type.is_deleted = False
                    existing_type.deleted_at = None
                processed_combinations.add((existing_type.name, existing_type.duration_minutes))
            elif (existing_type.name, existing_type.duration_minutes) in incoming_by_name_duration:
                # Type is being kept (matched by name+duration, no ID in incoming)
                incoming_data = incoming_by_name_duration[(existing_type.name, existing_type.duration_minutes)]
                # Update grouping and ordering if provided
                if "service_type_group_id" in incoming_data:
                    existing_type.service_type_group_id = incoming_data.get("service_type_group_id")
                if "display_order" in incoming_data:
                    existing_type.display_order = incoming_data.get("display_order", 0)
                # Update notes customization fields
                update_notes_fields(existing_type, incoming_data)
                # Update message customization fields if provided
                update_message_fields(existing_type, incoming_data)
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
                # Reactivate if it was soft deleted and update billing fields
                if existing.is_deleted:
                    existing.is_deleted = False
                    existing.deleted_at = None
                # Update billing fields if provided
                if "receipt_name" in at_data:
                    existing.receipt_name = at_data.get("receipt_name")
                if "allow_patient_booking" in at_data:
                    existing.allow_patient_booking = at_data.get("allow_patient_booking", True)
                # Only update if explicitly provided (not None/undefined)
                if "allow_patient_practitioner_selection" in at_data:
                    raw_value = at_data.get("allow_patient_practitioner_selection")
                    if raw_value is not None:
                        existing.allow_patient_practitioner_selection = bool(raw_value)
                if "description" in at_data:
                    existing.description = at_data.get("description")
                if "scheduling_buffer_minutes" in at_data:
                    existing.scheduling_buffer_minutes = at_data.get("scheduling_buffer_minutes", 0)
                # Update grouping and ordering if provided
                if "service_type_group_id" in at_data:
                    existing.service_type_group_id = at_data.get("service_type_group_id")
                if "display_order" in at_data:
                    existing.display_order = at_data.get("display_order", 0)
                # Update notes customization fields
                update_notes_fields(existing, at_data)
                # Update message settings if provided
                if "send_patient_confirmation" in at_data:
                    existing.send_patient_confirmation = at_data.get("send_patient_confirmation", True)
                if "send_clinic_confirmation" in at_data:
                    existing.send_clinic_confirmation = at_data.get("send_clinic_confirmation", True)
                if "send_reminder" in at_data:
                    existing.send_reminder = at_data.get("send_reminder", True)
                if "patient_confirmation_message" in at_data:
                    existing.patient_confirmation_message = at_data.get("patient_confirmation_message")
                if "clinic_confirmation_message" in at_data:
                    existing.clinic_confirmation_message = at_data.get("clinic_confirmation_message")
                if "reminder_message" in at_data:
                    existing.reminder_message = at_data.get("reminder_message")
            else:
                # Create new
                # Handle None as missing value (default to True)
                raw_practitioner_selection = at_data.get("allow_patient_practitioner_selection")
                allow_practitioner_selection = raw_practitioner_selection if raw_practitioner_selection is not None else True
                
                # Get max display_order for new items
                max_order = db.query(func.max(AppointmentType.display_order)).filter(
                    AppointmentType.clinic_id == clinic_id
                ).scalar()
                default_display_order = (max_order + 1) if max_order is not None else 0
                
                # Import default message constants
                from core.message_template_constants import (
                    DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
                    DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
                    DEFAULT_REMINDER_MESSAGE
                )
                
                # Get message settings from request or use defaults
                send_patient_confirmation = at_data.get("send_patient_confirmation", True)
                send_clinic_confirmation = at_data.get("send_clinic_confirmation", True)
                send_reminder = at_data.get("send_reminder", True)
                
                # For messages: use default if not provided, empty, or whitespace
                # This handles cases where frontend sends empty string '' or None
                patient_confirmation_message = get_message_or_default(
                    at_data.get("patient_confirmation_message"),
                    DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
                    send_patient_confirmation
                )
                clinic_confirmation_message = get_message_or_default(
                    at_data.get("clinic_confirmation_message"),
                    DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
                    send_clinic_confirmation
                )
                reminder_message = get_message_or_default(
                    at_data.get("reminder_message"),
                    DEFAULT_REMINDER_MESSAGE,
                    send_reminder
                )
                
                appointment_type = AppointmentType(
                    clinic_id=clinic_id,
                    name=name,
                    duration_minutes=duration,
                    receipt_name=at_data.get("receipt_name"),
                    allow_patient_booking=at_data.get("allow_patient_booking", True),
                    allow_patient_practitioner_selection=allow_practitioner_selection,
                    description=at_data.get("description"),
                    scheduling_buffer_minutes=at_data.get("scheduling_buffer_minutes", 0),
                    service_type_group_id=at_data.get("service_type_group_id"),
                    display_order=at_data.get("display_order", default_display_order),
                    require_notes=at_data.get("require_notes", False),
                    notes_instructions=at_data.get("notes_instructions") if at_data.get("notes_instructions") and at_data.get("notes_instructions").strip() else None,
                    send_patient_confirmation=send_patient_confirmation,
                    send_clinic_confirmation=send_clinic_confirmation,
                    send_reminder=send_reminder,
                    patient_confirmation_message=patient_confirmation_message,
                    clinic_confirmation_message=clinic_confirmation_message,
                    reminder_message=reminder_message
                )
                db.add(appointment_type)
                # Log appointment type creation for debugging (only in development)
                if os.getenv('ENVIRONMENT') == 'development':
                    logger.debug("Creating new appointment type: name=%s, duration=%s, clinic_id=%s, temp_id=%s", 
                                name, duration, clinic_id, at_data.get('id'))

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

        # Validate message fields: if toggle is ON, message must be non-empty and within character limit
        # Only validate active (non-deleted) appointment types
        all_appointment_types = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).all()
        for at in all_appointment_types:
            if at.send_patient_confirmation:
                if not at.patient_confirmation_message or not at.patient_confirmation_message.strip():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"服務項目「{at.name}」：啟用病患確認訊息時，訊息模板為必填"
                    )
                if len(at.patient_confirmation_message) > 3500:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"服務項目「{at.name}」：病患確認訊息模板長度超過限制（3500字元）"
                    )
            if at.send_clinic_confirmation:
                if not at.clinic_confirmation_message or not at.clinic_confirmation_message.strip():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"服務項目「{at.name}」：啟用診所確認訊息時，訊息模板為必填"
                    )
                if len(at.clinic_confirmation_message) > 3500:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"服務項目「{at.name}」：診所確認訊息模板長度超過限制（3500字元）"
                    )
            if at.send_reminder:
                if not at.reminder_message or not at.reminder_message.strip():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"服務項目「{at.name}」：啟用提醒訊息時，訊息模板為必填"
                    )
                if len(at.reminder_message) > 3500:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"服務項目「{at.name}」：提醒訊息模板長度超過限制（3500字元）"
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

