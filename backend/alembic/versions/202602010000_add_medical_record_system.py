"""Add medical record system tables

Revision ID: 202602010000
Revises: 202601281728
Create Date: 2026-02-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = '202602010000'
down_revision: Union[str, None] = '202601281728'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def index_exists(connection, table_name: str, index_name: str) -> bool:
    """Check if an index exists on a table."""
    result = connection.execute(text("""
        SELECT 1 FROM pg_indexes 
        WHERE tablename = :table AND indexname = :index
    """), {"table": table_name, "index": index_name})
    return result.fetchone() is not None


def column_exists(connection, table_name: str, column_name: str) -> bool:
    """Check if a column exists on a table."""
    result = connection.execute(text("""
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = :table AND column_name = :column
    """), {"table": table_name, "column": column_name})
    return result.fetchone() is not None


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
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default='now()'),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ),
            sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
            sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
    
    # Create indexes only if they don't exist
    if not index_exists(conn, 'medical_record_templates', 'idx_medical_record_templates_clinic'):
        op.create_index('idx_medical_record_templates_clinic', 'medical_record_templates', ['clinic_id'], unique=False)
    
    if not index_exists(conn, 'medical_record_templates', 'idx_medical_record_templates_deleted'):
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
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default='now()'),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default='now()'),
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
    
    # Create indexes only if they don't exist
    if not index_exists(conn, 'medical_records', 'idx_medical_records_appointment'):
        op.create_index('idx_medical_records_appointment', 'medical_records', ['appointment_id'], unique=False)
    if not index_exists(conn, 'medical_records', 'idx_medical_records_clinic'):
        op.create_index('idx_medical_records_clinic', 'medical_records', ['clinic_id'], unique=False)
    if not index_exists(conn, 'medical_records', 'idx_medical_records_created'):
        op.create_index('idx_medical_records_created', 'medical_records', ['created_at'], unique=False)
    if not index_exists(conn, 'medical_records', 'idx_medical_records_deleted'):
        op.create_index('idx_medical_records_deleted', 'medical_records', ['clinic_id', 'patient_id', 'is_deleted'], unique=False)
    if not index_exists(conn, 'medical_records', 'idx_medical_records_patient'):
        op.create_index('idx_medical_records_patient', 'medical_records', ['patient_id'], unique=False)
    if not index_exists(conn, 'medical_records', 'idx_medical_records_updated'):
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
            sa.Column('is_pending', sa.Boolean(), server_default='true', nullable=False),
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('deleted_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default='now()'),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column('uploaded_by_user_id', sa.Integer(), nullable=True),
            sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ),
            sa.ForeignKeyConstraint(['medical_record_id'], ['medical_records.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
            sa.ForeignKeyConstraint(['uploaded_by_user_id'], ['users.id'], ),
            sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
    
    # Create indexes only if they don't exist
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_clinic'):
        op.create_index('idx_patient_photos_clinic', 'patient_photos', ['clinic_id'], unique=False)
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_created'):
        op.create_index('idx_patient_photos_created', 'patient_photos', ['created_at'], unique=False)
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_dedup'):
        op.create_index('idx_patient_photos_dedup', 'patient_photos', ['clinic_id', 'content_hash'], unique=False)
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_deleted'):
        op.create_index('idx_patient_photos_deleted', 'patient_photos', ['clinic_id', 'is_deleted'], unique=False)
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_medical_record'):
        op.create_index('idx_patient_photos_medical_record', 'patient_photos', ['medical_record_id'], unique=False)
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_patient'):
        op.create_index('idx_patient_photos_patient', 'patient_photos', ['patient_id'], unique=False)
    if not index_exists(conn, 'patient_photos', 'idx_patient_photos_patient_record'):
        op.create_index('idx_patient_photos_patient_record', 'patient_photos', ['patient_id', 'medical_record_id'], unique=False)
    
    # Handle missing columns in existing patient_photos table
    if 'patient_photos' in existing_tables:
        if not column_exists(conn, 'patient_photos', 'updated_at'):
            op.add_column('patient_photos', sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True))
        if not column_exists(conn, 'patient_photos', 'updated_by_user_id'):
            op.add_column('patient_photos', sa.Column('updated_by_user_id', sa.Integer(), nullable=True))
            # Add foreign key constraint for the new column
            try:
                op.create_foreign_key('patient_photos_updated_by_user_id_fkey', 'patient_photos', 'users', ['updated_by_user_id'], ['id'])
            except Exception:
                # Foreign key might already exist, ignore the error
                pass


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
