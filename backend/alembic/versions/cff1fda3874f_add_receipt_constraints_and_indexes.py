"""add_receipt_constraints_and_indexes

Revision ID: cff1fda3874f
Revises: add_billing_phase1
Create Date: 2025-12-12 20:07:25.283800

Phase 0: Add database constraints and indexes for receipt checkout management
- Add trigger to prevent checkout on cancelled appointments
- Add indexes for performance optimization
- Ensure unique constraint for one active receipt per appointment
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cff1fda3874f'
down_revision: Union[str, None] = 'add_billing_phase1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add database constraints and indexes for receipt checkout management.
    
    This migration:
    1. Creates trigger to prevent receipt creation on cancelled appointments (Constraint 2)
    2. Adds performance indexes if not present
    3. Ensures unique partial index for one active receipt per appointment
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if receipts table exists
    tables = inspector.get_table_names()
    if 'receipts' not in tables:
        # Receipts table doesn't exist yet, skip this migration
        # It will be created by the billing system migration
        return
    
    # Step 1: Create trigger to prevent checkout on cancelled appointments
    # Check if function already exists
    result = conn.execute(sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'prevent_checkout_cancelled'
        )
    """))
    function_exists = result.scalar()
    
    if not function_exists:
        op.execute("""
            CREATE OR REPLACE FUNCTION prevent_checkout_cancelled()
            RETURNS TRIGGER AS $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM appointments 
                    WHERE calendar_event_id = NEW.appointment_id 
                    AND status != 'confirmed'
                ) THEN
                    RAISE EXCEPTION 'Cannot create receipt for cancelled appointment';
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
            WHERE c.relname = 'receipts' AND t.tgname = 'prevent_checkout_cancelled_trigger'
        )
    """))
    trigger_exists = result.scalar()
    
    if not trigger_exists:
        op.execute("""
            CREATE TRIGGER prevent_checkout_cancelled_trigger
                BEFORE INSERT ON receipts
                FOR EACH ROW
                EXECUTE FUNCTION prevent_checkout_cancelled();
        """)
    
    # Step 2: Add performance indexes if not present
    indexes = [idx['name'] for idx in inspector.get_indexes('receipts')]
    
    # Check if composite index exists (may have different name)
    composite_index_exists = any(
        'appointment_id' in str(idx.get('column_names', [])) and 
        'is_voided' in str(idx.get('column_names', []))
        for idx in inspector.get_indexes('receipts')
    )
    
    if 'idx_receipts_appointment_id' not in indexes:
        op.create_index('idx_receipts_appointment_id', 'receipts', ['appointment_id'])
    
    if 'idx_receipts_is_voided' not in indexes:
        op.create_index('idx_receipts_is_voided', 'receipts', ['is_voided'])
    
    if not composite_index_exists:
        op.create_index(
            'idx_receipts_appointment_voided',
            'receipts',
            ['appointment_id', 'is_voided']
        )
    
    # Step 3: Ensure unique partial index for one active receipt per appointment
    # Check if unique partial index exists (may be named uq_receipts_appointment_active from billing migration)
    unique_index_exists = (
        'uq_receipts_one_active_per_appointment' in indexes or
        'uq_receipts_appointment_active' in indexes or
        any(
            idx.get('unique', False) and 
            'appointment_id' in str(idx.get('column_names', []))
            for idx in inspector.get_indexes('receipts')
        )
    )
    
    if not unique_index_exists:
        op.execute("""
            CREATE UNIQUE INDEX uq_receipts_one_active_per_appointment 
            ON receipts(appointment_id) 
            WHERE is_voided = false;
        """)


def downgrade() -> None:
    """
    Remove database constraints and indexes.
    
    This removes:
    1. Trigger and function for preventing checkout on cancelled appointments
    2. Performance indexes (keep basic indexes from billing migration)
    3. Unique partial index for active receipts
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if receipts table exists
    tables = inspector.get_table_names()
    if 'receipts' not in tables:
        return
    
    # Drop trigger and function
    op.execute("DROP TRIGGER IF EXISTS prevent_checkout_cancelled_trigger ON receipts;")
    op.execute("DROP FUNCTION IF EXISTS prevent_checkout_cancelled();")
    
    # Drop indexes (check if they exist first)
    indexes = [idx['name'] for idx in inspector.get_indexes('receipts')]
    
    if 'idx_receipts_appointment_id' in indexes:
        op.drop_index('idx_receipts_appointment_id', table_name='receipts')
    
    if 'idx_receipts_is_voided' in indexes:
        op.drop_index('idx_receipts_is_voided', table_name='receipts')
    
    if 'idx_receipts_appointment_voided' in indexes:
        op.drop_index('idx_receipts_appointment_voided', table_name='receipts')
    
    if 'uq_receipts_one_active_per_appointment' in indexes:
        op.drop_index('uq_receipts_one_active_per_appointment', table_name='receipts')
