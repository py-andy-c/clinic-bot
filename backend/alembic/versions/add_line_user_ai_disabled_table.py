"""add_line_user_ai_disabled_table

Revision ID: a1b2c3d4e5f6
Revises: f7bd9e88de5a
Create Date: 2025-11-20 22:00:00.000000

Add line_user_ai_disabled table to track when clinic admins permanently disable AI replies.

This table enables per-clinic permanent disable tracking for LINE users. Unlike the
temporary opt-out system (LineUserAiOptOut), this setting is admin-controlled and
persists until manually changed. This allows clinics to disable AI for specific
users after their first visit, for example.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '4d8177af9cf1'
down_revision: Union[str, None] = 'f7bd9e88de5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create line_user_ai_disabled table for tracking permanent AI disable status.
    
    This table tracks per-clinic permanent disable status for LINE users. This is
    different from the temporary opt-out system (LineUserAiOptOut) which is
    user-initiated and expires after 24 hours. This setting is admin-controlled
    and persists until manually changed.
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'line_user_ai_disabled' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'line_user_ai_disabled',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('disabled_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('disabled_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.String(500), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_user_clinic_ai_disabled')
    )
    
    # Create indexes for efficient queries
    op.create_index(
        'idx_line_user_ai_disabled_user_clinic',
        'line_user_ai_disabled',
        ['line_user_id', 'clinic_id']
    )
    
    op.create_index(
        'idx_line_user_ai_disabled_at',
        'line_user_ai_disabled',
        ['disabled_at']
    )
    
    op.create_index(
        'idx_line_user_ai_disabled_by_user',
        'line_user_ai_disabled',
        ['disabled_by_user_id']
    )


def downgrade() -> None:
    """
    Drop line_user_ai_disabled table.
    """
    # Drop indexes first
    op.drop_index('idx_line_user_ai_disabled_by_user', table_name='line_user_ai_disabled')
    op.drop_index('idx_line_user_ai_disabled_at', table_name='line_user_ai_disabled')
    op.drop_index('idx_line_user_ai_disabled_user_clinic', table_name='line_user_ai_disabled')
    
    # Drop table
    op.drop_table('line_user_ai_disabled')

