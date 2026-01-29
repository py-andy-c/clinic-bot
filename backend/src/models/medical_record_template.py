"""
Template for medical records, defining structured header fields and workspace config.
"""

from sqlalchemy import String, ForeignKey, TIMESTAMP, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime
from typing import List, Dict, Any

from core.database import Base
from core.constants import MAX_STRING_LENGTH

class MedicalRecordTemplate(Base):
    """
    Template for medical records, defining structured header fields and workspace config.
    """
    __tablename__ = "medical_record_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the template."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"), index=True)
    """Reference to the clinic that owns this template."""

    name: Mapped[str] = mapped_column(String(MAX_STRING_LENGTH))
    """Name of the template (e.g., 'First Visit', 'Post-Op')."""

    header_fields: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default='[]')
    """JSON definition of the structured header fields."""

    workspace_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default='{}')
    """JSON configuration for the clinical workspace (e.g., base diagrams)."""

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default='true')
    """Whether this template is active and can be used for new records."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    """Timestamp when the template was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    """Timestamp when the template was last updated."""

    # Relationships
    clinic = relationship("Clinic")
    """Relationship to the clinic that owns this template."""

    def __repr__(self) -> str:
        return f"<MedicalRecordTemplate(id={self.id}, name='{self.name}', clinic_id={self.clinic_id})>"
