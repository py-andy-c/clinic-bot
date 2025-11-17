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

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False)
    """Reference to the patient for whom the notification is requested."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"), nullable=False)
    """Reference to the appointment type."""

    practitioner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    """Optional reference to specific practitioner. None means "不指定" (any practitioner)."""

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

    patient = relationship("Patient")
    """Relationship to the patient."""

    appointment_type = relationship("AppointmentType")
    """Relationship to the appointment type."""

    practitioner = relationship("User")
    """Optional relationship to the practitioner."""

    __table_args__ = (
        Index('idx_notification_lookup', 'clinic_id', 'appointment_type_id', 'date', 'status'),
        Index('idx_notification_user', 'line_user_id', 'status'),
        Index('idx_notification_date', 'date', 'status'),
        CheckConstraint(
            "status IN ('active', 'fulfilled', 'expired', 'cancelled')",
            name='check_notification_status'
        ),
    )

