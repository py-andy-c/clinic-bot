"""
Appointment type model representing different types of appointments offered by a clinic.

Appointment types define the various services or treatments that a clinic provides,
such as "Initial Consultation", "Follow-up Treatment", "Physical Therapy Session", etc.
Each type has a specific duration and belongs to a particular clinic.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, ForeignKey, TIMESTAMP, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


def _get_default_patient_confirmation_message() -> str:
    """Get default patient confirmation message."""
    from core.message_template_constants import DEFAULT_PATIENT_CONFIRMATION_MESSAGE
    return DEFAULT_PATIENT_CONFIRMATION_MESSAGE


def _get_default_clinic_confirmation_message() -> str:
    """Get default clinic confirmation message."""
    from core.message_template_constants import DEFAULT_CLINIC_CONFIRMATION_MESSAGE
    return DEFAULT_CLINIC_CONFIRMATION_MESSAGE


def _get_default_reminder_message() -> str:
    """Get default reminder message."""
    from core.message_template_constants import DEFAULT_REMINDER_MESSAGE
    return DEFAULT_REMINDER_MESSAGE


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

    service_type_group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("service_type_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    """Reference to the service type group this appointment type belongs to. NULL if ungrouped."""

    display_order: Mapped[int] = mapped_column(Integer, default=0)
    """Display order for this appointment type (global ordering across all services)."""

    is_deleted: Mapped[bool] = mapped_column(default=False)
    """Soft delete flag. True if this appointment type has been deleted."""

    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when the appointment type was soft deleted (if applicable)."""

    # Message customization fields
    send_patient_confirmation: Mapped[bool] = mapped_column(default=True)
    """Whether to send confirmation message when patient books via LIFF. Default: true for new items."""
    
    send_clinic_confirmation: Mapped[bool] = mapped_column(default=True)
    """Whether to send confirmation message when clinic creates appointment. Default: true."""
    
    send_reminder: Mapped[bool] = mapped_column(default=True)
    """Whether to send reminder message before appointment. Default: true."""
    
    patient_confirmation_message: Mapped[str] = mapped_column(Text, nullable=False, default=_get_default_patient_confirmation_message)
    """Message template for patient-triggered confirmation. Always populated with text."""
    
    clinic_confirmation_message: Mapped[str] = mapped_column(Text, nullable=False, default=_get_default_clinic_confirmation_message)
    """Message template for clinic-triggered confirmation. Always populated with text."""
    
    reminder_message: Mapped[str] = mapped_column(Text, nullable=False, default=_get_default_reminder_message)
    """Message template for reminder. Always populated with text."""

    # Notes customization fields
    require_notes: Mapped[bool] = mapped_column(default=False)
    """Whether notes are required when patients book this service via LIFF. Only applies when allow_patient_booking = true."""
    
    notes_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """Custom instructions shown to patients when filling out notes. Replaces global appointment_notes_instructions if not null."""

    # Relationships
    clinic = relationship("Clinic", back_populates="appointment_types")
    """Relationship to the Clinic entity that owns this appointment type."""

    appointments = relationship("Appointment", back_populates="appointment_type")
    """Relationship to all Appointment instances that use this appointment type."""

    practitioner_appointment_types = relationship("PractitionerAppointmentTypes", back_populates="appointment_type")
    """Relationship to practitioners who can offer this appointment type."""
    # Note: No cascade - PATs use soft-delete, so they should not be hard-deleted when AppointmentType is deleted

    resource_requirements = relationship(
        "AppointmentResourceRequirement",
        back_populates="appointment_type",
        cascade="all, delete-orphan"
    )
    """Relationship to resource requirements for this appointment type."""

    service_type_group = relationship("ServiceTypeGroup", back_populates="appointment_types")
    """Relationship to the ServiceTypeGroup entity this appointment type belongs to."""

    follow_up_messages = relationship("FollowUpMessage", back_populates="appointment_type", cascade="all, delete-orphan")
    """Relationship to follow-up messages configured for this appointment type."""
