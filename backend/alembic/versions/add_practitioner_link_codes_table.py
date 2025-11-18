"""add_practitioner_link_codes_table

Revision ID: add_practitioner_link_codes
Revises: add_line_user_id_users
Create Date: 2025-01-20 10:00:00.000000

Add practitioner_link_codes table for webhook-based LINE account linking.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_practitioner_link_codes'
down_revision: Union[str, None] = 'add_line_user_id_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create practitioner_link_codes table.
    
    This table stores temporary linking codes that practitioners can send
    to the clinic's LINE Official Account to link their LINE accounts.
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'practitioner_link_codes' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'practitioner_link_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('used_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for efficient lookups
    op.create_index(
        'idx_practitioner_link_codes_code',
        'practitioner_link_codes',
        ['code']
    )
    op.create_index(
        'idx_practitioner_link_codes_user_id',
        'practitioner_link_codes',
        ['user_id']
    )
    op.create_index(
        'idx_practitioner_link_codes_active',
        'practitioner_link_codes',
        ['code', 'expires_at', 'used_at']
    )


def downgrade() -> None:
    """Drop practitioner_link_codes table."""
    op.drop_index('idx_practitioner_link_codes_active', table_name='practitioner_link_codes')
    op.drop_index('idx_practitioner_link_codes_user_id', table_name='practitioner_link_codes')
    op.drop_index('idx_practitioner_link_codes_code', table_name='practitioner_link_codes')
    op.drop_table('practitioner_link_codes')

