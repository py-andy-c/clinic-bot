"""add_line_push_messages_table

Revision ID: add_line_push_messages
Revises: add_picture_url_line_users
Create Date: 2025-01-15 12:00:00.000000

Add line_push_messages table to track LINE push messages (paid messages) for dashboard metrics.

This table uses a flexible multi-label system to support:
- Current grouping needs (recipient type, event type, trigger source)
- Future regrouping without losing history
- Extensibility for new event types and labels

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_line_push_messages'
down_revision: Union[str, None] = 'add_picture_url_line_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create line_push_messages table for tracking LINE push messages.
    
    This table tracks paid push messages sent through the platform to enable
    dashboard statistics and cost visibility.
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'line_push_messages' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'line_push_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('line_message_id', sa.String(255), nullable=True),
        sa.Column('recipient_type', sa.String(50), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('trigger_source', sa.String(50), nullable=False),
        sa.Column('labels', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for efficient queries
    op.create_index(
        'idx_line_push_messages_line_user_id',
        'line_push_messages',
        ['line_user_id']
    )
    
    op.create_index(
        'idx_line_push_messages_clinic_id',
        'line_push_messages',
        ['clinic_id']
    )
    
    op.create_index(
        'idx_line_push_messages_line_message_id',
        'line_push_messages',
        ['line_message_id']
    )
    
    op.create_index(
        'idx_line_push_messages_recipient_type',
        'line_push_messages',
        ['recipient_type']
    )
    
    op.create_index(
        'idx_line_push_messages_event_type',
        'line_push_messages',
        ['event_type']
    )
    
    op.create_index(
        'idx_line_push_messages_trigger_source',
        'line_push_messages',
        ['trigger_source']
    )
    
    op.create_index(
        'idx_line_push_messages_created_at',
        'line_push_messages',
        ['created_at']
    )
    
    # Composite indexes for efficient dashboard queries
    op.create_index(
        'idx_push_messages_clinic_created',
        'line_push_messages',
        ['clinic_id', 'created_at']
    )
    
    op.create_index(
        'idx_push_messages_labels',
        'line_push_messages',
        ['clinic_id', 'recipient_type', 'event_type', 'trigger_source']
    )


def downgrade() -> None:
    """
    Drop line_push_messages table.
    """
    # Drop indexes first
    op.drop_index('idx_push_messages_labels', table_name='line_push_messages')
    op.drop_index('idx_push_messages_clinic_created', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_created_at', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_trigger_source', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_event_type', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_recipient_type', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_line_message_id', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_clinic_id', table_name='line_push_messages')
    op.drop_index('idx_line_push_messages_line_user_id', table_name='line_push_messages')
    
    # Drop table
    op.drop_table('line_push_messages')

