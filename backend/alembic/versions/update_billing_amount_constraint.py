"""Update billing amount constraint to allow zero

Revision ID: update_billing_amount
Revises: 9b8c4e806631
Create Date: 2026-01-27

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'update_billing_amount'
down_revision = '9b8c4e806631'
branch_labels = None
depends_on = None


def upgrade():
    """Change amount constraint from > 0 to >= 0."""
    conn = op.get_bind()
    
    # Check if old constraint exists
    result = conn.execute(sa.text("""
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'billing_scenarios'::regclass
        AND conname = 'chk_amount_positive'
    """))
    if result.fetchone():
        op.drop_constraint('chk_amount_positive', 'billing_scenarios', type_='check')
    
    # Check if new constraint already exists
    result = conn.execute(sa.text("""
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'billing_scenarios'::regclass
        AND conname = 'chk_amount_non_negative'
    """))
    if not result.fetchone():
        op.create_check_constraint(
            'chk_amount_non_negative',
            'billing_scenarios',
            'amount >= 0'
        )


def downgrade():
    """Revert to amount > 0 constraint."""
    conn = op.get_bind()
    
    # Check if new constraint exists
    result = conn.execute(sa.text("""
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'billing_scenarios'::regclass
        AND conname = 'chk_amount_non_negative'
    """))
    if result.fetchone():
        op.drop_constraint('chk_amount_non_negative', 'billing_scenarios', type_='check')
    
    # Check if old constraint already exists
    result = conn.execute(sa.text("""
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'billing_scenarios'::regclass
        AND conname = 'chk_amount_positive'
    """))
    if not result.fetchone():
        op.create_check_constraint(
            'chk_amount_positive',
            'billing_scenarios',
            'amount > 0'
        )
