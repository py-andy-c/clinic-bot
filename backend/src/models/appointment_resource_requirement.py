"""
Appointment resource requirement model representing resource requirements for appointment types.

This model defines which resource types and quantities are required for each appointment type.
This is the single source of truth for resource requirements.
"""

from datetime import datetime
from sqlalchemy import ForeignKey, TIMESTAMP, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class AppointmentResourceRequirement(Base):
    """
    Appointment resource requirement entity.
    
    Defines which resource types and quantities are required for an appointment type.
    Example: "物理治療" appointment type requires 1 "治療室" resource.
    """

    __tablename__ = "appointment_resource_requirements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the requirement."""

    appointment_type_id: Mapped[int] = mapped_column(
        ForeignKey("appointment_types.id", ondelete="CASCADE"),
        index=True
    )
    """Reference to the appointment type that requires this resource."""

    resource_type_id: Mapped[int] = mapped_column(
        ForeignKey("resource_types.id", ondelete="RESTRICT"),
        index=True
    )
    """Reference to the resource type that is required."""

    quantity: Mapped[int] = mapped_column(Integer)
    """Quantity of resources of this type required. Must be at least 1."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the requirement was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the requirement was last updated."""

    # Relationships
    appointment_type = relationship("AppointmentType", back_populates="resource_requirements")
    """Relationship to the AppointmentType entity that requires this resource."""

    resource_type = relationship("ResourceType", back_populates="appointment_resource_requirements")
    """Relationship to the ResourceType entity that is required."""

    # Unique constraint: (appointment_type_id, resource_type_id)
    __table_args__ = (
        UniqueConstraint('appointment_type_id', 'resource_type_id', name='uq_appt_resource_req'),
    )


