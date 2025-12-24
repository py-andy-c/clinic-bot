"""
Patient model representing individuals who receive treatment at clinics.

Patients are the core users of the clinic system, representing individuals who
book appointments and receive treatments. Each patient belongs to exactly one clinic
and can optionally be linked to a LINE user account for communication and appointment
management through the LIFF app.
"""

from sqlalchemy import String, Text, ForeignKey, TIMESTAMP, Date, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, date
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

    phone_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    """Contact phone number for the patient, used for appointment confirmations and reminders. Optional for clinic-created patients."""

    birthday: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    """Optional birthday of the patient (date only, no time)."""

    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    """Optional gender of the patient (生理性別). Valid values: 'male', 'female', 'other'."""

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """Optional notes/remarks about the patient (備注)."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the patient was first created."""

    line_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("line_users.id"), nullable=True)
    """Optional reference to the LINE user account managing this patient."""

    created_by_type: Mapped[str] = mapped_column(String(20), nullable=False, default='line_user')
    """Source of patient creation: 'line_user' or 'clinic_user'. Tracks whether patient was created via LINE or by clinic staff."""

    # Soft delete support
    is_deleted: Mapped[bool] = mapped_column(default=False)
    """Soft delete flag. True if this patient has been deleted."""

    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when the patient was soft deleted (if applicable)."""

    # Relationships
    clinic = relationship("Clinic", back_populates="patients")
    """Relationship to the Clinic entity where this patient receives treatment."""

    appointments = relationship("Appointment", back_populates="patient")
    """Relationship to all Appointment entities booked by this patient."""

    line_user = relationship("LineUser", back_populates="patients")
    """Optional relationship to the LINE user account managing this patient."""

    __table_args__ = (
        # Regular index for performance (no uniqueness constraint to allow phone number corrections)
        # idx_patients_clinic_phone covers queries filtering by clinic_id alone (left-prefix rule)
        Index('idx_patients_clinic_phone', 'clinic_id', 'phone_number'),
        Index('idx_patients_line_user', 'line_user_id'),
        # Removed idx_patients_clinic as it's redundant with idx_patients_clinic_phone
        Index('idx_patients_created_at', 'created_at'),
    )
