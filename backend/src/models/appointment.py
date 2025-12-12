"""
Appointment model representing scheduled appointments between patients and therapists.

Appointments represent the core scheduling functionality of the clinic system.
Each appointment links a patient, therapist, and appointment type for a specific
time slot. Appointments are now based on the CalendarEvent schema for unified
calendar management while maintaining specialized appointment-specific data.
"""

from datetime import date as date_type, datetime
from typing import Optional
from sqlalchemy import String, ForeignKey, Index, TIMESTAMP, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class Appointment(Base):
    """
    Appointment entity representing a scheduled session between a patient and therapist.

    This model extends CalendarEvent to represent patient appointments. The timing
    is stored in the associated CalendarEvent, while this model contains
    appointment-specific data like patient, appointment type, and status.

    The hybrid approach allows for:
    - Unified calendar queries with availability exceptions
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

    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """
    Timestamp when the reminder was sent for this appointment.
    
    NULL means reminder has not been sent yet. This field enables:
    - Duplicate reminder prevention
    - Handling of reminder_hours_before setting changes
    - Server downtime recovery
    - Window boundary edge case handling
    """

    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    """Optional patient-provided notes about the appointment (備註)."""

    clinic_notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    """Optional clinic internal notes (備注), visible only to clinic users. Separate from patient-provided notes."""

    is_auto_assigned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    """
    Current auto-assignment state.
    
    True: Appointment is currently auto-assigned (system assigned practitioner, but shows "不指定" to patient)
    False: Appointment is manually assigned (shows practitioner name to patient)
    """

    originally_auto_assigned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    """
    Historical flag indicating if appointment was originally created without practitioner specified.
    
    This flag never changes once set, preserving the historical fact that the appointment
    was originally auto-assigned. Used for analytics and tracking.
    """

    reassigned_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    """
    Tracks which user reassigned this appointment from auto-assigned state.
    
    NULL if appointment was never reassigned or was manually assigned from the start.
    Set when appointment is reassigned from auto-assigned (不指定) to specific practitioner.
    """

    reassigned_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """
    Timestamp when appointment was reassigned from auto-assigned state.
    
    NULL if appointment was never reassigned or was manually assigned from the start.
    Set when appointment is reassigned from auto-assigned (不指定) to specific practitioner.
    """

    # Relationships
    calendar_event = relationship("CalendarEvent", back_populates="appointment")
    """Relationship to the CalendarEvent entity containing timing and metadata."""

    patient = relationship("Patient", back_populates="appointments")
    """Relationship to the Patient entity who booked this appointment."""

    appointment_type = relationship("AppointmentType", back_populates="appointments")
    """Relationship to the AppointmentType entity defining this appointment's service type."""

    receipt = relationship("Receipt", back_populates="appointment", uselist=False)
    """Relationship to the Receipt entity (one-to-one, if receipt exists)."""

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
        Index('idx_appointments_status', 'status'),
        # Composite index for load balancing query (status + calendar_event_id for JOIN efficiency)
        Index('idx_appointments_status_calendar_event', 'status', 'calendar_event_id'),
        # Index for querying auto-assigned appointments
        Index('idx_appointments_is_auto_assigned', 'is_auto_assigned'),
        Index('idx_appointments_originally_auto_assigned', 'originally_auto_assigned'),
        # Index for reminder service queries (status + reminder_sent_at)
        Index('idx_appointments_status_reminder', 'status', 'reminder_sent_at'),
    )
