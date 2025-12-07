"""move_line_user_id_to_user_clinic_association

Revision ID: move_line_user_id_uca
Revises: a1b2c3d4e5f7
Create Date: 2025-01-20 15:00:00.000000

Move line_user_id from users table to user_clinic_associations table.
This enables per-clinic LINE enrollment, allowing users to link their LINE
account independently for each clinic they're associated with.

Migration steps:
1. Add line_user_id column to user_clinic_associations
2. Migrate existing data from users.line_user_id to all active associations
3. Validate migration completeness
4. Add unique constraint on (clinic_id, line_user_id)
5. Remove line_user_id column from users table

Note: This migration uses PostgreSQL-specific SQL syntax (FROM clause in UPDATE,
DO $$ blocks). The project requires PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = 'move_line_user_id_uca'
down_revision: Union[str, None] = 'merge_heads_before_line_user_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Move line_user_id from users to user_clinic_associations.
    
    This migration:
    1. Adds line_user_id column to user_clinic_associations
    2. Migrates existing data from users.line_user_id to all active associations
    3. Adds unique constraint on (clinic_id, line_user_id)
    4. Removes line_user_id column from users table
    """
    conn = op.get_bind()
    inspector = inspect(conn)
    
    # Step 1: Add line_user_id column to user_clinic_associations
    uca_columns = [col['name'] for col in inspector.get_columns('user_clinic_associations')]
    if 'line_user_id' not in uca_columns:
        op.add_column(
            'user_clinic_associations',
            sa.Column('line_user_id', sa.String(255), nullable=True)
        )
        print("Added line_user_id column to user_clinic_associations")
    
    # Step 2: Migrate existing data from users.line_user_id to all active associations
    # For each user with line_user_id, copy it to all their active associations
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    if 'line_user_id' in users_columns:
        # Migrate data: copy user.line_user_id to all active associations for that user
        # Note: Uses PostgreSQL-specific FROM clause syntax
        conn.execute(text("""
            UPDATE user_clinic_associations uca
            SET line_user_id = u.line_user_id
            FROM users u
            WHERE uca.user_id = u.id
              AND u.line_user_id IS NOT NULL
              AND uca.is_active = TRUE
              AND uca.line_user_id IS NULL
        """))
        
        # Validate migration: verify all users with line_user_id had it migrated
        # Count distinct users with line_user_id in users table
        user_count_result = conn.execute(text("""
            SELECT COUNT(DISTINCT u.id)
            FROM users u
            WHERE u.line_user_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM user_clinic_associations uca
                  WHERE uca.user_id = u.id
                    AND uca.is_active = TRUE
              )
        """))
        users_with_line_id = user_count_result.scalar()
        
        # Count distinct users with line_user_id in associations
        uca_count_result = conn.execute(text("""
            SELECT COUNT(DISTINCT user_id)
            FROM user_clinic_associations
            WHERE line_user_id IS NOT NULL
        """))
        associations_with_line_id = uca_count_result.scalar()
        
        # Verify migration completeness
        # Note: associations_with_line_id may be >= users_with_line_id if a user has multiple clinics
        # But every user with line_user_id should have at least one association with it
        if users_with_line_id > 0 and associations_with_line_id < users_with_line_id:
            raise Exception(
                f"Migration validation failed: {users_with_line_id} users with line_user_id "
                f"but only {associations_with_line_id} associations migrated. "
                "Some users may have no active associations."
            )
        
        print(f"Migrated line_user_id: {users_with_line_id} users -> {associations_with_line_id} associations")
    
    # Step 3: Add unique constraint on (clinic_id, line_user_id)
    # This prevents the same LINE account from linking to multiple users in the same clinic
    uca_constraints = [uc['name'] for uc in inspector.get_unique_constraints('user_clinic_associations')]
    if 'uq_user_clinic_associations_clinic_line_user' not in uca_constraints:
        # First, check for duplicates before adding unique constraint
        # Note: Uses PostgreSQL-specific DO $$ block syntax
        # (PostgreSQL allows multiple NULLs in unique constraints, but we want to be explicit)
        conn.execute(text("""
            -- Ensure no duplicate non-NULL line_user_id values per clinic
            -- This should not happen, but check anyway
            -- PostgreSQL-specific syntax (DO $$ block)
            DO $$
            DECLARE
                duplicate_count INTEGER;
            BEGIN
                SELECT COUNT(*) INTO duplicate_count
                FROM (
                    SELECT clinic_id, line_user_id, COUNT(*) as cnt
                    FROM user_clinic_associations
                    WHERE line_user_id IS NOT NULL
                    GROUP BY clinic_id, line_user_id
                    HAVING COUNT(*) > 1
                ) duplicates;
                
                IF duplicate_count > 0 THEN
                    RAISE EXCEPTION 'Found % duplicate (clinic_id, line_user_id) pairs. Please resolve before migration.', duplicate_count;
                END IF;
            END $$;
        """))
        
        op.create_unique_constraint(
            'uq_user_clinic_associations_clinic_line_user',
            'user_clinic_associations',
            ['clinic_id', 'line_user_id']
        )
        print("Added unique constraint on (clinic_id, line_user_id)")
    
    # Step 4: Add index for query performance
    uca_indexes = [idx['name'] for idx in inspector.get_indexes('user_clinic_associations')]
    if 'idx_user_clinic_associations_line_user_id' not in uca_indexes:
        op.create_index(
            'idx_user_clinic_associations_line_user_id',
            'user_clinic_associations',
            ['line_user_id']
        )
        print("Added index on line_user_id")
    
    # Step 5: Remove line_user_id column from users table
    if 'line_user_id' in users_columns:
        op.drop_column('users', 'line_user_id')
        print("Removed line_user_id column from users table")


def downgrade() -> None:
    """
    Reverse the migration: move line_user_id back to users table.
    
    Note: This is a lossy operation if a user had different line_user_id
    values for different clinics. We'll use the first non-NULL value found.
    """
    conn = op.get_bind()
    inspector = inspect(conn)
    
    # Step 1: Add line_user_id column back to users table
    users_columns = [col['name'] for col in inspector.get_columns('users')]
    if 'line_user_id' not in users_columns:
        op.add_column(
            'users',
            sa.Column('line_user_id', sa.String(255), nullable=True)
        )
    
    # Step 2: Migrate data back (use first non-NULL line_user_id per user)
    # This is lossy if user had different line_user_id per clinic
    conn.execute(text("""
        UPDATE users u
        SET line_user_id = (
            SELECT uca.line_user_id
            FROM user_clinic_associations uca
            WHERE uca.user_id = u.id
              AND uca.line_user_id IS NOT NULL
            LIMIT 1
        )
    """))
    
    # Step 3: Remove unique constraint and index from user_clinic_associations
    uca_constraints = [uc['name'] for uc in inspector.get_unique_constraints('user_clinic_associations')]
    if 'uq_user_clinic_associations_clinic_line_user' in uca_constraints:
        op.drop_constraint(
            'uq_user_clinic_associations_clinic_line_user',
            'user_clinic_associations',
            type_='unique'
        )
    
    uca_indexes = [idx['name'] for idx in inspector.get_indexes('user_clinic_associations')]
    if 'idx_user_clinic_associations_line_user_id' in uca_indexes:
        op.drop_index('idx_user_clinic_associations_line_user_id', table_name='user_clinic_associations')
    
    # Step 4: Remove line_user_id column from user_clinic_associations
    uca_columns = [col['name'] for col in inspector.get_columns('user_clinic_associations')]
    if 'line_user_id' in uca_columns:
        op.drop_column('user_clinic_associations', 'line_user_id')

