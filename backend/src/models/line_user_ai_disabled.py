"""
LINE user AI disabled model for tracking when clinic admins permanently disable AI replies.

This model tracks per-clinic permanent disable status for LINE users. Unlike the
temporary opt-out system (LineUserAiOptOut), this setting is admin-controlled and
persists until manually changed.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, ForeignKey, TIMESTAMP, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class LineUserAiDisabled(Base):
    """
    LINE user AI disabled entity tracking permanent AI reply disabling.
    
    Represents an admin-controlled permanent disable status for AI replies per clinic.
    When disabled, messages from this user are not processed by the AI agent.
    
    This is different from LineUserAiOptOut which is user-initiated and temporary.
    This setting persists until manually changed by a clinic admin.
    """

    __tablename__ = "line_user_ai_disabled"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the disable record."""

    line_user_id: Mapped[str] = mapped_column(String(255))
    """
    LINE user ID string (from LINE platform).
    
    This is the LINE user ID string, not a foreign key to line_users table,
    because LINE users may not have a LineUser record if they only chat
    (and haven't booked appointments via LIFF).
    """

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    """Reference to the clinic where this disable applies."""

    disabled_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when AI was disabled for this user."""

    disabled_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    """ID of the admin user who disabled AI (for audit trail)."""

    reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    """Optional reason/notes for why AI was disabled."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the record was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the record was last updated."""

    # Relationships
    clinic = relationship("Clinic", back_populates="line_user_ai_disabled")
    """Relationship to the Clinic entity."""
    
    disabled_by_user = relationship("User")
    """Relationship to the User who disabled AI for this LINE user."""

    __table_args__ = (
        UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_user_clinic_ai_disabled'),
        Index('idx_line_user_ai_disabled_user_clinic', 'line_user_id', 'clinic_id'),
        Index('idx_line_user_ai_disabled_at', 'disabled_at'),
        Index('idx_line_user_ai_disabled_by_user', 'disabled_by_user_id'),
    )
