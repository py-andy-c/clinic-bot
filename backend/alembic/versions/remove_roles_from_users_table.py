"""remove_roles_from_users_table

Revision ID: f7e8d9c0b1a2
Revises: 66e9bc4e32da
Create Date: 2025-11-13 04:00:00.000000

Remove roles column from users table.

The roles field is no longer needed because:
1. Roles are now stored in user_clinic_associations.roles (clinic-specific)
2. The migration fe49cf078f8b already migrated all data from users.roles to user_clinic_associations.roles

This completes the migration to multi-clinic user support by removing the old roles column.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7e8d9c0b1a2'
down_revision: Union[str, None] = '66e9bc4e32da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove roles column from users table.
    
    This column is no longer needed because:
    - Roles are now stored in user_clinic_associations.roles (clinic-specific)
    - The migration fe49cf078f8b already migrated all data
    """
    # Check if roles column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'roles' in users_columns:
        # Check if there's a GIN index on roles that needs to be dropped first
        indexes = [idx['name'] for idx in inspector.get_indexes('users')]
        if 'idx_users_roles_gin' in indexes:
            op.drop_index('idx_users_roles_gin', table_name='users')
        
        # Drop the column
        op.drop_column('users', 'roles')
        print("Dropped roles column from users table")
    else:
        print("roles column does not exist in users table, skipping")


def downgrade() -> None:
    """
    Restore roles column to users table.
    
    Adds back the column with default empty array. Note that this won't restore
    the original data that was migrated to user_clinic_associations.
    """
    # Check if roles column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'roles' not in users_columns:
        # Add the column back with default empty array
        from sqlalchemy.dialects import postgresql
        op.add_column('users', 
            sa.Column('roles', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb"))
        )
        
        # Recreate GIN index for roles
        op.create_index(
            'idx_users_roles_gin',
            'users',
            ['roles'],
            postgresql_using='gin'
        )
        print("Restored roles column to users table with default empty array")
    else:
        print("roles column already exists in users table, skipping")
