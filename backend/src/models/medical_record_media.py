"""
Media files associated with a medical record's clinical workspace.
"""

from sqlalchemy import String, ForeignKey, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from core.database import Base

class MedicalRecordMedia(Base):
    """
    Media files associated with a medical record's clinical workspace.
    """
    __tablename__ = "medical_record_media"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the media entry."""

    record_id: Mapped[int] = mapped_column(ForeignKey("medical_records.id"), index=True)
    """Reference to the medical record this media belongs to."""

    s3_key: Mapped[str] = mapped_column(String(512), unique=True)
    """S3 key where the media file is stored."""

    file_type: Mapped[str] = mapped_column(String(50))
    """MIME type of the media file (e.g., 'image/webp')."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    """Timestamp when the media entry was created."""

    # Relationships
    record = relationship("MedicalRecord", back_populates="media")
    """Relationship to the medical record this media belongs to."""

    def __repr__(self) -> str:
        return f"<MedicalRecordMedia(id={self.id}, record_id={self.record_id}, s3_key='{self.s3_key}')>"
