"""remove_is_active_from_users_table

Revision ID: e5f6a7b8c9d0
Revises: fe49cf078f8b
Create Date: 2025-01-27 20:30:00.000000

Remove is_active column from users table.

The is_active field is no longer needed because:
1. System admins: Access is controlled by SYSTEM_ADMIN_EMAILS whitelist
2. Clinic users: Access is controlled by UserClinicAssociation.is_active (clinic-specific)

This simplifies the data model and removes redundant checks.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'fe49cf078f8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove is_active column from users table.
    
    This column is no longer needed because:
    - System admins: Access controlled by email whitelist
    - Clinic users: Access controlled by UserClinicAssociation.is_active
    """
    # Check if is_active column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'is_active' in users_columns:
        # Drop the column
        op.drop_column('users', 'is_active')
        print("Dropped is_active column from users table")
    else:
        print("is_active column does not exist in users table, skipping")


def downgrade() -> None:
    """
    Restore is_active column to users table.
    
    Adds back the column with default value True for all existing users.
    """
    # Check if is_active column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'is_active' not in users_columns:
        # Add the column back with default True
        op.add_column('users', 
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true')
        )
        print("Restored is_active column to users table with default True")
    else:
        print("is_active column already exists in users table, skipping")

