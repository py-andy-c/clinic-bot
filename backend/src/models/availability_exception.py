"""
Availability exception model representing practitioner unavailability periods.

This model extends the CalendarEvent base table to represent specific periods
when a practitioner is unavailable (e.g., personal time off, meetings, etc.).
These exceptions take precedence over default availability for scheduling.
"""

from datetime import date as date_type
from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class AvailabilityException(Base):
    """
    Availability exception entity representing practitioner unavailability periods.

    This model extends CalendarEvent to represent specific periods when a practitioner
    is unavailable. These exceptions override the practitioner's default availability
    schedule and take precedence over appointments for future scheduling.

    Multiple exceptions per day are allowed, and overlapping exceptions are permitted
    to handle complex unavailability scenarios.
    """

    __tablename__ = "availability_exceptions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the availability exception."""

    calendar_event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id"))
    """
    Reference to the base calendar event containing timing and metadata.
    This creates a one-to-one relationship with CalendarEvent.
    """

    # Relationships
    calendar_event = relationship("CalendarEvent", back_populates="availability_exception")
    """Relationship to the CalendarEvent entity containing timing and metadata."""

    # Table indexes for performance
    __table_args__ = (
        Index('idx_availability_exceptions_calendar_event', 'calendar_event_id'),
    )

    @property
    def user_id(self) -> int:
        """Get the user ID from the associated calendar event."""
        return self.calendar_event.user_id

    @property
    def date(self) -> date_type:
        """Get the date from the associated calendar event."""
        return self.calendar_event.date

    @property
    def start_time(self):
        """Get the start time from the associated calendar event."""
        return self.calendar_event.start_time

    @property
    def end_time(self):
        """Get the end time from the associated calendar event."""
        return self.calendar_event.end_time

    @property
    def is_all_day(self) -> bool:
        """Check if this is an all-day exception."""
        return self.calendar_event.is_all_day

    def __repr__(self) -> str:
        return f"<AvailabilityException(id={self.id}, calendar_event_id={self.calendar_event_id}, date={self.date}, time={self.start_time}-{self.end_time})>"
