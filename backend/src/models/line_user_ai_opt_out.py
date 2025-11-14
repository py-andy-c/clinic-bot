"""
LINE user AI opt-out model for tracking when users disable AI replies.

This model tracks per-clinic opt-out status for LINE users who want to
temporarily disable AI responses. Opt-out expires after the specified
duration (typically 24 hours).
"""

from datetime import datetime

from sqlalchemy import String, ForeignKey, TIMESTAMP, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class LineUserAiOptOut(Base):
    """
    LINE user AI opt-out entity tracking temporary AI reply disabling.
    
    Represents a user's opt-out status for AI replies per clinic. When a user
    sends "人工回覆", they are opted out for 24 hours. During this period,
    messages are received but not processed by the AI agent.
    
    The opt-out is automatically expired when opted_out_until timestamp passes.
    """

    __tablename__ = "line_user_ai_opt_outs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the opt-out record."""

    line_user_id: Mapped[str] = mapped_column(String(255))
    """
    LINE user ID string (from LINE platform).
    
    This is the LINE user ID string, not a foreign key to line_users table,
    because LINE users may not have a LineUser record if they only chat
    (and haven't booked appointments via LIFF).
    """

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    """Reference to the clinic where this opt-out applies."""

    opted_out_until: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    """
    Timestamp when the opt-out expires.
    
    After this timestamp, the user is automatically opted back in.
    Typically set to 24 hours from when opt-out was requested.
    """

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the opt-out was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the opt-out was last updated."""

    # Relationships
    clinic = relationship("Clinic", back_populates="line_user_ai_opt_outs")
    """Relationship to the Clinic entity."""

    __table_args__ = (
        UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_user_clinic_opt_out'),
        Index('idx_line_user_ai_opt_out_user_clinic', 'line_user_id', 'clinic_id'),
        Index('idx_line_user_ai_opt_out_expiry', 'opted_out_until'),
    )

