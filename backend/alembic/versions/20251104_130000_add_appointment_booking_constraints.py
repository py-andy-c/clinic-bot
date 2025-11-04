"""add appointment booking constraints

Revision ID: 20251104130000
Revises: 20251104120000
Create Date: 2025-11-04 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20251104130000'
down_revision: Union[str, None] = '20251104120000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add unique constraint to prevent overlapping appointments
    # This creates a partial unique index for appointment time slots
    op.execute("""
        CREATE UNIQUE INDEX uq_appointment_time_slot
        ON calendar_events (user_id, date, start_time)
        WHERE event_type = 'appointment'
    """)


def downgrade() -> None:
    # Remove the unique constraint
    op.execute("DROP INDEX IF EXISTS uq_appointment_time_slot")
