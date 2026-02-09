"""Add patient_form fields to templates and records

Revision ID: 018017c6a9fb
Revises: dc5d1bd8abd4
Create Date: 2026-02-09 15:32:51.546682

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '018017c6a9fb'
down_revision: Union[str, None] = 'dc5d1bd8abd4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(connection, table_name: str, column_name: str) -> bool:
    """Check if a column exists on a table."""
    result = connection.execute(text("""
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = :table AND column_name = :column
    """), {"table": table_name, "column": column_name})
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()
    
    # Add is_patient_form to medical_record_templates if it doesn't exist
    if not column_exists(conn, 'medical_record_templates', 'is_patient_form'):
        op.add_column('medical_record_templates', sa.Column('is_patient_form', sa.Boolean(), server_default='false', nullable=False))
    
    # Add fields to medical_records if they don't exist
    if not column_exists(conn, 'medical_records', 'patient_last_edited_at'):
        op.add_column('medical_records', sa.Column('patient_last_edited_at', sa.TIMESTAMP(timezone=True), nullable=True))
    if not column_exists(conn, 'medical_records', 'is_submitted'):
        op.add_column('medical_records', sa.Column('is_submitted', sa.Boolean(), server_default='false', nullable=False))
    
    # Add composite index for efficient patient form queries
    # This optimizes queries like: WHERE clinic_id = ? AND is_patient_form = true AND is_deleted = false
    try:
        op.create_index(
            'idx_medical_record_templates_patient_form',
            'medical_record_templates',
            ['clinic_id', 'is_patient_form', 'is_deleted']
        )
    except Exception:
        # Index might already exist, ignore the error
        pass


def downgrade() -> None:
    # Remove index
    try:
        op.drop_index('idx_medical_record_templates_patient_form', table_name='medical_record_templates')
    except Exception:
        # Index might not exist, ignore the error
        pass
    
    # Remove fields from medical_records
    op.drop_column('medical_records', 'is_submitted')
    op.drop_column('medical_records', 'patient_last_edited_at')
    
    # Remove is_patient_form from medical_record_templates
    op.drop_column('medical_record_templates', 'is_patient_form')
