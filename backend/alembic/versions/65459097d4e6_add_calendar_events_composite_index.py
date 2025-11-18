"""add_calendar_events_composite_index

Revision ID: 65459097d4e6
Revises: add_practitioner_link_codes
Create Date: 2025-11-18 10:08:25.413099

Add composite index for calendar_events to optimize common query patterns.
This index covers queries filtering by user_id, clinic_id, and date together,
which is the most common pattern in calendar data retrieval.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '65459097d4e6'
down_revision: Union[str, None] = 'add_practitioner_link_codes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add composite index for calendar_events table.
    
    Index: idx_calendar_events_user_clinic_date
    Columns: (user_id, clinic_id, date)
    
    This index optimizes the most common query pattern:
    - Filtering by user_id, clinic_id, and date together
    - Used in daily calendar view and batch calendar queries
    - PostgreSQL can use left-prefix for queries filtering by (user_id) or (user_id, clinic_id)
    """
    # Check if index already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    indexes = [idx['name'] for idx in inspector.get_indexes('calendar_events')]
    
    if 'idx_calendar_events_user_clinic_date' in indexes:
        return  # Index already exists, skip migration
    
    op.create_index(
        'idx_calendar_events_user_clinic_date',
        'calendar_events',
        ['user_id', 'clinic_id', 'date'],
        unique=False
    )


def downgrade() -> None:
    """Remove composite index from calendar_events table."""
    op.drop_index('idx_calendar_events_user_clinic_date', table_name='calendar_events')
