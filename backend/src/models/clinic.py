"""
Clinic model representing a physical therapy clinic.

A clinic is the top-level entity that owns all therapists, patients,
appointment types, and administrators. Each clinic operates independently
with its own LINE Official Account.
"""

from datetime import datetime
from typing import Optional, Dict, Any

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import String, TIMESTAMP, Integer, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from core.constants import MAX_STRING_LENGTH


# Settings schema validation models
class NotificationSettings(BaseModel):
    """Schema for notification settings."""
    reminder_hours_before: int = Field(default=24, ge=1, le=168)


class BookingRestrictionSettings(BaseModel):
    """Schema for booking restriction settings."""
    booking_restriction_type: str = Field(default="minimum_hours_required")
    minimum_booking_hours_ahead: int = Field(default=24, ge=1, le=168)
    deadline_time_day_before: Optional[str] = Field(default="08:00", description="Deadline time (24-hour format HH:MM) for booking appointments. Used when booking_restriction_type is 'deadline_time_day_before'. Default is 08:00 (8:00 AM).")
    deadline_on_same_day: bool = Field(default=False, description="If True, deadline is on the same day as appointment (date X). If False, deadline is on the day before (date X-1).")
    step_size_minutes: int = Field(default=30, ge=5, le=60, description="Time interval in minutes for appointment slot granularity. Patients can only book appointments at these intervals. For example, 30 means patients can select 09:00, 09:30, 10:00, etc. A smaller value provides more time options (e.g., 15 minutes = 09:00, 09:15, 09:30, 09:45), while a larger value provides fewer options.")
    max_future_appointments: int = Field(default=3, ge=1, le=100, description="Maximum number of active future appointments a patient can have")
    max_booking_window_days: int = Field(default=90, ge=1, le=365, description="Maximum number of days in advance that patients can book appointments")
    minimum_cancellation_hours_before: int = Field(default=24, ge=1, le=168, description="Minimum number of hours before appointment that patients can cancel. Cancellations from clinic are not subject to this restriction.")
    allow_patient_deletion: bool = Field(default=True, description="Whether patients are allowed to delete/cancel appointments on their own. When disabled, patients can only reschedule appointments.")

    @model_validator(mode='before')
    @classmethod
    def migrate_same_day_disallowed(cls, data: Any) -> Any:
        """
        Auto-migrate deprecated same_day_disallowed to minimum_hours_required.

        This ensures backward compatibility while deprecating the old setting.
        If same_day_disallowed is provided, it is automatically converted to
        minimum_hours_required with a default of 24 hours if not specified.
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
    """Schema for clinic information settings."""
    display_name: Optional[str] = Field(default=None)
    address: Optional[str] = Field(default=None)
    phone_number: Optional[str] = Field(default=None)
    appointment_type_instructions: Optional[str] = Field(default=None, description="Instructions to guide patients when selecting appointment types")
    appointment_notes_instructions: Optional[str] = Field(default=None, description="Instructions to guide patients when adding notes to appointments")
    require_birthday: bool = Field(default=False, description="Whether to require birthday during patient registration")
    require_gender: bool = Field(default=False, description="Whether to require gender (生理性別) during patient registration")


class ChatSettings(BaseModel):
    """Schema for chat/chatbot settings."""
    chat_enabled: bool = Field(default=False, description="Whether the AI chatbot feature is enabled for this clinic")
    clinic_description: Optional[str] = Field(default=None, max_length=10000, description="Clinic description, specialties, and treatment approach")
    therapist_info: Optional[str] = Field(default=None, max_length=10000, description="Detailed information about therapists")
    treatment_details: Optional[str] = Field(default=None, max_length=10000, description="Detailed information about treatments, prices, duration, and content")
    service_item_selection_guide: Optional[str] = Field(default=None, max_length=10000, description="Guide for selecting service items")
    operating_hours: Optional[str] = Field(default=None, max_length=10000, description="Clinic operating hours")
    location_details: Optional[str] = Field(default=None, max_length=10000, description="Transportation and location details")
    booking_policy: Optional[str] = Field(default=None, max_length=10000, description="Appointment booking and cancellation policies")
    payment_methods: Optional[str] = Field(default=None, max_length=10000, description="Accepted payment methods")
    equipment_facilities: Optional[str] = Field(default=None, max_length=10000, description="Equipment and facilities available at the clinic")
    common_questions: Optional[str] = Field(default=None, max_length=10000, description="Frequently asked questions and answers")
    other_info: Optional[str] = Field(default=None, max_length=10000, description="Other information about the clinic")
    ai_guidance: Optional[str] = Field(default=None, max_length=10000, description="AI guidance instructions for the chatbot")


class ReceiptSettings(BaseModel):
    """Schema for receipt settings."""
    custom_notes: Optional[str] = Field(default=None, max_length=2000, description="Custom notes to append at the end of receipts")
    show_stamp: bool = Field(default=False, description="Whether to display a stamp with clinic name and checkout date on receipts")


class ClinicSettings(BaseModel):
    """Schema for all clinic settings."""
    notification_settings: NotificationSettings = Field(default_factory=NotificationSettings)
    booking_restriction_settings: BookingRestrictionSettings = Field(default_factory=BookingRestrictionSettings)
    clinic_info_settings: ClinicInfoSettings = Field(default_factory=ClinicInfoSettings)
    chat_settings: ChatSettings = Field(default_factory=ChatSettings)
    receipt_settings: ReceiptSettings = Field(default_factory=ReceiptSettings)


class Clinic(Base):
    """
    Physical therapy clinic entity.

    Represents a clinic that uses the system. Each clinic has:
    - Unique LINE Official Account for patient communication
    - Multiple therapists
    - Registered patients
    - Subscription and billing information
    """

    __tablename__ = "clinics"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the clinic."""

    name: Mapped[str] = mapped_column(String(MAX_STRING_LENGTH))
    """Human-readable name of the clinic."""

    line_channel_id: Mapped[str] = mapped_column(String(MAX_STRING_LENGTH), unique=True)
    """
    LINE Channel ID for the clinic's Official Account.

    Obtained from LINE Developers Console. Used to identify which
    webhook messages belong to this clinic.
    """

    line_channel_secret: Mapped[str] = mapped_column(String(MAX_STRING_LENGTH))
    """
    LINE Channel Secret for webhook signature verification.

    Used to verify that incoming webhooks are authentic and from LINE.
    Must be kept secure and never exposed to clients.
    """

    line_channel_access_token: Mapped[str] = mapped_column(String(MAX_STRING_LENGTH))
    """
    LINE Channel Access Token for sending messages via LINE Messaging API.

    Required to send push messages, reply messages, and other LINE API operations.
    Obtained from LINE Developers Console. Must be kept secure.
    """

    line_official_account_user_id: Mapped[Optional[str]] = mapped_column(String(MAX_STRING_LENGTH), nullable=True)
    """
    LINE Official Account User ID (bot user ID) for the clinic's bot.

    This is the user ID of the clinic's official account that appears in the
    'destination' field of LINE webhook payloads. Obtained from LINE API
    using the channel access token. Used to identify which clinic a webhook
    event belongs to.
    """

    subscription_status: Mapped[str] = mapped_column(String(50), default="trial")
    """
    Current subscription status of the clinic.

    Possible values:
    - 'trial': Free trial period active
    - 'active': Paid subscription active
    - 'past_due': Payment overdue
    - 'canceled': Subscription canceled
    """

    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """
    End date/time of the free trial period.

    After this time, the clinic must have an active subscription
    to continue using the service.
    """

    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(MAX_STRING_LENGTH), nullable=True)
    """
    Stripe customer ID for billing purposes.

    Links the clinic to their Stripe customer record for subscription
    management and payment processing.
    """

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the clinic was first created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the clinic was last updated."""

    # LINE Integration Health Tracking
    last_webhook_received_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp of the last successfully received LINE webhook."""

    webhook_count_24h: Mapped[int] = mapped_column(Integer, default=0)
    """Count of webhooks received in the last 24 hours."""

    last_health_check_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp of the last health check performed."""

    health_check_errors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """JSON string containing recent health check errors."""

    liff_access_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True, index=True)
    """
    Secure token for clinic identification in LIFF URLs.

    This cryptographically secure token replaces the insecure clinic_id parameter
    in LIFF URLs. Each clinic has a unique token that cannot be easily guessed or
    enumerated, providing better security for clinic isolation.

    Generated using secrets.token_urlsafe(32), producing ~43 characters URL-safe.
    Used for shared LIFF app (when liff_id is not set).
    """

    liff_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True, index=True)
    """
    LIFF ID for clinic-specific LIFF apps.

    This is the LIFF app ID from LINE Developers Console for clinics that have
    their own LINE provider. When set, the clinic uses its own LIFF app instead
    of the shared LIFF app.

    Format: {channel_id}-{random_string} (e.g., "1234567890-abcdefgh")
    Only one clinic can have a specific liff_id (unique constraint).
    """
    # Clinic Settings (JSONB column for all configurable settings)
    settings: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """
    JSONB column containing all clinic settings with validated schema.

    Structure (matches ClinicSettings Pydantic model):
    {
        "notification_settings": {
            "reminder_hours_before": 24
        },
        "booking_restriction_settings": {
            "booking_restriction_type": "minimum_hours_required",
            "minimum_booking_hours_ahead": 24
        },
        "clinic_info_settings": {
            "display_name": null,
            "address": null,
            "phone_number": null,
            "appointment_type_instructions": null
        },
        "chat_settings": {
            "chat_enabled": false,
            "clinic_description": null,
            "therapist_info": null,
            "treatment_details": null,
            "service_item_selection_guide": null,
            "operating_hours": null,
            "location_details": null,
            "booking_policy": null,
            "payment_methods": null,
            "equipment_facilities": null,
            "common_questions": null,
            "other_info": null,
            "ai_guidance": null
        }
    }
    """

    def get_validated_settings(self) -> ClinicSettings:
        """Get settings with schema validation."""
        return ClinicSettings.model_validate(self.settings)

    def set_validated_settings(self, settings: ClinicSettings):
        """Set settings with schema validation."""
        self.settings = settings.model_dump()

    # Clinic Lifecycle Management
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    """
    Whether this clinic is active and can accept new appointments.

    Set to false during maintenance, billing issues, or clinic closure.
    Active clinics can still view existing data but cannot book new appointments.
    """

    # Relationships
    # New: Multi-clinic support via associations
    user_associations = relationship(
        "UserClinicAssociation",
        back_populates="clinic",
        cascade="all, delete-orphan"
    )
    """User-clinic associations for multi-clinic support. Roles and names are clinic-specific."""

    patients = relationship("Patient", back_populates="clinic")
    """Patients registered with this clinic."""

    appointment_types = relationship("AppointmentType", back_populates="clinic")
    """Types of appointments offered by this clinic."""

    resource_types = relationship("ResourceType", back_populates="clinic", cascade="all, delete-orphan")
    """Resource types owned by this clinic."""

    resources = relationship("Resource", back_populates="clinic", cascade="all, delete-orphan")
    """Resources owned by this clinic."""

    service_type_groups = relationship("ServiceTypeGroup", back_populates="clinic", cascade="all, delete-orphan")
    """Service type groups owned by this clinic."""

    signup_tokens = relationship("SignupToken", back_populates="clinic")
    """Active signup tokens for inviting new users"""

    line_users = relationship("LineUser", back_populates="clinic", cascade="all, delete-orphan")
    """LINE users associated with this clinic (one entry per LINE user)."""


    line_messages = relationship("LineMessage", back_populates="clinic", cascade="all, delete-orphan")
    line_push_messages = relationship("LinePushMessage", back_populates="clinic", cascade="all, delete-orphan")
    """LINE messages associated with this clinic."""

    line_ai_replies = relationship("LineAiReply", back_populates="clinic", cascade="all, delete-orphan")
    """LINE AI reply messages (free messages) tracked for dashboard metrics."""


    # Settings convenience properties (match API keys)
    @property
    def reminder_hours_before(self) -> int:
        """Get reminder hours before setting with default."""
        return self.settings.get("notification_settings", {}).get("reminder_hours_before", 24)

    @reminder_hours_before.setter
    def reminder_hours_before(self, value: int):
        """Set reminder hours before setting."""
        notification_settings = self.settings.get("notification_settings", {})
        notification_settings["reminder_hours_before"] = value
        self.settings["notification_settings"] = notification_settings

    @property
    def booking_restriction_type(self) -> str:
        """Get booking restriction type with default."""
        return self.settings.get("booking_restriction_settings", {}).get("booking_restriction_type", "minimum_hours_required")

    @booking_restriction_type.setter
    def booking_restriction_type(self, value: str):
        """Set booking restriction type."""
        booking_settings = self.settings.get("booking_restriction_settings", {})
        booking_settings["booking_restriction_type"] = value
        self.settings["booking_restriction_settings"] = booking_settings

    @property
    def minimum_booking_hours_ahead(self) -> int:
        """Get minimum booking hours ahead with default."""
        return self.settings.get("booking_restriction_settings", {}).get("minimum_booking_hours_ahead", 24)

    @minimum_booking_hours_ahead.setter
    def minimum_booking_hours_ahead(self, value: int):
        """Set minimum booking hours ahead."""
        booking_settings = self.settings.get("booking_restriction_settings", {})
        booking_settings["minimum_booking_hours_ahead"] = value
        self.settings["booking_restriction_settings"] = booking_settings

    @property
    def display_name(self) -> Optional[str]:
        """Get display name setting."""
        return self.settings.get("clinic_info_settings", {}).get("display_name")

    @display_name.setter
    def display_name(self, value: Optional[str]):
        """Set display name setting."""
        clinic_info = self.settings.get("clinic_info_settings", {})
        clinic_info["display_name"] = value
        self.settings["clinic_info_settings"] = clinic_info

    @property
    def address(self) -> Optional[str]:
        """Get address setting."""
        return self.settings.get("clinic_info_settings", {}).get("address")

    @address.setter
    def address(self, value: Optional[str]):
        """Set address setting."""
        clinic_info = self.settings.get("clinic_info_settings", {})
        clinic_info["address"] = value
        self.settings["clinic_info_settings"] = clinic_info

    @property
    def phone_number(self) -> Optional[str]:
        """Get phone number setting."""
        return self.settings.get("clinic_info_settings", {}).get("phone_number")

    @phone_number.setter
    def phone_number(self, value: Optional[str]):
        """Set phone number setting."""
        clinic_info = self.settings.get("clinic_info_settings", {})
        clinic_info["phone_number"] = value
        self.settings["clinic_info_settings"] = clinic_info

    @property
    def appointment_type_instructions(self) -> Optional[str]:
        """Get appointment type instructions setting."""
        return self.settings.get("clinic_info_settings", {}).get("appointment_type_instructions")

    @appointment_type_instructions.setter
    def appointment_type_instructions(self, value: Optional[str]):
        """Set appointment type instructions setting."""
        clinic_info = self.settings.get("clinic_info_settings", {})
        clinic_info["appointment_type_instructions"] = value
        self.settings["clinic_info_settings"] = clinic_info

    @property
    def appointment_notes_instructions(self) -> Optional[str]:
        """Get appointment notes instructions setting."""
        return self.settings.get("clinic_info_settings", {}).get("appointment_notes_instructions")

    @appointment_notes_instructions.setter
    def appointment_notes_instructions(self, value: Optional[str]):
        """Set appointment notes instructions setting."""
        clinic_info = self.settings.get("clinic_info_settings", {})
        clinic_info["appointment_notes_instructions"] = value
        self.settings["clinic_info_settings"] = clinic_info

    @property
    def effective_display_name(self) -> str:
        """Get the effective display name, falling back to clinic name if not set."""
        return self.display_name if self.display_name else self.name
