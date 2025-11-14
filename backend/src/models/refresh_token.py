"""
Refresh Token model for JWT session management.

Handles secure storage and validation of refresh tokens with automatic
cleanup of expired tokens and session management.
"""

from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import String, TIMESTAMP, Boolean, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
import sqlalchemy as sa

from core.database import Base


class RefreshToken(Base):
    """Secure refresh tokens for JWT session management."""

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)  # Both system admins and clinic users have User records now
    token_hash: Mapped[str] = mapped_column(String(255), unique=True)  # bcrypt hashed
    token_hash_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # SHA-256 hash for O(1) lookup
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    # Legacy fields - no longer needed (user_id links to User record)
    # Kept for backward compatibility during migration period
    # TODO: Remove in future migration after all old refresh tokens are migrated
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    google_subject_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relationships
    user = relationship("User", back_populates="refresh_tokens", foreign_keys=[user_id])

    __table_args__ = (
        Index('idx_refresh_tokens_user_id', 'user_id'),
        Index('idx_refresh_tokens_token_hash', 'token_hash'),
        Index('idx_refresh_tokens_token_hash_sha256', 'token_hash_sha256', unique=True, postgresql_where=sa.text('token_hash_sha256 IS NOT NULL')),
        Index('idx_refresh_tokens_sha256_valid', 'token_hash_sha256', 'revoked', 'expires_at', postgresql_where=sa.text('token_hash_sha256 IS NOT NULL AND revoked = false')),
        Index('idx_refresh_tokens_expires_at', 'expires_at'),
    )

    @property
    def is_valid(self) -> bool:
        """Check if refresh token is still valid."""
        return (
            not self.revoked
            and self.expires_at > datetime.now(timezone.utc)
        )

    def update_last_used(self) -> None:
        """Update the last used timestamp."""
        self.last_used_at = datetime.now(timezone.utc)

    def revoke(self) -> None:
        """Revoke this refresh token."""
        self.revoked = True

    def __repr__(self) -> str:
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, is_valid={self.is_valid})>"
