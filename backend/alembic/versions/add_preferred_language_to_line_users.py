"""add_preferred_language_to_line_users

Revision ID: add_preferred_language_line_users
Revises: e1e721261de1
Create Date: 2025-01-XX XX:XX:XX.XXXXXX

Add preferred_language column to line_users table.
This enables storing user's language preference for UI and LINE messages.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_pref_lang_line_users'
down_revision: Union[str, None] = 'e1e721261de1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add preferred_language column to line_users table.
    
    This column stores the user's preferred language for UI and LINE messages.
    Values: 'zh-TW' (Traditional Chinese), 'en' (English), 'ja' (Japanese)
    Default: 'zh-TW' for existing rows
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('line_users')]
    
    if 'preferred_language' not in columns:
        op.add_column(
            'line_users',
            sa.Column(
                'preferred_language',
                sa.String(10),
                nullable=True,
                server_default='zh-TW'  # Database-level default for existing rows
            )
        )
        
        # Explicitly set default for any existing null values (safety)
        op.execute("""
            UPDATE line_users 
            SET preferred_language = 'zh-TW' 
            WHERE preferred_language IS NULL
        """)


def downgrade() -> None:
    """
    Remove preferred_language column from line_users table.
    """
    op.drop_column('line_users', 'preferred_language')

