"""
Unified User model for clinic personnel.

This model replaces the separate ClinicAdmin and Therapist models.
All clinic personnel (admins, practitioners) are stored in this single table
with role-based access control via the JSONB roles field.
"""

from typing import Optional
from datetime import datetime
from sqlalchemy import String, TIMESTAMP, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class User(Base):
    """Unified user model for all clinic personnel (admins, practitioners, etc.)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))

    # Authentication (all users)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    google_subject_id: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    roles: Mapped[list[str]] = mapped_column(JSONB, default=list)  # ['admin'], ['practitioner'], or ['admin', 'practitioner']

    # Metadata
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    # Relationships
    clinic = relationship("Clinic", back_populates="users")
    refresh_tokens = relationship("RefreshToken", back_populates="user")
    availability = relationship("PractitionerAvailability", back_populates="user", cascade="all, delete-orphan")
    calendar_events = relationship("CalendarEvent", back_populates="user", cascade="all, delete-orphan")
    practitioner_appointment_types = relationship("PractitionerAppointmentTypes", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('clinic_id', 'email', name='uq_clinic_user_email'),
        UniqueConstraint('google_subject_id', name='uq_google_subject_id'),
    )

    @property
    def is_admin(self) -> bool:
        """Check if user has admin role."""
        return 'admin' in self.roles

    @property
    def is_practitioner(self) -> bool:
        """Check if user has practitioner role."""
        return 'practitioner' in self.roles

    def has_role(self, role: str) -> bool:
        """Check if user has a specific role."""
        return role in self.roles

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}', roles={self.roles})>"
