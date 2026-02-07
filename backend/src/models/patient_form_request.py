"""
Patient form request model for tracking forms sent to patients.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Text, Boolean, TIMESTAMP, CheckConstraint, func  # type: ignore
from sqlalchemy.orm import relationship, Mapped, mapped_column
from core.database import Base
from core.constants import (
    PATIENT_FORM_STATUS_PENDING,
    PATIENT_FORM_STATUS_SUBMITTED,
    PATIENT_FORM_STATUS_SKIPPED,
    PATIENT_FORM_SOURCE_AUTO,
    PATIENT_FORM_SOURCE_MANUAL
)
from datetime import datetime
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    pass


class PatientFormRequest(Base):
    """
    Tracking for a specific form sent to a patient.
    """

    __tablename__ = "patient_form_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    template_id: Mapped[int] = mapped_column(ForeignKey("medical_record_templates.id"), nullable=False)
    appointment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("appointments.calendar_event_id", ondelete="SET NULL"), nullable=True)
    
    request_source: Mapped[str] = mapped_column(String(20), nullable=False)  # 'auto', 'manual'
    patient_form_setting_id: Mapped[Optional[int]] = mapped_column(ForeignKey("patient_form_settings.id", ondelete="SET NULL"), nullable=True)
    
    notify_admin: Mapped[bool] = mapped_column(Boolean, server_default='false', default=False)
    notify_appointment_practitioner: Mapped[bool] = mapped_column(Boolean, server_default='false', default=False)
    notify_assigned_practitioner: Mapped[bool] = mapped_column(Boolean, server_default='false', default=False)
    
    status: Mapped[str] = mapped_column(String(20), server_default=PATIENT_FORM_STATUS_PENDING, default=PATIENT_FORM_STATUS_PENDING)  # 'pending', 'submitted', 'skipped'
    access_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    
    # Circular FK: PatientFormRequest -> MedicalRecord (the result of submission)
    # MedicalRecord -> PatientFormRequest (the source of the record for auditing)
    medical_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("medical_records.id", ondelete="SET NULL", name="fk_patient_form_requests_medical_record", use_alter=True), 
        nullable=True
    )
    
    sent_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    clinic = relationship("Clinic", foreign_keys=[clinic_id])
    patient = relationship("Patient", foreign_keys=[patient_id])
    template = relationship("MedicalRecordTemplate", foreign_keys=[template_id])
    appointment = relationship("Appointment", foreign_keys=[appointment_id])
    setting = relationship("PatientFormSetting", foreign_keys=[patient_form_setting_id])
    medical_record = relationship("MedicalRecord", foreign_keys=[medical_record_id])

    __table_args__ = (
        CheckConstraint(f"request_source IN ('{PATIENT_FORM_SOURCE_AUTO}', '{PATIENT_FORM_SOURCE_MANUAL}')", name='check_request_source'),
        CheckConstraint(f"status IN ('{PATIENT_FORM_STATUS_PENDING}', '{PATIENT_FORM_STATUS_SUBMITTED}', '{PATIENT_FORM_STATUS_SKIPPED}')", name='check_status'),
    )
