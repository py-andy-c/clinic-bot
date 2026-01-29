"""sync medical_record_media schema

Revision ID: f1c5c7fdb2a1
Revises: 0fa4fea4113d
Create Date: 2026-01-29 13:41:57.970482

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1c5c7fdb2a1'
down_revision: Union[str, None] = '0fa4fea4113d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('medical_record_media')]

    # 1. Rename s3_key to file_path if it exists
    if 's3_key' in columns and 'file_path' not in columns:
        op.alter_column('medical_record_media', 's3_key', new_column_name='file_path')
        op.drop_constraint('medical_record_media_s3_key_key', 'medical_record_media', type_='unique')
        op.create_unique_constraint('medical_record_media_file_path_key', 'medical_record_media', ['file_path'])
    
    # Refresh columns after rename
    columns = [c['name'] for c in inspector.get_columns('medical_record_media')]

    # 2. Add missing columns
    if 'clinic_id' not in columns:
        # We need a default clinic_id for existing rows. 
        # Since this table is likely empty or small in dev, we'll use a placeholder or 
        # better, try to fetch it from the related medical_record.
        op.add_column('medical_record_media', sa.Column('clinic_id', sa.Integer(), nullable=True))
        # Update clinic_id from medical_records
        op.execute("UPDATE medical_record_media SET clinic_id = (SELECT clinic_id FROM medical_records WHERE medical_records.id = medical_record_media.record_id)")
        op.alter_column('medical_record_media', 'clinic_id', nullable=False)
        op.create_index(op.f('ix_medical_record_media_clinic_id'), 'medical_record_media', ['clinic_id'], unique=False)

    if 'url' not in columns:
        op.add_column('medical_record_media', sa.Column('url', sa.String(length=1024), nullable=True))
        # For existing rows, we can't easily reconstruct the URL without knowing the bucket/domain,
        # but we can set it to the file_path as a fallback.
        op.execute("UPDATE medical_record_media SET url = file_path")
        op.alter_column('medical_record_media', 'url', nullable=False)

    if 'original_filename' not in columns:
        op.add_column('medical_record_media', sa.Column('original_filename', sa.String(length=255), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('medical_record_media')]

    if 'original_filename' in columns:
        op.drop_column('medical_record_media', 'original_filename')
    
    if 'url' in columns:
        op.drop_column('medical_record_media', 'url')

    if 'clinic_id' in columns:
        op.drop_index(op.f('ix_medical_record_media_clinic_id'), table_name='medical_record_media')
        op.drop_column('medical_record_media', 'clinic_id')

    if 'file_path' in columns:
        op.alter_column('medical_record_media', 'file_path', new_column_name='s3_key')
        op.drop_constraint('medical_record_media_file_path_key', 'medical_record_media', type_='unique')
        op.create_unique_constraint('medical_record_media_s3_key_key', 'medical_record_media', ['s3_key'])
