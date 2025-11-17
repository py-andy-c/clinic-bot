"""add_settings_to_user_clinic_associations

Revision ID: add_settings_uca
Revises: a399815a9e4c
Create Date: 2025-11-16 00:00:00.000000

Add settings JSONB column to user_clinic_associations table.
This enables per-practitioner, per-clinic settings like compact schedule preferences.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'add_settings_uca'
down_revision: Union[str, None] = 'a399815a9e4c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add settings JSONB column to user_clinic_associations table.
    
    This column stores practitioner-specific settings per clinic, such as:
    - compact_schedule_enabled: Whether to recommend compact schedule slots
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('user_clinic_associations')]
    
    if 'settings' not in columns:
        op.add_column(
            'user_clinic_associations',
            sa.Column(
                'settings',
                JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
                comment='JSONB column containing practitioner settings per clinic'
            )
        )


def downgrade() -> None:
    """
    Remove settings column from user_clinic_associations table.
    """
    op.drop_column('user_clinic_associations', 'settings')

