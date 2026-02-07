"""add_constraints_to_medical_record_templates

Revision ID: 3e526ece80c3
Revises: 62a4bc97a1f9
Create Date: 2026-02-07 21:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3e526ece80c3'
down_revision: Union[str, None] = '62a4bc97a1f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add check constraints to medical_record_templates
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    constraints = inspector.get_check_constraints('medical_record_templates')
    constraint_names = [c['name'] for c in constraints]

    if 'check_template_type' not in constraint_names:
        op.create_check_constraint(
            'check_template_type',
            'medical_record_templates',
            "template_type IN ('medical_record', 'patient_form')"
        )
    if 'check_max_photos' not in constraint_names:
        op.create_check_constraint(
            'check_max_photos',
            'medical_record_templates',
            "max_photos >= 0 AND max_photos <= 20"
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    constraints = inspector.get_check_constraints('medical_record_templates')
    constraint_names = [c['name'] for c in constraints]

    if 'check_max_photos' in constraint_names:
        op.drop_constraint('check_max_photos', 'medical_record_templates', type_='check')
    if 'check_template_type' in constraint_names:
        op.drop_constraint('check_template_type', 'medical_record_templates', type_='check')
