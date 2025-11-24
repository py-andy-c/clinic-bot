"""merge_token_generation_and_deprecated_tables

Revision ID: b2f4e9438264
Revises: drop_deprecated_tables_phase4, generate_liff_tokens_existing
Create Date: 2025-11-23 16:35:34.138403

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2f4e9438264'
down_revision: Union[str, None] = ('drop_deprecated_tables_phase4', 'generate_liff_tokens_existing')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
