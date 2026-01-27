"""
Billing scenario model representing pricing options for practitioner-service combinations.

Billing scenarios allow clinics to define multiple pricing options (e.g., regular price,
discounts, member prices) for each practitioner-service combination. Each scenario
includes the amount charged to the patient and the revenue share for the clinic.
"""

from datetime import datetime
from typing import Optional
from decimal import Decimal

from sqlalchemy import String, ForeignKey, TIMESTAMP, Boolean, Numeric, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class BillingScenario(Base):
    """
    Billing scenario entity representing a pricing option for a practitioner-service combination.

    Each practitioner-service combination can have multiple billing scenarios (e.g., "原價",
    "九折", "會員價"). Each scenario defines:
    - Amount charged to patient (shown on receipt)
    - Revenue share to clinic (internal only)
    - Whether it's the default scenario for this combination
    """

    __tablename__ = "billing_scenarios"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the billing scenario."""

    practitioner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    """Reference to the practitioner (user) this scenario applies to."""

    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"))
    """Reference to the appointment type (service item) this scenario applies to."""

    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))
    """Reference to the clinic this scenario belongs to."""

    name: Mapped[str] = mapped_column(String(255))
    """Scenario name (e.g., "原價", "九折", "會員價")."""

    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    """Amount charged to patient (shown on receipt)."""

    revenue_share: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    """Revenue share to clinic (internal only, must be <= amount)."""

    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    """Whether this is the default scenario for this practitioner-service combination."""

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    """Soft delete flag. True if this billing scenario has been deleted."""

    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    """Timestamp when the billing scenario was soft deleted (if applicable)."""

    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the billing scenario was created."""

    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    """Timestamp when the billing scenario was last updated."""

    # Relationships
    practitioner = relationship("User")
    """Relationship to the User entity (practitioner)."""

    appointment_type = relationship("AppointmentType")
    """Relationship to the AppointmentType entity."""

    clinic = relationship("Clinic")
    """Relationship to the Clinic entity."""

    __table_args__ = (
        # Unique constraint: name must be unique per practitioner-service combination (excluding deleted)
        # Note: Partial unique index is created in migration, not here
        # Indexes for performance
        Index('idx_billing_scenarios_practitioner_appointment_clinic', 'practitioner_id', 'appointment_type_id', 'clinic_id'),
        Index('idx_billing_scenarios_deleted', 'is_deleted'),
        # Check constraints (enforced at database level)
        CheckConstraint('revenue_share <= amount', name='chk_revenue_share_le_amount'),
        CheckConstraint('amount >= 0', name='chk_amount_non_negative'),
        CheckConstraint('revenue_share >= 0', name='chk_revenue_share_non_negative'),
    )


