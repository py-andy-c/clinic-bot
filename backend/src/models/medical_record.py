"""
Instance of a medical record for a patient.
"""

from sqlalchemy import ForeignKey, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime
from typing import List, Dict, Any

from core.database import Base

class MedicalRecord(Base):
    """
    Instance of a medical record for a patient.
    """
    __tablename__ = "medical_records"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the record."""

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    """Reference to the patient this record belongs to."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"), index=True)
    """Reference to the clinic where this record was created."""

    template_id: Mapped[int] = mapped_column(ForeignKey("medical_record_templates.id"), index=True)
    """Reference to the template used to create this record."""

    header_structure: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    """Snapshot of the template's header_fields at the time of creation."""

    header_values: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default='{}')
    """Data entered for the structured header fields."""

    workspace_data: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default='{}')
    """Vector drawing paths and media placements for the clinical workspace."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    """Timestamp when the record was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    """Timestamp when the record was last edited."""

    # Relationships
    patient = relationship("Patient")
    """Relationship to the patient this record belongs to."""

    clinic = relationship("Clinic")
    """Relationship to the clinic where this record was created."""

    template = relationship("MedicalRecordTemplate")
    """Relationship to the template used for this record."""

    media = relationship("MedicalRecordMedia", back_populates="record", cascade="all, delete-orphan")
    """Media files associated with this record's clinical workspace."""

    def __repr__(self) -> str:
        return f"<MedicalRecord(id={self.id}, patient_id={self.patient_id}, clinic_id={self.clinic_id})>"
