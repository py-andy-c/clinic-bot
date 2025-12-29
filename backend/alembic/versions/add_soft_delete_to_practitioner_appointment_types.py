"""add_soft_delete_to_practitioner_appointment_types

Revision ID: add_pat_soft_delete
Revises: add_follow_up_messages
Create Date: 2025-12-29 15:00:00.000000

Add soft-delete support to practitioner_appointment_types:
- Add is_deleted and deleted_at columns
- Drop existing unique constraint and create partial unique index
- Create index on is_deleted for query performance
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_pat_soft_delete'
down_revision: Union[str, None] = 'add_follow_up_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add soft-delete support to practitioner_appointment_types.
    
    This migration:
    1. Adds is_deleted and deleted_at columns
    2. Sets is_deleted = false and deleted_at = NULL for all existing records
    3. Creates index on is_deleted for query performance
    4. Drops existing unique constraint uq_practitioner_type_clinic
    5. Creates partial unique index on (user_id, clinic_id, appointment_type_id) where is_deleted = false
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Step 1: Add soft-delete fields to practitioner_appointment_types
    columns = [col['name'] for col in inspector.get_columns('practitioner_appointment_types')]
    
    if 'is_deleted' not in columns:
        op.add_column(
            'practitioner_appointment_types',
            sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false')
        )
    
    if 'deleted_at' not in columns:
        op.add_column(
            'practitioner_appointment_types',
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True)
        )
    
    # Set is_deleted = false and deleted_at = NULL for all existing records
    # Note: is_deleted has server_default='false', but we ensure deleted_at is NULL
    op.execute(
        sa.text("""
            UPDATE practitioner_appointment_types 
            SET is_deleted = false, deleted_at = NULL 
            WHERE deleted_at IS NOT NULL
        """)
    )
    
    # Create index for soft-delete filtering
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_appointment_types')]
    if 'idx_practitioner_appointment_types_deleted' not in indexes:
        op.create_index(
            'idx_practitioner_appointment_types_deleted',
            'practitioner_appointment_types',
            ['is_deleted']
        )
    
    # Step 2: Drop existing unique constraint and create partial unique index
    # Check if the unique constraint exists
    constraints = inspector.get_unique_constraints('practitioner_appointment_types')
    unique_constraint_name = None
    for constraint in constraints:
        if set(constraint['column_names']) == {'user_id', 'clinic_id', 'appointment_type_id'}:
            unique_constraint_name = constraint['name']
            break
    
    # Also check indexes (the constraint might be implemented as a unique index)
    for idx in indexes:
        if idx == 'uq_practitioner_type_clinic':
            unique_constraint_name = idx
            break
    
    if unique_constraint_name:
        # Drop the existing unique constraint/index
        try:
            op.drop_constraint(unique_constraint_name, 'practitioner_appointment_types', type_='unique')
        except Exception:
            # If it's an index, drop it as an index
            op.drop_index(unique_constraint_name, table_name='practitioner_appointment_types')
    
    # Create partial unique index
    if 'idx_pat_unique_active' not in indexes:
        op.execute(sa.text("""
            CREATE UNIQUE INDEX idx_pat_unique_active 
            ON practitioner_appointment_types (user_id, clinic_id, appointment_type_id) 
            WHERE is_deleted = false
        """))


def downgrade() -> None:
    """
    Revert soft-delete support and restore original unique constraint.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Step 1: Drop partial unique index
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_appointment_types')]
    if 'idx_pat_unique_active' in indexes:
        op.drop_index('idx_pat_unique_active', table_name='practitioner_appointment_types')
    
    # Step 2: Recreate original unique constraint
    op.create_index(
        'uq_practitioner_type_clinic',
        'practitioner_appointment_types',
        ['user_id', 'clinic_id', 'appointment_type_id'],
        unique=True
    )
    
    # Step 3: Remove soft-delete fields
    columns = [col['name'] for col in inspector.get_columns('practitioner_appointment_types')]
    
    if 'idx_practitioner_appointment_types_deleted' in indexes:
        op.drop_index('idx_practitioner_appointment_types_deleted', table_name='practitioner_appointment_types')
    
    if 'deleted_at' in columns:
        op.drop_column('practitioner_appointment_types', 'deleted_at')
    
    if 'is_deleted' in columns:
        op.drop_column('practitioner_appointment_types', 'is_deleted')

