"""Add medical record system tables

Revision ID: 202602010000
Revises: 202601281728
Create Date: 2026-02-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '202602010000'
down_revision: Union[str, None] = '202601281728'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if tables exist before creating to avoid conflicts in test environment
    # where Base.metadata.create_all() might have already created them via initial_schema_baseline
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # 1. Create medical_record_templates table
    if 'medical_record_templates' not in existing_tables:
        op.create_table(
            'medical_record_templates',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=True),
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ),
            sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
            sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('idx_medical_record_templates_clinic', 'medical_record_templates', ['clinic_id'], unique=False)
        op.create_index('idx_medical_record_templates_deleted', 'medical_record_templates', ['clinic_id', 'is_deleted'], unique=False)

    # 2. Create medical_records table
    if 'medical_records' not in existing_tables:
        op.create_table(
            'medical_records',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('patient_id', sa.Integer(), nullable=False),
            sa.Column('template_id', sa.Integer(), nullable=False),
            sa.Column('template_name', sa.String(length=255), nullable=False),
            sa.Column('appointment_id', sa.Integer(), nullable=True),
            sa.Column('template_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column('values', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=True),
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['appointment_id'], ['appointments.calendar_event_id'], ),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ),
            sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
            sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
            sa.ForeignKeyConstraint(['template_id'], ['medical_record_templates.id'], ),
            sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('idx_medical_records_appointment', 'medical_records', ['appointment_id'], unique=False)
        op.create_index('idx_medical_records_clinic', 'medical_records', ['clinic_id'], unique=False)
        op.create_index('idx_medical_records_created', 'medical_records', ['created_at'], unique=False)
        op.create_index('idx_medical_records_deleted', 'medical_records', ['clinic_id', 'patient_id', 'is_deleted'], unique=False)
        op.create_index('idx_medical_records_patient', 'medical_records', ['patient_id'], unique=False)
        op.create_index('idx_medical_records_updated', 'medical_records', ['clinic_id', 'updated_at'], unique=False)

    # 3. Create patient_photos table
    if 'patient_photos' not in existing_tables:
        op.create_table(
            'patient_photos',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('patient_id', sa.Integer(), nullable=False),
            sa.Column('medical_record_id', sa.Integer(), nullable=True),
            sa.Column('filename', sa.String(length=255), nullable=False),
            sa.Column('storage_key', sa.String(length=512), nullable=False),
            sa.Column('thumbnail_key', sa.String(length=512), nullable=True),
            sa.Column('content_hash', sa.String(length=64), nullable=True),
            sa.Column('content_type', sa.String(length=100), nullable=False),
            sa.Column('size_bytes', sa.Integer(), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('is_pending', sa.Boolean(), server_default='true', nullable=True),
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=True),
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.Column('uploaded_by_user_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ),
            sa.ForeignKeyConstraint(['medical_record_id'], ['medical_records.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
            sa.ForeignKeyConstraint(['uploaded_by_user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('idx_patient_photos_clinic', 'patient_photos', ['clinic_id'], unique=False)
        op.create_index('idx_patient_photos_created', 'patient_photos', ['created_at'], unique=False)
        op.create_index('idx_patient_photos_dedup', 'patient_photos', ['clinic_id', 'content_hash'], unique=False)
        op.create_index('idx_patient_photos_deleted', 'patient_photos', ['clinic_id', 'is_deleted'], unique=False)
        op.create_index('idx_patient_photos_medical_record', 'patient_photos', ['medical_record_id'], unique=False)
        op.create_index('idx_patient_photos_patient', 'patient_photos', ['patient_id'], unique=False)
        op.create_index('idx_patient_photos_patient_record', 'patient_photos', ['patient_id', 'medical_record_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_patient_photos_patient_record', table_name='patient_photos')
    op.drop_index('idx_patient_photos_patient', table_name='patient_photos')
    op.drop_index('idx_patient_photos_medical_record', table_name='patient_photos')
    op.drop_index('idx_patient_photos_deleted', table_name='patient_photos')
    op.drop_index('idx_patient_photos_dedup', table_name='patient_photos')
    op.drop_index('idx_patient_photos_created', table_name='patient_photos')
    op.drop_index('idx_patient_photos_clinic', table_name='patient_photos')
    op.drop_table('patient_photos')

    op.drop_index('idx_medical_records_updated', table_name='medical_records')
    op.drop_index('idx_medical_records_patient', table_name='medical_records')
    op.drop_index('idx_medical_records_deleted', table_name='medical_records')
    op.drop_index('idx_medical_records_created', table_name='medical_records')
    op.drop_index('idx_medical_records_clinic', table_name='medical_records')
    op.drop_index('idx_medical_records_appointment', table_name='medical_records')
    op.drop_table('medical_records')

    op.drop_index('idx_medical_record_templates_deleted', table_name='medical_record_templates')
    op.drop_index('idx_medical_record_templates_clinic', table_name='medical_record_templates')
    op.drop_table('medical_record_templates')
