"""make_line_users_clinic_id_not_null_phase3

Revision ID: make_line_users_clinic_id_not_null_phase3
Revises: migrate_line_users_per_clinic_phase2
Create Date: 2025-01-XX XX:XX:XX.XXXXXX

Phase 3: Final migration to enforce clinic_id NOT NULL and add unique constraint.

This migration:
1. Ensures all LineUser entries have clinic_id set (should be done by Phase 2)
2. Makes clinic_id NOT NULL
3. Adds unique constraint on (line_user_id, clinic_id)
4. Creates index for efficient queries

After this migration, the per-clinic LineUser architecture is complete.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = 'make_clinic_id_not_null_phase3'
down_revision: Union[str, None] = 'migrate_line_users_phase2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Make clinic_id NOT NULL and add unique constraint.
    
    This assumes Phase 2 migration has completed and all LineUsers have clinic_id set.
    """
    conn = op.get_bind()
    
    # Check if there are any LineUsers without clinic_id
    # This should not happen if Phase 2 migration completed successfully
    check_query = text("SELECT COUNT(*) FROM line_users WHERE clinic_id IS NULL")
    null_count = conn.execute(check_query).scalar()
    
    if null_count > 0:
        raise ValueError(
            f"Cannot proceed: {null_count} LineUser entries still have NULL clinic_id. "
            "Please ensure Phase 2 data migration completed successfully."
        )
    
    # Add unique constraint on (line_user_id, clinic_id)
    # Check if constraint already exists
    inspector = inspect(conn)
    constraints = inspector.get_unique_constraints('line_users')
    constraint_exists = any(
        set(c['column_names']) == {'line_user_id', 'clinic_id'}
        for c in constraints
    )
    
    if not constraint_exists:
        op.create_unique_constraint(
            'uq_line_users_line_user_clinic',
            'line_users',
            ['line_user_id', 'clinic_id']
        )
    
    # Make clinic_id NOT NULL
    # First, ensure the index exists (it should from Phase 1)
    op.alter_column(
        'line_users',
        'clinic_id',
        nullable=False,
        existing_type=sa.Integer(),
        existing_nullable=True
    )


def downgrade() -> None:
    """
    Revert to nullable clinic_id and remove unique constraint.
    
    Note: This will allow NULL clinic_id values, which may cause issues.
    """
    # Remove unique constraint
    op.drop_constraint('uq_line_users_line_user_clinic', 'line_users', type_='unique')
    
    # Make clinic_id nullable again
    op.alter_column(
        'line_users',
        'clinic_id',
        nullable=True,
        existing_type=sa.Integer(),
        existing_nullable=False
    )

