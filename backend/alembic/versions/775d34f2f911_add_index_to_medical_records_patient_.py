"""add index to medical_records patient_form_request_id

Revision ID: 775d34f2f911
Revises: dd74401dfb16
Create Date: 2026-02-07 14:32:25.398038

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '775d34f2f911'
down_revision: Union[str, None] = 'dd74401dfb16'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if index already exists
    indexes = inspector.get_indexes('medical_records')
    index_names = [idx['name'] for idx in indexes]
    
    if 'idx_medical_records_patient_form_request' not in index_names:
        op.create_index('idx_medical_records_patient_form_request', 'medical_records', ['patient_form_request_id'])


def downgrade() -> None:
    op.drop_index('idx_medical_records_patient_form_request', table_name='medical_records')
