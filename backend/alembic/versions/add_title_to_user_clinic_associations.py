"""add_title_to_user_clinic_associations

Revision ID: add_title_uca
Revises: add_practitioner_selection
Create Date: 2025-01-16 00:00:00.000000

Add title field to user_clinic_associations table.
This field stores the practitioner's title/honorific (e.g., "治療師") used in external displays.
All existing records are migrated to have title = '治療師'.
New records default to empty string (via model default, not server_default).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'add_title_uca'
down_revision: Union[str, None] = 'add_practitioner_selection'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add title column to user_clinic_associations table.
    
    This migration:
    1. Adds title column with default empty string
    2. Migrates all existing records to have title = '治療師'
    3. Sets default to empty string for new records
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('user_clinic_associations')]
    
    if 'title' not in columns:
        # Add column with default empty string
        op.add_column(
            'user_clinic_associations',
            sa.Column(
                'title',
                sa.String(50),
                nullable=False,
                server_default='',
                comment='Title/honorific (e.g., "治療師") - used in external displays'
            )
        )
        
        # Migrate all existing records to have title = '治療師'
        # Note: All existing records will have title = '' at this point (from server_default),
        # so the WHERE clause is technically redundant but makes the intent clear.
        op.execute(text("""
            UPDATE user_clinic_associations
            SET title = '治療師'
            WHERE title = ''
        """))
        
        # Note on defaults:
        # - server_default='' is needed for the column creation
        # - After migration, existing records have title = '治療師'
        # - New records will use the model default (empty string) from Python code,
        #   not the server_default, since we explicitly set title in application code


def downgrade() -> None:
    """
    Remove title column from user_clinic_associations table.
    """
    op.drop_column('user_clinic_associations', 'title')

