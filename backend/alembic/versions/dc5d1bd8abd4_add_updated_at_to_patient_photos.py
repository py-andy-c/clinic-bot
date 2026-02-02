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
    # Check if columns exist before adding them to handle test environments
    # where tables might be created via Base.metadata.create_all()
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('patient_photos')]
    
    if 'updated_at' not in columns:
        op.add_column('patient_photos', sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True))
        
    if 'updated_by_user_id' not in columns:
        op.add_column('patient_photos', sa.Column('updated_by_user_id', sa.Integer(), nullable=True))
        # Add foreign key constraint for updated_by_user_id
        op.create_foreign_key('fk_patient_photos_updated_by_user', 'patient_photos', 'users', ['updated_by_user_id'], ['id'])


def downgrade() -> None:
    # Remove foreign key constraint and columns
    # We should check if they exist before dropping too, but downgrade is less common in tests
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('patient_photos')]

    if 'updated_by_user_id' in columns:
        op.drop_constraint('fk_patient_photos_updated_by_user', 'patient_photos', type_='foreignkey')
        op.drop_column('patient_photos', 'updated_by_user_id')
        
    if 'updated_at' in columns:
        op.drop_column('patient_photos', 'updated_at')
