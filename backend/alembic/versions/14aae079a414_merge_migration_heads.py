"""merge_migration_heads

Revision ID: 14aae079a414
Revises: 11946888e740, add_practitioner_availability
Create Date: 2025-10-27 22:36:58.208261

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '14aae079a414'
down_revision: Union[str, None] = ('11946888e740', 'add_practitioner_availability')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
