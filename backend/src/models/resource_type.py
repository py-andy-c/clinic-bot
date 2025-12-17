"""
Resource type model representing categories of resources (e.g., "治療室", "設備").

Resource types are clinic-specific categories that group individual resources.
Each resource type can have multiple resources, and appointment types can require
specific quantities of resources from a resource type.
"""

from datetime import datetime
from sqlalchemy import String, ForeignKey, TIMESTAMP, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class ResourceType(Base):
    """
    Resource type entity representing a category of resources.
    
    Examples: "治療室" (Treatment Room), "設備" (Equipment)
    Resource types are clinic-specific and have a unique name within each clinic.
    """

    __tablename__ = "resource_types"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the resource type."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    """Reference to the clinic that owns this resource type."""

    name: Mapped[str] = mapped_column(String(255))
    """Name of the resource type (e.g., "治療室", "設備")."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the resource type was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the resource type was last updated."""

    # Relationships
    clinic = relationship("Clinic", back_populates="resource_types")
    """Relationship to the Clinic entity that owns this resource type."""

    resources = relationship("Resource", back_populates="resource_type", cascade="all, delete-orphan")
    """Relationship to all Resource instances of this type."""

    appointment_resource_requirements = relationship(
        "AppointmentResourceRequirement",
        back_populates="resource_type",
        cascade="all, delete-orphan"
    )
    """Relationship to appointment resource requirements that reference this resource type."""

    # Unique constraint: (clinic_id, name)
    __table_args__ = (
        UniqueConstraint('clinic_id', 'name', name='uq_resource_type_clinic_name'),
    )

