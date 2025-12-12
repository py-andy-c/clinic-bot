"""add_billing_system_phase1

Revision ID: add_billing_phase1
Revises: add_clinic_notes
Create Date: 2025-12-11 19:12:16.000000

Phase 1: Database & Models for billing system
- Extend appointment_types table with new fields
- Create billing_scenarios table
- Create receipts table with immutability trigger
- Add receipt_settings to clinic settings JSONB
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_billing_phase1'
down_revision: Union[str, None] = 'add_clinic_notes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Phase 1: Add billing system database schema.
    
    This migration:
    1. Extends appointment_types table with new fields for service items
    2. Creates billing_scenarios table for pricing options
    3. Creates receipts table with immutable snapshot pattern
    4. Adds database trigger to enforce receipt_data immutability
    """
    # Get inspector for checking existing schema
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    # Step 1: Extend appointment_types table
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    if 'receipt_name' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('receipt_name', sa.String(255), nullable=True)
        )
        # Set default: receipt_name = name for existing records
        op.execute("""
            UPDATE appointment_types 
            SET receipt_name = name 
            WHERE receipt_name IS NULL
        """)
    
    if 'allow_patient_booking' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('allow_patient_booking', sa.Boolean(), nullable=False, server_default='true')
        )
    
    if 'description' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('description', sa.Text(), nullable=True)
        )
    
    if 'scheduling_buffer_minutes' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('scheduling_buffer_minutes', sa.Integer(), nullable=False, server_default='0')
        )
    
    # Step 2: Create billing_scenarios table
    # Check if table already exists (for idempotency - baseline migration may have created it)
    tables = inspector.get_table_names()
    if 'billing_scenarios' not in tables:
        op.create_table(
        'billing_scenarios',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('practitioner_appointment_type_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('revenue_share', sa.Numeric(10, 2), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['practitioner_appointment_type_id'], ['practitioner_appointment_types.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    
        # Create indexes for billing_scenarios
        op.create_index('idx_billing_scenarios_practitioner_type', 'billing_scenarios', ['practitioner_appointment_type_id'])
        op.create_index('idx_billing_scenarios_deleted', 'billing_scenarios', ['is_deleted'])
        
        # Create partial unique index: name must be unique per practitioner-service combination (excluding deleted)
        op.create_index(
            'uq_billing_scenarios_practitioner_type_name',
            'billing_scenarios',
            ['practitioner_appointment_type_id', 'name'],
            unique=True,
            postgresql_where=sa.text('is_deleted = FALSE')
        )
        
        # Add check constraints for validation
        op.create_check_constraint(
            'chk_revenue_share_le_amount',
            'billing_scenarios',
            'revenue_share <= amount'
        )
        op.create_check_constraint(
            'chk_amount_positive',
            'billing_scenarios',
            'amount > 0'
        )
        op.create_check_constraint(
            'chk_revenue_share_non_negative',
            'billing_scenarios',
            'revenue_share >= 0'
        )
    else:
        # Table exists, but check if indexes and constraints exist
        indexes = [idx['name'] for idx in inspector.get_indexes('billing_scenarios')]
        if 'uq_billing_scenarios_practitioner_type_name' not in indexes:
            op.create_index(
                'uq_billing_scenarios_practitioner_type_name',
                'billing_scenarios',
                ['practitioner_appointment_type_id', 'name'],
                unique=True,
                postgresql_where=sa.text('is_deleted = FALSE')
            )
        
        # Check if constraints exist
        result = conn.execute(sa.text("""
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'billing_scenarios'::regclass
            AND conname IN ('chk_revenue_share_le_amount', 'chk_amount_positive', 'chk_revenue_share_non_negative')
        """))
        existing_constraints = {row[0] for row in result}
        
        if 'chk_revenue_share_le_amount' not in existing_constraints:
            op.create_check_constraint(
                'chk_revenue_share_le_amount',
                'billing_scenarios',
                'revenue_share <= amount'
            )
        if 'chk_amount_positive' not in existing_constraints:
            op.create_check_constraint(
                'chk_amount_positive',
                'billing_scenarios',
                'amount > 0'
            )
        if 'chk_revenue_share_non_negative' not in existing_constraints:
            op.create_check_constraint(
                'chk_revenue_share_non_negative',
                'billing_scenarios',
                'revenue_share >= 0'
            )
    
    # Step 3: Create receipts table
    # Check if table already exists (for idempotency - baseline migration may have created it)
    if 'receipts' not in tables:
        op.create_table(
        'receipts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('appointment_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('receipt_number', sa.String(50), nullable=False),
        sa.Column('issue_date', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('total_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('total_revenue_share', sa.Numeric(10, 2), nullable=False),
        sa.Column('receipt_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_voided', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('voided_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('voided_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['appointment_id'], ['appointments.calendar_event_id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['voided_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('clinic_id', 'receipt_number', name='uq_receipts_clinic_number')
        )
        
        # Create indexes for receipts
        op.create_index('idx_receipts_receipt_number', 'receipts', ['receipt_number'])
        op.create_index('idx_receipts_issue_date', 'receipts', ['issue_date'])
        op.create_index('idx_receipts_appointment', 'receipts', ['appointment_id'])
        op.create_index('idx_receipts_clinic', 'receipts', ['clinic_id'])
        op.create_index('idx_receipts_voided', 'receipts', ['is_voided'])
        op.create_index('idx_receipts_voided_at', 'receipts', ['voided_at'])
        
        # Create partial unique index: Only one active (non-voided) receipt per appointment
        op.create_index(
            'uq_receipts_appointment_active',
            'receipts',
            ['appointment_id'],
            unique=True,
            postgresql_where=sa.text('is_voided = FALSE')
        )
        
        # Create GIN index for JSONB queries
        op.create_index(
            'idx_receipts_data_gin',
            'receipts',
            ['receipt_data'],
            postgresql_using='gin'
        )
    else:
        # Table exists, but check if indexes exist
        indexes = [idx['name'] for idx in inspector.get_indexes('receipts')]
        if 'uq_receipts_appointment_active' not in indexes:
            op.create_index(
                'uq_receipts_appointment_active',
                'receipts',
                ['appointment_id'],
                unique=True,
                postgresql_where=sa.text('is_voided = FALSE')
            )
        if 'idx_receipts_data_gin' not in indexes:
            op.create_index(
                'idx_receipts_data_gin',
                'receipts',
                ['receipt_data'],
                postgresql_using='gin'
            )
    
    # Step 4: Create database trigger to enforce receipt_data immutability
    # Only create if receipts table exists (was created in this migration or by baseline)
    if 'receipts' in tables:
        # Check if function already exists
        result = conn.execute(sa.text("""
            SELECT EXISTS (
                SELECT 1 FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = 'public' AND p.proname = 'prevent_receipt_data_modification'
            )
        """))
        function_exists = result.scalar()
        
        if not function_exists:
            op.execute("""
                CREATE OR REPLACE FUNCTION prevent_receipt_data_modification()
                RETURNS TRIGGER AS $$
                BEGIN
                    -- Allow updates only to voiding fields
                    IF OLD.receipt_data IS DISTINCT FROM NEW.receipt_data THEN
                        RAISE EXCEPTION 'receipt_data is immutable and cannot be modified after creation';
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
                WHERE c.relname = 'receipts' AND t.tgname = 'receipt_data_immutability_trigger'
            )
        """))
        trigger_exists = result.scalar()
        
        if not trigger_exists:
            op.execute("""
                CREATE TRIGGER receipt_data_immutability_trigger
                    BEFORE UPDATE ON receipts
                    FOR EACH ROW
                    EXECUTE FUNCTION prevent_receipt_data_modification();
            """)
    
    # Step 5: Initialize receipt_settings for existing clinics
    op.execute("""
        UPDATE clinics
        SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{receipt_settings}',
            '{"custom_notes": null, "show_stamp": false}'::jsonb
        )
        WHERE settings->'receipt_settings' IS NULL;
    """)


def downgrade() -> None:
    """
    Remove billing system database schema.
    
    This removes:
    1. Receipts table and trigger
    2. Billing scenarios table
    3. New columns from appointment_types table
    """
    # Drop trigger and function
    op.execute("DROP TRIGGER IF EXISTS receipt_data_immutability_trigger ON receipts;")
    op.execute("DROP FUNCTION IF EXISTS prevent_receipt_data_modification();")
    
    # Drop partial unique indexes first
    op.drop_index('uq_receipts_appointment_active', table_name='receipts')
    op.drop_index('uq_billing_scenarios_practitioner_type_name', table_name='billing_scenarios')
    
    # Drop receipts table (indexes will be dropped automatically)
    op.drop_table('receipts')
    
    # Drop billing_scenarios table (indexes and constraints will be dropped automatically)
    op.drop_table('billing_scenarios')
    
    # Remove columns from appointment_types
    op.drop_column('appointment_types', 'scheduling_buffer_minutes')
    op.drop_column('appointment_types', 'description')
    op.drop_column('appointment_types', 'allow_patient_booking')
    op.drop_column('appointment_types', 'receipt_name')


