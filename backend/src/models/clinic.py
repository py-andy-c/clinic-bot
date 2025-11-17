"""
Clinic model representing a physical therapy clinic.

A clinic is the top-level entity that owns all therapists, patients,
appointment types, and administrators. Each clinic operates independently
with its own LINE Official Account.
"""

from datetime import datetime
from typing import Optional, Dict, Any

from pydantic import BaseModel, Field
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
    booking_restriction_type: str = Field(default="same_day_disallowed")
    minimum_booking_hours_ahead: int = Field(default=24, ge=1, le=168)
    step_size_minutes: int = Field(default=30, ge=5, le=60, description="Time interval in minutes for appointment slot granularity. Patients can only book appointments at these intervals. For example, 30 means patients can select 09:00, 09:30, 10:00, etc. A smaller value provides more time options (e.g., 15 minutes = 09:00, 09:15, 09:30, 09:45), while a larger value provides fewer options.")
    max_future_appointments: int = Field(default=3, ge=1, le=100, description="Maximum number of active future appointments a patient can have")


class ClinicInfoSettings(BaseModel):
    """Schema for clinic information settings."""
    display_name: Optional[str] = Field(default=None)
    address: Optional[str] = Field(default=None)
    phone_number: Optional[str] = Field(default=None)
    appointment_type_instructions: Optional[str] = Field(default=None, description="Instructions to guide patients when selecting appointment types")
    require_birthday: bool = Field(default=False, description="Whether to require birthday during patient registration")


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


class ClinicSettings(BaseModel):
    """Schema for all clinic settings."""
    notification_settings: NotificationSettings = Field(default_factory=NotificationSettings)
    booking_restriction_settings: BookingRestrictionSettings = Field(default_factory=BookingRestrictionSettings)
    clinic_info_settings: ClinicInfoSettings = Field(default_factory=ClinicInfoSettings)
    chat_settings: ChatSettings = Field(default_factory=ChatSettings)


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
            "booking_restriction_type": "same_day_disallowed",
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

    signup_tokens = relationship("SignupToken", back_populates="clinic")
    """Active signup tokens for inviting new users"""

    line_user_ai_opt_outs = relationship("LineUserAiOptOut", back_populates="clinic", cascade="all, delete-orphan")
    """LINE user AI opt-out records for this clinic."""

    line_messages = relationship("LineMessage", back_populates="clinic", cascade="all, delete-orphan")
    """LINE messages associated with this clinic."""


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
        return self.settings.get("booking_restriction_settings", {}).get("booking_restriction_type", "same_day_disallowed")

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
    def effective_display_name(self) -> str:
        """Get the effective display name, falling back to clinic name if not set."""
        return self.display_name if self.display_name else self.name
