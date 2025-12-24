"""add_gender_to_patients

Revision ID: add_gender_to_patients
Revises: add_notes_customization
Create Date: 2025-01-30 12:00:00.000000

Add gender column to patients table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_gender_to_patients'
down_revision: Union[str, None] = 'add_notes_customization'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add gender column to patients table.
    
    This column stores the patient's gender (生理性別).
    It is nullable to support backward compatibility with existing patients
    and to allow clinics to optionally require gender collection.
    Valid values: 'male', 'female', 'other', or NULL.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('patients')]
    
    if 'gender' not in columns:
        op.add_column(
            'patients',
            sa.Column(
                'gender',
                sa.String(20),
                nullable=True,
                comment='Patient gender (生理性別). Valid values: male, female, other. NULL means gender not collected.'
            )
        )
        # Add CHECK constraint to enforce valid gender values at database level
        op.create_check_constraint(
            'check_valid_gender',
            'patients',
            "gender IS NULL OR gender IN ('male', 'female', 'other')"
        )


def downgrade() -> None:
    """
    Remove gender column from patients table.
    """
    # Drop constraint first, then column
    try:
        op.drop_constraint('check_valid_gender', 'patients', type_='check')
    except Exception:
        # Constraint might not exist if migration was partially applied
        pass
    op.drop_column('patients', 'gender')

