"""
Signup Token model for secure invitation-based onboarding.

Handles secure token generation and validation for clinic admin and team member
invitations with expiration, revocation, and one-time use functionality.
"""

from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import String, TIMESTAMP, Boolean, JSON, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class SignupToken(Base):
    """Secure tokens for invitation-based user onboarding."""

    __tablename__ = "signup_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))
    default_roles: Mapped[list[str]] = mapped_column(JSON)  # Default roles for new user
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    used_by_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    clinic = relationship("Clinic", back_populates="signup_tokens")

    __table_args__ = (
        Index('idx_signup_tokens_active', 'token', 'expires_at', 'is_revoked', 'used_at'),
        Index('idx_signup_tokens_clinic_id', 'clinic_id'),
    )

    @property
    def is_active(self) -> bool:
        """Check if token is still valid for use."""
        # expires_at is guaranteed to be non-null by database constraint
        assert self.expires_at is not None
        return (
            not self.is_revoked
            and self.used_at is None
            and self.expires_at > datetime.now(timezone.utc)
        )

    def mark_used(self, email: str) -> None:
        """Mark token as used by a specific email."""
        self.used_at = datetime.now(timezone.utc)
        self.used_by_email = email

    def __repr__(self) -> str:
        return f"<SignupToken(id={self.id}, clinic_id={self.clinic_id}, is_active={self.is_active})>"
