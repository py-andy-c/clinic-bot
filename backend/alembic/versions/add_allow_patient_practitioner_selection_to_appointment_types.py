"""add_allow_patient_practitioner_selection_to_appointment_types

Revision ID: add_practitioner_selection
Revises: add_patient_booking_allowed
Create Date: 2025-01-16 00:00:00.000000

Add allow_patient_practitioner_selection field to appointment_types table.
Defaults to True for all existing appointment types (backward compatibility).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_practitioner_selection'
down_revision: Union[str, None] = 'add_patient_booking_allowed'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add allow_patient_practitioner_selection field to appointment_types table.
    
    This migration:
    1. Adds the column with default value True
    2. Ensures backward compatibility by defaulting to True for all existing records
    """
    # Check if column already exists (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    if 'allow_patient_practitioner_selection' not in columns:
        # Add column with default value True
        op.add_column(
            'appointment_types',
            sa.Column(
                'allow_patient_practitioner_selection',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('true'),
                comment='Whether patients can specify a practitioner when booking. Default: true.'
            )
        )


def downgrade() -> None:
    """
    Remove allow_patient_practitioner_selection field from appointment_types table.
    """
    op.drop_column('appointment_types', 'allow_patient_practitioner_selection')

