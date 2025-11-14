"""remove_unused_indexes_from_line_messages

Revision ID: d26badef0731
Revises: f8a58e99b655
Create Date: 2025-11-14 08:30:18.936079

Remove unused indexes from line_messages table.

The following indexes are not used by any queries:
- idx_line_messages_clinic_user_created: No queries filter by (clinic_id, line_user_id, created_at) together
- idx_line_messages_quoted: No queries filter by quoted_message_id

Individual columns already have indexes where needed, so these composite indexes
are redundant and add unnecessary overhead.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd26badef0731'
down_revision: Union[str, None] = '162e4c22f57d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Drop unused indexes from line_messages table.
    """
    # Check if indexes exist before dropping (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    indexes = [idx['name'] for idx in inspector.get_indexes('line_messages')]
    
    if 'idx_line_messages_clinic_user_created' in indexes:
        op.drop_index('idx_line_messages_clinic_user_created', table_name='line_messages')
    
    if 'idx_line_messages_quoted' in indexes:
        op.drop_index('idx_line_messages_quoted', table_name='line_messages')


def downgrade() -> None:
    """
    Restore unused indexes to line_messages table.
    """
    op.create_index(
        'idx_line_messages_clinic_user_created',
        'line_messages',
        ['clinic_id', 'line_user_id', 'created_at']
    )
    op.create_index(
        'idx_line_messages_quoted',
        'line_messages',
        ['quoted_message_id']
    )
