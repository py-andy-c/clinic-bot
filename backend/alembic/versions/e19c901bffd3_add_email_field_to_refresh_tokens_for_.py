"""add_email_field_to_refresh_tokens_for_system_admins

Revision ID: e19c901bffd3
Revises: 7930a84b50b1
Create Date: 2025-11-02 19:27:29.812709

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e19c901bffd3'
down_revision: Union[str, None] = '7930a84b50b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add fields to refresh_tokens table for system admin support
    # These fields are nullable since clinic users have User records
    op.add_column('refresh_tokens', sa.Column('email', sa.String(length=255), nullable=True))
    op.add_column('refresh_tokens', sa.Column('google_subject_id', sa.String(length=255), nullable=True))
    op.add_column('refresh_tokens', sa.Column('name', sa.String(length=255), nullable=True))


def downgrade() -> None:
    # Remove fields from refresh_tokens table
    op.drop_column('refresh_tokens', 'name')
    op.drop_column('refresh_tokens', 'google_subject_id')
    op.drop_column('refresh_tokens', 'email')
