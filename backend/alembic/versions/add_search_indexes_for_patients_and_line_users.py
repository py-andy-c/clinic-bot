"""add_search_indexes_for_patients_and_line_users

Revision ID: add_search_indexes
Revises: b2f4e9438264
Create Date: 2025-01-XX 12:00:00.000000

Add database indexes for server-side search functionality.

This migration adds indexes on searchable fields to optimize search queries:
- patients.full_name: For searching by patient name
- patients.phone_number: For searching by phone number (partial matches)
- line_users.display_name: For searching by LINE user display name

These indexes are critical for performance when searching across large datasets.
Without these indexes, search queries will perform full table scans which can
be very slow for clinics with many patients or LINE users.

Note: We don't add a standalone index on patients.phone_number because there's
already a composite index idx_patients_clinic_phone on (clinic_id, phone_number)
which can be used for phone searches when combined with clinic_id filtering.
However, for ILIKE pattern matching, a standalone index on phone_number may still
be beneficial. We'll add it for completeness, but PostgreSQL may not use it
for pattern matching (ILIKE with % wildcards) unless it's a prefix match.

For full_name and display_name, these indexes will help with prefix searches
and can be used by PostgreSQL's text search capabilities.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_search_indexes'
down_revision: Union[str, None] = 'b2f4e9438264'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add indexes for searchable fields to optimize server-side search queries.
    
    Creates indexes on:
    1. patients.full_name - For patient name searches
    2. patients.phone_number - For phone number searches (partial matches)
    3. line_users.display_name - For LINE user display name searches
    
    These indexes improve performance for ILIKE pattern matching queries
    used in the server-side search functionality.
    """
    # Check if indexes already exist (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    
    # Get existing indexes
    patients_indexes = [idx['name'] for idx in inspector.get_indexes('patients')]
    line_users_indexes = [idx['name'] for idx in inspector.get_indexes('line_users')]
    
    # 1. Add index on patients.full_name for name searches
    if 'idx_patients_full_name' not in patients_indexes:
        op.create_index(
            'idx_patients_full_name',
            'patients',
            ['full_name']
        )
        print("Created index idx_patients_full_name on patients.full_name")
    else:
        print("Index idx_patients_full_name already exists, skipping")
    
    # 2. Add index on patients.phone_number for phone searches
    # Note: There's already a composite index idx_patients_clinic_phone on (clinic_id, phone_number)
    # but a standalone index on phone_number can still help with pattern matching
    if 'idx_patients_phone_number' not in patients_indexes:
        op.create_index(
            'idx_patients_phone_number',
            'patients',
            ['phone_number']
        )
        print("Created index idx_patients_phone_number on patients.phone_number")
    else:
        print("Index idx_patients_phone_number already exists, skipping")
    
    # 3. Add index on line_users.display_name for LINE user name searches
    if 'idx_line_users_display_name' not in line_users_indexes:
        op.create_index(
            'idx_line_users_display_name',
            'line_users',
            ['display_name']
        )
        print("Created index idx_line_users_display_name on line_users.display_name")
    else:
        print("Index idx_line_users_display_name already exists, skipping")


def downgrade() -> None:
    """
    Remove search indexes.
    
    Drops the indexes created in upgrade() to revert the migration.
    """
    # Check if indexes exist before dropping (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    
    # Get existing indexes
    patients_indexes = [idx['name'] for idx in inspector.get_indexes('patients')]
    line_users_indexes = [idx['name'] for idx in inspector.get_indexes('line_users')]
    
    # Drop indexes in reverse order
    if 'idx_line_users_display_name' in line_users_indexes:
        op.drop_index('idx_line_users_display_name', table_name='line_users')
        print("Dropped index idx_line_users_display_name")
    
    if 'idx_patients_phone_number' in patients_indexes:
        op.drop_index('idx_patients_phone_number', table_name='patients')
        print("Dropped index idx_patients_phone_number")
    
    if 'idx_patients_full_name' in patients_indexes:
        op.drop_index('idx_patients_full_name', table_name='patients')
        print("Dropped index idx_patients_full_name")

