"""add_appointment_notes_customization

Revision ID: add_notes_customization
Revises: add_msg_customization
Create Date: 2025-01-29 12:00:00.000000

Add appointment notes customization:
- Add require_notes boolean flag (default: false)
- Add notes_instructions text field (nullable, default: null)
- All existing appointment types get defaults: require_notes=false, notes_instructions=null
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_notes_customization'
down_revision: Union[str, None] = 'add_msg_customization'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add appointment notes customization fields.
    
    This migration:
    1. Adds require_notes boolean column (default: false)
    2. Adds notes_instructions text column (nullable, default: null)
    3. All existing appointment types get defaults (no data migration needed)
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    # Step 1: Add require_notes boolean column
    if 'require_notes' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('require_notes', sa.Boolean(), nullable=False, server_default=sa.false())
        )
    
    # Step 2: Add notes_instructions text column (nullable)
    if 'notes_instructions' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('notes_instructions', sa.Text(), nullable=True)
        )


def downgrade() -> None:
    """Remove appointment notes customization fields."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    # Remove notes_instructions column
    if 'notes_instructions' in columns:
        op.drop_column('appointment_types', 'notes_instructions')
    
    # Remove require_notes column
    if 'require_notes' in columns:
        op.drop_column('appointment_types', 'require_notes')

