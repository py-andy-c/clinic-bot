from typing import Dict, Any, Optional, List
from sqlalchemy import ForeignKey, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from core.database import Base

class MedicalRecord(Base):
    """
    Individual medical record for a patient.
    """
    __tablename__ = "medical_records"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    template_id: Mapped[Optional[int]] = mapped_column(ForeignKey("medical_record_templates.id", ondelete="SET NULL"), nullable=True)
    
    header_structure: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    """[Snapshot] A copy of the template's header_fields at the time of creation"""
    
    header_values: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """Data for structured fields: {field_id: value}"""
    
    workspace_data: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """Vector drawing paths and media placements"""
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
    version: Mapped[int] = mapped_column(default=1, nullable=False)

    # Relationships
    patient = relationship("Patient")
    clinic = relationship("Clinic")
    template = relationship("MedicalRecordTemplate", back_populates="records")
