"""
User-Clinic Association model for multi-clinic user support.

This model represents the many-to-many relationship between users and clinics,
storing clinic-specific roles and names for each association.
"""

from typing import Optional
from datetime import datetime
from sqlalchemy import String, TIMESTAMP, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


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
    
    # Relationships
    user = relationship("User", back_populates="clinic_associations")
    clinic = relationship("Clinic", back_populates="user_associations")
    
    __table_args__ = (
        UniqueConstraint('user_id', 'clinic_id', name='uq_user_clinic'),
    )
    
    def __repr__(self) -> str:
        return f"<UserClinicAssociation(id={self.id}, user_id={self.user_id}, clinic_id={self.clinic_id}, roles={self.roles})>"
