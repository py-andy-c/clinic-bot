"""add_jsonb_gin_indexes

Revision ID: 018d83953428
Revises: 20251104204901
Create Date: 2025-11-05 11:31:25.365660

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '018d83953428'
down_revision: Union[str, None] = '20251104204901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Convert JSON columns to JSONB and add GIN indexes for performance.

    GIN (Generalized Inverted Index) indexes are optimized for JSONB containment
    and existence queries, providing 10-100x performance improvement for JSON operations.

    Steps:
    1. Convert JSON columns to JSONB (required for GIN indexes)
    2. Create GIN indexes on JSONB columns

    These indexes enable fast queries like:
    - SELECT * FROM users WHERE roles @> '["admin"]'
    - SELECT * FROM clinics WHERE settings ? 'notification_enabled'
    - SELECT * FROM signup_tokens WHERE default_roles @> '["practitioner"]'
    """
    # Step 1: Convert users.roles from JSON to JSONB
    # PostgreSQL can cast JSON to JSONB directly
    op.execute("""
        ALTER TABLE users 
        ALTER COLUMN roles TYPE jsonb USING roles::jsonb
    """)
    
    # Step 2: Convert clinics.settings from JSON to JSONB
    op.execute("""
        ALTER TABLE clinics 
        ALTER COLUMN settings TYPE jsonb USING settings::jsonb
    """)
    
    # Step 3: Convert signup_tokens.default_roles from JSON to JSONB
    op.execute("""
        ALTER TABLE signup_tokens 
        ALTER COLUMN default_roles TYPE jsonb USING default_roles::jsonb
    """)
    
    # Step 4: Create GIN index for user roles JSONB field
    op.create_index(
        'idx_users_roles_gin',
        'users',
        ['roles'],
        postgresql_using='gin'
    )

    # Step 5: Create GIN index for clinic settings JSONB field
    op.create_index(
        'idx_clinics_settings_gin',
        'clinics',
        ['settings'],
        postgresql_using='gin'
    )
    
    # Step 6: Create GIN index for signup token default roles JSONB field
    op.create_index(
        'idx_signup_tokens_default_roles_gin',
        'signup_tokens',
        ['default_roles'],
        postgresql_using='gin'
    )


def downgrade() -> None:
    """Remove GIN indexes and convert JSONB back to JSON."""
    # Step 1: Drop GIN indexes
    op.drop_index('idx_users_roles_gin', table_name='users')
    op.drop_index('idx_clinics_settings_gin', table_name='clinics')
    op.drop_index('idx_signup_tokens_default_roles_gin', table_name='signup_tokens')
    
    # Step 2: Convert JSONB back to JSON (if needed for compatibility)
    # Note: JSONB can be cast to JSON, but JSONB is generally preferred
    op.execute("""
        ALTER TABLE users 
        ALTER COLUMN roles TYPE json USING roles::json
    """)
    
    op.execute("""
        ALTER TABLE clinics 
        ALTER COLUMN settings TYPE json USING settings::json
    """)
    
    op.execute("""
        ALTER TABLE signup_tokens 
        ALTER COLUMN default_roles TYPE json USING default_roles::json
    """)
