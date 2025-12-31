"""
Resource model representing individual instances of a resource type.

Resources are individual instances of a resource type (e.g., "治療室1", "治療室2").
Each resource belongs to a resource type and a clinic, and can be allocated to appointments.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, ForeignKey, TIMESTAMP, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class Resource(Base):
    """
    Resource entity representing an individual instance of a resource type.
    
    Examples: "治療室1", "治療室2", "設備A"
    Resources belong to a resource type and can be allocated to appointments.
    """

    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the resource."""

    resource_type_id: Mapped[int] = mapped_column(ForeignKey("resource_types.id", ondelete="RESTRICT"), index=True)
    """Reference to the resource type this resource belongs to."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    """Reference to the clinic that owns this resource."""

    name: Mapped[str] = mapped_column(String(255))
    """Name of the resource (e.g., "治療室1", "治療室2"). Must be unique within the resource type."""

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """Optional description of the resource."""

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    """Soft delete flag. True if this resource has been soft deleted."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the resource was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the resource was last updated."""

    # Relationships
    resource_type = relationship("ResourceType", back_populates="resources")
    """Relationship to the ResourceType entity this resource belongs to."""

    clinic = relationship("Clinic", back_populates="resources")
    """Relationship to the Clinic entity that owns this resource."""

    appointment_resource_allocations = relationship(
        "AppointmentResourceAllocation",
        back_populates="resource",
        cascade="all, delete-orphan"
    )
    """Relationship to appointment resource allocations that use this resource."""

    # Unique constraint: (resource_type_id, name)
    __table_args__ = (
        UniqueConstraint('resource_type_id', 'name', name='uq_resource_type_name'),
    )



