from typing import Dict, Any, List
from sqlalchemy import String, ForeignKey, Boolean, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base
from datetime import datetime

class MedicalRecordTemplate(Base):
    """
    Template for medical records, defining structured header fields and 
    workspace configurations.
    """
    __tablename__ = "medical_record_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    
    header_fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    """Array of field definitions: {id, type, label, options[]}"""
    
    workspace_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """{base_layers: MediaLayer[]}"""
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))

    # Relationships
    clinic = relationship("Clinic")
    records = relationship("MedicalRecord", back_populates="template")
