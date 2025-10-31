"""
Appointment model representing scheduled appointments between patients and therapists.

Appointments represent the core scheduling functionality of the clinic system.
Each appointment links a patient, therapist, and appointment type for a specific
time slot. Appointments are now based on the CalendarEvent schema for unified
calendar management while maintaining specialized appointment-specific data.
"""

from datetime import date as date_type, datetime
from typing import Optional
from sqlalchemy import String, ForeignKey, Index, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class Appointment(Base):
    """
    Appointment entity representing a scheduled session between a patient and therapist.

    This model extends CalendarEvent to represent patient appointments. The timing
    and Google Calendar sync information is stored in the associated CalendarEvent,
    while this model contains appointment-specific data like patient, appointment type,
    and status.

    The hybrid approach allows for:
    - Unified calendar queries with availability exceptions
    - Consistent Google Calendar synchronization
    - Appointment-specific data and relationships
    - Conflict prevention with availability exceptions
    """

    __tablename__ = "appointments"

    calendar_event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id"), primary_key=True)
    """
    Reference to the base calendar event containing timing and metadata.
    This serves as the primary key and creates a one-to-one relationship with CalendarEvent.
    """

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    """Reference to the patient who has booked this appointment."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"))
    """Reference to the type of appointment (service/treatment being provided)."""

    status: Mapped[str] = mapped_column(String(50))  # 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'
    """Current status of the appointment. Valid values: 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'."""

    canceled_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when the appointment was canceled (if applicable)."""

    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    """Optional patient-provided notes about the appointment (備註)."""

    # Relationships
    calendar_event = relationship("CalendarEvent", back_populates="appointment")
    """Relationship to the CalendarEvent entity containing timing and metadata."""

    patient = relationship("Patient", back_populates="appointments")
    """Relationship to the Patient entity who booked this appointment."""

    appointment_type = relationship("AppointmentType", back_populates="appointments")
    """Relationship to the AppointmentType entity defining this appointment's service type."""

    # Convenience properties for backward compatibility
    @property
    def user_id(self) -> int:
        """Get the user ID from the associated calendar event."""
        return self.calendar_event.user_id

    @property
    def start_time(self):
        """Get the start time from the associated calendar event."""
        return self.calendar_event.start_time

    @property
    def end_time(self):
        """Get the end time from the associated calendar event."""
        return self.calendar_event.end_time

    @property
    def date(self) -> date_type:
        """Get the date from the associated calendar event."""
        return self.calendar_event.date

    @property
    def gcal_event_id(self):
        """Get the Google Calendar event ID from the associated calendar event."""
        return self.calendar_event.gcal_event_id

    @property
    def created_at(self):
        """Get the creation timestamp from the associated calendar event."""
        return self.calendar_event.created_at

    @property
    def updated_at(self):
        """Get the update timestamp from the associated calendar event."""
        return self.calendar_event.updated_at

    # Table indexes for performance
    __table_args__ = (
        Index('idx_appointments_patient', 'patient_id'),
    )
