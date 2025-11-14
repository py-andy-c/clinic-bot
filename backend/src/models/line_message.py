"""
LINE message model for storing LINE message metadata.

This model stores LINE message IDs and content to enable retrieval of quoted messages.
LINE's API only allows retrieving media content (images, videos, etc.) but not text messages,
so we need to store text messages ourselves to support quoted message functionality.
"""

from typing import Optional
from datetime import datetime

from sqlalchemy import String, ForeignKey, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class LineMessage(Base):
    """
    LINE message entity for storing message metadata and content.
    
    Stores LINE message IDs and text content to enable retrieval of quoted messages.
    Only text messages are stored (media messages are not supported).
    """

    __tablename__ = "line_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the message record."""

    line_message_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    """LINE's message ID (unique identifier from LINE platform)."""

    line_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    """LINE user ID of the message sender/receiver."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    """Clinic ID associated with this message."""

    message_text: Mapped[Optional[str]] = mapped_column(String(5000), nullable=True)
    """Text content of the message (None for non-text messages)."""

    message_type: Mapped[str] = mapped_column(String(50), nullable=False, default="text")
    """Type of message (e.g., 'text', 'image', 'video', etc.)."""

    is_from_user: Mapped[bool] = mapped_column(nullable=False, default=True)
    """True if message is from user, False if from bot."""

    quoted_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """LINE message ID of the quoted message (if this message quotes another)."""

    session_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    """Session ID for correlation with SDK conversation history (format: "{clinic_id}-{line_user_id}")."""

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now()
    )
    """Timestamp when the message was created."""

    # Relationships
    clinic = relationship("Clinic", back_populates="line_messages")
    """Relationship to Clinic entity."""

