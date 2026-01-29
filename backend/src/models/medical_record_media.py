from sqlalchemy import String, ForeignKey, TIMESTAMP, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from core.database import Base

class MedicalRecordMedia(Base):
    """
    Storage reference for images injected into the Clinical Workspace.
    """
    __tablename__ = "medical_record_media"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    record_id: Mapped[int] = mapped_column(ForeignKey("medical_records.id", ondelete="CASCADE"), index=True)
    s3_key: Mapped[str] = mapped_column(String(512), unique=True)
    file_type: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))

    # Relationships
    record = relationship("MedicalRecord")
