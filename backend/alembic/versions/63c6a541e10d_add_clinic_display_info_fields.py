"""add_clinic_display_info_fields

Revision ID: 63c6a541e10d
Revises: 054d4458faa7
Create Date: 2025-11-03 22:11:43.601283

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '63c6a541e10d'
down_revision: Union[str, None] = '054d4458faa7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add clinic display info fields
    op.add_column('clinics', sa.Column('display_name', sa.String(length=255), nullable=True))
    op.add_column('clinics', sa.Column('address', sa.String(length=255), nullable=True))
    op.add_column('clinics', sa.Column('phone_number', sa.String(length=255), nullable=True))


def downgrade() -> None:
    # Remove clinic display info fields
    op.drop_column('clinics', 'phone_number')
    op.drop_column('clinics', 'address')
    op.drop_column('clinics', 'display_name')
