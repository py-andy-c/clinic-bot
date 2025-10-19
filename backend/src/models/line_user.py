"""
LINE user model representing LINE messaging platform users who are clinic patients.

LINE users represent patients who interact with the clinic through the LINE messaging
platform. Each LINE user is linked to exactly one patient record, establishing the
connection between LINE's user identification and the clinic's patient management system.
"""

from typing import Optional

from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class LineUser(Base):
    """
    LINE user entity representing a patient who interacts via LINE messaging.

    Establishes the link between LINE's user identification system and
    the clinic's patient records. Each patient can have at most one LINE user account,
    and each LINE user corresponds to exactly one patient. This ensures clean mapping
    between messaging identities and medical records.
    """

    __tablename__ = "line_users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the LINE user record."""

    line_user_id: Mapped[str] = mapped_column(String(255), unique=True)
    """Unique identifier for the user provided by LINE messaging platform."""

    patient_id: Mapped[Optional[int]] = mapped_column(ForeignKey("patients.id"), unique=True, nullable=True)  # Enforces 1-to-1 mapping
    """Reference to the patient record associated with this LINE user. Unique constraint ensures one LINE user per patient."""

    # Relationships
    patient = relationship("Patient", back_populates="line_user")
    """Relationship to the Patient entity associated with this LINE user."""
