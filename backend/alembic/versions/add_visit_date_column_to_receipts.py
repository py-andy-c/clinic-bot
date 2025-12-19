"""add_visit_date_column_to_receipts

Revision ID: add_visit_date_column
Revises: cff1fda3874f
Create Date: 2025-12-19 10:28:19.525000

Add visit_date column to receipts table for efficient date filtering.
- Add visit_date column (TIMESTAMP WITH TIME ZONE, nullable initially)
- Backfill from receipt_data->>'visit_date', with fallback to issue_date
- Add index on visit_date
- Update receipt creation to populate visit_date column
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_visit_date_column'
down_revision: Union[str, None] = 'add_resource_constraints'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add visit_date column to receipts table.
    
    This migration:
    1. Adds visit_date column (nullable initially for backfill)
    2. Backfills visit_date from receipt_data JSONB, with fallback to issue_date
       (matches extractor's fallback logic for consistency)
    3. Adds index on visit_date for efficient queries
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if receipts table exists
    tables = inspector.get_table_names()
    if 'receipts' not in tables:
        # Receipts table doesn't exist yet, skip this migration
        return
    
    # Check if visit_date column already exists
    columns = [col['name'] for col in inspector.get_columns('receipts')]
    if 'visit_date' in columns:
        # Column already exists, skip
        return
    
    # Step 1: Add visit_date column (nullable initially)
    op.add_column(
        'receipts',
        sa.Column('visit_date', sa.TIMESTAMP(timezone=True), nullable=True)
    )
    
    # Step 2: Backfill from receipt_data JSONB, then fallback to issue_date
    # Extract visit_date from receipt_data->>'visit_date', or use issue_date as fallback
    # This matches the extractor's fallback logic for consistency
    op.execute("""
        UPDATE receipts
        SET visit_date = COALESCE(
            CASE 
                WHEN receipt_data->>'visit_date' IS NOT NULL 
                 AND receipt_data->>'visit_date' != ''
                 AND (receipt_data->>'visit_date')::timestamp with time zone IS NOT NULL
                THEN (receipt_data->>'visit_date')::timestamp with time zone
                ELSE NULL
            END,
            issue_date  -- Fallback to issue_date if visit_date is missing/invalid
        )
        WHERE visit_date IS NULL
    """)
    
    # Step 3: Add index on visit_date for efficient queries
    op.create_index(
        'idx_receipts_visit_date',
        'receipts',
        ['visit_date']
    )


def downgrade() -> None:
    """Remove visit_date column and index."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if receipts table exists
    tables = inspector.get_table_names()
    if 'receipts' not in tables:
        return
    
    # Check if visit_date column exists
    columns = [col['name'] for col in inspector.get_columns('receipts')]
    if 'visit_date' not in columns:
        return
    
    # Drop index first
    indexes = [idx['name'] for idx in inspector.get_indexes('receipts')]
    if 'idx_receipts_visit_date' in indexes:
        op.drop_index('idx_receipts_visit_date', 'receipts')
    
    # Drop column
    op.drop_column('receipts', 'visit_date')

