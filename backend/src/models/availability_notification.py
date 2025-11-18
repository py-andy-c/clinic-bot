"""
Availability notification model.

Represents a user's request to be notified when appointment slots become available
for specific appointment types, practitioners, and time windows.
"""

from datetime import date, datetime
from typing import Optional, List, Dict, TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from utils.datetime_utils import TAIWAN_TZ

if TYPE_CHECKING:
    from models.line_user import LineUser
    from models.clinic import Clinic
    from models.appointment_type import AppointmentType
    from models.user import User


class AvailabilityNotification(Base):
    """
    Availability notification entity.
    
    Represents a LINE user's request to be notified when appointment slots
    become available for specific criteria (appointment type, practitioner, time windows).
    """
    
    __tablename__ = "availability_notifications"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    """Unique identifier for the notification."""
    
    line_user_id: Mapped[int] = mapped_column(ForeignKey("line_users.id"))
    """LINE user who created this notification."""
    
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))
    """Clinic this notification is for."""
    
    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"))
    """Appointment type to watch for."""
    
    practitioner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    """Practitioner to watch for. NULL means "不指定" (any practitioner)."""
    
    # Store time windows as JSON: [{"date": "2024-01-15", "time_window": "morning"}, ...]
    time_windows: Mapped[List[Dict[str, str]]] = mapped_column(JSON)
    """List of time window entries: [{"date": "YYYY-MM-DD", "time_window": "morning|afternoon|evening"}, ...]"""
    
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(TAIWAN_TZ))
    """When this notification was created."""
    
    is_active: Mapped[bool] = mapped_column(default=True)
    """Whether this notification is active. False for soft-deleted notifications."""
    
    last_notified_date: Mapped[Optional[date]] = mapped_column(nullable=True)
    """Last date a notification was sent (for deduplication - one per day)."""
    
    # Relationships
    line_user: Mapped["LineUser"] = relationship(back_populates=None)  # type: ignore
    """Relationship to LINE user."""
    
    clinic: Mapped["Clinic"] = relationship(back_populates=None)  # type: ignore
    """Relationship to clinic."""
    
    appointment_type: Mapped["AppointmentType"] = relationship(back_populates=None)  # type: ignore
    """Relationship to appointment type."""
    
    practitioner: Mapped[Optional["User"]] = relationship(back_populates=None)  # type: ignore
    """Relationship to practitioner (if specified)."""
    
    # Indexes
    __table_args__ = (
        # Primary index for GET/POST endpoints: filter by line_user_id + clinic_id + is_active
        # Covers: GET notifications list, POST limit check
        # Order: line_user_id first (most selective), then clinic_id, then is_active
        # PostgreSQL can use left-prefix: queries filtering by (line_user_id) or (line_user_id, clinic_id) also benefit
        Index("idx_line_user_clinic_active", "line_user_id", "clinic_id", "is_active"),
    )

