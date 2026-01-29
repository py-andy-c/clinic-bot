"""add version to medical_records

Revision ID: 0fa4fea4113d
Revises: 05378856698e
Create Date: 2026-01-29 13:38:44.938593

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0fa4fea4113d'
down_revision: Union[str, None] = '05378856698e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use inspector to check if column already exists
    # This prevents errors during tests where Base.metadata.create_all() might have already created it
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('medical_records')]
    
    if 'version' not in columns:
        op.add_column('medical_records', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('medical_records')]
    
    if 'version' in columns:
        op.drop_column('medical_records', 'version')
