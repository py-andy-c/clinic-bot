"""
Patient model representing individuals who receive treatment at clinics.

Patients are the core users of the clinic system, representing individuals who
book appointments and receive treatments. Each patient belongs to exactly one clinic
and can optionally have a LINE messaging account for communication.
"""

from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from core.database import Base


class Patient(Base):
    """
    Patient entity representing an individual who receives treatment at a clinic.

    Represents patients who use the clinic's services. Each patient belongs
    to exactly one clinic and can have multiple appointments. Patients can optionally
    link their LINE messaging account for convenient communication and appointment
    management through the messaging platform.
    """

    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    """Unique identifier for the patient."""

    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    """Reference to the clinic where this patient receives treatment."""

    full_name = Column(String(255), nullable=False)
    """Full name of the patient (first and last name)."""

    phone_number = Column(String(50), nullable=False)
    """Contact phone number for the patient, used for appointment confirmations and reminders."""

    # Relationships
    clinic = relationship("Clinic", back_populates="patients")
    """Relationship to the Clinic entity where this patient receives treatment."""

    appointments = relationship("Appointment", back_populates="patient")
    """Relationship to all Appointment entities booked by this patient."""

    line_user = relationship("LineUser", back_populates="patient", uselist=False)
    """Optional relationship to the patient's LINE messaging account for communication."""
