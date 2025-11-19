"""
LINE user model representing LINE messaging platform users.

LINE users represent individuals who interact with clinics through the LINE messaging
platform. Each LINE user can have multiple patient records across different clinics,
enabling one LINE account to manage appointments for multiple family members or
across different clinics.
"""

from typing import Optional

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class LineUser(Base):
    """
    LINE user entity representing an individual who interacts via LINE messaging.

    Represents LINE platform users who can manage appointments across multiple clinics
    and for multiple patients (e.g., family members). Each LINE user can have multiple
    patient records across different clinics for proper data isolation.
    """

    __tablename__ = "line_users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the LINE user record."""

    line_user_id: Mapped[str] = mapped_column(String(255), unique=True)
    """Unique identifier for the user provided by LINE messaging platform."""

    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """Display name from LINE profile (may be None if not provided)."""

    preferred_language: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
        server_default='zh-TW'  # Database-level default, matches migration
    )
    """
    User's preferred language for UI and LINE messages.
    
    Values: 'zh-TW' (Traditional Chinese), 'en' (English), 'ja' (Japanese)
    Default: 'zh-TW'
    """

    # Relationships
    patients = relationship("Patient", back_populates="line_user")
    """Relationship to Patient entities associated with this LINE user."""
