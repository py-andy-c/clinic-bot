"""
Patient form settings model for configuring forms sent to patients.
"""

from datetime import datetime, time
from typing import Optional
from sqlalchemy import String, ForeignKey, TIMESTAMP, Text, Integer, Time, CheckConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class PatientFormSetting(Base):
    """
    Configuration for patient forms sent relative to appointments.
    """

    __tablename__ = "patient_form_settings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id", ondelete="CASCADE"), nullable=False)
    template_id: Mapped[int] = mapped_column(ForeignKey("medical_record_templates.id"), nullable=False)
    
    timing_mode: Mapped[str] = mapped_column(String(20), nullable=False)  # 'immediate', 'hours_after', 'specific_time'
    hours_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    days_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    time_of_day: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    
    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    flex_button_text: Mapped[str] = mapped_column(String(50), server_default='填寫表單', nullable=False)
    
    notify_admin: Mapped[bool] = mapped_column(Boolean, server_default='false', default=False)
    notify_appointment_practitioner: Mapped[bool] = mapped_column(Boolean, server_default='false', default=False)
    notify_assigned_practitioner: Mapped[bool] = mapped_column(Boolean, server_default='false', default=False)
    
    is_enabled: Mapped[bool] = mapped_column(Boolean, server_default='true', default=True)
    display_order: Mapped[int] = mapped_column(Integer, server_default='0', default=0)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    clinic = relationship("Clinic")
    appointment_type = relationship("AppointmentType")
    template = relationship("MedicalRecordTemplate")

    __table_args__ = (
        CheckConstraint("timing_mode IN ('immediate', 'hours_after', 'specific_time')", name='check_timing_mode'),
        CheckConstraint(
            "(timing_mode = 'immediate') OR "
            "(timing_mode = 'hours_after' AND hours_after IS NOT NULL AND hours_after >= 0) OR "
            "(timing_mode = 'specific_time' AND days_after IS NOT NULL AND days_after >= 0 AND time_of_day IS NOT NULL)",
            name='check_timing_mode_consistency'
        ),
    )
