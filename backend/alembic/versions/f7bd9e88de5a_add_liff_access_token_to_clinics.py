"""add_liff_access_token_to_clinics

Revision ID: f7bd9e88de5a
Revises: add_pref_lang_line_users
Create Date: 2025-11-20 21:33:52.739513

Add liff_access_token field to clinics table for secure clinic identification in LIFF URLs.
This replaces the insecure clinic_id parameter with a cryptographically secure token.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f7bd9e88de5a'
down_revision: Union[str, None] = 'add_pref_lang_line_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add liff_access_token column to clinics table.
    
    Tokens will be generated on-demand when clinics are accessed via LIFF login
    with clinic_id (backward compatibility mode). This avoids blocking migration
    with token generation for existing clinics.
    
    Note: The column may already exist if created by the baseline migration
    (Base.metadata.create_all), so we use raw SQL with error handling.
    
    Steps:
    1. Add column (nullable) - using raw SQL with exception handling
    2. Create unique index - using IF NOT EXISTS
    """
    # Step 1: Add column using raw SQL with exception handling
    # This avoids issues with op.add_column() exception handling
    op.execute(sa.text("""
        DO $$
        BEGIN
            ALTER TABLE clinics ADD COLUMN liff_access_token VARCHAR(255);
        EXCEPTION WHEN duplicate_column THEN
            -- Column already exists, which is fine (created by baseline migration)
            NULL;
        END $$;
    """))
    
    # Step 2: Create unique index using IF NOT EXISTS (PostgreSQL 9.5+)
    # This is the safest and fastest approach
    op.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_liff_access_token 
        ON clinics(liff_access_token);
    """))
    
    # Note: We do NOT generate tokens for existing clinics here to avoid:
    # 1. Blocking migration with long-running operations
    # 2. Transaction lock issues in test environments
    # 3. Deadlocks during concurrent test runs
    # 
    # Tokens will be auto-generated on-demand when:
    # - Clinic is accessed via LIFF login with clinic_id (backward compatibility)
    # - Admin regenerates token via API endpoint


def downgrade() -> None:
    """
    Remove liff_access_token column from clinics table.
    """
    # Drop index
    op.drop_index('idx_clinics_liff_access_token', table_name='clinics')
    
    # Drop column
    op.drop_column('clinics', 'liff_access_token')
