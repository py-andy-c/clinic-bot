# pyright: reportMissingTypeStubs=false
"""
Settings Management API endpoints.
"""

import logging
import secrets
import os
import re
import copy
from typing import Dict, List, Optional, Any, Callable

from core.sentinels import MISSING


def _update_field_if_present(obj: Any, field_name: str, data: Dict[str, Any], transform: Optional[Callable[[Any], Any]] = None) -> bool:
    """
    Update a field on an object if it exists in the data dictionary.
    Returns True if the field was updated.
    """
    if (val := data.get(field_name, MISSING)) is not MISSING:
        if transform:
            val = transform(val)
        setattr(obj, field_name, val)
        return True
    return False

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import status as http_status
from pydantic import BaseModel, model_validator, field_validator, Field
from datetime import time, datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func, or_, text


from core.database import get_db
from auth.dependencies import require_admin_role, require_authenticated, UserContext, ensure_clinic_access
from models import (
    Clinic,
    AppointmentType,
    UserClinicAssociation,
    PractitionerAppointmentTypes,
    BillingScenario,
    AppointmentResourceRequirement,
    FollowUpMessage,
    ResourceType
)
from services import AppointmentTypeService
from services.availability_service import AvailabilityService
from utils.datetime_utils import taiwan_now
from utils.dict_utils import deep_merge
from utils.appointment_queries import (
    count_future_appointments_for_appointment_type,
    count_past_appointments_for_appointment_type
)
from utils.id_utils import is_real_id
from api.responses import (
    AppointmentTypeResponse,
    AppointmentTypeDeletionErrorResponse,
    AppointmentTypeReference
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Module-level constants for helper functions (synced with core.message_template_constants)
from core.message_template_constants import (
    DEFAULT_PATIENT_CONFIRMATION_MESSAGE as _DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
    DEFAULT_CLINIC_CONFIRMATION_MESSAGE as _DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
    DEFAULT_REMINDER_MESSAGE as _DEFAULT_REMINDER_MESSAGE,
    DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE as _DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE
)




def _evict_soft_deleted_appointment_type_name(
    db: Session, 
    clinic_id: int, 
    name: str, 
    duration_minutes: int,
    exclude_id: Optional[int] = None
) -> None:
    """
    If a soft-deleted appointment type exists with the given name and duration, 
    rename it to a unique name to avoid name collisions when an active 
    appointment type wants to take the name.
    """
    conflict_items = db.query(AppointmentType).filter(
        AppointmentType.clinic_id == clinic_id,
        AppointmentType.name == name,
        AppointmentType.duration_minutes == duration_minutes,
        AppointmentType.is_deleted == True
    )
    if exclude_id is not None:
        conflict_items = conflict_items.filter(AppointmentType.id != exclude_id)
    
    results = conflict_items.all()
    for conflict_item in results:
        suffix = datetime.now().strftime("%Y%m%d%H%M%S%f")
        conflict_item.name = f"{conflict_item.name} (deleted-{suffix})"
        # Log eviction for audit/debug
        logger.info(f"Evicted soft-deleted appointment type name: {name} -> {conflict_item.name} (ID: {conflict_item.id})")
    
    if results:
        db.flush()


def _get_message_or_default(raw_message: Any, default_message: str) -> str:
    """
    Get message from request or use default if empty/whitespace.
    Ensures we never store literal "None" string in the database.
    """
    # Convert to string and strip if it's not None
    msg_str = str(raw_message).strip() if raw_message is not None else ""
    
    # We don't allow empty messages in the database (they are NOT NULL).
    # If user provides empty/whitespace, we revert to the system default.
    return msg_str if msg_str else default_message


def _update_notes_fields(appointment_type: AppointmentType, data: Dict[str, Any]) -> None:
    """Update notes customization fields from incoming data."""
    _update_field_if_present(appointment_type, "require_notes", data, bool)
    
    def transform_notes(v: Any) -> Optional[str]:
        # Notes and instructions ARE nullable in the DB
        s = str(v).strip() if v is not None else ""
        return s if s else None

    _update_field_if_present(appointment_type, "notes_instructions", data, transform_notes)


def _update_message_fields(appointment_type: AppointmentType, data: Dict[str, Any]) -> None:
    """Update message customization fields from incoming data."""
    # 1. Update messages first using their own intended toggle state (to avoid temporal coupling)
    # The toggle affects the "Reset to Default" logic (if we had any toggle-dependent logic here).
    # Currently _get_message_or_default is simple, but we handle messages before toggles to be safe.
    
    message_fields = [
        ("patient_confirmation_message", _DEFAULT_PATIENT_CONFIRMATION_MESSAGE),
        ("clinic_confirmation_message", _DEFAULT_CLINIC_CONFIRMATION_MESSAGE),
        ("reminder_message", _DEFAULT_REMINDER_MESSAGE),
        ("recurrent_clinic_confirmation_message", _DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE),
    ]

    for field_name, default_val in message_fields:
        _update_field_if_present(
            appointment_type, 
            field_name, 
            data, 
            lambda v, d=default_val: _get_message_or_default(v, d)
        )

    # 2. Update toggles
    _update_field_if_present(appointment_type, "send_patient_confirmation", data, bool)
    _update_field_if_present(appointment_type, "send_clinic_confirmation", data, bool)
    _update_field_if_present(appointment_type, "send_reminder", data, bool)
    _update_field_if_present(appointment_type, "send_recurrent_clinic_confirmation", data, bool)


def _process_existing_appointment_type_update(
    existing_type: AppointmentType,
    incoming_data: Dict[str, Any]
) -> None:
    """Process update for an existing appointment type."""
    # Handle basic identifying fields
    _update_field_if_present(existing_type, "name", incoming_data, str)
    _update_field_if_present(existing_type, "duration_minutes", incoming_data, int)
    _update_field_if_present(existing_type, "receipt_name", incoming_data)

    # Handle visibility fields
    _update_field_if_present(existing_type, "allow_new_patient_booking", incoming_data, bool)
    _update_field_if_present(existing_type, "allow_existing_patient_booking", incoming_data, bool)

    # Handle multiple time slot selection
    _update_field_if_present(existing_type, "allow_multiple_time_slot_selection", incoming_data, bool)

    # Handle practitioner selection
    _update_field_if_present(existing_type, "allow_patient_practitioner_selection", incoming_data, bool)

    # Handle other basic fields
    _update_field_if_present(existing_type, "description", incoming_data)
    _update_field_if_present(existing_type, "scheduling_buffer_minutes", incoming_data, int)

    # Update grouping and ordering if provided
    _update_field_if_present(existing_type, "service_type_group_id", incoming_data)
    _update_field_if_present(existing_type, "display_order", incoming_data, int)

    # Update notes and message fields
    _update_notes_fields(existing_type, incoming_data)
    _update_message_fields(existing_type, incoming_data)

    _reactivate_if_soft_deleted(existing_type)


def _reactivate_if_soft_deleted(obj: Any) -> None:
    """Reactivate a soft-deleted object and log the action."""
    if getattr(obj, "is_deleted", False):
        obj.is_deleted = False
        obj.deleted_at = None
        logger.info(
            "Reactivated soft-deleted %s (ID: %s)", 
            obj.__class__.__name__, 
            getattr(obj, "id", "unknown")
        )


def _create_new_appointment_type(
    db: Session,
    clinic_id: int,
    at_data: Dict[str, Any],
    default_display_order: int
) -> Optional[AppointmentType]:
    """Create a new appointment type from incoming data."""
    name = at_data.get("name")
    duration = at_data.get("duration_minutes")

    if not name or not duration:
        return None

    # Check if this type already exists (maybe was soft deleted or has different ID)
    existing = db.query(AppointmentType).filter(
        AppointmentType.clinic_id == clinic_id,
        AppointmentType.name == name,
        AppointmentType.duration_minutes == duration
    ).first()

    if existing:
        # Update existing type (reactivates if soft-deleted)
        _process_existing_appointment_type_update(existing, at_data)
        return existing

    # Before creating a truly new one, evict any soft-deleted item with the same name and duration
    _evict_soft_deleted_appointment_type_name(db, clinic_id, name, duration)

    # Create new appointment type
    allow_practitioner_selection = at_data.get("allow_patient_practitioner_selection", True)

    appointment_type = AppointmentType(
        clinic_id=clinic_id,
        name=name,
        duration_minutes=duration,
        receipt_name=at_data.get("receipt_name"),
        allow_patient_booking=at_data.get("allow_patient_booking", True),  # DEPRECATED
        allow_new_patient_booking=at_data.get("allow_new_patient_booking", True),
        allow_existing_patient_booking=at_data.get("allow_existing_patient_booking", True),
        allow_patient_practitioner_selection=allow_practitioner_selection,
        allow_multiple_time_slot_selection=at_data.get("allow_multiple_time_slot_selection", False),
        description=at_data.get("description"),
        scheduling_buffer_minutes=at_data.get("scheduling_buffer_minutes", 0),
        service_type_group_id=at_data.get("service_type_group_id"),
        display_order=at_data.get("display_order", default_display_order),
        require_notes=at_data.get("require_notes", False),
        notes_instructions=at_data.get("notes_instructions") if at_data.get("notes_instructions") and str(at_data.get("notes_instructions")).strip() else None,
        send_patient_confirmation=at_data.get("send_patient_confirmation", True),
        send_clinic_confirmation=at_data.get("send_clinic_confirmation", True),
        send_reminder=at_data.get("send_reminder", True),
        patient_confirmation_message=_get_message_or_default(
            at_data.get("patient_confirmation_message"),
            _DEFAULT_PATIENT_CONFIRMATION_MESSAGE
        ),
        clinic_confirmation_message=_get_message_or_default(
            at_data.get("clinic_confirmation_message"),
            _DEFAULT_CLINIC_CONFIRMATION_MESSAGE
        ),
        reminder_message=_get_message_or_default(
            at_data.get("reminder_message"),
            _DEFAULT_REMINDER_MESSAGE
        )
    )

    db.add(appointment_type)

    # Log appointment type creation for debugging (only in development)
    if os.getenv('ENVIRONMENT') == 'development':
        logger.debug("Creating new appointment type: name=%s, duration=%s, clinic_id=%s, temp_id=%s",
                    name, duration, clinic_id, at_data.get('id'))

    return appointment_type


class NotificationSettings(BaseModel):
    """Notification settings for clinic."""
    reminder_hours_before: int = 24
    reminder_timing_mode: str = "hours_before"
    reminder_previous_day_time: Optional[str] = "21:00"

    @field_validator('reminder_previous_day_time')
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if not re.match(r'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$', v):
                raise ValueError('Time must be in 24-hour format HH:MM')
        return v


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
    restrict_to_assigned_practitioners: bool = False
    query_page_instructions: Optional[str] = None
    settings_page_instructions: Optional[str] = None
    notifications_page_instructions: Optional[str] = None


class TimePeriod(BaseModel):
    """A specific time period with start and end times in HH:MM format."""
    start_time: str
    end_time: str

class AIWeeklySchedule(BaseModel):
    """Weekly schedule for AI replies."""
    mon: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]
    tue: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]
    wed: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]
    thu: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]
    fri: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]
    sat: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]
    sun: List[TimePeriod] = Field(default_factory=list) # pyright: ignore[reportUnknownVariableType]

class ChatSettings(BaseModel):
    """Chat/chatbot settings for clinic."""
    chat_enabled: bool = False
    label_ai_replies: bool = True
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
    ai_reply_schedule_enabled: bool = False
    ai_reply_schedule: Optional[AIWeeklySchedule] = None


class ReceiptSettings(BaseModel):
    """Receipt settings for clinic."""
    custom_notes: Optional[str] = None
    show_stamp: bool = False


class BillingScenarioBundleData(BaseModel):
    id: Optional[int] = None
    practitioner_id: int
    name: str = Field(..., min_length=1)
    amount: Decimal = Field(..., ge=0)
    revenue_share: Decimal = Field(..., ge=0)
    is_default: bool = False
    
    @model_validator(mode='after')
    def validate_revenue_share(self):
        if self.revenue_share > self.amount:
            raise ValueError('revenue_share must be less than or equal to amount')
        return self


class ResourceRequirementBundleData(BaseModel):
    resource_type_id: int
    resource_type_name: Optional[str] = None
    quantity: int


class FollowUpMessageBundleData(BaseModel):
    id: Optional[int] = None
    timing_mode: str
    hours_after: Optional[int] = None
    days_after: Optional[int] = None
    time_of_day: Optional[str] = None
    message_template: str
    is_enabled: bool = True
    display_order: int = 0


class ServiceItemBundleAssociations(BaseModel):
    practitioner_ids: List[int] = []
    billing_scenarios: List[BillingScenarioBundleData] = []
    resource_requirements: List[ResourceRequirementBundleData] = []
    follow_up_messages: List[FollowUpMessageBundleData] = []


class ServiceItemData(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    duration_minutes: int = Field(..., ge=1)
    receipt_name: Optional[str] = None
    allow_patient_booking: bool = True
    allow_new_patient_booking: bool = True
    allow_existing_patient_booking: bool = True
    allow_patient_practitioner_selection: bool = True
    allow_multiple_time_slot_selection: bool = False
    description: Optional[str] = None
    scheduling_buffer_minutes: int = 0
    service_type_group_id: Optional[int] = None
    display_order: int = 0
    send_patient_confirmation: bool = True
    send_clinic_confirmation: bool = True
    send_reminder: bool = True
    send_recurrent_clinic_confirmation: bool = True
    patient_confirmation_message: Optional[str] = None
    clinic_confirmation_message: Optional[str] = None
    reminder_message: Optional[str] = None
    recurrent_clinic_confirmation_message: Optional[str] = None
    require_notes: bool = False
    notes_instructions: Optional[str] = None

    @model_validator(mode='after')
    def validate_templates(self) -> 'ServiceItemData':
        """Validate placeholders in message templates."""
        # Standard templates
        from services.message_template_service import MessageTemplateService
        
        for field, template in [
            ("patient_confirmation_message", self.patient_confirmation_message),
            ("clinic_confirmation_message", self.clinic_confirmation_message),
            ("reminder_message", self.reminder_message)
        ]:
            if template:
                errors = MessageTemplateService.validate_template(
                    template, MessageTemplateService.STANDARD_PLACEHOLDERS
                )
                if errors:
                    raise ValueError(f"{field}: {', '.join(errors)}")
        
        # Recurrent template
        if self.recurrent_clinic_confirmation_message:
            errors = MessageTemplateService.validate_template(
                self.recurrent_clinic_confirmation_message, 
                MessageTemplateService.RECURRENT_PLACEHOLDERS
            )
            if errors:
                raise ValueError(f"recurrent_clinic_confirmation_message: {', '.join(errors)}")
                
        return self


def _create_billing_scenario(
    clinic_id: int,
    appointment_type_id: int,
    bs_data: BillingScenarioBundleData
) -> BillingScenario:
    """Helper to create a BillingScenario record."""
    return BillingScenario(
        clinic_id=clinic_id,
        appointment_type_id=appointment_type_id,
        practitioner_id=bs_data.practitioner_id,
        name=bs_data.name,
        amount=bs_data.amount,
        revenue_share=bs_data.revenue_share,
        is_default=bs_data.is_default,
        created_at=taiwan_now(),
        updated_at=taiwan_now()
    )


def _create_follow_up_message(
    clinic_id: int,
    appointment_type_id: int,
    fm_data: FollowUpMessageBundleData
) -> FollowUpMessage:
    """Helper to create a FollowUpMessage record."""
    fm_time = None
    if fm_data.time_of_day:
        h, m = map(int, fm_data.time_of_day.split(':'))
        fm_time = time(h, m)

    return FollowUpMessage(
        clinic_id=clinic_id,
        appointment_type_id=appointment_type_id,
        timing_mode=fm_data.timing_mode,
        hours_after=fm_data.hours_after,
        days_after=fm_data.days_after,
        time_of_day=fm_time,
        message_template=fm_data.message_template,
        is_enabled=fm_data.is_enabled,
        display_order=fm_data.display_order
    )


class ServiceItemBundleRequest(BaseModel):
    item: ServiceItemData
    associations: ServiceItemBundleAssociations


class ServiceItemBundleResponse(BaseModel):
    item: AppointmentTypeResponse
    associations: ServiceItemBundleAssociations


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
                allow_patient_booking=at.allow_patient_booking,  # DEPRECATED
                allow_new_patient_booking=at.allow_new_patient_booking,
                allow_existing_patient_booking=at.allow_existing_patient_booking,
                allow_patient_practitioner_selection=at.allow_patient_practitioner_selection,
                allow_multiple_time_slot_selection=at.allow_multiple_time_slot_selection,
                description=at.description,
                scheduling_buffer_minutes=at.scheduling_buffer_minutes,
                service_type_group_id=at.service_type_group_id,
                display_order=at.display_order,
                send_patient_confirmation=at.send_patient_confirmation,
                send_clinic_confirmation=at.send_clinic_confirmation,
                send_reminder=at.send_reminder,
                patient_confirmation_message=at.patient_confirmation_message,
                clinic_confirmation_message=at.clinic_confirmation_message,
                reminder_message=at.reminder_message,
                send_recurrent_clinic_confirmation=at.send_recurrent_clinic_confirmation,
                recurrent_clinic_confirmation_message=at.recurrent_clinic_confirmation_message,
                require_notes=at.require_notes,
                notes_instructions=at.notes_instructions
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
        
        # Generate LIFF URLs for all modes except 'reschedule' (read-only operation - no auto-generation)
        # 'reschedule' is excluded as it requires appointmentId parameter and is not a standalone entry point
        # Tokens should be generated via explicit endpoints or during clinic creation
        from utils.liff_token import generate_liff_url
        liff_urls: Optional[Dict[str, str]] = {}
        modes = ['home', 'book', 'query', 'settings', 'notifications']  # All modes except 'reschedule'
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
        
        # Convert validated settings to API response models
        chat_settings_model = ChatSettings.model_validate(validated_settings.chat_settings.model_dump())
        logger.debug(f"Returning chat_settings for clinic {clinic_id}: {chat_settings_model.model_dump()}")
        
        return SettingsResponse(
            clinic_id=clinic.id,
            clinic_name=clinic.name,
            business_hours=business_hours,
            appointment_types=appointment_type_list,
            # Convert from models to API response models - automatically includes all fields
            notification_settings=NotificationSettings.model_validate(validated_settings.notification_settings.model_dump()),
            booking_restriction_settings=BookingRestrictionSettings.model_validate(validated_settings.booking_restriction_settings.model_dump()),
            clinic_info_settings=ClinicInfoSettings.model_validate(validated_settings.clinic_info_settings.model_dump()),
            chat_settings=chat_settings_model,
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


@router.delete("/appointment-types/{id}", summary="Delete an appointment type")
async def delete_appointment_type(
    id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Delete an appointment type (soft delete).
    
    Only clinic admins can delete appointment types.
    The appointment type must not be referenced by any practitioners.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # 1. Check if the appointment type exists and belongs to the clinic
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
            
        # 2. Check for practitioner references (blocking)
        # Use same logic as validate_appointment_type_deletion
        practitioners = AvailabilityService.get_practitioners_for_appointment_type(
            db=db,
            appointment_type_id=id,
            clinic_id=clinic_id
        )
        
        if practitioners:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法刪除此預約類型，因為有治療師正在提供此服務"
            )
            
        # 3. Perform soft delete
        AppointmentTypeService.soft_delete_appointment_type(db, id, clinic_id)
        db.commit()
        
        return {"message": "預約類型已刪除"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error deleting appointment type: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="刪除預約類型失敗"
        )


@router.put("/settings", summary="Update clinic settings")
async def update_settings(

    settings: Dict[str, Any],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
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
        types_to_delete: List[Any] = []
        types_being_updated: Dict[int, Dict[str, Any]] = {}

        # Only do this if appointment_types is provided in the request
        if "appointment_types" in settings:
            # Determine which appointment types are being deleted or updated
            # A type is being deleted if:
            # 1. It's not matched by ID (if incoming has ID), AND
            # 2. It's not matched by (name, duration) combination
            for existing_type in existing_appointment_types:
                # First try to match by ID (most reliable)
                if existing_type.id in incoming_by_id:
                    incoming_data = incoming_by_id[existing_type.id]
                    # Check if this is an update (name or duration changed) or just keeping it
                    # Use MISSING sentinel for safe comparison
                    incoming_name = incoming_data.get("name", MISSING)
                    incoming_duration = incoming_data.get("duration_minutes", MISSING)
                    
                    if (incoming_name is not MISSING and existing_type.name != incoming_name) or \
                       (incoming_duration is not MISSING and existing_type.duration_minutes != incoming_duration):
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
        # Get clinic object
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Update flat settings sections if present (Partial Update Pattern)
        # We merge incoming data into the existing settings dictionary
        current_settings = copy.deepcopy(clinic.settings)
        settings_sections = [
            "clinic_info_settings", 
            "notification_settings", 
            "booking_restriction_settings", 
            "chat_settings",
            "receipt_settings"
        ]
        
        settings_changed = False
        for section in settings_sections:
            incoming_section = settings.get(section, MISSING)
            if incoming_section is not MISSING:
                # Update the section in the current settings
                # We use deep_merge to ensure we don't clear fields omitted by the frontend
                logger.info(f"Updating settings section '{section}' for clinic {clinic_id}")
                if section == "chat_settings":
                    logger.debug(f"New chat_settings: {settings[section]}")
                
                # Perform recursive merge
                current_settings[section] = deep_merge(
                    current_settings.get(section, {}), 
                    incoming_section
                )
                settings_changed = True
        
        if settings_changed:
            clinic.settings = current_settings
            flag_modified(clinic, "settings")
            db.flush()

        # Process appointment types: update existing, create new, soft delete removed ones
        # Only process if appointment_types is explicitly provided in the request
        if "appointment_types" in settings:
            # Track which (name, duration) combinations we've processed
            processed_combinations: set[tuple[str, int]] = set()
            
            # First, update existing types that are matched by ID
            for existing_type in existing_appointment_types:
                if existing_type.id in types_being_updated:
                    # Update the existing type with new name/duration and billing fields
                    incoming_data = types_being_updated[existing_type.id]
                    # Helper handles all fields consistently including name/duration
                    _process_existing_appointment_type_update(existing_type, incoming_data)
                    processed_combinations.add((existing_type.name, existing_type.duration_minutes))
                elif existing_type.id in incoming_by_id:
                    # Type is being kept, but may have billing field updates
                    incoming_data = incoming_by_id[existing_type.id]
                    # Use helper function for all fields
                    _process_existing_appointment_type_update(existing_type, incoming_data)
                    processed_combinations.add((existing_type.name, existing_type.duration_minutes))
                elif (existing_type.name, existing_type.duration_minutes) in incoming_by_name_duration:
                    # Type is being kept (matched by name+duration, no ID in incoming)
                    incoming_data = incoming_by_name_duration[(existing_type.name, existing_type.duration_minutes)]
                    # Use helper function for all fields
                    _process_existing_appointment_type_update(existing_type, incoming_data)
                    processed_combinations.add((existing_type.name, existing_type.duration_minutes))
                elif existing_type in types_to_delete:
                    # Type is being deleted - already checked for practitioners above
                    # Soft delete it
                    if not existing_type.is_deleted:
                        existing_type.is_deleted = True
                        existing_type.deleted_at = taiwan_now()

            # Create new appointment types (ones not matched to existing types)
            max_order = db.query(func.max(AppointmentType.display_order)).filter(
                AppointmentType.clinic_id == clinic_id
            ).scalar()
            default_display_order = (max_order + 1) if max_order is not None else 0

            for at_data in appointment_types_data:
                if not at_data.get("name") or not at_data.get("duration_minutes"):
                    continue

                name = at_data.get("name")
                duration = at_data.get("duration_minutes")
                key = (name, duration)

                if key in processed_combinations:
                    continue

                appointment_type = _create_new_appointment_type(db, clinic_id, at_data, default_display_order)
                if appointment_type:
                    processed_combinations.add(key)
        
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


@router.get("/service-items/{id}/bundle", summary="Get service item bundle")
def get_service_item_bundle(
    id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ServiceItemBundleResponse:
    """Get service item and all its associations."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get appointment type
        at = db.query(AppointmentType).filter(
            AppointmentType.id == id,
            AppointmentType.clinic_id == clinic_id
        ).first()
        
        if not at:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="服務項目不存在"
            )
            
        # Get practitioner IDs
        practitioner_ids: List[int] = [
            pat.user_id 
            for pat in db.query(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == id,
                PractitionerAppointmentTypes.is_deleted == False
            ).all()
        ]
        
        # Get billing scenarios
        billing_scenarios: List[BillingScenarioBundleData] = [
            BillingScenarioBundleData(
                id=bs.id,
                practitioner_id=bs.practitioner_id,
                name=bs.name,
                amount=bs.amount,
                revenue_share=bs.revenue_share,
                is_default=bs.is_default
            )
            for bs in db.query(BillingScenario).filter(
                BillingScenario.appointment_type_id == id,
                BillingScenario.is_deleted == False
            ).all()
        ]
        
        # Get resource requirements
        resource_requirements: List[ResourceRequirementBundleData] = []
        
        # Use simple join to get resource type name
        rr_query = db.query(AppointmentResourceRequirement, ResourceType).join(
            ResourceType, 
            AppointmentResourceRequirement.resource_type_id == ResourceType.id
        ).filter(
            AppointmentResourceRequirement.appointment_type_id == id
        ).all()
        
        for rr, rt in rr_query:
            resource_requirements.append(ResourceRequirementBundleData(
                resource_type_id=rr.resource_type_id,
                resource_type_name=rt.name,
                quantity=rr.quantity
            ))
        
        # Get follow-up messages
        follow_up_messages: List[FollowUpMessageBundleData] = [
            FollowUpMessageBundleData(
                id=fm.id,
                timing_mode=fm.timing_mode,
                hours_after=fm.hours_after,
                days_after=fm.days_after,
                time_of_day=fm.time_of_day.strftime("%H:%M") if fm.time_of_day else None,
                message_template=fm.message_template,
                is_enabled=fm.is_enabled,
                display_order=fm.display_order
            )
            for fm in db.query(FollowUpMessage).filter(
                FollowUpMessage.appointment_type_id == id
            ).all()
        ]
        
        return ServiceItemBundleResponse(
            item=AppointmentTypeResponse(
                id=at.id,
                clinic_id=at.clinic_id,
                name=at.name,
                duration_minutes=at.duration_minutes,
                receipt_name=at.receipt_name,
                allow_patient_booking=at.allow_patient_booking,
                allow_new_patient_booking=at.allow_new_patient_booking,
                allow_existing_patient_booking=at.allow_existing_patient_booking,
                allow_patient_practitioner_selection=at.allow_patient_practitioner_selection,
                allow_multiple_time_slot_selection=at.allow_multiple_time_slot_selection,
                description=at.description,
                scheduling_buffer_minutes=at.scheduling_buffer_minutes,
                service_type_group_id=at.service_type_group_id,
                display_order=at.display_order,
                send_patient_confirmation=at.send_patient_confirmation,
                send_clinic_confirmation=at.send_clinic_confirmation,
                send_reminder=at.send_reminder,
                patient_confirmation_message=at.patient_confirmation_message,
                clinic_confirmation_message=at.clinic_confirmation_message,
                reminder_message=at.reminder_message,
                send_recurrent_clinic_confirmation=at.send_recurrent_clinic_confirmation,
                recurrent_clinic_confirmation_message=at.recurrent_clinic_confirmation_message,
                require_notes=at.require_notes,
                notes_instructions=at.notes_instructions
            ),
            associations=ServiceItemBundleAssociations(
                practitioner_ids=practitioner_ids,
                billing_scenarios=billing_scenarios,
                resource_requirements=resource_requirements,
                follow_up_messages=follow_up_messages
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting service item bundle: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得服務項目細節"
        )


def _sync_service_item_associations(
    db: Session,
    clinic_id: int,
    appointment_type_id: int,
    associations: ServiceItemBundleAssociations
) -> None:
    """
    Sync all associations for a service item in a single transaction.
    Uses Hard Sync (Replace-All) for practitioners and diff-based sync for others.
    """
    # Verification: Ensure assigned practitioners belong to this clinic
    if associations.practitioner_ids:
        clinic_practitioner_count = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.user_id.in_(associations.practitioner_ids),
            UserClinicAssociation.is_active == True
        ).count()
        if clinic_practitioner_count != len(associations.practitioner_ids):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="一個或多個指派的治療師不屬於此診所或已停用"
            )

    # 1. Practitioner Appointment Types (Hard Sync)
    # Deactivate all current practitioner associations for this item
    db.query(PractitionerAppointmentTypes).filter(
        PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
        PractitionerAppointmentTypes.is_deleted == False
    ).update({"is_deleted": True, "deleted_at": taiwan_now()}, synchronize_session='fetch')
    
    # Reactivate or create new ones
    for p_id in associations.practitioner_ids:
        pat = db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
            PractitionerAppointmentTypes.user_id == p_id
        ).first()
        
        if pat:
            pat.is_deleted = False
            pat.deleted_at = None
        else:
            pat = PractitionerAppointmentTypes(
                user_id=p_id,
                appointment_type_id=appointment_type_id,
                clinic_id=clinic_id,
                is_deleted=False
            )
            db.add(pat)

    # 2. Billing Scenarios (Diff Sync)
    # Only delete scenarios that are explicitly removed from the incoming list.
    # Preserve scenarios for unchecked practitioners so they can be restored later.
    incoming_bs_ids = {bs.id for bs in associations.billing_scenarios if bs.id}
    
    # Get active practitioners in this clinic to avoid ghost data issues
    valid_practitioner_ids = {
        row.user_id for row in db.query(UserClinicAssociation.user_id).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()
    }

    # Soft-delete candidates: 
    # - Scenarios not in the incoming list
    # - Scenarios for practitioners no longer in the clinic
    scenarios_to_soft_delete = db.query(BillingScenario).filter(
        BillingScenario.appointment_type_id == appointment_type_id,
        BillingScenario.is_deleted == False,
        or_(
            BillingScenario.id.not_in(incoming_bs_ids) if incoming_bs_ids else text("TRUE"),
            BillingScenario.practitioner_id.not_in(valid_practitioner_ids)
        )
    ).all()

    for bs_to_delete in scenarios_to_soft_delete:
        bs_to_delete.is_deleted = True
        bs_to_delete.deleted_at = taiwan_now()
        bs_to_delete.is_default = False

    # Update or create scenarios
    for bs_data in associations.billing_scenarios:
        if bs_data.practitioner_id not in valid_practitioner_ids:
            continue
            
        if is_real_id(bs_data.id):
            bs = db.query(BillingScenario).filter(
                BillingScenario.id == bs_data.id,
                BillingScenario.appointment_type_id == appointment_type_id,
                BillingScenario.clinic_id == clinic_id
            ).first()
            if bs:
                logger.info(f"Updating existing billing scenario {bs.id}")
                bs.practitioner_id = bs_data.practitioner_id
                bs.name = bs_data.name
                bs.amount = bs_data.amount
                bs.revenue_share = bs_data.revenue_share
                bs.is_default = bs_data.is_default
                bs.is_deleted = False
                bs.deleted_at = None
                bs.updated_at = taiwan_now()
            else:
                logger.warning(f"Billing scenario ID {bs_data.id} provided but not found in DB for AT {appointment_type_id} and clinic {clinic_id}. Treating as new record.")
                bs = _create_billing_scenario(clinic_id, appointment_type_id, bs_data)
                db.add(bs)
        else:
            logger.info(f"Creating new billing scenario for AT {appointment_type_id}")
            bs = _create_billing_scenario(clinic_id, appointment_type_id, bs_data)
            db.add(bs)

    # 3. Resource Requirements (Replace-All Sync)
    db.query(AppointmentResourceRequirement).filter(
        AppointmentResourceRequirement.appointment_type_id == appointment_type_id
    ).delete(synchronize_session='fetch')
    
    for rr_data in associations.resource_requirements:
        rr = AppointmentResourceRequirement(
            appointment_type_id=appointment_type_id,
            resource_type_id=rr_data.resource_type_id,
            quantity=rr_data.quantity
        )
        db.add(rr)

    # 4. Follow-up Messages (Diff Sync)
    incoming_fm_ids = {fm.id for fm in associations.follow_up_messages if fm.id}
    logger.info(f"Syncing follow-up messages for AT {appointment_type_id}. Incoming IDs: {incoming_fm_ids}")
    
    q_fm = db.query(FollowUpMessage).filter(
        FollowUpMessage.appointment_type_id == appointment_type_id
    )
    if incoming_fm_ids:
        q_fm = q_fm.filter(FollowUpMessage.id.not_in(incoming_fm_ids))
        
    deleted_count = q_fm.delete(synchronize_session='fetch')
    logger.info(f"Deleted {deleted_count} follow-up messages not in incoming list")
    
    for fm_data in associations.follow_up_messages:
        if is_real_id(fm_data.id):
            fm = db.query(FollowUpMessage).filter(
                FollowUpMessage.id == fm_data.id,
                FollowUpMessage.appointment_type_id == appointment_type_id,
                FollowUpMessage.clinic_id == clinic_id
            ).first()
            if fm:
                logger.info(f"Updating existing follow-up message {fm.id}")
                fm.timing_mode = fm_data.timing_mode
                fm.hours_after = fm_data.hours_after
                fm.days_after = fm_data.days_after
                
                if fm_data.time_of_day:
                    h, m = map(int, fm_data.time_of_day.split(':'))
                    fm.time_of_day = time(h, m)
                else:
                    fm.time_of_day = None
                    
                fm.message_template = fm_data.message_template
                fm.is_enabled = fm_data.is_enabled
                fm.display_order = fm_data.display_order
            else:
                logger.warning(f"Follow-up message ID {fm_data.id} provided but not found in DB for AT {appointment_type_id} and clinic {clinic_id}. Treating as new record.")
                fm = _create_follow_up_message(clinic_id, appointment_type_id, fm_data)
                db.add(fm)
        else:
            logger.info(f"Creating new follow-up message for AT {appointment_type_id}")
            fm = _create_follow_up_message(clinic_id, appointment_type_id, fm_data)
            db.add(fm)


@router.post("/service-items/bundle", summary="Create service item bundle")
def create_service_item_bundle(
    request: ServiceItemBundleRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ServiceItemBundleResponse:
    """Create a new service item and all its associations in one transaction."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # 0. Check for name uniqueness with pessimistic lock
        existing = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.name == request.item.name,
            AppointmentType.is_deleted == False
        ).with_for_update().first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="服務項目名稱已重疊"
            )
        
        # Handle Shadow Conflict if a soft-deleted one exists (same name/duration)
        _evict_soft_deleted_appointment_type_name(db, clinic_id, request.item.name, request.item.duration_minutes)

        # 1. Create Appointment Type
        # Get max order
        max_order = db.query(func.max(AppointmentType.display_order)).filter(
            AppointmentType.clinic_id == clinic_id
        ).scalar()
        display_order = request.item.display_order or ((max_order + 1) if max_order is not None else 0)
        
        at = AppointmentType(
            clinic_id=clinic_id,
            name=request.item.name,
            duration_minutes=request.item.duration_minutes,
            receipt_name=request.item.receipt_name,
            allow_patient_booking=request.item.allow_patient_booking,
            allow_new_patient_booking=request.item.allow_new_patient_booking,
            allow_existing_patient_booking=request.item.allow_existing_patient_booking,
            allow_patient_practitioner_selection=request.item.allow_patient_practitioner_selection,
            allow_multiple_time_slot_selection=request.item.allow_multiple_time_slot_selection,
            description=request.item.description,
            scheduling_buffer_minutes=request.item.scheduling_buffer_minutes,
            service_type_group_id=request.item.service_type_group_id,
            display_order=display_order,
            send_patient_confirmation=request.item.send_patient_confirmation,
            send_clinic_confirmation=request.item.send_clinic_confirmation,
            send_reminder=request.item.send_reminder,
            patient_confirmation_message=request.item.patient_confirmation_message or _DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
            clinic_confirmation_message=request.item.clinic_confirmation_message or _DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
            reminder_message=request.item.reminder_message or _DEFAULT_REMINDER_MESSAGE,
            send_recurrent_clinic_confirmation=request.item.send_recurrent_clinic_confirmation,
            recurrent_clinic_confirmation_message=request.item.recurrent_clinic_confirmation_message or _DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE,
            require_notes=request.item.require_notes,
            notes_instructions=request.item.notes_instructions
        )
        db.add(at)
        db.flush()  # Get ID
        new_item_id = at.id
        
        # 2. Sync Associations
        _sync_service_item_associations(db, clinic_id, at.id, request.associations)
        
        db.commit()
        return get_service_item_bundle(new_item_id, current_user, db)
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error creating service item bundle: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立服務項目"
        )


@router.put("/service-items/{id}/bundle", summary="Update service item bundle")
def update_service_item_bundle(
    id: int,
    request: ServiceItemBundleRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ServiceItemBundleResponse:
    """Update an existing service item and all its associations in one transaction."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get appointment type with pessimistic lock
        at = db.query(AppointmentType).filter(
            AppointmentType.id == id,
            AppointmentType.clinic_id == clinic_id
        ).with_for_update().first()
        
        if not at:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="服務項目不存在"
            )
        
        # 0. Check for name uniqueness if name changed
        if at.name != request.item.name:
            existing = db.query(AppointmentType).filter(
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.name == request.item.name,
                AppointmentType.duration_minutes == (request.item.duration_minutes or at.duration_minutes),
                AppointmentType.is_deleted == False,
                AppointmentType.id != id
            ).with_for_update().first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="服務項目名稱已重疊"
                )
            
            # Handle Shadow Conflict if a soft-deleted one exists
            _evict_soft_deleted_appointment_type_name(db, clinic_id, request.item.name, request.item.duration_minutes, exclude_id=id)

        # 1. Update Appointment Type
        # Use helper for all fields to ensure consistency and fix "Cannot Clear" bug
        # Use exclude_unset=True to ensure the MISSING sentinel logic works correctly
        _process_existing_appointment_type_update(at, request.item.model_dump(exclude_unset=True))
        
        # 2. Sync Associations
        _sync_service_item_associations(db, clinic_id, at.id, request.associations)
        
        db.commit()
        return get_service_item_bundle(at.id, current_user, db)
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error updating service item bundle: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新服務項目"
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

