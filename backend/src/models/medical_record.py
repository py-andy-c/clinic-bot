"""
Medical Record model.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional, TYPE_CHECKING
from sqlalchemy import String, Integer, Boolean, TIMESTAMP, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base

if TYPE_CHECKING:
    from models.patient_photo import PatientPhoto

class MedicalRecord(Base):
    """
    Medical record entity representing a patient's clinical record.
    """
    __tablename__ = "medical_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(Integer, ForeignKey("clinics.id"), nullable=False)
    patient_id: Mapped[int] = mapped_column(Integer, ForeignKey("patients.id"), nullable=False)
    
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("medical_record_templates.id"), nullable=False)
    template_name: Mapped[str] = mapped_column(String(255), nullable=False) # Denormalized
    
    appointment_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("appointments.calendar_event_id"), nullable=True)
    
    # Snapshot of the template structure at the time of creation
    template_snapshot: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    
    # Actual values for the record
    values: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    
    source_type: Mapped[str] = mapped_column(String(20), server_default='clinic', nullable=False)
    last_updated_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    last_updated_by_patient_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("patients.id"), nullable=True)
    patient_form_request_id: Mapped[Optional[int]] = mapped_column(
        Integer, 
        ForeignKey("patient_form_requests.id", name="fk_medical_records_patient_form_request", use_alter=True), 
        nullable=True
    )
    
    version: Mapped[int] = mapped_column(Integer, server_default='1', nullable=False)
    
    is_deleted: Mapped[bool] = mapped_column(Boolean, server_default='false', nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default='now()')
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default='now()', onupdate=lambda: datetime.now(timezone.utc))
    
    created_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    clinic = relationship("Clinic")
    patient = relationship("Patient", foreign_keys=[patient_id]) # We'll need to update Patient model to back_populate if needed
    template = relationship("MedicalRecordTemplate")
    appointment = relationship("Appointment")
    
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id])
    last_updated_by_user = relationship("User", foreign_keys=[last_updated_by_user_id])
    last_updated_by_patient = relationship("Patient", foreign_keys=[last_updated_by_patient_id])
    patient_form_request = relationship("PatientFormRequest", foreign_keys=[patient_form_request_id])
    
    photos: Mapped[list["PatientPhoto"]] = relationship("PatientPhoto", back_populates="medical_record", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_medical_records_clinic", "clinic_id"),
        Index("idx_medical_records_patient", "patient_id"),
        Index("idx_medical_records_appointment", "appointment_id"),
        Index("idx_medical_records_deleted", "clinic_id", "patient_id", "is_deleted"),
        Index("idx_medical_records_updated", "clinic_id", "updated_at"),
        Index("idx_medical_records_created", "created_at"),
    )
