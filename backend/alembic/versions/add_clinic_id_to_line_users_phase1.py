"""add_clinic_id_to_line_users_phase1

Revision ID: add_clinic_id_line_users_phase1
Revises: 4d8177af9cf1
Create Date: 2025-01-XX XX:XX:XX.XXXXXX

Phase 1: Add clinic_id (nullable) and AI settings fields to line_users table.
This is the first phase of migrating to per-clinic LineUser entries.

This migration:
1. Adds clinic_id column (nullable initially for zero-downtime migration)
2. Removes unique constraint on line_user_id (will add composite unique constraint later)
3. Adds AI settings fields directly to line_users table
4. Creates index on (clinic_id, line_user_id) for efficient queries

After data migration, Phase 2 will make clinic_id NOT NULL and add unique constraint.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'add_clinic_id_phase1'
down_revision: Union[str, None] = '4d8177af9cf1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Phase 1: Add clinic_id (nullable) and AI settings fields to line_users.
    
    This allows gradual migration - existing code continues to work while
    we migrate data and update code to use clinic_id.
    """
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('line_users')]
    
    # Add clinic_id column (nullable initially)
    if 'clinic_id' not in columns:
        op.add_column(
            'line_users',
            sa.Column(
                'clinic_id',
                sa.Integer(),
                nullable=True,  # Nullable for zero-downtime migration
            )
        )
        # Add foreign key constraint separately
        op.create_foreign_key(
            'fk_line_users_clinic_id',
            'line_users',
            'clinics',
            ['clinic_id'],
            ['id'],
            ondelete='CASCADE'
        )
        
        # Create index for efficient queries (even with nullable clinic_id)
        op.create_index(
            'idx_line_users_clinic_line_user',
            'line_users',
            ['clinic_id', 'line_user_id']
        )
    
    # Remove unique constraint on line_user_id alone
    # (We'll add composite unique constraint in Phase 3)
    # Check if unique constraint exists
    constraints = inspector.get_unique_constraints('line_users')
    for constraint in constraints:
        if 'line_user_id' in constraint['column_names'] and len(constraint['column_names']) == 1:
            op.drop_constraint(constraint['name'], 'line_users', type_='unique')
            break
    
    # Add AI settings fields
    if 'ai_disabled' not in columns:
        op.add_column(
            'line_users',
            sa.Column('ai_disabled', sa.Boolean(), nullable=False, server_default='false')
        )
    
    if 'ai_disabled_at' not in columns:
        op.add_column(
            'line_users',
            sa.Column('ai_disabled_at', sa.TIMESTAMP(timezone=True), nullable=True)
        )
    
    if 'ai_disabled_by_user_id' not in columns:
        op.add_column(
            'line_users',
            sa.Column(
                'ai_disabled_by_user_id',
                sa.Integer(),
                nullable=True
            )
        )
        # Add foreign key constraint separately
        op.create_foreign_key(
            'fk_line_users_ai_disabled_by_user_id',
            'line_users',
            'users',
            ['ai_disabled_by_user_id'],
            ['id'],
            ondelete='SET NULL'
        )
    
    if 'ai_disabled_reason' not in columns:
        op.add_column(
            'line_users',
            sa.Column('ai_disabled_reason', sa.String(500), nullable=True)
        )
    
    if 'ai_opt_out_until' not in columns:
        op.add_column(
            'line_users',
            sa.Column('ai_opt_out_until', sa.TIMESTAMP(timezone=True), nullable=True)
        )


def downgrade() -> None:
    """
    Remove clinic_id and AI settings fields from line_users table.
    Restore unique constraint on line_user_id.
    """
    # Drop foreign key constraints first
    op.drop_constraint('fk_line_users_ai_disabled_by_user_id', 'line_users', type_='foreignkey')
    op.drop_constraint('fk_line_users_clinic_id', 'line_users', type_='foreignkey')
    
    # Drop new columns
    op.drop_column('line_users', 'ai_opt_out_until')
    op.drop_column('line_users', 'ai_disabled_reason')
    op.drop_column('line_users', 'ai_disabled_by_user_id')
    op.drop_column('line_users', 'ai_disabled_at')
    op.drop_column('line_users', 'ai_disabled')
    
    # Drop index
    op.drop_index('idx_line_users_clinic_line_user', table_name='line_users')
    
    # Drop clinic_id column
    op.drop_column('line_users', 'clinic_id')
    
    # Restore unique constraint on line_user_id
    op.create_unique_constraint('uq_line_users_line_user_id', 'line_users', ['line_user_id'])

