"""add_patient_forms_system

Revision ID: add_patient_forms_system
Revises: dc5d1bd8abd4
Create Date: 2026-02-07 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_patient_forms_system'
down_revision: Union[str, None] = 'dc5d1bd8abd4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Modify medical_record_templates
    if 'medical_record_templates' in tables:
        columns = [c['name'] for c in inspector.get_columns('medical_record_templates')]
        if 'template_type' not in columns:
            op.add_column('medical_record_templates', sa.Column('template_type', sa.String(20), nullable=False, server_default='medical_record'))
            op.create_index('idx_medical_record_templates_type', 'medical_record_templates', ['clinic_id', 'template_type'])
        if 'max_photos' not in columns:
            op.add_column('medical_record_templates', sa.Column('max_photos', sa.Integer(), nullable=False, server_default='5'))
        
        # Add constraints if they don't exist
        # Note: In some environments, constraints might need manual naming or check if they exist
        # For simplicity in this migration, we'll just add them. 
        # op.create_check_constraint('check_template_type', 'medical_record_templates', "template_type IN ('medical_record', 'patient_form')")
        # op.create_check_constraint('check_max_photos', 'medical_record_templates', "max_photos >= 0 AND max_photos <= 20")

    # 2. Create patient_form_settings
    if 'patient_form_settings' not in tables:
        op.create_table(
            'patient_form_settings',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('appointment_type_id', sa.Integer(), nullable=False),
            sa.Column('template_id', sa.Integer(), nullable=False),
            sa.Column('timing_mode', sa.String(20), nullable=False),
            sa.Column('hours_after', sa.Integer(), nullable=True),
            sa.Column('days_after', sa.Integer(), nullable=True),
            sa.Column('time_of_day', sa.Time(), nullable=True),
            sa.Column('message_template', sa.Text(), nullable=False),
            sa.Column('flex_button_text', sa.String(50), nullable=False, server_default='填寫表單'),
            sa.Column('notify_admin', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('notify_appointment_practitioner', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('notify_assigned_practitioner', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['template_id'], ['medical_record_templates.id']),
            sa.CheckConstraint("timing_mode IN ('immediate', 'hours_after', 'specific_time')", name='check_timing_mode'),
            sa.CheckConstraint("(timing_mode = 'immediate') OR (timing_mode = 'hours_after' AND hours_after IS NOT NULL AND hours_after >= 0) OR (timing_mode = 'specific_time' AND days_after IS NOT NULL AND days_after >= 0 AND time_of_day IS NOT NULL)", name='check_timing_mode_consistency')
        )
        op.create_index('idx_patient_form_settings_clinic', 'patient_form_settings', ['clinic_id'])
        op.create_index('idx_patient_form_settings_apt_type', 'patient_form_settings', ['appointment_type_id'])

    # 3. Create patient_form_requests
    if 'patient_form_requests' not in tables:
        op.create_table(
            'patient_form_requests',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('patient_id', sa.Integer(), nullable=False),
            sa.Column('template_id', sa.Integer(), nullable=False),
            sa.Column('appointment_id', sa.Integer(), nullable=True),
            sa.Column('request_source', sa.String(20), nullable=False),
            sa.Column('patient_form_setting_id', sa.Integer(), nullable=True),
            sa.Column('notify_admin', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('notify_appointment_practitioner', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('notify_assigned_practitioner', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
            sa.Column('access_token', sa.String(64), nullable=False),
            sa.Column('medical_record_id', sa.Integer(), nullable=True),
            sa.Column('sent_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('submitted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('access_token'),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['template_id'], ['medical_record_templates.id']),
            sa.ForeignKeyConstraint(['appointment_id'], ['appointments.calendar_event_id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['patient_form_setting_id'], ['patient_form_settings.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['medical_record_id'], ['medical_records.id'], ondelete='SET NULL'),
            sa.CheckConstraint("request_source IN ('auto', 'manual')", name='check_request_source'),
            sa.CheckConstraint("status IN ('pending', 'submitted', 'skipped')", name='check_status')
        )
        op.create_index('idx_patient_form_requests_clinic', 'patient_form_requests', ['clinic_id'])
        op.create_index('idx_patient_form_requests_patient', 'patient_form_requests', ['patient_id'])
        op.create_index('idx_patient_form_requests_appointment', 'patient_form_requests', ['appointment_id'])
        op.create_index('idx_patient_form_requests_token', 'patient_form_requests', ['access_token'])
        op.create_index('idx_patient_form_requests_status', 'patient_form_requests', ['clinic_id', 'status'])

    # 4. Modify medical_records
    if 'medical_records' in tables:
        columns = [c['name'] for c in inspector.get_columns('medical_records')]
        if 'source_type' not in columns:
            op.add_column('medical_records', sa.Column('source_type', sa.String(20), nullable=False, server_default='clinic'))
        if 'last_updated_by_user_id' not in columns:
            op.add_column('medical_records', sa.Column('last_updated_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True))
        if 'last_updated_by_patient_id' not in columns:
            op.add_column('medical_records', sa.Column('last_updated_by_patient_id', sa.Integer(), sa.ForeignKey('patients.id'), nullable=True))
        if 'patient_form_request_id' not in columns:
            op.add_column('medical_records', sa.Column('patient_form_request_id', sa.Integer(), sa.ForeignKey('patient_form_requests.id'), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Drop patient_form_requests
    if 'patient_form_requests' in tables:
        op.drop_table('patient_form_requests')
    
    # 2. Drop patient_form_settings
    if 'patient_form_settings' in tables:
        op.drop_table('patient_form_settings')
    
    # 3. Revert medical_record_templates
    if 'medical_record_templates' in tables:
        columns = [c['name'] for c in inspector.get_columns('medical_record_templates')]
        indexes = [idx['name'] for idx in inspector.get_indexes('medical_record_templates')]
        if 'idx_medical_record_templates_type' in indexes:
            op.drop_index('idx_medical_record_templates_type', table_name='medical_record_templates')
        if 'max_photos' in columns:
            op.drop_column('medical_record_templates', 'max_photos')
        if 'template_type' in columns:
            op.drop_column('medical_record_templates', 'template_type')
    
    # 4. Revert medical_records
    if 'medical_records' in tables:
        columns = [c['name'] for c in inspector.get_columns('medical_records')]
        if 'patient_form_request_id' in columns:
            op.drop_column('medical_records', 'patient_form_request_id')
        if 'last_updated_by_patient_id' in columns:
            op.drop_column('medical_records', 'last_updated_by_patient_id')
        if 'last_updated_by_user_id' in columns:
            op.drop_column('medical_records', 'last_updated_by_user_id')
        if 'source_type' in columns:
            op.drop_column('medical_records', 'source_type')
