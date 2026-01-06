"""merge_heads

Revision ID: 571ddb1af54d
Revises: add_patient_visibility, cleanup_practitioner_daily
Create Date: 2026-01-06 10:43:24.796865

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '571ddb1af54d'
down_revision: Union[str, None] = ('add_patient_visibility', 'cleanup_practitioner_daily')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
