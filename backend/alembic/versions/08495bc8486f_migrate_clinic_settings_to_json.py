"""migrate_clinic_settings_to_json

Revision ID: 08495bc8486f
Revises: 20251104140000
Create Date: 2025-11-04 11:56:57.941913

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '08495bc8486f'
down_revision: Union[str, None] = '20251104140000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add settings JSON column with default empty object
    op.add_column('clinics', sa.Column('settings', sa.JSON(), nullable=False, server_default='{}'))

    # Remove old setting columns
    op.drop_column('clinics', 'reminder_hours_before')
    op.drop_column('clinics', 'booking_restriction_type')
    op.drop_column('clinics', 'minimum_booking_hours_ahead')
    op.drop_column('clinics', 'display_name')
    op.drop_column('clinics', 'address')
    op.drop_column('clinics', 'phone_number')


def downgrade() -> None:
    # Add back old setting columns
    op.add_column('clinics', sa.Column('reminder_hours_before', sa.Integer(), nullable=False, server_default='24'))
    op.add_column('clinics', sa.Column('booking_restriction_type', sa.String(length=50), nullable=False, server_default='same_day_disallowed'))
    op.add_column('clinics', sa.Column('minimum_booking_hours_ahead', sa.Integer(), nullable=False, server_default='24'))
    op.add_column('clinics', sa.Column('display_name', sa.String(length=255), nullable=True))
    op.add_column('clinics', sa.Column('address', sa.String(length=255), nullable=True))
    op.add_column('clinics', sa.Column('phone_number', sa.String(length=255), nullable=True))

    # Remove settings JSON column
    op.drop_column('clinics', 'settings')
