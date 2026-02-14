"""add_unique_constraint_to_appointment_types

Revision ID: 925771af4920
Revises: 018017c6a9fb
Create Date: 2026-02-13 18:57:19.118549

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '925771af4920'
down_revision: Union[str, None] = '018017c6a9fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    
    # 1. Safety Check: Handle any existing duplicates in ACTIVE records before adding constraint
    # We check for same (clinic_id, name, duration_minutes) among active records.
    # If any exist, we rename the older ones to clear the conflict.
    # This prevents the migration from failing on production data.
    conn.execute(sa.text("""
        UPDATE appointment_types at1
        SET name = name || ' (dup-cleanup-' || to_char(NOW(), 'YYYYMMDDHH24MISSUS') || ')'
        WHERE is_deleted = FALSE
        AND EXISTS (
            SELECT 1 FROM appointment_types at2
            WHERE at2.clinic_id = at1.clinic_id
            AND at2.name = at1.name
            AND at2.duration_minutes = at1.duration_minutes
            AND at2.is_deleted = FALSE
            AND at2.id < at1.id
        )
    """))

    # 2. Add unique constraint: name + duration must be unique per clinic
    inspector = Inspector.from_engine(conn)
    unique_constraints = inspector.get_unique_constraints('appointment_types')
    constraint_names = [uc['name'] for uc in unique_constraints]
    
    # Clean up old constraint name if it exists from previous attempts
    if 'uq_appointment_type_clinic_name' in constraint_names:
        op.drop_constraint('uq_appointment_type_clinic_name', 'appointment_types', type_='unique')
    
    if 'uq_appointment_type_clinic_name_duration' not in constraint_names:
        op.create_unique_constraint(
            'uq_appointment_type_clinic_name_duration', 
            'appointment_types', 
            ['clinic_id', 'name', 'duration_minutes']
        )


def downgrade() -> None:
    # Remove unique constraint from appointment_types
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    unique_constraints = inspector.get_unique_constraints('appointment_types')
    constraint_names = [uc['name'] for uc in unique_constraints]
    
    if 'uq_appointment_type_clinic_name_duration' in constraint_names:
        op.drop_constraint('uq_appointment_type_clinic_name_duration', 'appointment_types', type_='unique')
