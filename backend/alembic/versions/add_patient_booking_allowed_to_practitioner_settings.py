"""add_patient_booking_allowed_to_practitioner_settings

Revision ID: add_patient_booking_allowed
Revises: 5cdb88eb05ab
Create Date: 2025-12-15 00:00:00.000000

Add patient_booking_allowed field to practitioner settings.
Defaults to True for all existing practitioners (backward compatibility).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'add_patient_booking_allowed'
down_revision: Union[str, None] = '5cdb88eb05ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add patient_booking_allowed field to existing practitioner settings.
    
    This migration:
    1. Updates all existing settings JSONB to include patient_booking_allowed: true
    2. Ensures backward compatibility by defaulting to True
    """
    # Update all existing settings to include patient_booking_allowed: true
    # This uses PostgreSQL JSONB operators to merge the new field
    op.execute(text("""
        UPDATE user_clinic_associations
        SET settings = settings || '{"patient_booking_allowed": true}'::jsonb
        WHERE settings IS NOT NULL
        AND (settings->>'patient_booking_allowed') IS NULL
    """))


def downgrade() -> None:
    """
    Remove patient_booking_allowed field from practitioner settings.
    
    Note: This removes the field but doesn't affect other settings.
    """
    # Remove patient_booking_allowed from all settings
    op.execute(text("""
        UPDATE user_clinic_associations
        SET settings = settings - 'patient_booking_allowed'
        WHERE settings ? 'patient_booking_allowed'
    """))

