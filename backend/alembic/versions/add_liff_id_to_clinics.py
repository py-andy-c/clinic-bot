"""add_liff_id_to_clinics

Revision ID: add_liff_id_clinics
Revises: move_line_user_id_uca
Create Date: 2025-01-21 00:00:00.000000

Add liff_id column to clinics table for clinic-specific LIFF app support.
This enables clinics with their own LINE provider to use their own LIFF app.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_liff_id_clinics'
down_revision: Union[str, None] = 'move_line_user_id_uca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add liff_id column to clinics table.
    
    Steps:
    1. Add column (nullable, unique, indexed)
    2. Create partial unique index (WHERE liff_id IS NOT NULL)
    """
    # Step 1: Add column using raw SQL with exception handling
    op.execute(sa.text("""
        DO $$
        BEGIN
            ALTER TABLE clinics ADD COLUMN liff_id VARCHAR(255);
        EXCEPTION WHEN duplicate_column THEN
            -- Column already exists, which is fine
            NULL;
        END $$;
    """))
    
    # Step 2: Create partial unique index (only for non-NULL values)
    # This allows multiple NULL values but ensures uniqueness for non-NULL liff_ids
    op.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_liff_id 
        ON clinics(liff_id) 
        WHERE liff_id IS NOT NULL;
    """))


def downgrade() -> None:
    """
    Remove liff_id column from clinics table.
    """
    # Drop index
    op.execute(sa.text("""
        DROP INDEX IF EXISTS idx_clinics_liff_id;
    """))
    
    # Drop column
    op.execute(sa.text("""
        DO $$
        BEGIN
            ALTER TABLE clinics DROP COLUMN liff_id;
        EXCEPTION WHEN undefined_column THEN
            -- Column doesn't exist, which is fine
            NULL;
        END $$;
    """))

