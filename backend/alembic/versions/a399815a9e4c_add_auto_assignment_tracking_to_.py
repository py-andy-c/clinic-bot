"""add_auto_assignment_tracking_to_appointments

Revision ID: a399815a9e4c
Revises: d27dfa438bad
Create Date: 2025-11-15 18:50:33.706662

Add auto-assignment tracking fields to appointments table.
This enables tracking of system-assigned appointments and reassignment history.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a399815a9e4c'
down_revision: Union[str, None] = 'd27dfa438bad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add auto-assignment tracking fields to appointments table.
    
    Fields added:
    - is_auto_assigned: Current state (True = shows "不指定" to patient)
    - originally_auto_assigned: Historical flag (never changes once set)
    - reassigned_by_user_id: Tracks who reassigned the appointment
    - reassigned_at: Timestamp when reassigned
    """
    # Check if columns already exist (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('appointments')]
    
    # Add is_auto_assigned column
    if 'is_auto_assigned' not in columns:
        op.add_column(
            'appointments',
            sa.Column(
                'is_auto_assigned',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('false'),
                comment='Current auto-assignment state. True = shows "不指定" to patient, False = manually assigned'
            )
        )
    
    # Add originally_auto_assigned column
    if 'originally_auto_assigned' not in columns:
        op.add_column(
            'appointments',
            sa.Column(
                'originally_auto_assigned',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('false'),
                comment='Historical flag indicating if appointment was originally auto-assigned. Never changes once set.'
            )
        )
    
    # Add reassigned_by_user_id column
    if 'reassigned_by_user_id' not in columns:
        op.add_column(
            'appointments',
            sa.Column(
                'reassigned_by_user_id',
                sa.Integer(),
                nullable=True,
                comment='Tracks which user reassigned this appointment from auto-assigned state'
            )
        )
        # Add foreign key constraint
        op.create_foreign_key(
            'fk_appointments_reassigned_by_user',
            'appointments',
            'users',
            ['reassigned_by_user_id'],
            ['id'],
            ondelete='SET NULL'
        )
    
    # Add reassigned_at column
    if 'reassigned_at' not in columns:
        op.add_column(
            'appointments',
            sa.Column(
                'reassigned_at',
                sa.TIMESTAMP(timezone=True),
                nullable=True,
                comment='Timestamp when appointment was reassigned from auto-assigned state'
            )
        )
    
    # Check if indexes already exist
    indexes = [idx['name'] for idx in inspector.get_indexes('appointments')]
    
    # Add indexes for querying auto-assigned appointments
    if 'idx_appointments_is_auto_assigned' not in indexes:
        op.create_index(
            'idx_appointments_is_auto_assigned',
            'appointments',
            ['is_auto_assigned']
        )
    
    if 'idx_appointments_originally_auto_assigned' not in indexes:
        op.create_index(
            'idx_appointments_originally_auto_assigned',
            'appointments',
            ['originally_auto_assigned']
        )


def downgrade() -> None:
    """
    Remove auto-assignment tracking fields from appointments table.
    """
    # Drop indexes first
    op.drop_index('idx_appointments_originally_auto_assigned', table_name='appointments')
    op.drop_index('idx_appointments_is_auto_assigned', table_name='appointments')
    
    # Drop foreign key constraint
    op.drop_constraint('fk_appointments_reassigned_by_user', 'appointments', type_='foreignkey')
    
    # Drop columns
    op.drop_column('appointments', 'reassigned_at')
    op.drop_column('appointments', 'reassigned_by_user_id')
    op.drop_column('appointments', 'originally_auto_assigned')
    op.drop_column('appointments', 'is_auto_assigned')
