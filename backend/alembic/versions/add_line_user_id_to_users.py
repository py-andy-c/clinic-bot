"""add_line_user_id_to_users

Revision ID: add_line_user_id_users
Revises: a1b2c3d4e5f7
Create Date: 2025-01-20 10:00:00.000000

Add line_user_id field to users table for practitioner LINE account linking.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_line_user_id_users'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add line_user_id column to users table.
    
    This allows practitioners to link their LINE accounts to receive
    appointment notifications via LINE messaging.
    """
    # Check if column already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'line_user_id' in columns:
        return  # Column already exists, skip migration
    
    op.add_column(
        'users',
        sa.Column('line_user_id', sa.String(255), nullable=True)
    )


def downgrade() -> None:
    """Remove line_user_id column from users table."""
    op.drop_column('users', 'line_user_id')

