"""add_availability_notifications_table

Revision ID: 4df1ea3c02d0
Revises: f7e8d9c0b1a2
Create Date: 2025-11-16 20:00:00.000000

Add availability_notifications table for waitlist functionality.

This table stores user requests to be notified when appointment slots become
available in specific time windows for specific dates.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '4df1ea3c02d0'
down_revision: Union[str, None] = 'add_settings_uca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create availability_notifications table.
    
    This table stores user requests to be notified when appointment slots
    become available in specific time windows (morning, afternoon, evening)
    for specific dates.
    """
    # Check if table already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'availability_notifications' in tables:
        print("availability_notifications table already exists, skipping creation")
        return
    
    op.create_table(
        'availability_notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('patient_id', sa.Integer(), nullable=False),
        sa.Column('appointment_type_id', sa.Integer(), nullable=False),
        sa.Column('practitioner_id', sa.Integer(), nullable=True),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('time_windows', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='active'),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('expires_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('last_notified_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ),
        sa.ForeignKeyConstraint(['line_user_id'], ['line_users.id'], ),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
        sa.ForeignKeyConstraint(['practitioner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "status IN ('active', 'fulfilled', 'expired', 'cancelled')",
            name='check_notification_status'
        )
    )
    
    # Create indexes
    op.create_index(
        'idx_notification_lookup',
        'availability_notifications',
        ['clinic_id', 'appointment_type_id', 'date', 'status']
    )
    
    op.create_index(
        'idx_notification_user',
        'availability_notifications',
        ['line_user_id', 'status']
    )
    
    op.create_index(
        'idx_notification_date',
        'availability_notifications',
        ['date', 'status']
    )
    
    op.create_index(op.f('ix_availability_notifications_id'), 'availability_notifications', ['id'], unique=False)


def downgrade() -> None:
    """
    Drop availability_notifications table.
    """
    # Check if table exists before dropping
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'availability_notifications' not in tables:
        print("availability_notifications table does not exist, skipping drop")
        return
    
    op.drop_index(op.f('ix_availability_notifications_id'), table_name='availability_notifications')
    op.drop_index('idx_notification_date', table_name='availability_notifications')
    op.drop_index('idx_notification_user', table_name='availability_notifications')
    op.drop_index('idx_notification_lookup', table_name='availability_notifications')
    op.drop_table('availability_notifications')

