"""Add processing status to scheduled_line_messages

Revision ID: 202602150000
Revises: 202602140000
Create Date: 2026-02-15 00:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '202602150000'
down_revision = '202602140000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old constraint
    op.drop_constraint('check_status', 'scheduled_line_messages', type_='check')
    
    # Add the new constraint with 'processing' status
    op.create_check_constraint(
        'check_status',
        'scheduled_line_messages',
        "status IN ('pending', 'processing', 'sent', 'skipped', 'failed')"
    )


def downgrade() -> None:
    # Drop the new constraint
    op.drop_constraint('check_status', 'scheduled_line_messages', type_='check')
    
    # Restore the old constraint
    op.create_check_constraint(
        'check_status',
        'scheduled_line_messages',
        "status IN ('pending', 'sent', 'skipped', 'failed')"
    )
