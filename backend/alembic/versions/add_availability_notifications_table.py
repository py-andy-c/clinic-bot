"""add_availability_notifications_table

Revision ID: a1b2c3d4e5f7
Revises: add_settings_uca
Create Date: 2025-01-16 12:00:00.000000

Add availability_notifications table for LINE users to sign up for availability alerts.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'add_settings_uca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create availability_notifications table.
    
    This table stores LINE user preferences for availability notifications,
    including appointment types, practitioners, and time windows to watch.
    """
    # Check if table already exists (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    if 'availability_notifications' in inspector.get_table_names():
        return  # Table already exists, skip migration
    
    op.create_table(
        'availability_notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('appointment_type_id', sa.Integer(), nullable=False),
        sa.Column('practitioner_id', sa.Integer(), nullable=True),
        sa.Column('time_windows', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_notified_date', sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(['line_user_id'], ['line_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['practitioner_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create index for GET/POST endpoints: filter by line_user_id + clinic_id + is_active
    op.create_index(
        'idx_line_user_clinic_active',
        'availability_notifications',
        ['line_user_id', 'clinic_id', 'is_active']
    )


def downgrade() -> None:
    """Drop availability_notifications table."""
    op.drop_index('idx_line_user_clinic_active', table_name='availability_notifications')
    op.drop_table('availability_notifications')

