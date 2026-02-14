"""
Appointment type patient form configuration model.

This model stores the automation settings for sending patient forms (medical records)
before or after appointments based on appointment type.
"""

from datetime import datetime, time
from typing import Optional
from sqlalchemy import String, ForeignKey, TIMESTAMP, Integer, Time, CheckConstraint, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from core.database import Base


class AppointmentTypePatientFormConfig(Base):
    """
    Patient form automation configuration entity.
    
    Stores the configuration for automated patient form sending that are sent
    to patients before or after their appointments. Each appointment type can have
    multiple patient form configurations with different timing configurations.
    """

    __tablename__ = "appointment_type_patient_form_configs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the patient form configuration."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id", ondelete="CASCADE"), nullable=False, index=True)
    """Reference to the appointment type this patient form configuration belongs to."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    """Reference to the clinic that owns this patient form configuration."""

    medical_record_template_id: Mapped[int] = mapped_column(ForeignKey("medical_record_templates.id", ondelete="CASCADE"), nullable=False)
    """Reference to the medical record template (patient form) to send."""

    timing_type: Mapped[str] = mapped_column(String(20), nullable=False)
    """Timing type: 'before' or 'after' the appointment."""

    timing_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    """Timing mode: 'hours' or 'specific_time'."""

    hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """For hours mode: X hours before start / after end (x >= 0)."""

    days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """For specific_time mode: Y days before / after date (y >= 0)."""

    time_of_day: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    """For specific_time mode: specific time (e.g., 09:00)."""

    on_impossible: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    """For 'before' timing: 'send_immediately' or 'skip' when timing is impossible. NULL for 'after' timing."""

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default='true')
    """Whether this patient form automation is enabled."""

    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    """Display order for sorting multiple patient form configurations."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    """Timestamp when the patient form configuration was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    """Timestamp when the patient form configuration was last updated."""

    # Relationships
    appointment_type = relationship("AppointmentType", back_populates="patient_form_configs")
    """Relationship to the AppointmentType entity."""

    clinic = relationship("Clinic")
    """Relationship to the Clinic entity."""

    medical_record_template = relationship("MedicalRecordTemplate")
    """Relationship to the MedicalRecordTemplate entity."""

    # Table constraints
    __table_args__ = (
        CheckConstraint("timing_type IN ('before', 'after')", name='check_timing_type'),
        CheckConstraint("timing_mode IN ('hours', 'specific_time')", name='check_timing_mode'),
        CheckConstraint('hours >= 0', name='check_hours_non_negative'),
        CheckConstraint('days >= 0', name='check_days_non_negative'),
        CheckConstraint(
            "(timing_mode = 'hours' AND hours IS NOT NULL) OR "
            "(timing_mode = 'specific_time' AND days IS NOT NULL AND time_of_day IS NOT NULL)",
            name='check_timing_mode_consistency'
        ),
        CheckConstraint(
            "(timing_type = 'before' AND on_impossible IN ('send_immediately', 'skip')) OR "
            "(timing_type = 'after' AND on_impossible IS NULL)",
            name='check_on_impossible_consistency'
        ),
        UniqueConstraint('appointment_type_id', 'display_order', name='unique_appointment_type_patient_form_order'),
    )
