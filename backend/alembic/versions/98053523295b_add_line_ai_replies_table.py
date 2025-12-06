"""add_line_ai_replies_table

Revision ID: 98053523295b
Revises: add_line_push_messages
Create Date: 2025-12-05 16:51:58.266237

Add line_ai_replies table to track LINE AI reply messages (free messages) for dashboard metrics.

This table persists indefinitely (unlike LineMessage which is cleaned up after 10 days)
to maintain accurate historical dashboard statistics.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '98053523295b'
down_revision: Union[str, None] = 'add_line_push_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create line_ai_replies table for tracking LINE AI reply messages.
    
    This table tracks free AI reply messages sent through the platform to enable
    dashboard statistics. Unlike LineMessage which is cleaned up after 10 days,
    this table persists indefinitely to maintain historical data.
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'line_ai_replies' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'line_ai_replies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('line_message_id', sa.String(255), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for efficient queries
    op.create_index(
        'idx_line_ai_replies_line_user_id',
        'line_ai_replies',
        ['line_user_id']
    )
    
    op.create_index(
        'idx_line_ai_replies_clinic_id',
        'line_ai_replies',
        ['clinic_id']
    )
    
    op.create_index(
        'idx_line_ai_replies_line_message_id',
        'line_ai_replies',
        ['line_message_id']
    )
    
    op.create_index(
        'idx_line_ai_replies_created_at',
        'line_ai_replies',
        ['created_at']
    )
    
    # Composite index for efficient dashboard queries
    op.create_index(
        'idx_ai_replies_clinic_created',
        'line_ai_replies',
        ['clinic_id', 'created_at']
    )


def downgrade() -> None:
    """
    Drop line_ai_replies table.
    """
    # Drop indexes first
    op.drop_index('idx_ai_replies_clinic_created', table_name='line_ai_replies')
    op.drop_index('idx_line_ai_replies_created_at', table_name='line_ai_replies')
    op.drop_index('idx_line_ai_replies_line_message_id', table_name='line_ai_replies')
    op.drop_index('idx_line_ai_replies_clinic_id', table_name='line_ai_replies')
    op.drop_index('idx_line_ai_replies_line_user_id', table_name='line_ai_replies')
    
    # Drop table
    op.drop_table('line_ai_replies')
