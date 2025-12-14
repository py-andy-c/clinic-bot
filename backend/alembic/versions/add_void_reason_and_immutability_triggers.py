"""add_void_reason_and_immutability_triggers

Revision ID: 5cdb88eb05ab
Revises: cff1fda3874f
Create Date: 2024-12-20 10:00:00.000000

Add void_reason column and immutability triggers for receipt void information.
- Add void_reason TEXT column to receipts table
- Add length constraint for void_reason
- Simplify receipt_data immutability trigger (block all updates)
- Add trigger to prevent void_info modification after voiding
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5cdb88eb05ab'
down_revision: Union[str, None] = 'cff1fda3874f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add void_reason column and immutability triggers.
    
    This migration:
    1. Adds void_reason TEXT column to receipts table
    2. Adds length constraint for void_reason (max 500 characters)
    3. Simplifies receipt_data immutability trigger to block ALL updates
    4. Adds trigger to prevent void_info modification after voiding
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if receipts table exists
    tables = inspector.get_table_names()
    if 'receipts' not in tables:
        # Receipts table doesn't exist yet, skip this migration
        return
    
    # Step 1: Add void_reason column if it doesn't exist
    columns = [col['name'] for col in inspector.get_columns('receipts')]
    if 'void_reason' not in columns:
        op.add_column('receipts', sa.Column('void_reason', sa.Text(), nullable=True))
    
    # Step 2: Add length constraint for void_reason
    # Check if constraint already exists
    result = conn.execute(sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'receipts' 
            AND c.conname = 'chk_void_reason_length'
        )
    """))
    constraint_exists = result.scalar()
    
    if not constraint_exists:
        op.execute("""
            ALTER TABLE receipts 
            ADD CONSTRAINT chk_void_reason_length 
            CHECK (void_reason IS NULL OR LENGTH(void_reason) <= 500);
        """)
    
    # Step 3: Simplify receipt_data immutability trigger
    # Update function to block ALL receipt_data updates (truly immutable)
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_receipt_data_modification()
        RETURNS TRIGGER AS $$
        BEGIN
          -- Block ALL receipt_data updates (truly immutable)
          IF OLD.receipt_data IS DISTINCT FROM NEW.receipt_data THEN
            RAISE EXCEPTION 'receipt_data is immutable and cannot be modified after creation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    
    # Step 4: Create trigger to prevent void_info modification after voiding
    # Check if function already exists
    result = conn.execute(sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'prevent_void_info_modification'
        )
    """))
    function_exists = result.scalar()
    
    if not function_exists:
        op.execute("""
            CREATE OR REPLACE FUNCTION prevent_void_info_modification()
            RETURNS TRIGGER AS $$
            BEGIN
              -- If void_info was already set, prevent further changes
              IF OLD.is_voided = TRUE AND (
                  OLD.voided_at IS DISTINCT FROM NEW.voided_at OR
                  OLD.voided_by_user_id IS DISTINCT FROM NEW.voided_by_user_id OR
                  OLD.void_reason IS DISTINCT FROM NEW.void_reason
              ) THEN
                RAISE EXCEPTION 'Void information cannot be modified after voiding';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        """)
    
    # Check if trigger already exists
    result = conn.execute(sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            WHERE c.relname = 'receipts' AND t.tgname = 'prevent_void_info_modification_trigger'
        )
    """))
    trigger_exists = result.scalar()
    
    if not trigger_exists:
        op.execute("""
            CREATE TRIGGER prevent_void_info_modification_trigger
              BEFORE UPDATE ON receipts
              FOR EACH ROW
              EXECUTE FUNCTION prevent_void_info_modification();
        """)


def downgrade() -> None:
    """
    Remove void_reason column and immutability triggers.
    
    This removes:
    1. void_reason column and constraint
    2. void_info immutability trigger and function
    3. Restores original receipt_data immutability trigger (if needed)
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if receipts table exists
    tables = inspector.get_table_names()
    if 'receipts' not in tables:
        return
    
    # Drop trigger and function for void_info immutability
    op.execute("DROP TRIGGER IF EXISTS prevent_void_info_modification_trigger ON receipts;")
    op.execute("DROP FUNCTION IF EXISTS prevent_void_info_modification();")
    
    # Drop constraint and column
    columns = [col['name'] for col in inspector.get_columns('receipts')]
    if 'void_reason' in columns:
        op.execute("ALTER TABLE receipts DROP CONSTRAINT IF EXISTS chk_void_reason_length;")
        op.drop_column('receipts', 'void_reason')
    
    # Note: We don't restore the old receipt_data trigger function in downgrade
    # as it's simpler to keep the current simplified version

