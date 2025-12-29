"""
Practitioner-AppointmentType mapping model.

This model establishes many-to-many relationships between practitioners (users)
and appointment types they are qualified to provide. This enables clinics to
configure which services each practitioner offers.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, TIMESTAMP, Index, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class PractitionerAppointmentTypes(Base):
    """
    Many-to-many mapping between practitioners and appointment types.

    Allows clinics to specify which appointment types each practitioner
    is qualified to offer. This enables filtered practitioner selection
    during appointment booking and prevents booking practitioners for
    services they don't provide.
    """

    __tablename__ = "practitioner_appointment_types"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the mapping record."""

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    """Reference to the practitioner (user) who can offer this appointment type."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id", ondelete="CASCADE"))
    """Reference to the appointment type this practitioner can offer."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    """Reference to the clinic this mapping belongs to."""

    created_at: Mapped[TIMESTAMP] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the mapping was created."""

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    """Soft delete flag. True if this practitioner-appointment type association has been deleted."""

    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when the practitioner-appointment type association was soft deleted (if applicable)."""

    # Relationships
    user = relationship("User", back_populates="practitioner_appointment_types")
    """Relationship to the User entity (practitioner)."""

    appointment_type = relationship("AppointmentType", back_populates="practitioner_appointment_types")
    """Relationship to the AppointmentType entity."""

    __table_args__ = (
        # Partial unique index prevents duplicate active mappings per clinic
        # Note: Partial unique index is created in migration, not here
        # The partial unique index on (user_id, clinic_id, appointment_type_id) where is_deleted = false
        # allows multiple soft-deleted PATs but prevents duplicate active ones

        # Indexes for performance
        Index('idx_practitioner_types_user', 'user_id'),
        Index('idx_practitioner_types_type', 'appointment_type_id'),
        Index('idx_practitioner_types_clinic', 'clinic_id'),
        Index('idx_practitioner_appointment_types_deleted', 'is_deleted'),
    )
