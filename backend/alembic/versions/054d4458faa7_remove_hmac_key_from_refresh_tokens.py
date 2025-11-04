"""remove_hmac_key_from_refresh_tokens

Revision ID: 054d4458faa7
Revises: 73e30b8b8da7
Create Date: 2025-11-03 19:56:32.728910

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '054d4458faa7'
down_revision: Union[str, None] = '73e30b8b8da7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite doesn't support dropping columns with indexes
    # We need to recreate the table without the hmac_key column
    with op.batch_alter_table('refresh_tokens') as batch_op:
        # Drop the index first
        batch_op.drop_index('idx_refresh_tokens_hmac_key')
        # Drop the column
        batch_op.drop_column('hmac_key')


def downgrade() -> None:
    # Add back the hmac_key column
    op.add_column('refresh_tokens', sa.Column('hmac_key', sa.String(length=64), nullable=True))
    # Add back the index
    op.create_index('idx_refresh_tokens_hmac_key', 'refresh_tokens', ['hmac_key'], unique=False)
