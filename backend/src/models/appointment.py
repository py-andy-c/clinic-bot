"""
Appointment model representing scheduled appointments between patients and therapists.

Appointments represent the core scheduling functionality of the clinic system.
Each appointment links a patient, therapist, and appointment type for a specific
time slot. Appointments can be synced with Google Calendar and have various
status states throughout their lifecycle.
"""

from sqlalchemy import Column, Integer, TIMESTAMP, String, ForeignKey
from sqlalchemy.orm import relationship

from core.database import Base


class Appointment(Base):
    """
    Appointment entity representing a scheduled session between a patient and therapist.

    Represents the actual scheduled appointments in the system. Each appointment
    has a specific start and end time, links to the patient, therapist, and appointment type,
    and can be synchronized with Google Calendar. Appointments go through various status
    changes throughout their lifecycle.
    """

    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    """Unique identifier for the appointment."""

    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    """Reference to the patient who has booked this appointment."""

    therapist_id = Column(Integer, ForeignKey("therapists.id"), nullable=False)
    """Reference to the therapist who will conduct this appointment."""

    appointment_type_id = Column(Integer, ForeignKey("appointment_types.id"), nullable=False)
    """Reference to the type of appointment (service/treatment being provided)."""

    start_time = Column(TIMESTAMP(timezone=True), nullable=False)
    """Start time of the appointment (timezone-aware datetime)."""

    end_time = Column(TIMESTAMP(timezone=True), nullable=False)
    """End time of the appointment (timezone-aware datetime)."""

    status = Column(String(50), nullable=False)  # 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'
    """Current status of the appointment. Valid values: 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'."""

    gcal_event_id = Column(String(255))
    """Google Calendar event ID for appointments that have been synced with Google Calendar."""

    # Relationships
    patient = relationship("Patient", back_populates="appointments")
    """Relationship to the Patient entity who booked this appointment."""

    therapist = relationship("Therapist", back_populates="appointments")
    """Relationship to the Therapist entity conducting this appointment."""

    appointment_type = relationship("AppointmentType", back_populates="appointments")
    """Relationship to the AppointmentType entity defining this appointment's service type."""
