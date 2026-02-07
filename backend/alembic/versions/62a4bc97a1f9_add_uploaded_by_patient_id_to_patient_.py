"""add_uploaded_by_patient_id_to_patient_photos

Revision ID: 62a4bc97a1f9
Revises: add_patient_forms_system
Create Date: 2026-02-07 20:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '62a4bc97a1f9'
down_revision: Union[str, None] = 'add_patient_forms_system'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('patient_photos')]
    if 'uploaded_by_patient_id' not in columns:
        op.add_column('patient_photos', sa.Column('uploaded_by_patient_id', sa.Integer(), sa.ForeignKey('patients.id'), nullable=True))
        op.create_index('idx_patient_photos_uploaded_by_patient', 'patient_photos', ['uploaded_by_patient_id'])


def downgrade() -> None:
    op.drop_index('idx_patient_photos_uploaded_by_patient', table_name='patient_photos')
    op.drop_column('patient_photos', 'uploaded_by_patient_id')
