"""
Appointment type model representing different types of appointments offered by a clinic.

Appointment types define the various services or treatments that a clinic provides,
such as "Initial Consultation", "Follow-up Treatment", "Physical Therapy Session", etc.
Each type has a specific duration and belongs to a particular clinic.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, ForeignKey, TIMESTAMP, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class AppointmentType(Base):
    """
    Appointment type entity representing a service or treatment offered by a clinic.

    Defines the different types of appointments that patients can book, each with
    specific characteristics like name and duration. Appointment types are scoped
    to individual clinics, allowing each clinic to define their own service offerings.
    """

    __tablename__ = "appointment_types"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the appointment type."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))
    """Reference to the clinic that offers this appointment type."""

    name: Mapped[str] = mapped_column(String(255))
    """Human-readable name of the appointment type (e.g., 'Initial Consultation', 'Follow-up Treatment')."""

    duration_minutes: Mapped[int] = mapped_column()
    """Expected duration of appointments of this type in minutes (e.g., 30, 60, 90)."""

    receipt_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """Name to display on receipt (can differ from name). Defaults to name if not set."""

    allow_patient_booking: Mapped[bool] = mapped_column(default=True)
    """Whether patients can book this service via LIFF. Default: true."""

    allow_patient_practitioner_selection: Mapped[bool] = mapped_column(default=True)
    """Whether patients can specify a practitioner when booking. Default: true."""

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """Service description shown on LIFF."""

    scheduling_buffer_minutes: Mapped[int] = mapped_column(default=0)
    """Additional minutes added to duration for scheduling. Default: 0."""

    is_deleted: Mapped[bool] = mapped_column(default=False)
    """Soft delete flag. True if this appointment type has been deleted."""

    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when the appointment type was soft deleted (if applicable)."""

    # Relationships
    clinic = relationship("Clinic", back_populates="appointment_types")
    """Relationship to the Clinic entity that owns this appointment type."""

    appointments = relationship("Appointment", back_populates="appointment_type")
    """Relationship to all Appointment instances that use this appointment type."""

    practitioner_appointment_types = relationship("PractitionerAppointmentTypes", back_populates="appointment_type", cascade="all, delete-orphan")
    """Relationship to practitioners who can offer this appointment type."""

    resource_requirements = relationship(
        "AppointmentResourceRequirement",
        back_populates="appointment_type",
        cascade="all, delete-orphan"
    )
    """Relationship to resource requirements for this appointment type."""
