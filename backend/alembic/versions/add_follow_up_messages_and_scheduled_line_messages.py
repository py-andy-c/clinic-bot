"""add_follow_up_messages_and_scheduled_line_messages

Revision ID: add_follow_up_messages
Revises: remove_deprecated_placeholder
Create Date: 2025-02-01 12:00:00.000000

Add post-appointment follow-up messages feature:
- Create follow_up_messages table (configuration)
- Create scheduled_line_messages table (generalized scheduling)
- Add indexes and constraints
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_follow_up_messages'
down_revision: Union[str, None] = 'remove_deprecated_placeholder'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add follow-up messages and scheduled LINE messages tables.
    
    This migration:
    1. Creates follow_up_messages table (configuration)
    2. Creates scheduled_line_messages table (generalized scheduling)
    3. Adds indexes and constraints
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    # Step 1: Create follow_up_messages table
    if 'follow_up_messages' not in tables:
        op.create_table(
            'follow_up_messages',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('appointment_type_id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('timing_mode', sa.String(20), nullable=False),
            sa.Column('hours_after', sa.Integer(), nullable=True),
            sa.Column('days_after', sa.Integer(), nullable=True),
            sa.Column('time_of_day', sa.Time(), nullable=True),
            sa.Column('message_template', sa.Text(), nullable=False),
            sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.CheckConstraint("timing_mode IN ('hours_after', 'specific_time')", name='check_timing_mode'),
            sa.CheckConstraint('hours_after >= 0', name='check_hours_after_non_negative'),
            sa.CheckConstraint('days_after >= 0', name='check_days_after_non_negative'),
            sa.CheckConstraint(
                "(timing_mode = 'hours_after' AND hours_after IS NOT NULL) OR "
                "(timing_mode = 'specific_time' AND days_after IS NOT NULL AND time_of_day IS NOT NULL)",
                name='check_timing_mode_consistency'
            ),
            sa.UniqueConstraint('appointment_type_id', 'display_order', name='unique_appointment_type_order')
        )
        
        # Create indexes
        op.create_index('idx_follow_up_appointment_type', 'follow_up_messages', ['appointment_type_id'])
        op.create_index('idx_follow_up_clinic', 'follow_up_messages', ['clinic_id'])
        op.create_index('idx_follow_up_enabled', 'follow_up_messages', ['is_enabled'])
    
    # Step 2: Create scheduled_line_messages table
    if 'scheduled_line_messages' not in tables:
        op.create_table(
            'scheduled_line_messages',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('recipient_type', sa.String(20), nullable=False),
            sa.Column('recipient_line_user_id', sa.String(255), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('message_type', sa.String(50), nullable=False),
            sa.Column('message_template', sa.Text(), nullable=False),
            sa.Column('message_context', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column('scheduled_send_time', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.Column('actual_send_time', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
            sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('max_retries', sa.Integer(), nullable=False, server_default='3'),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.CheckConstraint("status IN ('pending', 'sent', 'skipped', 'failed')", name='check_status'),
            sa.CheckConstraint('retry_count >= 0', name='check_retry_count_non_negative'),
            sa.CheckConstraint('max_retries >= 0', name='check_max_retries_non_negative')
        )
        
        # Create indexes
        # Composite index for cron job query pattern (status, scheduled_send_time, clinic_id)
        op.create_index('idx_scheduled_status_time', 'scheduled_line_messages', ['status', 'scheduled_send_time'])
        op.create_index('idx_scheduled_status_time_clinic', 'scheduled_line_messages', ['status', 'scheduled_send_time', 'clinic_id'])
        # Standalone index on scheduled_send_time for time-based queries
        op.create_index('idx_scheduled_send_time', 'scheduled_line_messages', ['scheduled_send_time'])
        # Indexes for recipient and message type lookups
        op.create_index('idx_scheduled_recipient', 'scheduled_line_messages', ['recipient_type', 'recipient_line_user_id'])
        op.create_index('idx_scheduled_message_type', 'scheduled_line_messages', ['message_type'])
        op.create_index('idx_scheduled_clinic', 'scheduled_line_messages', ['clinic_id'])
        # GIN index on message_context for efficient JSONB queries (e.g., filtering by appointment_id)
        op.execute("CREATE INDEX idx_scheduled_message_context ON scheduled_line_messages USING GIN (message_context)")


def downgrade() -> None:
    """Remove follow-up messages and scheduled LINE messages tables."""
    op.drop_index('idx_scheduled_message_context', table_name='scheduled_line_messages')
    op.drop_index('idx_scheduled_clinic', table_name='scheduled_line_messages')
    op.drop_index('idx_scheduled_message_type', table_name='scheduled_line_messages')
    op.drop_index('idx_scheduled_recipient', table_name='scheduled_line_messages')
    op.drop_index('idx_scheduled_send_time', table_name='scheduled_line_messages')
    op.drop_index('idx_scheduled_status_time_clinic', table_name='scheduled_line_messages')
    op.drop_index('idx_scheduled_status_time', table_name='scheduled_line_messages')
    op.drop_table('scheduled_line_messages')
    
    op.drop_index('idx_follow_up_enabled', table_name='follow_up_messages')
    op.drop_index('idx_follow_up_clinic', table_name='follow_up_messages')
    op.drop_index('idx_follow_up_appointment_type', table_name='follow_up_messages')
    op.drop_table('follow_up_messages')

