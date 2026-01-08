"""
Service type group model representing categories of appointment types (e.g., "徒手治療", "物理治療").

Service type groups are clinic-specific categories that group individual appointment types.
Each group can have multiple appointment types, and groups are used for internal organization,
filtering, and dashboard breakdowns.
"""

from datetime import datetime
from sqlalchemy import String, ForeignKey, TIMESTAMP, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class ServiceTypeGroup(Base):
    """
    Service type group entity representing a category of appointment types.
    
    Examples: "徒手治療" (Manual Therapy), "物理治療" (Physical Therapy)
    Service type groups are clinic-specific and have a unique name within each clinic.
    """

    __tablename__ = "service_type_groups"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the service type group."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    """Reference to the clinic that owns this service type group."""

    name: Mapped[str] = mapped_column(String(255))
    """Name of the service type group (e.g., "徒手治療", "物理治療")."""

    display_order: Mapped[int] = mapped_column(Integer, default=0)
    """Display order for this group (used for ordering in filters and dashboards)."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the service type group was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the service type group was last updated."""

    # Relationships
    clinic = relationship("Clinic", back_populates="service_type_groups")
    """Relationship to the Clinic entity that owns this service type group."""

    appointment_types = relationship(
        "AppointmentType",
        back_populates="service_type_group"
    )
    """Relationship to all AppointmentType instances in this group."""

    # Unique constraint: (clinic_id, name)
    __table_args__ = (
        UniqueConstraint('clinic_id', 'name', name='uq_service_type_group_clinic_name'),
    )

