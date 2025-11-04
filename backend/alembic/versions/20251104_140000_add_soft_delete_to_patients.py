"""add soft delete to patients

Revision ID: 20251104140000
Revises: 20251104130000
Create Date: 2025-11-04 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import Boolean


# revision identifiers, used by Alembic.
revision: str = '20251104140000'
down_revision: Union[str, None] = '20251104130000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add soft delete columns to patients table
    # First add as nullable, then set default, then make not null
    op.add_column('patients', sa.Column('is_deleted', sa.Boolean(), nullable=True))
    op.add_column('patients', sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True))

    # Set default value for is_deleted
    op.execute("UPDATE patients SET is_deleted = 0 WHERE is_deleted IS NULL")

    # Make is_deleted NOT NULL
    with op.batch_alter_table('patients') as batch_op:
        batch_op.alter_column('is_deleted', nullable=False, default=False)


def downgrade() -> None:
    # Remove soft delete columns
    op.drop_column('patients', 'deleted_at')
    op.drop_column('patients', 'is_deleted')
