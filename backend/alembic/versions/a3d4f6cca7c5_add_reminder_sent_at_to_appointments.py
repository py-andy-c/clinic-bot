"""add_reminder_sent_at_to_appointments

Revision ID: a3d4f6cca7c5
Revises: 680334b106f8
Create Date: 2025-01-27 11:01:44.673490

Add reminder_sent_at field to appointments table to track when reminders were sent.
This enables duplicate reminder prevention and supports edge case handling for
setting changes, server downtime recovery, and window boundary issues.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a3d4f6cca7c5'
down_revision: Union[str, None] = '680334b106f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add reminder_sent_at column to appointments table.
    
    This column tracks when a reminder was sent for an appointment, enabling:
    - Duplicate reminder prevention
    - Handling of reminder_hours_before setting changes
    - Server downtime recovery
    - Window boundary edge case handling
    """
    # Check if column already exists (in case it was created by baseline migration)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('appointments')]
    
    # Add reminder_sent_at column (nullable, timezone-aware timestamp)
    if 'reminder_sent_at' not in columns:
        op.add_column(
            'appointments',
            sa.Column(
                'reminder_sent_at',
                sa.TIMESTAMP(timezone=True),
                nullable=True,
                comment='Timestamp when the reminder was sent for this appointment. NULL means reminder has not been sent yet.'
            )
        )
    
    # Check if index already exists
    indexes = [idx['name'] for idx in inspector.get_indexes('appointments')]
    
    # Add index for efficient queries (filtering by reminder_sent_at IS NULL)
    if 'idx_appointments_reminder_sent_at' not in indexes:
        op.create_index(
            'idx_appointments_reminder_sent_at',
            'appointments',
            ['reminder_sent_at'],
            postgresql_where=sa.text('reminder_sent_at IS NULL')  # Partial index for NULL values
        )


def downgrade() -> None:
    """
    Remove reminder_sent_at column from appointments table.
    """
    # Drop index first
    op.drop_index('idx_appointments_reminder_sent_at', table_name='appointments')
    
    # Drop column
    op.drop_column('appointments', 'reminder_sent_at')
