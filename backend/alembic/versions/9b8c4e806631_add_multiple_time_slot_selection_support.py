"""add_multiple_time_slot_selection_support

Revision ID: 9b8c4e806631
Revises: 9c7c88416b76
Create Date: 2026-01-15 09:58:25.925785

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b8c4e806631'
down_revision: Union[str, None] = '9c7c88416b76'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if columns already exist (idempotent migration)
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # Add allow_multiple_time_slot_selection to appointment_types table
    appointment_types_columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    if 'allow_multiple_time_slot_selection' not in appointment_types_columns:
        op.add_column('appointment_types', sa.Column('allow_multiple_time_slot_selection', sa.Boolean(), nullable=False, server_default='false'))

    # Add multiple time slot selection fields to appointments table
    appointments_columns = [col['name'] for col in inspector.get_columns('appointments')]
    if 'pending_time_confirmation' not in appointments_columns:
        op.add_column('appointments', sa.Column('pending_time_confirmation', sa.Boolean(), nullable=False, server_default='false'))
    if 'alternative_time_slots' not in appointments_columns:
        op.add_column('appointments', sa.Column('alternative_time_slots', sa.JSON(), nullable=True))
    if 'confirmed_by_user_id' not in appointments_columns:
        op.add_column('appointments', sa.Column('confirmed_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True))
    if 'confirmed_at' not in appointments_columns:
        op.add_column('appointments', sa.Column('confirmed_at', sa.TIMESTAMP(timezone=True), nullable=True))


def downgrade() -> None:
    # Check if columns exist before dropping (idempotent migration)
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # Remove columns in reverse order
    appointments_columns = [col['name'] for col in inspector.get_columns('appointments')]
    appointment_types_columns = [col['name'] for col in inspector.get_columns('appointment_types')]

    if 'confirmed_at' in appointments_columns:
        op.drop_column('appointments', 'confirmed_at')
    if 'confirmed_by_user_id' in appointments_columns:
        op.drop_column('appointments', 'confirmed_by_user_id')
    if 'alternative_time_slots' in appointments_columns:
        op.drop_column('appointments', 'alternative_time_slots')
    if 'pending_time_confirmation' in appointments_columns:
        op.drop_column('appointments', 'pending_time_confirmation')
    if 'allow_multiple_time_slot_selection' in appointment_types_columns:
        op.drop_column('appointment_types', 'allow_multiple_time_slot_selection')
