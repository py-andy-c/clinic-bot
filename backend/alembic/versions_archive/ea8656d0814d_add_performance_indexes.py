"""add_performance_indexes

Revision ID: ea8656d0814d
Revises: 2e8a774cc355
Create Date: 2025-11-05 18:34:21.785447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ea8656d0814d'
down_revision: Union[str, None] = '2e8a774cc355'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add composite indexes for common query patterns to improve performance.
    
    Adds composite indexes for frequently used query patterns:
    1. Soft delete queries: clinic_id + is_deleted (for patients and appointment_types)
    2. Active user queries: clinic_id + is_active (for users)
    
    These indexes optimize queries that filter by multiple columns together,
    which is common in soft delete and active status filtering patterns.
    
    Indexes added:
    1. patients(clinic_id, is_deleted): For clinic + soft delete queries
    2. appointment_types(clinic_id, is_deleted): For clinic + soft delete queries
    3. users(clinic_id, is_active): For clinic + active user queries
    """
    # Step 1: Add composite index for patients soft delete queries
    # Common pattern: WHERE clinic_id = ? AND is_deleted = false
    op.create_index(
        'idx_patients_clinic_deleted',
        'patients',
        ['clinic_id', 'is_deleted']
    )
    
    # Step 2: Add composite index for appointment_types soft delete queries
    # Common pattern: WHERE clinic_id = ? AND is_deleted = false
    op.create_index(
        'idx_appointment_types_clinic_deleted',
        'appointment_types',
        ['clinic_id', 'is_deleted']
    )
    
    # Step 3: Add composite index for users active status queries
    # Common pattern: WHERE clinic_id = ? AND is_active = true
    # Note: This index can also be used for clinic_id-only queries (left-prefix rule),
    # but we keep idx_users_clinic_id (from auth_schema_migration) for optimal
    # performance on clinic_id-only queries (admin view of all users).
    op.create_index(
        'idx_users_clinic_active',
        'users',
        ['clinic_id', 'is_active']
    )


def downgrade() -> None:
    """Remove performance indexes."""
    # Step 1: Drop composite indexes
    op.drop_index('idx_users_clinic_active', table_name='users')
    op.drop_index('idx_appointment_types_clinic_deleted', table_name='appointment_types')
    op.drop_index('idx_patients_clinic_deleted', table_name='patients')
