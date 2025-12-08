"""add_clinic_notes_to_appointments

Revision ID: add_clinic_notes
Revises: add_custom_event_name
Create Date: 2025-01-08 06:45:00.000000

Add clinic_notes column to appointments table.
This enables clinics to add internal notes that are visible only to clinic users,
separate from patient-provided notes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_clinic_notes'
down_revision: Union[str, None] = 'add_custom_event_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add clinic_notes column to appointments table.
    
    This column stores clinic internal notes (備注) that are visible only to clinic users.
    This is separate from the patient-provided notes field.
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('appointments')]
    
    if 'clinic_notes' not in columns:
        op.add_column(
            'appointments',
            sa.Column(
                'clinic_notes',
                sa.String(1000),
                nullable=True,
                comment='Optional clinic internal notes (備注), visible only to clinic users. Separate from patient-provided notes.'
            )
        )


def downgrade() -> None:
    """
    Remove clinic_notes column from appointments table.
    """
    op.drop_column('appointments', 'clinic_notes')

