"""add_patient_form_request_id_to_patient_photos

Revision ID: dd74401dfb16
Revises: 3e526ece80c3
Create Date: 2026-02-07 21:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd74401dfb16'
down_revision: Union[str, None] = '3e526ece80c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add patient_form_request_id to patient_photos
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('patient_photos')]
    
    if 'patient_form_request_id' not in columns:
        op.add_column('patient_photos', sa.Column('patient_form_request_id', sa.Integer(), sa.ForeignKey('patient_form_requests.id', ondelete='SET NULL'), nullable=True))
        op.create_index('idx_patient_photos_patient_form_request', 'patient_photos', ['patient_form_request_id'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('patient_photos')]
    
    if 'patient_form_request_id' in columns:
        op.drop_index('idx_patient_photos_patient_form_request', table_name='patient_photos')
        op.drop_column('patient_photos', 'patient_form_request_id')
