"""remove_full_name_from_users_table

Revision ID: 66e9bc4e32da
Revises: e5f6a7b8c9d0
Create Date: 2025-11-12 11:22:20.390573

Remove full_name column from users table.

The full_name field is no longer needed because:
1. System admins: Use email as name (not displayed)
2. Clinic users: Use UserClinicAssociation.full_name (clinic-specific names)

This simplifies the data model and ensures clinic-specific names are always used.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '66e9bc4e32da'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove full_name column from users table.
    
    This column is no longer needed because:
    - System admins: Use email as name (not displayed)
    - Clinic users: Use UserClinicAssociation.full_name (clinic-specific)
    """
    # Check if full_name column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'full_name' in users_columns:
        # Drop the column
        op.drop_column('users', 'full_name')
        print("Dropped full_name column from users table")
    else:
        print("full_name column does not exist in users table, skipping")


def downgrade() -> None:
    """
    Restore full_name column to users table.
    
    Adds back the column. For existing users, we'll use email as a fallback.
    """
    # Check if full_name column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'full_name' not in users_columns:
        # Add the column back with email as default
        op.add_column('users', 
            sa.Column('full_name', sa.String(255), nullable=False, server_default=sa.text("email"))
        )
        # Update existing rows to use email as full_name
        op.execute("""
            UPDATE users 
            SET full_name = email 
            WHERE full_name IS NULL OR full_name = ''
        """)
        print("Restored full_name column to users table with email as default")
    else:
        print("full_name column already exists in users table, skipping")
