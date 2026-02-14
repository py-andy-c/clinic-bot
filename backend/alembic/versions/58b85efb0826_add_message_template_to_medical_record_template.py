"""add message_template to medical_record_template

Revision ID: 58b85efb0826
Revises: 925771af4920
Create Date: 2026-02-14 10:32:18.365873

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '58b85efb0826'
down_revision: Union[str, None] = '925771af4920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('medical_record_templates')]
    if 'message_template' not in columns:
        op.add_column('medical_record_templates', sa.Column('message_template', sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('medical_record_templates')]
    if 'message_template' in columns:
        op.drop_column('medical_record_templates', 'message_template')
