"""Add appointment_type_patient_form_configs table

Revision ID: 202602140000
Revises: 58b85efb0826, 202602010000
Create Date: 2026-02-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '202602140000'
down_revision: Union[str, None] = ('58b85efb0826', '202602010000')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Get connection to check if table exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Only create table if it doesn't exist
    if 'appointment_type_patient_form_configs' not in existing_tables:
        # Create appointment_type_patient_form_configs table
        op.create_table(
            'appointment_type_patient_form_configs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('appointment_type_id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('medical_record_template_id', sa.Integer(), nullable=False),
            sa.Column('timing_type', sa.String(length=20), nullable=False),
            sa.Column('timing_mode', sa.String(length=20), nullable=False),
            sa.Column('hours', sa.Integer(), nullable=True),
            sa.Column('days', sa.Integer(), nullable=True),
            sa.Column('time_of_day', sa.Time(), nullable=True),
            sa.Column('on_impossible', sa.String(length=20), nullable=True),
            sa.Column('is_enabled', sa.Boolean(), server_default='true', nullable=False),
            sa.Column('display_order', sa.Integer(), server_default='0', nullable=False),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['medical_record_template_id'], ['medical_record_templates.id'], ondelete='CASCADE'),
            sa.CheckConstraint("timing_type IN ('before', 'after')", name='check_timing_type'),
            sa.CheckConstraint("timing_mode IN ('hours', 'specific_time')", name='check_timing_mode'),
            sa.CheckConstraint('hours >= 0', name='check_hours_non_negative'),
            sa.CheckConstraint('days >= 0', name='check_days_non_negative'),
            sa.CheckConstraint(
                "(timing_mode = 'hours' AND hours IS NOT NULL) OR "
                "(timing_mode = 'specific_time' AND days IS NOT NULL AND time_of_day IS NOT NULL)",
                name='check_timing_mode_consistency'
            ),
            sa.CheckConstraint(
                "(timing_type = 'before' AND on_impossible IN ('send_immediately', 'skip')) OR "
                "(timing_type = 'after' AND on_impossible IS NULL)",
                name='check_on_impossible_consistency'
            ),
            sa.UniqueConstraint('appointment_type_id', 'display_order', name='unique_appointment_type_patient_form_order'),
        )
        
        # Create indexes
        op.create_index('ix_appointment_type_patient_form_configs_id', 'appointment_type_patient_form_configs', ['id'])
        op.create_index('ix_appointment_type_patient_form_configs_appointment_type_id', 'appointment_type_patient_form_configs', ['appointment_type_id'])
        op.create_index('ix_appointment_type_patient_form_configs_clinic_id', 'appointment_type_patient_form_configs', ['clinic_id'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_appointment_type_patient_form_configs_clinic_id', table_name='appointment_type_patient_form_configs')
    op.drop_index('ix_appointment_type_patient_form_configs_appointment_type_id', table_name='appointment_type_patient_form_configs')
    op.drop_index('ix_appointment_type_patient_form_configs_id', table_name='appointment_type_patient_form_configs')
    
    # Drop table
    op.drop_table('appointment_type_patient_form_configs')
