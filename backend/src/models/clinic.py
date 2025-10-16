"""
Clinic model representing a physical therapy clinic.

A clinic is the top-level entity that owns all therapists, patients,
appointment types, and administrators. Each clinic operates independently
with its own LINE Official Account and Google Calendar integrations.
"""

from sqlalchemy import Column, Integer, String, TIMESTAMP, func
from sqlalchemy.orm import relationship

from .base import Base
from ..core.constants import MAX_STRING_LENGTH


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

    id = Column(Integer, primary_key=True, index=True)
    """Unique identifier for the clinic."""

    name = Column(String(MAX_STRING_LENGTH), nullable=False)
    """Human-readable name of the clinic."""

    line_channel_id = Column(String(MAX_STRING_LENGTH), unique=True, nullable=False)
    """
    LINE Channel ID for the clinic's Official Account.

    Obtained from LINE Developers Console. Used to identify which
    webhook messages belong to this clinic.
    """

    line_channel_secret = Column(String(MAX_STRING_LENGTH), nullable=False)
    """
    LINE Channel Secret for webhook signature verification.

    Used to verify that incoming webhooks are authentic and from LINE.
    Must be kept secure and never exposed to clients.
    """

    subscription_status = Column(String(50), default="trial", nullable=False)
    """
    Current subscription status of the clinic.

    Possible values:
    - 'trial': Free trial period active
    - 'active': Paid subscription active
    - 'past_due': Payment overdue
    - 'canceled': Subscription canceled
    """

    trial_ends_at = Column(TIMESTAMP(timezone=True))
    """
    End date/time of the free trial period.

    After this time, the clinic must have an active subscription
    to continue using the service.
    """

    stripe_customer_id = Column(String(MAX_STRING_LENGTH))
    """
    Stripe customer ID for billing purposes.

    Links the clinic to their Stripe customer record for subscription
    management and payment processing.
    """

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    """Timestamp when the clinic was first created."""

    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    """Timestamp when the clinic was last updated."""

    # Relationships
    admins = relationship("ClinicAdmin", back_populates="clinic")
    """Clinic administrators who manage this clinic."""

    therapists = relationship("Therapist", back_populates="clinic")
    """Therapists employed at this clinic."""

    patients = relationship("Patient", back_populates="clinic")
    """Patients registered with this clinic."""

    appointment_types = relationship("AppointmentType", back_populates="clinic")
    """Types of appointments offered by this clinic."""
