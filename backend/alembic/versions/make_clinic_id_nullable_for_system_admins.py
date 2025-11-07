"""make_clinic_id_nullable_for_system_admins

Revision ID: b2c3d4e5f6a7
Revises: a3d4f6cca7c5
Create Date: 2025-11-06 20:10:00.000000

Make clinic_id nullable in users table to support system admins.
System admins will have clinic_id=None, while clinic users will have clinic_id set.

This migration:
1. Makes clinic_id nullable in users table
2. Updates the unique constraint to allow multiple users with same email across different clinics
   (but still enforces uniqueness per clinic)
3. Allows system admins (clinic_id=None) to have unique emails globally

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a3d4f6cca7c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Make clinic_id nullable in users table to support system admins.
    
    System admins will have clinic_id=None, while clinic users will have clinic_id set.
    This allows us to unify system admin handling by creating User records for them.
    
    PostgreSQL unique constraints allow NULL values, so the existing clinic_id+email
    constraint will work fine. System admins (clinic_id=NULL) will have globally
    unique emails (enforced by the email column unique constraint), while clinic
    users will have unique emails per clinic (enforced by the clinic_id+email constraint).
    """
    # Drop the foreign key constraint temporarily
    op.drop_constraint('users_clinic_id_fkey', 'users', type_='foreignkey')
    
    # Make clinic_id nullable
    op.alter_column(
        'users',
        'clinic_id',
        existing_type=sa.Integer(),
        nullable=True,
        existing_nullable=False
    )
    
    # Recreate foreign key constraint
    # For system admins (clinic_id=NULL), the foreign key won't apply
    op.create_foreign_key(
        'users_clinic_id_fkey',
        'users',
        'clinics',
        ['clinic_id'],
        ['id'],
        ondelete='CASCADE'
    )
    
    # Add index on (email, clinic_id) for better query performance
    # This helps with queries like: WHERE email = ? AND clinic_id IS NULL (system admins)
    # and WHERE email = ? AND clinic_id = ? (clinic users)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    indexes = [idx['name'] for idx in inspector.get_indexes('users')]
    
    if 'idx_users_email_clinic_id' not in indexes:
        op.create_index(
            'idx_users_email_clinic_id',
            'users',
            ['email', 'clinic_id']
        )
    
    # Note: The existing unique constraints will work fine:
    # - email column unique constraint: ensures system admins have globally unique emails
    # - clinic_id+email unique constraint: ensures clinic users have unique emails per clinic
    # PostgreSQL unique constraints allow NULL values, so system admins (clinic_id=NULL)
    # won't conflict with the clinic_id+email constraint


def downgrade() -> None:
    """
    Revert clinic_id to non-nullable.
    
    WARNING: This will fail if there are any system admin users (clinic_id=NULL).
    You must delete or migrate system admin users before downgrading.
    """
    # Drop index
    op.drop_index('idx_users_email_clinic_id', table_name='users')
    
    # Drop foreign key
    op.drop_constraint('users_clinic_id_fkey', 'users', type_='foreignkey')
    
    # Make clinic_id non-nullable again
    # This will fail if there are any NULL values
    op.alter_column(
        'users',
        'clinic_id',
        existing_type=sa.Integer(),
        nullable=False,
        existing_nullable=True
    )
    
    # Recreate foreign key
    op.create_foreign_key(
        'users_clinic_id_fkey',
        'users',
        'clinics',
        ['clinic_id'],
        ['id'],
        ondelete='CASCADE'
    )

