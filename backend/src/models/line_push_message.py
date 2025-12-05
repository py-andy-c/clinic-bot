"""
LINE push message model for tracking paid messages (push messages) for dashboard metrics.

This model tracks LINE push messages (paid messages) sent through the platform
to enable dashboard statistics and cost visibility. Uses a flexible multi-label
system to support current grouping needs and future regrouping without losing history.
"""

from typing import Optional, Dict, Any
from datetime import datetime

from sqlalchemy import String, ForeignKey, TIMESTAMP, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class LinePushMessage(Base):
    """
    Track LINE push messages (paid messages) for dashboard metrics.
    
    Uses a flexible multi-label system to support:
    - Current grouping needs (recipient type, event type, trigger source)
    - Future regrouping without losing history
    - Extensibility for new event types and labels
    """

    __tablename__ = "line_push_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the push message record."""

    line_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    """Recipient LINE user ID."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    """Clinic ID."""

    line_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    """LINE message ID from LINE API response (for correlation with LineMessage if needed)."""

    # Core indexed labels for efficient querying
    recipient_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    """Recipient type: 'patient', 'practitioner', or 'admin'."""

    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    """Event type: 'appointment_confirmation', 'appointment_cancellation', etc."""

    trigger_source: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    """Trigger source: 'clinic_triggered', 'patient_triggered', or 'system_triggered'."""

    # Flexible labels for future extensibility (JSONB)
    labels: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """
    Flexible labels dictionary for additional metadata.
    
    Examples:
    - {'appointment_context': 'new_appointment'}  # For appointment-related messages
    - {'priority': 'high'}  # For future priority-based grouping
    - {'campaign_id': 'summer_2024'}  # For future campaign tracking
    - {'message_category': 'notification'}  # For future categorization
    
    This allows regrouping messages in the future without losing historical data.
    """

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True
    )
    """Timestamp when the message was sent."""

    # Relationships
    clinic = relationship("Clinic", back_populates="line_push_messages")
    """Relationship to Clinic entity."""

    # Composite indexes for efficient dashboard queries
    __table_args__ = (
        Index('idx_push_messages_clinic_created', 'clinic_id', 'created_at'),
        Index('idx_push_messages_labels', 'clinic_id', 'recipient_type', 'event_type', 'trigger_source'),
    )

    def __repr__(self) -> str:
        """String representation for debugging."""
        return (
            f"<LinePushMessage(id={self.id}, "
            f"recipient_type={self.recipient_type}, "
            f"event_type={self.event_type}, "
            f"trigger_source={self.trigger_source})>"
        )

