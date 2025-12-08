"""add_custom_event_name_to_calendar_events

Revision ID: add_custom_event_name
Revises: ('e1e721261de1', 'add_liff_id_clinics')
Create Date: 2025-12-07 10:00:00.000000

Add custom_event_name column to calendar_events table.
This allows clinics to customize the event name displayed on the calendar.

This is a merge migration that combines two migration heads.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_custom_event_name'
down_revision: Union[str, None] = ('e1e721261de1', 'add_liff_id_clinics')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add custom_event_name column to calendar_events table.
    
    This column stores a custom event name for calendar display.
    If set, this name will be used instead of the default format.
    For appointments: defaults to "{patient_name} - {appointment_type_name}"
    For availability exceptions: defaults to "休診"
    If null, the default format is used.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('calendar_events')]
    
    if 'custom_event_name' not in columns:
        op.add_column(
            'calendar_events',
            sa.Column(
                'custom_event_name',
                sa.String(100),
                nullable=True,
                comment='Custom event name for calendar display. If set, used instead of default format. NULL means use default format.'
            )
        )


def downgrade() -> None:
    """
    Remove custom_event_name column from calendar_events table.
    """
    op.drop_column('calendar_events', 'custom_event_name')

