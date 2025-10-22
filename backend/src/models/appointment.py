"""
Appointment model representing scheduled appointments between patients and therapists.

Appointments represent the core scheduling functionality of the clinic system.
Each appointment links a patient, therapist, and appointment type for a specific
time slot. Appointments can be synced with Google Calendar and have various
status states throughout their lifecycle.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import TIMESTAMP, String, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

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

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the appointment."""

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    """Reference to the patient who has booked this appointment."""

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    """Reference to the practitioner who will conduct this appointment."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"))
    """Reference to the type of appointment (service/treatment being provided)."""

    start_time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    """Start time of the appointment (timezone-aware datetime)."""

    end_time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    """End time of the appointment (timezone-aware datetime)."""

    status: Mapped[str] = mapped_column(String(50))  # 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'
    """Current status of the appointment. Valid values: 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'."""

    gcal_event_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """Google Calendar event ID for appointments that have been synced with Google Calendar."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    """Timestamp when the appointment was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    """Timestamp when the appointment was last updated."""

    # Relationships
    patient = relationship("Patient", back_populates="appointments")
    """Relationship to the Patient entity who booked this appointment."""

    user = relationship("User", back_populates="appointments", foreign_keys=[user_id])
    """Relationship to the User entity conducting this appointment."""

    appointment_type = relationship("AppointmentType", back_populates="appointments")
    """Relationship to the AppointmentType entity defining this appointment's service type."""

    # Table indexes for performance
    __table_args__ = (
        Index('idx_patient_upcoming', 'patient_id', 'start_time'),
        Index('idx_user_schedule', 'user_id', 'start_time'),
        Index('idx_gcal_sync', 'gcal_event_id'),
    )
