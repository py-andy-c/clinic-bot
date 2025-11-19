"""add_calendar_event_and_appointment_indexes

Revision ID: e1e721261de1
Revises: 65459097d4e6
Create Date: 2025-11-18 16:46:14.571760

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1e721261de1'
down_revision: Union[str, None] = '65459097d4e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if indexes already exist (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    
    calendar_indexes = [idx['name'] for idx in inspector.get_indexes('calendar_events')]
    appointment_indexes = [idx['name'] for idx in inspector.get_indexes('appointments')]
    
    # Add composite index for clinic calendar queries (used in batch calendar endpoints)
    if 'idx_calendar_events_clinic_date_type' not in calendar_indexes:
        op.create_index(
            'idx_calendar_events_clinic_date_type',
            'calendar_events',
            ['clinic_id', 'date', 'event_type'],
            unique=False
        )
    
    # Add composite index for batch calendar queries by practitioner
    if 'idx_calendar_events_clinic_user_date' not in calendar_indexes:
        op.create_index(
            'idx_calendar_events_clinic_user_date',
            'calendar_events',
            ['clinic_id', 'user_id', 'date'],
            unique=False
        )
    
    # Add index for reminder service queries (status + reminder_sent_at)
    if 'idx_appointments_status_reminder' not in appointment_indexes:
        op.create_index(
            'idx_appointments_status_reminder',
            'appointments',
            ['status', 'reminder_sent_at'],
            unique=False
        )


def downgrade() -> None:
    op.drop_index('idx_appointments_status_reminder', table_name='appointments')
    op.drop_index('idx_calendar_events_clinic_user_date', table_name='calendar_events')
    op.drop_index('idx_calendar_events_clinic_date_type', table_name='calendar_events')
