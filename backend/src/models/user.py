"""
Unified User model for clinic personnel.

This model replaces the separate ClinicAdmin and Therapist models.
All clinic personnel (admins, practitioners) are stored in this single table.
Role-based access control is handled via UserClinicAssociation.roles (clinic-specific).
"""

from typing import Optional
from datetime import datetime
from sqlalchemy import String, TIMESTAMP, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, Session

from core.database import Base


class User(Base):
    """Unified user model for all clinic personnel (admins, practitioners, etc.)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Authentication (all users)
    email: Mapped[str] = mapped_column(String(255), unique=True)  # Globally unique (not per-clinic)
    google_subject_id: Mapped[str] = mapped_column(String(255), unique=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    # Relationships
    # Multi-clinic support via associations
    clinic_associations = relationship(
        "UserClinicAssociation",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    """User-clinic associations for multi-clinic support. Roles and names are clinic-specific."""

    refresh_tokens = relationship("RefreshToken", back_populates="user")
    availability = relationship("PractitionerAvailability", back_populates="user", cascade="all, delete-orphan")
    calendar_events = relationship("CalendarEvent", back_populates="user", cascade="all, delete-orphan")
    practitioner_appointment_types = relationship("PractitionerAppointmentTypes", back_populates="user")
    # Note: No cascade - PATs use soft-delete, so they should not be hard-deleted when User is deleted
    patient_assignments = relationship("PatientPractitionerAssignment", foreign_keys="[PatientPractitionerAssignment.user_id]", back_populates="practitioner", cascade="all, delete-orphan")
    """Patient assignments for this practitioner."""

    __table_args__ = (
        # Note: uq_clinic_user_email constraint is removed by migration
        # Email is now globally unique (not per-clinic)
        UniqueConstraint('google_subject_id', name='uq_google_subject_id'),
    )

    def is_system_admin(self, db: Session) -> bool:
        """Check if user is a system admin (has no clinic associations)."""
        from models import UserClinicAssociation
        return db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == self.id
        ).first() is None

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}')>"
