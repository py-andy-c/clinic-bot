"""remove_updated_at_from_line_messages

Revision ID: 162e4c22f57d
Revises: e10bb81b94e7
Create Date: 2025-11-14 08:21:17.781535

Remove updated_at column from line_messages table.

LineMessage records are immutable - they are created once and never updated.
The updated_at field is not used anywhere in the codebase and adds unnecessary
overhead. Cleanup operations use created_at, not updated_at.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '162e4c22f57d'
down_revision: Union[str, None] = 'e10bb81b94e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Drop updated_at column from line_messages table.
    
    LineMessage records are immutable, so updated_at is not needed.
    """
    # Check if column exists before dropping (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('line_messages')]
    
    if 'updated_at' in columns:
        op.drop_column('line_messages', 'updated_at')


def downgrade() -> None:
    """
    Restore updated_at column to line_messages table.
    """
    op.add_column(
        'line_messages',
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now())
    )
