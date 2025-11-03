"""
Patient model representing individuals who receive treatment at clinics.

Patients are the core users of the clinic system, representing individuals who
book appointments and receive treatments. Each patient belongs to exactly one clinic
and can optionally be linked to a LINE user account for communication and appointment
management through the LIFF app.
"""

from sqlalchemy import String, ForeignKey, TIMESTAMP, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional

from core.database import Base


class Patient(Base):
    """
    Patient entity representing an individual who receives treatment at a clinic.

    Represents patients who use the clinic's services. Each patient belongs
    to exactly one clinic and can have multiple appointments. Patients can optionally
    be linked to a LINE user account for convenient communication and appointment
    management through the LIFF app.
    """

    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the patient."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))
    """Reference to the clinic where this patient receives treatment."""

    full_name: Mapped[str] = mapped_column(String(255))
    """Full name of the patient (first and last name)."""

    phone_number: Mapped[str] = mapped_column(String(50))
    """Contact phone number for the patient, used for appointment confirmations and reminders."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the patient was first created."""

    line_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("line_users.id"), nullable=True)
    """Optional reference to the LINE user account managing this patient."""

    # Relationships
    clinic = relationship("Clinic", back_populates="patients")
    """Relationship to the Clinic entity where this patient receives treatment."""

    appointments = relationship("Appointment", back_populates="patient")
    """Relationship to all Appointment entities booked by this patient."""

    line_user = relationship("LineUser", back_populates="patients")
    """Optional relationship to the LINE user account managing this patient."""

    __table_args__ = (
        # Regular index for performance (no uniqueness constraint to allow phone number corrections)
        Index('idx_patients_clinic_phone', 'clinic_id', 'phone_number'),
        Index('idx_patients_line_user', 'line_user_id'),
        Index('idx_patients_clinic', 'clinic_id'),
        Index('idx_patients_created_at', 'created_at'),
    )
