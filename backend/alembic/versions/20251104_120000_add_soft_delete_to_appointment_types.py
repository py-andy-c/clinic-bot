"""add soft delete to appointment types

Revision ID: 20251104120000
Revises: 61cdb3d6fde6
Create Date: 2025-11-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20251104120000'
down_revision: Union[str, None] = '61cdb3d6fde6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add soft delete columns to appointment_types table
    op.add_column('appointment_types', sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('appointment_types', sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True))


def downgrade() -> None:
    # Remove soft delete columns from appointment_types table
    op.drop_column('appointment_types', 'deleted_at')
    op.drop_column('appointment_types', 'is_deleted')
