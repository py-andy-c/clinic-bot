"""
Therapist model representing healthcare professionals who provide treatments at clinics.

Therapists are the medical professionals who conduct appointments and treatments.
Each therapist belongs to a specific clinic and can optionally integrate their
Google Calendar for appointment synchronization and availability management.
"""

from sqlalchemy import Column, Integer, String, Boolean, TIMESTAMP, ForeignKey, JSON, func
from sqlalchemy.orm import relationship

from .base import Base


class Therapist(Base):
    """
    Therapist entity representing a healthcare professional who provides treatments.

    Represents the therapists and healthcare providers who work at clinics.
    Each therapist belongs to exactly one clinic and can have multiple appointments.
    Therapists can optionally link their Google Calendar for automatic appointment
    synchronization and availability management.
    """

    __tablename__ = "therapists"

    id = Column(Integer, primary_key=True, index=True)
    """Unique identifier for the therapist."""

    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    """Reference to the clinic where this therapist is employed."""

    name = Column(String(255), nullable=False)
    """Full name of the therapist."""

    email = Column(String(255), nullable=False)
    """Email address of the therapist, used for communication and calendar integration."""

    gcal_credentials = Column(JSON)  # Stores encrypted OAuth2 refresh_token, access_token, etc.
    """Encrypted Google OAuth2 credentials stored as JSON. Contains access_token, refresh_token, expiry, etc."""

    gcal_sync_enabled = Column(Boolean, default=False)
    """Whether Google Calendar synchronization is enabled for this therapist. Defaults to False."""

    gcal_watch_resource_id = Column(String(255))  # To manage Google Push Notifications channel
    """Google Calendar watch resource ID for managing webhook notifications about calendar changes."""

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    """Timestamp when the therapist record was created."""

    # Relationships
    clinic = relationship("Clinic", back_populates="therapists")
    """Relationship to the Clinic entity where this therapist works."""

    appointments = relationship("Appointment", back_populates="therapist")
    """Relationship to all Appointment entities where this therapist is the provider."""
