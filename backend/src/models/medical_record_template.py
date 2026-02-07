"""
Medical Record Template model.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import String, Integer, Text, Boolean, TIMESTAMP, ForeignKey, Index, CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base

class MedicalRecordTemplate(Base):
    """
    Template for medical records defining the structure of fields.
    """
    __tablename__ = "medical_record_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(Integer, ForeignKey("clinics.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # JSONB field for storing template structure (list of fields)
    fields: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    
    template_type: Mapped[str] = mapped_column(String(20), server_default='medical_record', nullable=False)
    max_photos: Mapped[int] = mapped_column(Integer, server_default='5', nullable=False)
    
    version: Mapped[int] = mapped_column(Integer, server_default='1', nullable=False)
    
    is_deleted: Mapped[bool] = mapped_column(Boolean, server_default='false', nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default='now()')
    created_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    
    updated_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True, onupdate=lambda: datetime.now(timezone.utc))
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    clinic = relationship("Clinic", back_populates="medical_record_templates")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id])
    
    __table_args__ = (
        Index("idx_medical_record_templates_clinic", "clinic_id"),
        Index("idx_medical_record_templates_deleted", "clinic_id", "is_deleted"),
        CheckConstraint("template_type IN ('medical_record', 'patient_form')", name="check_template_type"),
        CheckConstraint("max_photos >= 0 AND max_photos <= 20", name="check_max_photos"),
    )
