"""add_line_user_ai_opt_out_table

Revision ID: b8c9d0e1f2a3
Revises: f7e8d9c0b1a2
Create Date: 2025-01-28 10:00:00.000000

Add line_user_ai_opt_outs table to track when LINE users temporarily disable AI replies.

This table enables per-clinic opt-out tracking for LINE users who want to
temporarily disable AI responses. Opt-out expires after the specified duration
(typically 24 hours).

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'f7e8d9c0b1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create line_user_ai_opt_outs table for tracking AI opt-out status.
    
    This table tracks per-clinic opt-out status for LINE users. When a user
    sends "人工回覆", they are opted out for 24 hours. During this period,
    messages are received but not processed by the AI agent.
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'line_user_ai_opt_outs' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'line_user_ai_opt_outs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('opted_out_until', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_user_clinic_opt_out')
    )
    
    # Create indexes for efficient queries
    op.create_index(
        'idx_line_user_ai_opt_out_user_clinic',
        'line_user_ai_opt_outs',
        ['line_user_id', 'clinic_id']
    )
    
    op.create_index(
        'idx_line_user_ai_opt_out_expiry',
        'line_user_ai_opt_outs',
        ['opted_out_until']
    )


def downgrade() -> None:
    """
    Drop line_user_ai_opt_outs table.
    """
    # Drop indexes first
    op.drop_index('idx_line_user_ai_opt_out_expiry', table_name='line_user_ai_opt_outs')
    op.drop_index('idx_line_user_ai_opt_out_user_clinic', table_name='line_user_ai_opt_outs')
    
    # Drop table
    op.drop_table('line_user_ai_opt_outs')

