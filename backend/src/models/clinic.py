"""
Clinic model representing a physical therapy clinic.

A clinic is the top-level entity that owns all therapists, patients,
appointment types, and administrators. Each clinic operates independently
with its own LINE Official Account and Google Calendar integrations.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, TIMESTAMP, func, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from core.constants import MAX_STRING_LENGTH


class Clinic(Base):
    """
    Physical therapy clinic entity.

    Represents a clinic that uses the system. Each clinic has:
    - Unique LINE Official Account for patient communication
    - Multiple therapists with Google Calendar integration
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

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    """Timestamp when the clinic was first created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
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

    # Notification Settings
    reminder_hours_before: Mapped[int] = mapped_column(Integer, default=24)
    """Number of hours before appointment to send reminders."""

    # LIFF Integration
    line_liff_id: Mapped[Optional[str]] = mapped_column(String(MAX_STRING_LENGTH), nullable=True, unique=True)
    """
    LIFF ID for this clinic's LIFF app instance.

    Each clinic gets its own LIFF app for proper data isolation in multi-tenant setup.
    Used to identify which clinic's LIFF app the user is accessing.
    """

    # Relationships
    users = relationship("User", back_populates="clinic")
    """All clinic personnel (admins, practitioners)"""

    patients = relationship("Patient", back_populates="clinic")
    """Patients registered with this clinic."""

    appointment_types = relationship("AppointmentType", back_populates="clinic")
    """Types of appointments offered by this clinic."""

    signup_tokens = relationship("SignupToken", back_populates="clinic")
    """Active signup tokens for inviting new users"""

    # Convenience properties for backward compatibility
    @property
    def admins(self):
        """Get all admin users for this clinic."""
        return [u for u in self.users if 'admin' in u.roles]

    @property
    def therapists(self):
        """Get all practitioner users for this clinic (deprecated - use practitioners)."""
        return self.practitioners

    @property
    def practitioners(self):
        """Get all practitioner users for this clinic."""
        return [u for u in self.users if 'practitioner' in u.roles]
