"""add_clinic_display_name_to_line_users

Revision ID: add_clinic_display_name
Revises: ('b1f551863153', '162e4c22f57d')
Create Date: 2025-12-04 08:00:00.000000

Add clinic_display_name column to line_users table.
This allows clinics to overwrite the display name for internal use.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_clinic_display_name'
down_revision: Union[str, None] = ('b1f551863153', '162e4c22f57d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add clinic_display_name column to line_users table.
    
    This column stores the clinic-overwritten display name (clinic internal only).
    If set, this name will be shown everywhere instead of the original display_name.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('line_users')]
    
    if 'clinic_display_name' not in columns:
        op.add_column(
            'line_users',
            sa.Column(
                'clinic_display_name',
                sa.String(255),
                nullable=True
            )
        )


def downgrade() -> None:
    """
    Remove clinic_display_name column from line_users table.
    """
    op.drop_column('line_users', 'clinic_display_name')

