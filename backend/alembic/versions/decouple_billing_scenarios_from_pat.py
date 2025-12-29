"""decouple_billing_scenarios_from_pat

Revision ID: decouple_billing_scenarios
Revises: add_pat_soft_delete
Create Date: 2025-12-29 16:00:00.000000

Decouple billing scenarios from practitioner_appointment_types:
- Add direct fields: practitioner_id, appointment_type_id, clinic_id
- Populate from existing practitioner_appointment_type_id
- Create indexes and unique constraint
- Remove practitioner_appointment_type_id FK and column
- Add database trigger to prevent hard-deletes
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'decouple_billing_scenarios'
down_revision: Union[str, None] = 'add_pat_soft_delete'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Decouple billing scenarios from practitioner_appointment_types.
    
    This migration:
    1. Validates no orphaned scenarios exist
    2. Adds direct fields: practitioner_id, appointment_type_id, clinic_id
    3. Populates new fields from existing practitioner_appointment_type_id
    4. Creates indexes for query performance
    5. Creates composite unique index for scenario name uniqueness
    6. Drops obsolete index on practitioner_appointment_type_id
    7. Removes practitioner_appointment_type_id FK and column
    8. Adds database trigger to prevent hard-deletes
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Pre-migration validation and state check
    columns = [col['name'] for col in inspector.get_columns('billing_scenarios')]
    
    # Check for orphaned scenarios (only if old column exists)
    if 'practitioner_appointment_type_id' in columns:
        result = conn.execute(sa.text("""
            SELECT COUNT(*) FROM billing_scenarios bs
            LEFT JOIN practitioner_appointment_types pat ON bs.practitioner_appointment_type_id = pat.id
            WHERE pat.id IS NULL
        """))
        orphaned_count = result.scalar()
        
        if orphaned_count > 0:
            raise Exception(
                f"Migration cannot proceed: {orphaned_count} orphaned billing scenario(s) found. "
                "Please clean up orphaned scenarios before running this migration."
            )
    
    # Step 1: Check current state of billing_scenarios table
    
    # Check if migration has already been applied (new columns exist, old column doesn't)
    has_new_columns = all(col in columns for col in ['practitioner_id', 'appointment_type_id', 'clinic_id'])
    has_old_column = 'practitioner_appointment_type_id' in columns
    
    if has_new_columns and not has_old_column:
        # Migration already applied, skip data migration steps but ensure indexes/triggers exist
        pass
    elif has_old_column:
        # Normal migration path: add new columns and migrate data
        if 'practitioner_id' not in columns:
            op.add_column(
                'billing_scenarios',
                sa.Column('practitioner_id', sa.Integer(), nullable=True)  # Temporarily nullable
            )
        
        if 'appointment_type_id' not in columns:
            op.add_column(
                'billing_scenarios',
                sa.Column('appointment_type_id', sa.Integer(), nullable=True)  # Temporarily nullable
            )
        
        if 'clinic_id' not in columns:
            op.add_column(
                'billing_scenarios',
                sa.Column('clinic_id', sa.Integer(), nullable=True)  # Temporarily nullable
            )
        
        # Step 2: Populate new fields from existing practitioner_appointment_type_id
        conn.execute(sa.text("""
            UPDATE billing_scenarios bs
            SET 
                practitioner_id = pat.user_id,
                appointment_type_id = pat.appointment_type_id,
                clinic_id = pat.clinic_id
            FROM practitioner_appointment_types pat
            WHERE bs.practitioner_appointment_type_id = pat.id
        """))
    else:
        # Unexpected state: neither old nor new columns exist
        raise Exception(
            "Migration cannot proceed: billing_scenarios table exists but "
            "neither practitioner_appointment_type_id nor the new direct columns exist. "
            "This suggests the table was created in an unexpected way."
        )
    
    # Step 3: Make fields NOT NULL and add foreign keys (only if we're doing the migration)
    if has_old_column:
        op.alter_column('billing_scenarios', 'practitioner_id', nullable=False)
        op.alter_column('billing_scenarios', 'appointment_type_id', nullable=False)
        op.alter_column('billing_scenarios', 'clinic_id', nullable=False)
    
    # Add foreign keys (check if they exist first)
    foreign_keys = inspector.get_foreign_keys('billing_scenarios')
    fk_names = {fk['name'] for fk in foreign_keys}
    
    if 'fk_billing_scenarios_practitioner_id' not in fk_names:
        op.create_foreign_key(
            'fk_billing_scenarios_practitioner_id',
            'billing_scenarios',
            'users',
            ['practitioner_id'],
            ['id']
        )
    
    if 'fk_billing_scenarios_appointment_type_id' not in fk_names:
        op.create_foreign_key(
            'fk_billing_scenarios_appointment_type_id',
            'billing_scenarios',
            'appointment_types',
            ['appointment_type_id'],
            ['id']
        )
    
    if 'fk_billing_scenarios_clinic_id' not in fk_names:
        op.create_foreign_key(
            'fk_billing_scenarios_clinic_id',
            'billing_scenarios',
            'clinics',
            ['clinic_id'],
            ['id']
        )
    
    # Step 4: Create indexes for query performance
    indexes = [idx['name'] for idx in inspector.get_indexes('billing_scenarios')]
    
    if 'idx_billing_scenarios_practitioner_appointment_clinic' not in indexes:
        op.create_index(
            'idx_billing_scenarios_practitioner_appointment_clinic',
            'billing_scenarios',
            ['practitioner_id', 'appointment_type_id', 'clinic_id']
        )
    
    # Step 5: Create composite unique index for scenario name uniqueness
    op.execute(sa.text("""
        CREATE UNIQUE INDEX idx_billing_scenarios_name_unique 
        ON billing_scenarios (practitioner_id, appointment_type_id, clinic_id, name) 
        WHERE is_deleted = false
    """))
    
    # Step 6: Drop obsolete indexes on practitioner_appointment_type_id
    if 'idx_billing_scenarios_practitioner_type' in indexes:
        op.drop_index('idx_billing_scenarios_practitioner_type', table_name='billing_scenarios')
    
    # Drop the old unique index if it exists
    if 'uq_billing_scenarios_practitioner_type_name' in indexes:
        op.drop_index('uq_billing_scenarios_practitioner_type_name', table_name='billing_scenarios')
    
    # Step 7: Remove practitioner_appointment_type_id foreign key and column (only if it exists)
    if has_old_column:
        foreign_keys = inspector.get_foreign_keys('billing_scenarios')
        for fk in foreign_keys:
            if fk['constrained_columns'] == ['practitioner_appointment_type_id']:
                op.drop_constraint(fk['name'], 'billing_scenarios', type_='foreignkey')
                break
        
        if 'practitioner_appointment_type_id' in columns:
            op.drop_column('billing_scenarios', 'practitioner_appointment_type_id')
    
    # Step 8: Add database trigger to prevent hard-deletes
    # Create function
    conn.execute(sa.text("""
        CREATE OR REPLACE FUNCTION prevent_billing_scenario_hard_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            UPDATE billing_scenarios 
            SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP 
            WHERE id = OLD.id;
            RETURN NULL; -- Prevent actual deletion
        END;
        $$ LANGUAGE plpgsql;
    """))
    
    # Create trigger
    conn.execute(sa.text("""
        DROP TRIGGER IF EXISTS billing_scenario_soft_delete_trigger ON billing_scenarios;
    """))
    
    conn.execute(sa.text("""
        CREATE TRIGGER billing_scenario_soft_delete_trigger
        BEFORE DELETE ON billing_scenarios
        FOR EACH ROW EXECUTE FUNCTION prevent_billing_scenario_hard_delete();
    """))


def downgrade() -> None:
    """
    Revert decoupling and restore practitioner_appointment_type_id FK.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Step 1: Drop trigger and function
    conn.execute(sa.text("""
        DROP TRIGGER IF EXISTS billing_scenario_soft_delete_trigger ON billing_scenarios;
    """))
    
    conn.execute(sa.text("""
        DROP FUNCTION IF EXISTS prevent_billing_scenario_hard_delete();
    """))
    
    # Step 2: Add practitioner_appointment_type_id column back
    columns = [col['name'] for col in inspector.get_columns('billing_scenarios')]
    
    if 'practitioner_appointment_type_id' not in columns:
        op.add_column(
            'billing_scenarios',
            sa.Column('practitioner_appointment_type_id', sa.Integer(), nullable=True)
        )
    
    # Step 3: Populate practitioner_appointment_type_id from direct fields
    # This requires finding matching PATs - if multiple exist, use the first active one
    conn.execute(sa.text("""
        UPDATE billing_scenarios bs
        SET practitioner_appointment_type_id = (
            SELECT pat.id 
            FROM practitioner_appointment_types pat
            WHERE pat.user_id = bs.practitioner_id
                AND pat.appointment_type_id = bs.appointment_type_id
                AND pat.clinic_id = bs.clinic_id
                AND pat.is_deleted = false
            LIMIT 1
        )
    """))
    
    # Step 4: Make practitioner_appointment_type_id NOT NULL and add FK
    op.alter_column('billing_scenarios', 'practitioner_appointment_type_id', nullable=False)
    
    op.create_foreign_key(
        'fk_billing_scenarios_practitioner_appointment_type_id',
        'billing_scenarios',
        'practitioner_appointment_types',
        ['practitioner_appointment_type_id'],
        ['id'],
        ondelete='CASCADE'
    )
    
    # Step 5: Recreate obsolete index
    indexes = [idx['name'] for idx in inspector.get_indexes('billing_scenarios')]
    if 'idx_billing_scenarios_practitioner_type' not in indexes:
        op.create_index(
            'idx_billing_scenarios_practitioner_type',
            'billing_scenarios',
            ['practitioner_appointment_type_id']
        )
    
    # Step 6: Drop new indexes
    indexes = [idx['name'] for idx in inspector.get_indexes('billing_scenarios')]
    if 'idx_billing_scenarios_name_unique' in indexes:
        op.drop_index('idx_billing_scenarios_name_unique', table_name='billing_scenarios')
    
    if 'idx_billing_scenarios_practitioner_appointment_clinic' in indexes:
        op.drop_index('idx_billing_scenarios_practitioner_appointment_clinic', table_name='billing_scenarios')
    
    # Step 7: Drop foreign keys on direct fields
    foreign_keys = inspector.get_foreign_keys('billing_scenarios')
    for fk in foreign_keys:
        if fk['constrained_columns'] == ['practitioner_id']:
            op.drop_constraint(fk['name'], 'billing_scenarios', type_='foreignkey')
        elif fk['constrained_columns'] == ['appointment_type_id']:
            op.drop_constraint(fk['name'], 'billing_scenarios', type_='foreignkey')
        elif fk['constrained_columns'] == ['clinic_id']:
            op.drop_constraint(fk['name'], 'billing_scenarios', type_='foreignkey')
    
    # Step 8: Drop direct fields
    if 'practitioner_id' in columns:
        op.drop_column('billing_scenarios', 'practitioner_id')
    if 'appointment_type_id' in columns:
        op.drop_column('billing_scenarios', 'appointment_type_id')
    if 'clinic_id' in columns:
        op.drop_column('billing_scenarios', 'clinic_id')

