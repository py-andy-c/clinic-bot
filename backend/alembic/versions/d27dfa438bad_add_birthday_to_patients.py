"""add_birthday_to_patients

Revision ID: d27dfa438bad
Revises: 1b2375d21e4f
Create Date: 2025-11-14 13:10:55.564682

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd27dfa438bad'
down_revision: Union[str, None] = '1b2375d21e4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add birthday column to patients table.
    
    This column stores the patient's birthday (date only, no time).
    It is nullable to support backward compatibility with existing patients
    and to allow clinics to optionally require birthday collection.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('patients')]
    
    if 'birthday' not in columns:
        op.add_column(
            'patients',
            sa.Column(
                'birthday',
                sa.Date(),
                nullable=True,
                comment='Patient birthday (date only). NULL means birthday not collected.'
            )
        )


def downgrade() -> None:
    """
    Remove birthday column from patients table.
    """
    op.drop_column('patients', 'birthday')
