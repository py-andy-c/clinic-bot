"""
Practitioner-AppointmentType mapping model.

This model establishes many-to-many relationships between practitioners (users)
and appointment types they are qualified to provide. This enables clinics to
configure which services each practitioner offers.
"""

from sqlalchemy import ForeignKey, TIMESTAMP, Index
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

    created_at: Mapped[TIMESTAMP] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the mapping was created."""

    # Relationships
    user = relationship("User", back_populates="practitioner_appointment_types")
    """Relationship to the User entity (practitioner)."""

    appointment_type = relationship("AppointmentType", back_populates="practitioner_appointment_types")
    """Relationship to the AppointmentType entity."""

    __table_args__ = (
        # Composite unique constraint prevents duplicate mappings
        Index('uq_practitioner_type', 'user_id', 'appointment_type_id', unique=True),

        # Indexes for performance
        Index('idx_practitioner_types_user', 'user_id'),
        Index('idx_practitioner_types_type', 'appointment_type_id'),
    )
