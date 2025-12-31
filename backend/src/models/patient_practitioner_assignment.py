"""
Patient-Practitioner Assignment model.

This model represents the assignment of practitioners to patients.
A patient can have multiple assigned practitioners, and a practitioner
can be assigned to multiple patients.
"""

from sqlalchemy import ForeignKey, TIMESTAMP, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional

from core.database import Base


class PatientPractitionerAssignment(Base):
    """
    Assignment of a practitioner to a patient.
    
    Represents the relationship between a patient and a practitioner
    who is assigned as the main responsible person for that patient.
    This assignment affects appointment booking flows and patient management.
    """
    
    __tablename__ = "patient_practitioner_assignments"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the assignment."""
    
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    """Reference to the patient."""
    
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    """Reference to the practitioner (user)."""
    
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    """Reference to the clinic (for clinic-scoped queries)."""
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    """Timestamp when the assignment was created."""
    
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    """Reference to the user who created this assignment. NULL if system-generated."""
    
    # Relationships
    patient = relationship("Patient", back_populates="practitioner_assignments")
    """Relationship to the Patient entity."""
    
    practitioner = relationship("User", foreign_keys=[user_id], back_populates="patient_assignments")
    """Relationship to the User (practitioner) entity."""
    
    clinic = relationship("Clinic", back_populates="patient_practitioner_assignments")
    """Relationship to the Clinic entity."""
    
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    """Relationship to the User who created this assignment."""
    
    __table_args__ = (
        # Unique constraint: one assignment per patient-practitioner-clinic combination
        Index('uq_patient_practitioner_clinic', 'patient_id', 'user_id', 'clinic_id', unique=True),
        # Indexes for query performance
        Index('idx_patient_practitioner_assignments_patient', 'patient_id', 'clinic_id'),
        Index('idx_patient_practitioner_assignments_practitioner', 'user_id', 'clinic_id'),
        Index('idx_patient_practitioner_assignments_clinic', 'clinic_id'),
    )



