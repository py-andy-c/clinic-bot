"""
Clinic administrator model representing users who manage clinic operations.

Clinic administrators are authorized personnel who can manage clinic settings,
therapists, patients, and appointment scheduling. They are authenticated via
Google OAuth and have elevated permissions within their clinic's scope.
"""

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from .base import Base


class ClinicAdmin(Base):
    """
    Clinic administrator entity representing authorized personnel who manage clinic operations.

    Clinic admins have elevated permissions to manage their clinic's settings, therapists,
    patients, and appointments. They are authenticated through Google OAuth, ensuring
    secure and reliable identity verification. Each admin belongs to exactly one clinic.
    """

    __tablename__ = "clinic_admins"

    id = Column(Integer, primary_key=True, index=True)
    """Unique identifier for the clinic administrator."""

    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    """Reference to the clinic that this administrator manages."""

    email = Column(String(255), unique=True, nullable=False)
    """Email address of the clinic administrator, used for authentication and communication."""

    google_subject_id = Column(String(255), unique=True, nullable=False)  # Stable unique ID from Google
    """Stable unique identifier provided by Google OAuth. Unlike email, this doesn't change."""

    full_name = Column(String(255))
    """Full display name of the clinic administrator."""

    is_active = Column(Boolean, default=True)
    """Whether this administrator account is active and can authenticate. Defaults to True."""

    # Relationships
    clinic = relationship("Clinic", back_populates="admins")
    """Relationship to the Clinic entity that this administrator manages."""
