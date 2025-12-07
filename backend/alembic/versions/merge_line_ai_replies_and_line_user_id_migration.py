"""merge_line_ai_replies_and_line_user_id_migration

Revision ID: merge_heads_before_line_user_id
Revises: ('98053523295b', 'a1b2c3d4e5f7')
Create Date: 2025-01-20 16:00:00.000000

Merge migration to combine two migration heads before moving line_user_id to user_clinic_associations.
This merges:
- 98053523295b (add_line_ai_replies_table)
- a1b2c3d4e5f7 (add_availability_notifications_table)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_heads_before_line_user_id'
down_revision: Union[str, None] = ('98053523295b', 'a1b2c3d4e5f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge migration - no schema changes, just merges the two branches."""
    pass


def downgrade() -> None:
    """Merge migration - no schema changes."""
    pass


