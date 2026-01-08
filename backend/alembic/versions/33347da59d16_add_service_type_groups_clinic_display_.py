"""add_service_type_groups_clinic_display_order_index

Revision ID: 33347da59d16
Revises: 571ddb1af54d
Create Date: 2026-01-08 00:06:07.184989

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '33347da59d16'
down_revision: Union[str, None] = '571ddb1af54d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add index for service_type_groups clinic_id and display_order for bulk query performance."""
    # Check if index already exists (might be created by SQLAlchemy model definition)
    conn = op.get_bind()
    inspector = inspect(conn)

    indexes = [idx['name'] for idx in inspector.get_indexes('service_type_groups')]
    if 'idx_service_type_groups_clinic_display_order' not in indexes:
        # Add index for service_type_groups(clinic_id, display_order) - optimizes ORDER BY in bulk query
        op.create_index(
            'idx_service_type_groups_clinic_display_order',
            'service_type_groups',
            ['clinic_id', 'display_order'],
            unique=False
        )


def downgrade() -> None:
    """Remove the service_type_groups clinic display order index."""
    op.drop_index('idx_service_type_groups_clinic_display_order', table_name='service_type_groups')
