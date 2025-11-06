"""add_appointment_status_indexes

Revision ID: 7930a84b50b1
Revises: 08b75d419cd0
Create Date: 2025-11-02 15:41:06.336520

This migration adds database indexes to optimize queries filtering by Appointment.status.
These indexes improve performance for:
- list_appointments_for_clinic filtering by status
- load balancing query in _assign_practitioner (filtering by status == 'confirmed')
- reminder service queries filtering by status == 'confirmed'
- availability service queries joining with confirmed appointments

Indexes added:
- idx_appointments_status: Single column index on status for general status filtering
- idx_appointments_status_calendar_event: Composite index for JOIN efficiency when
  filtering by status and joining with CalendarEvent

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7930a84b50b1'
down_revision: Union[str, None] = '08b75d419cd0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add indexes to appointments table for status filtering optimization."""
    # Index for general status filtering
    op.create_index('idx_appointments_status', 'appointments', ['status'])
    
    # Composite index for JOIN efficiency (status + calendar_event_id)
    # This helps queries that filter by status and join with CalendarEvent
    op.create_index(
        'idx_appointments_status_calendar_event',
        'appointments',
        ['status', 'calendar_event_id']
    )


def downgrade() -> None:
    """Remove status-related indexes from appointments table."""
    op.drop_index('idx_appointments_status_calendar_event', table_name='appointments')
    op.drop_index('idx_appointments_status', table_name='appointments')
