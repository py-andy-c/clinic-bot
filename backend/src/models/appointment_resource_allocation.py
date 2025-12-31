"""
Appointment resource allocation model representing resource allocations to appointments.

This model tracks which resources are allocated to which appointments.
Each appointment can have multiple resource allocations (one per resource).
"""

from datetime import datetime
from sqlalchemy import ForeignKey, TIMESTAMP, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class AppointmentResourceAllocation(Base):
    """
    Appointment resource allocation entity.
    
    Tracks which resources are allocated to which appointments.
    Each appointment can have multiple resource allocations.
    """

    __tablename__ = "appointment_resource_allocations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the allocation."""

    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("calendar_events.id", ondelete="CASCADE"),
        index=True
    )
    """Reference to the calendar event (appointment) that uses this resource."""

    resource_id: Mapped[int] = mapped_column(
        ForeignKey("resources.id", ondelete="RESTRICT"),
        index=True
    )
    """Reference to the resource that is allocated to this appointment."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the allocation was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the allocation was last updated."""

    # Relationships
    appointment = relationship("CalendarEvent", back_populates="resource_allocations")
    """Relationship to the CalendarEvent entity (appointment) that uses this resource."""

    resource = relationship("Resource", back_populates="appointment_resource_allocations")
    """Relationship to the Resource entity that is allocated."""

    # Unique constraint: (appointment_id, resource_id) - prevents double-booking
    __table_args__ = (
        UniqueConstraint('appointment_id', 'resource_id', name='uq_appt_resource_alloc'),
    )


