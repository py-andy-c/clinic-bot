"""add_picture_url_to_line_users

Revision ID: add_picture_url_line_users
Revises: add_clinic_display_name
Create Date: 2025-01-16 08:30:00.000000

Add picture_url column to line_users table.
This stores the LINE user's profile picture URL for display in the UI.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_picture_url_line_users'
down_revision: Union[str, None] = 'add_clinic_display_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add picture_url column to line_users table.
    
    This column stores the LINE user's profile picture URL from LINE API.
    The URL is fetched when creating new users or when missing for existing users.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('line_users')]
    
    if 'picture_url' not in columns:
        op.add_column(
            'line_users',
            sa.Column(
                'picture_url',
                sa.String(500),  # URLs can be long
                nullable=True
            )
        )


def downgrade() -> None:
    """
    Remove picture_url column from line_users table.
    """
    op.drop_column('line_users', 'picture_url')

