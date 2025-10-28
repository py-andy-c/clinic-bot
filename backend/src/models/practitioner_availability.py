"""
Practitioner availability model for default weekly schedule management.

This model stores the default working hours for each practitioner by day of week.
Practitioners can set multiple working periods per day (e.g., 9am-12pm, 2pm-6pm)
to accommodate healthcare-specific scheduling needs like morning and afternoon sessions.
"""

from datetime import time, datetime
from typing import Optional
from sqlalchemy import Time, TIMESTAMP, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class PractitionerAvailability(Base):
    """
    Model for storing practitioner default availability hours by day of week.

    This model represents the practitioner's default weekly schedule. Each record
    represents one working period for a specific day of the week. Multiple records
    per day are allowed to support multiple working periods (e.g., morning and
    afternoon sessions).

    The model supports:
    - Multiple working periods per day
    - Flexible scheduling for healthcare needs
    - Day-of-week based default schedules
    - No unique constraints (multiple intervals per day allowed)
    """

    __tablename__ = "practitioner_availability"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the availability record."""

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    """Reference to the practitioner user."""

    day_of_week: Mapped[int] = mapped_column()
    """
    Day of the week (0=Monday, 1=Tuesday, ..., 6=Sunday).
    Multiple records per day are allowed for multiple working periods.
    """

    start_time: Mapped[time] = mapped_column(Time)
    """Start time of the working period."""

    end_time: Mapped[time] = mapped_column(Time)
    """End time of the working period."""

    # Metadata
    created_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    """Timestamp when the availability record was created."""

    updated_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    """Timestamp when the availability record was last updated."""

    # Relationships
    user = relationship("User", back_populates="availability")
    """Relationship to the User entity."""

    # Table indexes for performance
    __table_args__ = (
        Index('idx_practitioner_availability_user_day', 'user_id', 'day_of_week'),
        Index('idx_practitioner_availability_user_day_time', 'user_id', 'day_of_week', 'start_time'),
    )

    @property
    def day_name(self) -> str:
        """Get the day name for display."""
        days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        return days[self.day_of_week]

    @property
    def day_name_zh(self) -> str:
        """Get the day name in Traditional Chinese."""
        days = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
        return days[self.day_of_week]

    @property
    def duration_minutes(self) -> int:
        """Get the duration of this availability period in minutes."""
        start_minutes = self.start_time.hour * 60 + self.start_time.minute
        end_minutes = self.end_time.hour * 60 + self.end_time.minute
        return end_minutes - start_minutes

    def __repr__(self) -> str:
        return f"<PractitionerAvailability(user_id={self.user_id}, day={self.day_name}, {self.start_time}-{self.end_time})>"
