"""fix_calendar_time_range_constraint

Revision ID: b7745d01aa46
Revises: 63c6a541e10d
Create Date: 2025-11-03 23:08:25.573879

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7745d01aa46'
down_revision: Union[str, None] = '63c6a541e10d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite doesn't support dropping constraints directly, so we need to recreate the table
    # Use batch mode to handle this properly
    with op.batch_alter_table('calendar_events') as batch_op:
        # Drop the old constraint (this works in batch mode)
        batch_op.drop_constraint('check_valid_time_range', type_='check')

        # Add the new constraint that allows midnight-spanning appointments
        batch_op.create_check_constraint(
            'check_valid_time_range',
            "start_time IS NULL OR end_time IS NULL OR start_time != end_time"
        )


def downgrade() -> None:
    # Use batch mode for consistency
    with op.batch_alter_table('calendar_events') as batch_op:
        # Drop the new constraint
        batch_op.drop_constraint('check_valid_time_range', type_='check')

        # Restore the old restrictive constraint
        batch_op.create_check_constraint(
            'check_valid_time_range',
            "start_time IS NULL OR end_time IS NULL OR start_time < end_time"
        )
