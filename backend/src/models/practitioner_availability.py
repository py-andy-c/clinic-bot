"""
Practitioner availability model.

This model stores the available hours for each practitioner.
Practitioners can set their own availability, and clinic admins can also edit it.
"""

from datetime import time, datetime
from typing import Optional
from sqlalchemy import Time, TIMESTAMP, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class PractitionerAvailability(Base):
    """Model for storing practitioner availability hours."""

    __tablename__ = "practitioner_availability"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))  # References User (practitioners only)
    day_of_week: Mapped[int] = mapped_column()  # 0=Monday, 1=Tuesday, ..., 6=Sunday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    is_available: Mapped[bool] = mapped_column(default=True)

    # Metadata
    created_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="availability")

    __table_args__ = (
        UniqueConstraint('user_id', 'day_of_week', name='uq_user_day_availability'),
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

    def __repr__(self) -> str:
        return f"<PractitionerAvailability(user_id={self.user_id}, day={self.day_name}, {self.start_time}-{self.end_time})>"
