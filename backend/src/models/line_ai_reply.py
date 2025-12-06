"""
LINE AI reply tracking model for dashboard metrics.

This model tracks AI reply messages (free messages) sent through the platform
to enable dashboard statistics. Unlike LineMessage which is cleaned up after 10 days,
this table persists indefinitely to maintain historical dashboard data.
"""

from typing import Optional
from datetime import datetime

from sqlalchemy import String, ForeignKey, TIMESTAMP, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class LineAiReply(Base):
    """
    Track LINE AI reply messages (free messages) for dashboard metrics.
    
    This table persists indefinitely (unlike LineMessage which is cleaned up after 10 days)
    to maintain accurate historical dashboard statistics.
    """

    __tablename__ = "line_ai_replies"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the AI reply record."""

    line_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    """Recipient LINE user ID."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    """Clinic ID."""

    line_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    """LINE message ID from LINE API response (for correlation with LineMessage if needed)."""

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True
    )
    """Timestamp when the AI reply was sent."""

    # Relationships
    clinic = relationship("Clinic", back_populates="line_ai_replies")
    """Relationship to Clinic entity."""

    # Composite index for efficient dashboard queries
    __table_args__ = (
        Index('idx_ai_replies_clinic_created', 'clinic_id', 'created_at'),
    )

    def __repr__(self) -> str:
        """String representation for debugging."""
        return (
            f"<LineAiReply(id={self.id}, "
            f"clinic_id={self.clinic_id}, "
            f"line_user_id={self.line_user_id[:10]}...)>"
        )

