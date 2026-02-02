"""add_updated_at_to_patient_photos

Revision ID: dc5d1bd8abd4
Revises: 202602010000
Create Date: 2026-02-01 22:09:39.117297

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'dc5d1bd8abd4'
down_revision: Union[str, None] = '202602010000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Skip if patient_photos table does not exist (e.g. DB migrated from branch
    # where 202602010000 did not create it, or table was dropped).
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()
    if 'patient_photos' not in existing_tables:
        return

    columns = [c['name'] for c in inspector.get_columns('patient_photos')]

    if 'updated_at' not in columns:
        op.add_column('patient_photos', sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True))

    if 'updated_by_user_id' not in columns:
        op.add_column('patient_photos', sa.Column('updated_by_user_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_patient_photos_updated_by_user', 'patient_photos', 'users', ['updated_by_user_id'], ['id'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'patient_photos' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('patient_photos')]

    if 'updated_by_user_id' in columns:
        op.drop_constraint('fk_patient_photos_updated_by_user', 'patient_photos', type_='foreignkey')
        op.drop_column('patient_photos', 'updated_by_user_id')

    if 'updated_at' in columns:
        op.drop_column('patient_photos', 'updated_at')
