"""
Availability notification model for waitlist functionality.

Represents user requests to be notified when appointment slots become available
in specific time windows for specific dates.
"""

from sqlalchemy import String, ForeignKey, TIMESTAMP, Date, JSON, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional, List
from datetime import date as date_type

from core.database import Base


class AvailabilityNotification(Base):
    """
    Availability notification entity for waitlist functionality.

    Represents a user's request to be notified when appointment slots become
    available in specific time windows (morning, afternoon, evening) for a
    specific date, appointment type, and optional practitioner.
    """

    __tablename__ = "availability_notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the notification."""

    line_user_id: Mapped[int] = mapped_column(ForeignKey("line_users.id"), nullable=False)
    """Reference to the LINE user who requested the notification."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"), nullable=False)
    """Reference to the clinic."""

    appointment_type_ids: Mapped[List[int]] = mapped_column(JSON, nullable=False)
    """List of appointment type IDs. Allows multiple appointment types per notification."""

    practitioner_ids: Mapped[List[int]] = mapped_column(JSON, nullable=False, default=list)
    """List of practitioner IDs. Empty list means "不指定" (any practitioner)."""

    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    """Date for which notification is requested."""

    time_windows: Mapped[List[str]] = mapped_column(JSON, nullable=False)
    """List of time windows: ["morning", "afternoon", "evening"]."""

    status: Mapped[str] = mapped_column(String(50), default="active")
    """Status: "active", "fulfilled", "expired", "cancelled"."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the notification was created."""

    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the notification expires (end of requested date)."""

    last_notified_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when notification was last sent (for rate limiting)."""

    # Relationships
    line_user = relationship("LineUser", back_populates="availability_notifications")
    """Relationship to the LINE user."""

    clinic = relationship("Clinic")
    """Relationship to the clinic."""

    __table_args__ = (
        Index('idx_notification_user', 'line_user_id', 'clinic_id', 'status'),
        Index('idx_notification_date', 'date', 'status'),
        CheckConstraint(
            "status IN ('active', 'fulfilled', 'expired', 'cancelled')",
            name='check_notification_status'
        ),
    )

