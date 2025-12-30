"""add_patient_practitioner_assignments

Revision ID: add_patient_pract_assignments
Revises: decouple_billing_scenarios
Create Date: 2025-01-30 12:00:00.000000

Add patient-practitioner assignment feature:
- Create patient_practitioner_assignments table
- Add indexes for performance
- Add restrict_to_assigned_practitioners to clinic_info_settings
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_patient_pract_assignments'
down_revision: Union[str, None] = 'decouple_billing_scenarios'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add patient-practitioner assignment feature.
    
    This migration:
    1. Creates patient_practitioner_assignments table
    2. Adds indexes for query performance
    3. Adds restrict_to_assigned_practitioners to clinic_info_settings (default: false)
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    # Step 1: Create patient_practitioner_assignments table
    if 'patient_practitioner_assignments' not in tables:
        op.create_table(
            'patient_practitioner_assignments',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('patient_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('patient_id', 'user_id', 'clinic_id', name='uq_patient_practitioner_clinic')
        )
        
        # Create indexes for query performance
        op.create_index(
            'idx_patient_practitioner_assignments_patient',
            'patient_practitioner_assignments',
            ['patient_id', 'clinic_id']
        )
        
        op.create_index(
            'idx_patient_practitioner_assignments_practitioner',
            'patient_practitioner_assignments',
            ['user_id', 'clinic_id']
        )
        
        op.create_index(
            'idx_patient_practitioner_assignments_clinic',
            'patient_practitioner_assignments',
            ['clinic_id']
        )
    
    # Step 2: Add restrict_to_assigned_practitioners to clinic_info_settings
    # This is stored in clinics.settings JSONB column
    # We need to update existing clinics to have the default value
    op.execute(sa.text("""
        UPDATE clinics
        SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{clinic_info_settings,restrict_to_assigned_practitioners}',
            'false'::jsonb,
            true
        )
        WHERE NOT (settings ? 'clinic_info_settings' AND settings->'clinic_info_settings' ? 'restrict_to_assigned_practitioners')
    """))


def downgrade() -> None:
    """
    Remove patient-practitioner assignment feature.
    """
    # Step 1: Remove restrict_to_assigned_practitioners from clinic_info_settings
    op.execute(sa.text("""
        UPDATE clinics
        SET settings = settings #- '{clinic_info_settings,restrict_to_assigned_practitioners}'
        WHERE settings ? 'clinic_info_settings' 
        AND settings->'clinic_info_settings' ? 'restrict_to_assigned_practitioners'
    """))
    
    # Step 2: Drop indexes
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    indexes = [idx['name'] for idx in inspector.get_indexes('patient_practitioner_assignments')]
    
    if 'idx_patient_practitioner_assignments_clinic' in indexes:
        op.drop_index('idx_patient_practitioner_assignments_clinic', table_name='patient_practitioner_assignments')
    
    if 'idx_patient_practitioner_assignments_practitioner' in indexes:
        op.drop_index('idx_patient_practitioner_assignments_practitioner', table_name='patient_practitioner_assignments')
    
    if 'idx_patient_practitioner_assignments_patient' in indexes:
        op.drop_index('idx_patient_practitioner_assignments_patient', table_name='patient_practitioner_assignments')
    
    # Step 3: Drop table
    op.drop_table('patient_practitioner_assignments')

