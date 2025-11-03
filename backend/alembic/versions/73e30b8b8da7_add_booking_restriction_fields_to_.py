"""add_booking_restriction_fields_to_clinics

Revision ID: 73e30b8b8da7
Revises: e19c901bffd3
Create Date: 2025-11-03 13:46:22.771059

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '73e30b8b8da7'
down_revision: Union[str, None] = 'e19c901bffd3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add booking restriction fields to clinics table
    op.add_column('clinics', sa.Column('booking_restriction_type', sa.String(length=50), nullable=False, server_default='same_day_disallowed'))
    op.add_column('clinics', sa.Column('minimum_booking_hours_ahead', sa.Integer(), nullable=False, server_default='24'))


def downgrade() -> None:
    # Remove booking restriction fields from clinics table
    op.drop_column('clinics', 'minimum_booking_hours_ahead')
    op.drop_column('clinics', 'booking_restriction_type')
