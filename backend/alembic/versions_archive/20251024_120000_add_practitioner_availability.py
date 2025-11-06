"""Add practitioner availability table

Revision ID: add_practitioner_availability
Revises: auth_schema_migration
Create Date: 2025-10-24 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import TIMESTAMP, Integer, Time, Boolean, ForeignKey, UniqueConstraint, func


# revision identifiers, used by Alembic.
revision = 'add_practitioner_availability'
down_revision = 'auth_schema_migration'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create practitioner_availability table
    op.create_table('practitioner_availability',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('user_id', Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('day_of_week', Integer, nullable=False),  # 0=Monday, 1=Tuesday, ..., 6=Sunday
        sa.Column('start_time', Time, nullable=False),
        sa.Column('end_time', Time, nullable=False),
        sa.Column('is_available', Boolean, default=True, nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )

    # Create constraints and indexes
    op.create_unique_constraint('uq_user_day_availability', 'practitioner_availability', ['user_id', 'day_of_week'])

    # Create indexes
    op.create_index('idx_practitioner_availability_user_id', 'practitioner_availability', ['user_id'])
    op.create_index('idx_practitioner_availability_day', 'practitioner_availability', ['day_of_week'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_practitioner_availability_day', table_name='practitioner_availability')
    op.drop_index('idx_practitioner_availability_user_id', table_name='practitioner_availability')

    # Drop constraints
    op.drop_constraint('uq_user_day_availability', 'practitioner_availability')

    # Drop table
    op.drop_table('practitioner_availability')
