"""
Patient Photo model.
"""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Integer, Boolean, TIMESTAMP, ForeignKey, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base

class PatientPhoto(Base):
    """
    Patient photo entity representing an image uploaded for a patient.
    """
    __tablename__ = "patient_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(Integer, ForeignKey("clinics.id"), nullable=False)
    patient_id: Mapped[int] = mapped_column(Integer, ForeignKey("patients.id"), nullable=False)
    
    medical_record_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("medical_records.id", ondelete="CASCADE"), nullable=True)
    patient_form_request_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("patient_form_requests.id", ondelete="SET NULL"), nullable=True)
    
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    thumbnail_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    is_pending: Mapped[bool] = mapped_column(Boolean, server_default='true', nullable=False) # Staged state
    is_deleted: Mapped[bool] = mapped_column(Boolean, server_default='false', nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default='now()')
    updated_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True, onupdate=lambda: datetime.now(timezone.utc))
    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_by_patient_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("patients.id"), nullable=True)
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    clinic = relationship("Clinic")
    patient = relationship("Patient", foreign_keys=[patient_id])
    medical_record = relationship("MedicalRecord", back_populates="photos")
    patient_form_request = relationship("PatientFormRequest")
    uploaded_by_user = relationship("User", foreign_keys=[uploaded_by_user_id])
    uploaded_by_patient = relationship("Patient", foreign_keys=[uploaded_by_patient_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id])

    __table_args__ = (
        Index("idx_patient_photos_clinic", "clinic_id"),
        Index("idx_patient_photos_patient", "patient_id"),
        Index("idx_patient_photos_medical_record", "medical_record_id"),
        Index("idx_patient_photos_patient_record", "patient_id", "medical_record_id"),
        Index("idx_patient_photos_patient_form_request", "patient_form_request_id"),
        Index("idx_patient_photos_deleted", "clinic_id", "is_deleted"),
        Index("idx_patient_photos_dedup", "clinic_id", "content_hash"),
        Index("idx_patient_photos_created", "created_at"),
    )
