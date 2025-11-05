"""make refresh token user_id nullable

Revision ID: 20251104204901
Revises: 08495bc8486f
Create Date: 2025-11-04 20:49:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20251104204901'
down_revision: Union[str, None] = '08495bc8486f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make user_id nullable in refresh_tokens table to support system admins
    # System admins don't have User records, so user_id must be nullable
    # Check if column is already nullable (idempotent migration)
    from sqlalchemy import inspect
    from sqlalchemy.engine import Connection
    
    conn: Connection = op.get_bind()
    inspector = inspect(conn)
    columns = inspector.get_columns('refresh_tokens')
    user_id_col = next((col for col in columns if col['name'] == 'user_id'), None)
    
    if user_id_col and not user_id_col['nullable']:
        # Column exists and is NOT NULL, so make it nullable
        op.alter_column('refresh_tokens', 'user_id',
                        existing_type=sa.Integer(),
                        nullable=True)
    # If column is already nullable, no action needed


def downgrade() -> None:
    # Make user_id non-nullable again (requires removing any NULL values first)
    # Note: This will fail if there are any NULL user_id values in the table
    op.alter_column('refresh_tokens', 'user_id',
                    existing_type=sa.Integer(),
                    nullable=False)

