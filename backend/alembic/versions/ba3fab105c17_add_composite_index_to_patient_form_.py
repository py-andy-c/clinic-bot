"""add composite index to patient_form_requests

Revision ID: ba3fab105c17
Revises: 775d34f2f911
Create Date: 2026-02-07 15:30:10.698488

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ba3fab105c17'
down_revision: Union[str, None] = '775d34f2f911'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if index already exists
    indexes = inspector.get_indexes('patient_form_requests')
    index_names = [idx['name'] for idx in indexes]
    
    if 'idx_patient_form_requests_patient_status' not in index_names:
        op.create_index('idx_patient_form_requests_patient_status', 'patient_form_requests', ['clinic_id', 'patient_id', 'status'])


def downgrade() -> None:
    op.drop_index('idx_patient_form_requests_patient_status', table_name='patient_form_requests')
