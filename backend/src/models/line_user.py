"""
LINE user model representing LINE messaging platform users.

LINE users represent individuals who interact with clinics through the LINE messaging
platform. Each LINE user has a separate entry per clinic, enabling strict clinic isolation
and per-clinic customization of settings.
"""

from typing import Optional
from datetime import datetime

from sqlalchemy import String, ForeignKey, Boolean, TIMESTAMP, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class LineUser(Base):
    """
    LINE user entity representing an individual who interacts via LINE messaging.

    Each LINE user has a separate entry per clinic, enabling:
    - Strict clinic isolation (database-level via FK constraints)
    - Per-clinic customization (display_name, preferred_language, AI settings)
    - Simpler queries (direct clinic_id filtering)
    
    Note: During migration, clinic_id may be NULL for existing records.
    After migration completes, clinic_id will be NOT NULL with unique constraint on (line_user_id, clinic_id).
    """

    __tablename__ = "line_users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the LINE user record."""

    line_user_id: Mapped[str] = mapped_column(String(255))
    """
    Unique identifier for the user provided by LINE messaging platform.
    
    Note: After migration, uniqueness is enforced via (line_user_id, clinic_id) composite constraint.
    """

    clinic_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=True,  # Nullable during migration, will be NOT NULL after Phase 2
        index=True
    )
    """
    Reference to the clinic this LineUser entry belongs to.
    
    During migration (Phase 1), this is nullable to allow zero-downtime migration.
    After data migration (Phase 2), this will be NOT NULL with unique constraint on (line_user_id, clinic_id).
    """

    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """
    Display name from LINE profile (may be None if not provided).
    
    This is the original display name from LINE platform.
    """

    clinic_display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """
    Clinic-overwritten display name (clinic internal only).
    
    If set, this name will be shown everywhere instead of the original display_name.
    This allows clinics to customize how they see LINE users internally.
    """

    picture_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    """
    Profile picture URL from LINE API.
    
    This URL is fetched when creating new users or when missing for existing users.
    May be None if user hasn't added account as friend or profile is private.
    """

    preferred_language: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
        server_default='zh-TW'  # Database-level default, matches migration
    )
    """
    User's preferred language for UI and LINE messages (clinic-specific).
    
    Values: 'zh-TW' (Traditional Chinese), 'en' (English)
    Default: 'zh-TW'
    """

    # AI settings (clinic-specific)
    ai_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    """
    Whether AI replies are permanently disabled for this user at this clinic.
    
    This is an admin-controlled setting that persists until manually changed.
    Different from ai_opt_out_until which is user-initiated and temporary.
    """

    ai_disabled_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when AI was disabled for this user at this clinic."""

    ai_disabled_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    """ID of the admin user who disabled AI (for audit trail)."""

    ai_disabled_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    """Optional reason/notes for why AI was disabled."""

    ai_opt_out_until: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """
    [DEPRECATED] Timestamp when the user's temporary AI opt-out expires.
    
    This feature has been removed. Field is kept for database compatibility.
    """

    # Relationships
    clinic = relationship("Clinic", back_populates="line_users")
    """Relationship to the Clinic entity."""

    patients = relationship("Patient", back_populates="line_user")
    """Relationship to Patient entities associated with this LINE user at this clinic."""

    disabled_by_user = relationship("User", foreign_keys=[ai_disabled_by_user_id])
    """Relationship to the User who disabled AI for this LINE user."""

    @property
    def effective_display_name(self) -> Optional[str]:
        """
        Get the effective display name to show.
        
        Returns clinic_display_name if set, otherwise falls back to display_name.
        """
        return self.clinic_display_name if self.clinic_display_name else self.display_name

    __table_args__ = (
        # TODO: Add composite unique constraint in Phase 3 migration (make_line_users_clinic_id_not_null_phase3.py)
        # This ensures (line_user_id, clinic_id) uniqueness after data migration completes
        # UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_users_line_user_clinic'),
        # Index for efficient queries (clinic_id first for better selectivity)
        Index('idx_line_users_clinic_line_user', 'clinic_id', 'line_user_id'),
    )
