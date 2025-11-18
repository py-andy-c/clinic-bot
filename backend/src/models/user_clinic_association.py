"""
User-Clinic Association model for multi-clinic user support.

This model represents the many-to-many relationship between users and clinics,
storing clinic-specific roles and names for each association.
"""

from typing import Optional, Dict, Any
from datetime import datetime
from sqlalchemy import String, TIMESTAMP, Boolean, ForeignKey, UniqueConstraint, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pydantic import BaseModel, Field

from core.database import Base


class PractitionerSettings(BaseModel):
    """Schema for practitioner settings per clinic."""
    compact_schedule_enabled: bool = Field(
        default=False,
        description="Whether to recommend compact schedule slots that don't extend total time"
    )


class UserClinicAssociation(Base):
    """Many-to-many relationship between users and clinics with clinic-specific roles and names."""
    
    __tablename__ = "user_clinic_associations"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    roles: Mapped[list[str]] = mapped_column(JSONB, default=list)
    full_name: Mapped[str] = mapped_column(String(255))  # Clinic-specific name
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    
    settings: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """
    JSONB column containing practitioner settings per clinic with validated schema.
    
    Structure (matches PractitionerSettings Pydantic model):
    {
        "compact_schedule_enabled": false
    }
    """
    
    # Relationships
    user = relationship("User", back_populates="clinic_associations")
    clinic = relationship("Clinic", back_populates="user_associations")
    
    __table_args__ = (
        UniqueConstraint('user_id', 'clinic_id', name='uq_user_clinic'),
        # Indexes for query performance
        Index('idx_user_clinic_associations_user', 'user_id'),
        Index('idx_user_clinic_associations_clinic', 'clinic_id'),
        # Composite index for user + active + clinic lookups
        Index(
            'idx_user_clinic_associations_user_active_clinic',
            'user_id', 'is_active', 'clinic_id',
            postgresql_where=text('is_active = TRUE')
        ),
        # Covering index for get_active_clinic_association with id for fallback ordering
        # This index covers: filter by user_id + is_active, order by last_accessed_at DESC, id ASC
        # Removed idx_user_clinic_associations_active and idx_user_clinic_associations_last_accessed
        # as they are redundant with this more comprehensive index
        Index(
            'idx_user_clinic_associations_user_active_accessed_id',
            'user_id', 'is_active', 'last_accessed_at', 'id',
            postgresql_where=text('is_active = TRUE')
        ),
    )
    
    def get_validated_settings(self) -> PractitionerSettings:
        """Get settings with schema validation."""
        return PractitionerSettings.model_validate(self.settings)
    
    def set_validated_settings(self, settings: PractitionerSettings):
        """Set settings with schema validation."""
        self.settings = settings.model_dump()
    
    def __repr__(self) -> str:
        return f"<UserClinicAssociation(id={self.id}, user_id={self.user_id}, clinic_id={self.clinic_id}, roles={self.roles})>"
