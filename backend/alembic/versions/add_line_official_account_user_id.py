"""add_line_official_account_user_id

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2025-11-07 12:00:00.000000

Add line_official_account_user_id field to clinics table.

This field stores the LINE Official Account user ID (bot user ID) that appears
in the 'destination' field of LINE webhook payloads. This is different from
line_channel_id, which is the channel ID from LINE Developer Console.

The field is nullable initially to support existing clinics that don't have
this value yet. A migration script will populate it for existing clinics.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add line_official_account_user_id column to clinics table.
    
    This column stores the LINE Official Account user ID (bot user ID) that
    appears in webhook payloads. It's nullable initially to support existing
    clinics that don't have this value yet.
    """
    # Add column
    op.add_column(
        'clinics',
        sa.Column(
            'line_official_account_user_id',
            sa.String(255),
            nullable=True
        )
    )
    
    # Add index for performance
    op.create_index(
        'idx_clinics_line_official_account_user_id',
        'clinics',
        ['line_official_account_user_id']
    )


def downgrade() -> None:
    """
    Remove line_official_account_user_id column from clinics table.
    """
    # Drop index
    op.drop_index('idx_clinics_line_official_account_user_id', table_name='clinics')
    
    # Drop column
    op.drop_column('clinics', 'line_official_account_user_id')

