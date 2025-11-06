"""add_postgresql_constraints

Revision ID: 2e8a774cc355
Revises: 018d83953428
Create Date: 2025-11-05 17:41:17.471268

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2e8a774cc355'
down_revision: Union[str, None] = '018d83953428'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add PostgreSQL-specific constraints and indexes for data integrity and performance.
    
    Adds check constraints for enum-like fields to ensure data integrity
    at the database level. This prevents invalid status values from being
    inserted and provides better error messages.
    
    Also adds indexes for foreign keys that don't have them to optimize
    JOIN operations and foreign key constraint checks.
    
    Constraints added:
    1. clinics.subscription_status: Must be one of ('trial', 'active', 'past_due', 'canceled')
    2. appointments.status: Must be one of ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')
    
    Indexes added:
    1. appointment_types.clinic_id: Index for foreign key lookups
    2. appointments.appointment_type_id: Index for foreign key lookups
    
    Note: idx_users_clinic_id already exists from auth_schema_migration.
    """
    # Step 1: Add check constraint for clinic subscription_status
    op.create_check_constraint(
        'check_clinic_subscription_status',
        'clinics',
        "subscription_status IN ('trial', 'active', 'past_due', 'canceled')"
    )
    
    # Step 2: Add check constraint for appointment status
    op.create_check_constraint(
        'check_appointment_status',
        'appointments',
        "status IN ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')"
    )
    
    # Step 3: Add index for appointment_types.clinic_id foreign key
    op.create_index(
        'idx_appointment_types_clinic_id',
        'appointment_types',
        ['clinic_id']
    )
    
    # Step 4: Add index for appointments.appointment_type_id foreign key
    op.create_index(
        'idx_appointments_appointment_type_id',
        'appointments',
        ['appointment_type_id']
    )


def downgrade() -> None:
    """Remove PostgreSQL-specific constraints and indexes."""
    # Step 1: Drop indexes for foreign keys
    op.drop_index('idx_appointments_appointment_type_id', table_name='appointments')
    op.drop_index('idx_appointment_types_clinic_id', table_name='appointment_types')
    # Note: idx_users_clinic_id is not dropped here as it's from a previous migration
    
    # Step 2: Drop check constraint for appointment status
    op.drop_constraint('check_appointment_status', 'appointments', type_='check')
    
    # Step 3: Drop check constraint for clinic subscription_status
    op.drop_constraint('check_clinic_subscription_status', 'clinics', type_='check')
