"""
Calendar event model representing the base table for all calendar-related events.

This model serves as the foundation for both appointments and availability exceptions,
providing a unified calendar view while maintaining type safety through specialized tables.
"""

from datetime import datetime, date as date_type, time
from typing import Optional

from sqlalchemy import String, TIMESTAMP, ForeignKey, Date, Time, Index, func, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class CalendarEvent(Base):
    """
    Base calendar event entity for unified calendar management.

    This model serves as the foundation for all calendar-related events including
    appointments and availability exceptions. It provides common fields for timing,
    Google Calendar sync, and metadata while allowing specialized tables to extend
    functionality for specific event types.

    The hybrid approach allows for:
    - Unified calendar queries across all event types
    - Consistent Google Calendar synchronization
    - Type safety through specialized tables
    - Extensibility for future event types
    """

    __tablename__ = "calendar_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the calendar event."""

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    """Reference to the practitioner/user who owns this calendar event."""

    event_type: Mapped[str] = mapped_column(String(50))
    """
    Type of calendar event. Valid values:
    - 'appointment': Patient appointment booking
    - 'availability_exception': Practitioner unavailability period
    """

    date: Mapped[date_type] = mapped_column(Date)
    """Date of the calendar event."""

    start_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    """
    Start time of the event. Null indicates an all-day event.
    """

    end_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    """
    End time of the event. Null indicates an all-day event.
    """

    gcal_event_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    """
    Google Calendar event ID for events that have been synced with Google Calendar.
    Null indicates the event has not been synced yet.
    """

    gcal_watch_resource_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """
    Google Calendar watch resource ID for webhook notifications.
    Used to identify which calendar watch triggered a webhook notification.
    """

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    """Timestamp when the calendar event was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    """Timestamp when the calendar event was last updated."""

    # Relationships
    user = relationship("User", back_populates="calendar_events")
    """Relationship to the User entity who owns this calendar event."""

    appointment = relationship("Appointment", back_populates="calendar_event", uselist=False, cascade="all, delete-orphan")
    """Relationship to the Appointment entity (if this is an appointment event)."""

    availability_exception = relationship("AvailabilityException", back_populates="calendar_event", uselist=False, cascade="all, delete-orphan")
    """Relationship to the AvailabilityException entity (if this is an availability exception)."""

    # Table constraints and indexes
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('appointment', 'availability_exception')",
            name='check_valid_event_type'
        ),
        CheckConstraint(
            "start_time IS NULL OR end_time IS NULL OR start_time <= end_time",
            name='check_valid_time_range'
        ),
        # Indexes for performance
        Index('idx_calendar_events_user_date', 'user_id', 'date'),
        Index('idx_calendar_events_type', 'event_type'),
        Index('idx_calendar_events_gcal_sync', 'gcal_event_id'),
        Index('idx_calendar_events_user_date_type', 'user_id', 'date', 'event_type'),
    )

    @property
    def is_all_day(self) -> bool:
        """Check if this is an all-day event."""
        return self.start_time is None or self.end_time is None

    @property
    def duration_minutes(self) -> Optional[int]:
        """Get the duration of the event in minutes, or None for all-day events."""
        if self.is_all_day:
            return None
        
        if self.start_time is None or self.end_time is None:
            return None
            
        start_minutes = self.start_time.hour * 60 + self.start_time.minute
        end_minutes = self.end_time.hour * 60 + self.end_time.minute
        return end_minutes - start_minutes

    def __repr__(self) -> str:
        return f"<CalendarEvent(id={self.id}, user_id={self.user_id}, type={self.event_type}, date={self.date}, time={self.start_time}-{self.end_time})>"
