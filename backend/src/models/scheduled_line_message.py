"""
Scheduled LINE message model for generalized message scheduling.

This model stores all scheduled LINE messages (follow-ups, reminders,
practitioner notifications, etc.) that need to be sent at specific times.
"""

from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import String, ForeignKey, TIMESTAMP, Text, Integer, CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class ScheduledLineMessage(Base):
    """
    Scheduled LINE message entity.
    
    Stores all scheduled LINE messages that need to be sent at specific times.
    This is a generalized table that handles follow-ups, reminders, practitioner
    notifications, and any other scheduled messages.
    """

    __tablename__ = "scheduled_line_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the scheduled message."""

    recipient_type: Mapped[str] = mapped_column(String(20), nullable=False)
    """Recipient type: 'patient', 'practitioner', or 'admin'."""

    recipient_line_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    """LINE user ID of the recipient."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    """Reference to the clinic."""

    message_type: Mapped[str] = mapped_column(String(50), nullable=False)
    """Message type: 'appointment_reminder', 'follow_up', 'practitioner_daily', etc."""

    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    """Message template with placeholders (stored for audit trail)."""

    message_context: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    """Context data for rendering (appointment_id, follow_up_message_id, etc.)."""

    scheduled_send_time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """When the message should be sent."""

    actual_send_time: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """When the message was actually sent."""

    status: Mapped[str] = mapped_column(String(20), default='pending')
    """Status: 'pending', 'processing', 'sent', 'skipped', or 'failed'."""

    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    """Number of retry attempts."""

    max_retries: Mapped[int] = mapped_column(Integer, default=3)
    """Maximum number of retry attempts."""

    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """Error message if sending failed."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    """Timestamp when the scheduled message was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    """Timestamp when the scheduled message was last updated."""

    # Relationships
    clinic = relationship("Clinic")
    """Relationship to the Clinic entity."""

    # Table constraints
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'processing', 'sent', 'skipped', 'failed')", name='check_status'),
        CheckConstraint('retry_count >= 0', name='check_retry_count_non_negative'),
        CheckConstraint('max_retries >= 0', name='check_max_retries_non_negative'),
    )

