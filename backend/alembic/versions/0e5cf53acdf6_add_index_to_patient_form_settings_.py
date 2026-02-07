"""add index to patient_form_settings enabled

Revision ID: 0e5cf53acdf6
Revises: ba3fab105c17
Create Date: 2026-02-07 15:57:32.602168

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0e5cf53acdf6'
down_revision: Union[str, None] = 'ba3fab105c17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if index already exists
    indexes = inspector.get_indexes('patient_form_settings')
    index_names = [idx['name'] for idx in indexes]
    
    if 'idx_patient_form_settings_apt_type_enabled' not in index_names:
        op.create_index('idx_patient_form_settings_apt_type_enabled', 'patient_form_settings', ['appointment_type_id', 'is_enabled'])


def downgrade() -> None:
    op.drop_index('idx_patient_form_settings_apt_type_enabled', table_name='patient_form_settings')
