"""
Receipt model representing immutable receipts for appointments.

Receipts store complete snapshots of billing information at the time of checkout,
ensuring immutability and legal compliance. The receipt_data JSONB column contains
all information as it existed at creation time, while frequently queried fields
are extracted to columns for performance.
"""

from datetime import datetime
from typing import Optional, Dict, Any
from decimal import Decimal

from sqlalchemy import String, ForeignKey, TIMESTAMP, Boolean, Numeric, Index, UniqueConstraint, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class Receipt(Base):
    """
    Receipt entity representing an immutable billing record for an appointment.

    Receipts are never modified after creation (immutability requirement for legal compliance).
    All data is stored as a snapshot in receipt_data JSONB column. Frequently queried fields
    are extracted to columns for performance.

    Key features:
    - Immutable snapshot pattern (receipt_data JSONB)
    - Gapless sequential receipt numbering
    - Voiding support for corrections (maintains audit trail)
    - Only one active (non-voided) receipt per appointment
    """

    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the receipt."""

    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.calendar_event_id", ondelete="RESTRICT")
    )
    """Reference to the appointment this receipt is for."""

    clinic_id: Mapped[int] = mapped_column(
        ForeignKey("clinics.id", ondelete="RESTRICT")
    )
    """Reference to the clinic that issued this receipt."""

    receipt_number: Mapped[str] = mapped_column(String(50))
    """Sequential receipt number (e.g., "2024-00001"). Unique per clinic."""

    issue_date: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    """Receipt issue date (when receipt was created)."""

    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    """Total amount charged to patient."""

    total_revenue_share: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    """Total revenue share (internal only)."""

    receipt_data: Mapped[Dict[str, Any]] = mapped_column(JSONB(astext_type=Text()))
    """
    Complete immutable snapshot of all receipt information.
    
    Contains all data as it existed at creation time:
    - Receipt number, issue date, visit date
    - Clinic information (display name)
    - Patient information (name)
    - Items list with amounts and revenue shares
    - Payment method
    - Custom notes
    - Stamp configuration
    - Void information (if voided)
    """

    is_voided: Mapped[bool] = mapped_column(Boolean, default=False)
    """Whether receipt has been voided."""

    voided_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when receipt was voided (if applicable)."""

    voided_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"),
        nullable=True
    )
    """Reference to the admin user who voided the receipt (if applicable)."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the receipt was created."""

    # Relationships
    appointment = relationship("Appointment", back_populates="receipt")
    """Relationship to the Appointment entity."""

    clinic = relationship("Clinic")
    """Relationship to the Clinic entity."""

    voided_by = relationship("User", foreign_keys=[voided_by_user_id])
    """Relationship to the User who voided the receipt."""

    __table_args__ = (
        # Unique constraint: Receipt numbers unique per clinic
        # Note: Partial unique constraint for active receipts is created in migration, not here
        UniqueConstraint('clinic_id', 'receipt_number', name='uq_receipts_clinic_number'),
        # Indexes for performance
        Index('idx_receipts_receipt_number', 'receipt_number'),
        Index('idx_receipts_issue_date', 'issue_date'),
        Index('idx_receipts_appointment', 'appointment_id'),
        Index('idx_receipts_clinic', 'clinic_id'),
        Index('idx_receipts_voided', 'is_voided'),
        Index('idx_receipts_voided_at', 'voided_at'),
        # GIN index for JSONB queries
        Index(
            'idx_receipts_data_gin',
            'receipt_data',
            postgresql_using='gin'
        ),
    )
