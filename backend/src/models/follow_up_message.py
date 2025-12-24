"""
Follow-up message model for post-appointment follow-up messages.

This model stores the configuration for follow-up messages that are sent
to patients after their appointments. Each appointment type can have
multiple follow-up messages with different timing configurations.
"""

from datetime import datetime, time
from typing import Optional
from sqlalchemy import String, ForeignKey, TIMESTAMP, Text, Integer, Time, CheckConstraint, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class FollowUpMessage(Base):
    """
    Follow-up message configuration entity.
    
    Stores the configuration for follow-up messages that are sent to patients
    after their appointments. Each appointment type can have multiple follow-up
    messages with different timing configurations.
    """

    __tablename__ = "follow_up_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the follow-up message."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id", ondelete="CASCADE"), nullable=False)
    """Reference to the appointment type this follow-up message belongs to."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    """Reference to the clinic that owns this follow-up message."""

    timing_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    """Timing mode: 'hours_after' or 'specific_time'."""

    hours_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """For Mode A: hours after appointment end (x >= 0)."""

    days_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """For Mode B: days after appointment date (y >= 0)."""

    time_of_day: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    """For Mode B: specific time (e.g., 21:00)."""

    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    """Message template with placeholders."""

    is_enabled: Mapped[bool] = mapped_column(default=True)
    """Whether this follow-up message is enabled."""

    display_order: Mapped[int] = mapped_column(Integer, default=0)
    """Display order for sorting multiple follow-up messages."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    """Timestamp when the follow-up message was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    """Timestamp when the follow-up message was last updated."""

    # Relationships
    appointment_type = relationship("AppointmentType", back_populates="follow_up_messages")
    """Relationship to the AppointmentType entity."""

    clinic = relationship("Clinic")
    """Relationship to the Clinic entity."""

    # Table constraints
    __table_args__ = (
        CheckConstraint("timing_mode IN ('hours_after', 'specific_time')", name='check_timing_mode'),
        CheckConstraint('hours_after >= 0', name='check_hours_after_non_negative'),
        CheckConstraint('days_after >= 0', name='check_days_after_non_negative'),
        CheckConstraint(
            "(timing_mode = 'hours_after' AND hours_after IS NOT NULL) OR "
            "(timing_mode = 'specific_time' AND days_after IS NOT NULL AND time_of_day IS NOT NULL)",
            name='check_timing_mode_consistency'
        ),
        UniqueConstraint('appointment_type_id', 'display_order', name='unique_appointment_type_order'),
    )

