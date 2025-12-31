"""
User-Clinic Association model for multi-clinic user support.

This model represents the many-to-many relationship between users and clinics,
storing clinic-specific roles and names for each association.
"""

from typing import Optional, Dict, Any
from datetime import datetime
from sqlalchemy import String, TIMESTAMP, Boolean, ForeignKey, UniqueConstraint, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pydantic import BaseModel, Field, field_validator

from core.database import Base


class PractitionerSettings(BaseModel):
    """Schema for practitioner settings per clinic."""
    compact_schedule_enabled: bool = Field(
        default=False,
        description="Whether to recommend compact schedule slots that don't extend total time"
    )
    next_day_notification_time: str = Field(
        default="21:00",
        description="Time to send next-day appointment notifications (HH:MM format, 24-hour)"
    )
    auto_assigned_notification_time: str = Field(
        default="21:00",
        description="Time to send auto-assigned appointment notifications to admins (HH:MM format, 24-hour)"
    )
    patient_booking_allowed: bool = Field(
        default=True,
        description="Whether patients are allowed to schedule appointments with this practitioner. Only clinic users can book if False."
    )
    step_size_minutes: Optional[int] = Field(
        default=None,
        ge=5,
        le=60,
        description="Time interval in minutes for appointment slot granularity for this specific practitioner. If null, falls back to clinic default."
    )
    # Admin-only fields
    subscribe_to_appointment_changes: bool = Field(
        default=False,
        description="Admin-only: Subscribe to appointment change notifications for all practitioners"
    )
    admin_daily_reminder_enabled: bool = Field(
        default=False,
        description="[DEPRECATED] Admin-only: Receive daily appointment reminders for all practitioners. Use next_day_notification_time instead."
    )
    admin_daily_reminder_time: str = Field(
        default="21:00",
        description="[DEPRECATED] Admin-only: Time to send daily appointment reminder (HH:MM format, 24-hour). Use next_day_notification_time instead."
    )
    auto_assigned_notification_mode: str = Field(
        default="scheduled",
        description="Admin-only: Auto-assigned notification mode - 'immediate' or 'scheduled'"
    )
    
    @field_validator('auto_assigned_notification_mode')
    @classmethod
    def validate_notification_mode(cls, v: str) -> str:
        """Validate that notification mode is one of the allowed values."""
        if v not in ['immediate', 'scheduled']:
            raise ValueError("auto_assigned_notification_mode 必須是 'immediate' 或 'scheduled'")
        return v
    
    @field_validator('admin_daily_reminder_time')
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        """[DEPRECATED] Validate that time is in HH:MM format. This field is deprecated, use next_day_notification_time instead."""
        try:
            parts = v.split(':')
            if len(parts) != 2:
                raise ValueError("Time must be in HH:MM format")
            hour = int(parts[0])
            minute = int(parts[1])
            if hour < 0 or hour > 23:
                raise ValueError("Hour must be between 0 and 23")
            if minute < 0 or minute > 59:
                raise ValueError("Minute must be between 0 and 59")
        except (ValueError, AttributeError) as e:
            raise ValueError(f"Invalid time format: {v}. Must be HH:MM (24-hour format)") from e
        return v


class UserClinicAssociation(Base):
    """Many-to-many relationship between users and clinics with clinic-specific roles and names."""
    
    __tablename__ = "user_clinic_associations"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    roles: Mapped[list[str]] = mapped_column(JSONB, default=list)
    full_name: Mapped[str] = mapped_column(String(255))  # Clinic-specific name
    title: Mapped[str] = mapped_column(String(50), default="")  # Title/honorific (e.g., "治療師") - used in external displays
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    
    settings: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    """
    JSONB column containing practitioner settings per clinic with validated schema.
    
    Structure (matches PractitionerSettings Pydantic model):
    {
        "compact_schedule_enabled": false
    }
    """
    
    # LINE integration (optional - for practitioner/admin notifications per clinic)
    line_user_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """
    LINE user ID for practitioner/admin LINE account linking per clinic.
    
    Used to send appointment notifications to practitioners/admins via LINE.
    Optional - practitioners/admins can link their LINE account independently for each clinic.
    Each clinic may use a different LINE Messaging API channel, so the same physical LINE
    user will have different line_user_id values per channel.
    
    Unique constraint on (clinic_id, line_user_id) ensures one LINE account can only
    link to one user per clinic.
    """
    
    # Relationships
    user = relationship("User", back_populates="clinic_associations")
    clinic = relationship("Clinic", back_populates="user_associations")
    
    __table_args__ = (
        UniqueConstraint('user_id', 'clinic_id', name='uq_user_clinic'),
        UniqueConstraint('clinic_id', 'line_user_id', name='uq_user_clinic_associations_clinic_line_user'),
        # Indexes for query performance
        Index('idx_user_clinic_associations_user', 'user_id'),
        Index('idx_user_clinic_associations_clinic', 'clinic_id'),
        Index('idx_user_clinic_associations_line_user_id', 'line_user_id'),
        # Composite index for user + active + clinic lookups
        Index(
            'idx_user_clinic_associations_user_active_clinic',
            'user_id', 'is_active', 'clinic_id',
            postgresql_where=text('is_active = TRUE')
        ),
        # Covering index for get_active_clinic_association with id for fallback ordering
        # This index covers: filter by user_id + is_active, order by last_accessed_at DESC, id ASC
        # Removed idx_user_clinic_associations_active and idx_user_clinic_associations_last_accessed
        # as they are redundant with this more comprehensive index
        Index(
            'idx_user_clinic_associations_user_active_accessed_id',
            'user_id', 'is_active', 'last_accessed_at', 'id',
            postgresql_where=text('is_active = TRUE')
        ),
    )
    
    def get_validated_settings(self) -> PractitionerSettings:
        """Get settings with schema validation."""
        return PractitionerSettings.model_validate(self.settings)
    
    def set_validated_settings(self, settings: PractitionerSettings):
        """Set settings with schema validation."""
        self.settings = settings.model_dump()
    
    def __repr__(self) -> str:
        return f"<UserClinicAssociation(id={self.id}, user_id={self.user_id}, clinic_id={self.clinic_id}, roles={self.roles})>"
