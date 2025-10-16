"""
Appointment type model representing different types of appointments offered by a clinic.

Appointment types define the various services or treatments that a clinic provides,
such as "Initial Consultation", "Follow-up Treatment", "Physical Therapy Session", etc.
Each type has a specific duration and belongs to a particular clinic.
"""

from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from .base import Base


class AppointmentType(Base):
    """
    Appointment type entity representing a service or treatment offered by a clinic.

    Defines the different types of appointments that patients can book, each with
    specific characteristics like name and duration. Appointment types are scoped
    to individual clinics, allowing each clinic to define their own service offerings.
    """

    __tablename__ = "appointment_types"

    id = Column(Integer, primary_key=True, index=True)
    """Unique identifier for the appointment type."""

    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    """Reference to the clinic that offers this appointment type."""

    name = Column(String(255), nullable=False)
    """Human-readable name of the appointment type (e.g., 'Initial Consultation', 'Follow-up Treatment')."""

    duration_minutes = Column(Integer, nullable=False)
    """Expected duration of appointments of this type in minutes (e.g., 30, 60, 90)."""

    # Relationships
    clinic = relationship("Clinic", back_populates="appointment_types")
    """Relationship to the Clinic entity that owns this appointment type."""

    appointments = relationship("Appointment", back_populates="appointment_type")
    """Relationship to all Appointment instances that use this appointment type."""
