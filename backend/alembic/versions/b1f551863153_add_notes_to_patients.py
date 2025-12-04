"""add_notes_to_patients

Revision ID: b1f551863153
Revises: make_phone_nullable_type
Create Date: 2025-12-04 07:04:42.005430

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1f551863153'
down_revision: Union[str, None] = 'make_phone_nullable_type'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add notes (備注) column to patients table.
    
    This column stores optional notes/remarks about the patient.
    It is nullable to support backward compatibility with existing patients.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('patients')]
    
    if 'notes' not in columns:
        op.add_column(
            'patients',
            sa.Column(
                'notes',
                sa.Text(),
                nullable=True,
                comment='Optional notes/remarks about the patient (備注)'
            )
        )


def downgrade() -> None:
    """
    Remove notes column from patients table.
    """
    op.drop_column('patients', 'notes')
