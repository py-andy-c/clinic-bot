"""add_migration_lock_table

Revision ID: 9c7c88416b76
Revises: 571ddb1af54d
Create Date: 2026-01-14 13:37:38.390888

Add migration lock table and functions to prevent concurrent migrations.
This ensures only one deployment can run migrations at a time, preventing
database corruption from simultaneous schema changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '9c7c88416b76'
down_revision: Union[str, None] = '571ddb1af54d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create migration lock table
    op.create_table(
        'migration_lock',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('deployment_id', sa.String(), nullable=False),
        sa.Column('locked_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('locked_by', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('deployment_id')
    )

    # Create index for cleanup performance
    op.create_index(
        'idx_migration_lock_locked_at',
        'migration_lock',
        ['locked_at']
    )

    # Create the lock acquisition function
    op.execute(text("""
    CREATE OR REPLACE FUNCTION acquire_migration_lock(deployment_id TEXT, locker_id TEXT)
    RETURNS BOOLEAN AS $$
    BEGIN
        -- Try to insert lock, fail if already exists
        INSERT INTO migration_lock (deployment_id, locked_by, locked_at)
        VALUES (deployment_id, locker_id, now());

        -- Clean up old locks (older than 1 hour)
        DELETE FROM migration_lock
        WHERE locked_at < NOW() - INTERVAL '1 hour';

        RETURN TRUE;

    EXCEPTION
        WHEN unique_violation THEN
            -- Lock already exists
            RETURN FALSE;
    END;
    $$ LANGUAGE plpgsql;
    """))

    # Create function to check if lock is held
    op.execute(text("""
    CREATE OR REPLACE FUNCTION is_migration_locked()
    RETURNS BOOLEAN AS $$
    BEGIN
        -- Check for active locks (within last hour)
        RETURN EXISTS (
            SELECT 1 FROM migration_lock
            WHERE locked_at > NOW() - INTERVAL '1 hour'
        );
    END;
    $$ LANGUAGE plpgsql;
    """))


def downgrade() -> None:
    # Drop functions first
    op.execute(text("DROP FUNCTION IF EXISTS acquire_migration_lock(TEXT, TEXT);"))
    op.execute(text("DROP FUNCTION IF EXISTS is_migration_locked();"))

    # Drop index
    op.drop_index('idx_migration_lock_locked_at', table_name='migration_lock')

    # Drop table
    op.drop_table('migration_lock')
