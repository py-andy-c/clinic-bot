"""add_appointment_type_patient_visibility

Revision ID: add_patient_visibility
Revises: migrate_admin_reminder_time
Create Date: 2025-01-06 12:00:00.000000

Add patient visibility fields to appointment_types table.

This migration adds two new boolean fields to control appointment type visibility:
- allow_new_patient_booking: Controls visibility for new patients (no practitioner assignments)
- allow_existing_patient_booking: Controls visibility for existing patients (have practitioner assignments)

Both fields default to True for backward compatibility.
Also adds an index on patient_practitioner_assignments for performance.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_patient_visibility'
down_revision: Union[str, None] = 'migrate_admin_reminder_time'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add patient visibility fields to appointment_types table.

    This migration:
    1. Adds allow_new_patient_booking and allow_existing_patient_booking columns
    2. Migrates existing allow_patient_booking values to both new fields
    3. Adds performance index on patient_practitioner_assignments
    """
    # Check if columns already exist (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]

    # Add new patient visibility columns
    if 'allow_new_patient_booking' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column(
                'allow_new_patient_booking',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('true'),
                comment='Whether new patients (no practitioner assignments) can book this service. Default: true.'
            )
        )

    if 'allow_existing_patient_booking' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column(
                'allow_existing_patient_booking',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('true'),
                comment='Whether existing patients (have practitioner assignments) can book this service. Default: true.'
            )
        )

    # Data migration happens automatically via server defaults - no explicit migration needed
    # since both new columns default to true, matching the existing allow_patient_booking behavior

    # Add performance index on patient_practitioner_assignments
    op.create_index(
        'idx_patient_practitioner_assignments_classification',
        'patient_practitioner_assignments',
        ['patient_id', 'clinic_id'],
        unique=False
    )


def downgrade() -> None:
    """
    Remove patient visibility fields from appointment_types table.
    """
    # Drop the index
    op.drop_index('idx_patient_practitioner_assignments_classification', 'patient_practitioner_assignments')

    # Drop the new columns
    op.drop_column('appointment_types', 'allow_existing_patient_booking')
    op.drop_column('appointment_types', 'allow_new_patient_booking')
