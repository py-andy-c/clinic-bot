"""
Practitioner link code model for webhook-based LINE account linking.

This model stores temporary codes that practitioners can send to the clinic's
LINE Official Account to link their LINE user ID to their User account.
"""

from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import String, TIMESTAMP, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class PractitionerLinkCode(Base):
    """Temporary linking code for practitioners to link their LINE accounts."""
    
    __tablename__ = "practitioner_link_codes"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the link code record."""
    
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    """Linking code (e.g., "LINK-12345") that practitioner sends via LINE."""
    
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    """User (practitioner) who generated this code."""
    
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"), nullable=False)
    """Clinic for which this code is valid."""
    
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """When this code expires (typically 10 minutes after creation)."""
    
    used_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """When this code was used to link the LINE account (NULL if not used yet)."""
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    """When this code was created."""
    
    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    """User who generated this code."""
    
    clinic = relationship("Clinic", foreign_keys=[clinic_id])
    """Clinic for which this code is valid."""
    
    def is_active(self) -> bool:
        """Check if this code is still active (not expired and not used)."""
        now = datetime.now(timezone.utc)
        return (
            self.used_at is None
            and self.expires_at > now
        )
    
    def mark_used(self) -> None:
        """Mark this code as used."""
        self.used_at = datetime.now(timezone.utc)
    
    def __repr__(self) -> str:
        return f"<PractitionerLinkCode(id={self.id}, code='{self.code}', user_id={self.user_id}, clinic_id={self.clinic_id}, active={self.is_active()})>"

