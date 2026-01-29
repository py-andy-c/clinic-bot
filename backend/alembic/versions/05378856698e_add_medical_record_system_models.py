"""Add medical record system models

Revision ID: 05378856698e
Revises: 202601281728
Create Date: 2026-01-29 07:50:02.064698

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '05378856698e'
down_revision: Union[str, None] = '202601281728'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Get current tables to avoid conflicts with "noisy" baseline migrations
    # that use Base.metadata.create_all()
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'medical_record_templates' not in existing_tables:
        op.create_table('medical_record_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('header_fields', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('workspace_config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_medical_record_templates_clinic_id'), 'medical_record_templates', ['clinic_id'], unique=False)
        op.create_index(op.f('ix_medical_record_templates_id'), 'medical_record_templates', ['id'], unique=False)
    
    if 'medical_records' not in existing_tables:
        op.create_table('medical_records',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('patient_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('template_id', sa.Integer(), nullable=True),
        sa.Column('header_structure', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('header_values', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('workspace_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['template_id'], ['medical_record_templates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_medical_records_clinic_id'), 'medical_records', ['clinic_id'], unique=False)
        op.create_index(op.f('ix_medical_records_id'), 'medical_records', ['id'], unique=False)
        op.create_index(op.f('ix_medical_records_patient_id'), 'medical_records', ['patient_id'], unique=False)
    
    if 'medical_record_media' not in existing_tables:
        op.create_table('medical_record_media',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('record_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('file_path', sa.String(length=512), nullable=False),
        sa.Column('file_type', sa.String(length=50), nullable=False),
        sa.Column('original_filename', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['record_id'], ['medical_records.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('file_path')
        )
        op.create_index(op.f('ix_medical_record_media_id'), 'medical_record_media', ['id'], unique=False)
        op.create_index(op.f('ix_medical_record_media_record_id'), 'medical_record_media', ['record_id'], unique=False)
        op.create_index(op.f('ix_medical_record_media_clinic_id'), 'medical_record_media', ['clinic_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_medical_record_media_record_id'), table_name='medical_record_media')
    op.drop_index(op.f('ix_medical_record_media_id'), table_name='medical_record_media')
    op.drop_table('medical_record_media')
    op.drop_index(op.f('ix_medical_records_patient_id'), table_name='medical_records')
    op.drop_index(op.f('ix_medical_records_id'), table_name='medical_records')
    op.drop_index(op.f('ix_medical_records_clinic_id'), table_name='medical_records')
    op.drop_table('medical_records')
    op.drop_index(op.f('ix_medical_record_templates_id'), table_name='medical_record_templates')
    op.drop_index(op.f('ix_medical_record_templates_clinic_id'), table_name='medical_record_templates')
    op.drop_table('medical_record_templates')
