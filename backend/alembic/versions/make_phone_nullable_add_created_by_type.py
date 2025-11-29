"""make_phone_nullable_add_created_by_type

Revision ID: make_phone_nullable_type
Revises: 4d8177af9cf1
Create Date: 2025-01-28 12:00:00.000000

Make phone_number nullable and add created_by_type field to patients table.

This migration:
1. Makes phone_number nullable to allow clinic users to create patients without phone numbers
2. Adds created_by_type field to track whether patient was created by LINE user or clinic user
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
# Note: Tuple format is correct for merging multiple migration heads (parallel branches)
revision: str = 'make_phone_nullable_type'
down_revision: Union[str, None] = ('add_search_indexes', '4d8177af9cf1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Make phone_number nullable and add created_by_type field.
    
    This allows:
    - Clinic users to create patients without phone numbers (walk-ins, etc.)
    - Tracking of patient creation source (LINE user vs clinic user) for analytics
    """
    # Check if columns already exist (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('patients')]
    
    # 1. Make phone_number nullable
    if 'phone_number' in columns:
        # Get current column info
        phone_col = next(col for col in inspector.get_columns('patients') if col['name'] == 'phone_number')
        if not phone_col['nullable']:
            # Alter column to be nullable
            op.alter_column(
                'patients',
                'phone_number',
                existing_type=sa.String(50),
                nullable=True,
                existing_nullable=False
            )
            print("Made phone_number nullable")
        else:
            print("phone_number is already nullable, skipping")
    
    # 2. Add created_by_type column
    if 'created_by_type' not in columns:
        op.add_column(
            'patients',
            sa.Column(
                'created_by_type',
                sa.String(20),
                nullable=False,
                server_default='line_user',
                comment='Source of patient creation: line_user or clinic_user'
            )
        )
        print("Added created_by_type column")
        
        # Update existing records: set to 'line_user' for all existing patients
        # (all current patients were created via LINE)
        op.execute("""
            UPDATE patients 
            SET created_by_type = 'line_user'
            WHERE created_by_type IS NULL OR created_by_type = ''
        """)
        print("Updated existing patients to created_by_type = 'line_user'")
    else:
        print("created_by_type column already exists, skipping")


def downgrade() -> None:
    """
    Revert changes: make phone_number required and remove created_by_type.
    
    Note: This will fail if there are any NULL phone_number values.
    """
    # Check if columns exist
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('patients')]
    
    # 1. Remove created_by_type column
    if 'created_by_type' in columns:
        op.drop_column('patients', 'created_by_type')
        print("Dropped created_by_type column")
    
    # 2. Make phone_number required (NOT NULL)
    # Note: This will fail if there are any NULL values
    if 'phone_number' in columns:
        phone_col = next(col for col in inspector.get_columns('patients') if col['name'] == 'phone_number')
        if phone_col['nullable']:
            # First, set any NULL phone_numbers to a default value
            # Use a placeholder that indicates missing phone
            op.execute("""
                UPDATE patients 
                SET phone_number = '' 
                WHERE phone_number IS NULL
            """)
            
            # Then make it NOT NULL
            op.alter_column(
                'patients',
                'phone_number',
                existing_type=sa.String(50),
                nullable=False,
                existing_nullable=True
            )
            print("Made phone_number required (NOT NULL)")

