"""add_line_messages_table

Revision ID: e10bb81b94e7
Revises: b8c9d0e1f2a3
Create Date: 2025-01-28 12:00:00.000000

Add line_messages table to store LINE message metadata and content.

This table enables retrieval of quoted messages. LINE's API only allows
retrieving media content (images, videos, etc.) but not text messages,
so we need to store text messages ourselves to support quoted message functionality.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e10bb81b94e7'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create line_messages table for storing LINE message metadata.
    
    This table stores LINE message IDs and text content to enable retrieval
    of quoted messages. Only text messages are stored (media messages are not supported).
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'line_messages' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'line_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_message_id', sa.String(255), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('message_text', sa.String(5000), nullable=True),
        sa.Column('message_type', sa.String(50), nullable=False, server_default='text'),
        sa.Column('is_from_user', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('quoted_message_id', sa.String(255), nullable=True),
        sa.Column('session_id', sa.String(255), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('line_message_id', name='uq_line_message_id')
    )
    
    # Create indexes for efficient queries
    op.create_index(
        'idx_line_messages_message_id',
        'line_messages',
        ['line_message_id']
    )
    
    op.create_index(
        'idx_line_messages_user_id',
        'line_messages',
        ['line_user_id']
    )
    
    op.create_index(
        'idx_line_messages_clinic_id',
        'line_messages',
        ['clinic_id']
    )
    
    op.create_index(
        'idx_line_messages_session_id',
        'line_messages',
        ['session_id']
    )
    
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
    
    op.create_index(
        'idx_line_messages_created_at',
        'line_messages',
        ['created_at']
    )


def downgrade() -> None:
    """
    Drop line_messages table.
    """
    # Drop indexes first
    op.drop_index('idx_line_messages_created_at', table_name='line_messages')
    op.drop_index('idx_line_messages_quoted', table_name='line_messages')
    op.drop_index('idx_line_messages_clinic_user_created', table_name='line_messages')
    op.drop_index('idx_line_messages_session_id', table_name='line_messages')
    op.drop_index('idx_line_messages_clinic_id', table_name='line_messages')
    op.drop_index('idx_line_messages_user_id', table_name='line_messages')
    op.drop_index('idx_line_messages_message_id', table_name='line_messages')
    
    # Drop table
    op.drop_table('line_messages')

