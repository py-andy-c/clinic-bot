"""add_service_type_grouping_and_ordering

Revision ID: add_service_type_grouping
Revises: add_visit_date_column
Create Date: 2025-01-28 12:00:00.000000

Add service type grouping and ordering:
- Create service_type_groups table
- Add service_type_group_id and display_order to appointment_types
- Set display_order for existing services based on id
- Leave service_type_group_id as NULL for all existing services
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_service_type_grouping'
down_revision: Union[str, None] = 'add_visit_date_column'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add service type grouping and ordering.
    
    This migration:
    1. Creates service_type_groups table (similar to resource_types)
    2. Adds service_type_group_id FK to appointment_types (nullable)
    3. Adds display_order to appointment_types
    4. Sets display_order for existing services based on id
    5. Leaves service_type_group_id as NULL for all existing services
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    # Step 1: Create service_type_groups table
    if 'service_type_groups' not in tables:
        op.create_table(
            'service_type_groups',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('clinic_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('clinic_id', 'name', name='uq_service_type_group_clinic_name')
        )
        op.create_index(op.f('ix_service_type_groups_id'), 'service_type_groups', ['id'], unique=False)
        op.create_index(op.f('ix_service_type_groups_clinic_id'), 'service_type_groups', ['clinic_id'], unique=False)
        # Composite index for ordering groups
        op.create_index('idx_service_type_groups_clinic_order', 'service_type_groups', ['clinic_id', 'display_order'], unique=False)
    
    # Step 2: Add service_type_group_id to appointment_types
    if 'appointment_types' in tables:
        columns = [col['name'] for col in inspector.get_columns('appointment_types')]
        
        if 'service_type_group_id' not in columns:
            op.add_column(
                'appointment_types',
                sa.Column('service_type_group_id', sa.Integer(), nullable=True)
            )
            # Add foreign key constraint with CASCADE to NULL
            op.create_foreign_key(
                'fk_appointment_types_service_type_group_id',
                'appointment_types',
                'service_type_groups',
                ['service_type_group_id'],
                ['id'],
                ondelete='SET NULL'
            )
            # Add index for filtering by group
            op.create_index(
                'idx_appointment_types_group_id',
                'appointment_types',
                ['service_type_group_id']
            )
            # Composite index for filtered ordering queries
            op.create_index(
                'idx_appointment_types_clinic_group_order',
                'appointment_types',
                ['clinic_id', 'service_type_group_id', 'display_order']
            )
        
        # Step 3: Add display_order to appointment_types
        if 'display_order' not in columns:
            op.add_column(
                'appointment_types',
                sa.Column('display_order', sa.Integer(), nullable=False, server_default='0')
            )
            # Set display_order for existing services based on id (preserve implicit order)
            op.execute("""
                UPDATE appointment_types 
                SET display_order = id 
                WHERE display_order = 0
            """)
            # Add index for ordering queries
            op.create_index(
                'idx_appointment_types_clinic_order',
                'appointment_types',
                ['clinic_id', 'display_order']
            )


def downgrade() -> None:
    """Remove service type grouping and ordering."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' in tables:
        columns = [col['name'] for col in inspector.get_columns('appointment_types')]
        
        # Remove display_order
        if 'display_order' in columns:
            indexes = [idx['name'] for idx in inspector.get_indexes('appointment_types')]
            if 'idx_appointment_types_clinic_order' in indexes:
                op.drop_index('idx_appointment_types_clinic_order', table_name='appointment_types')
            op.drop_column('appointment_types', 'display_order')
        
        # Remove service_type_group_id
        if 'service_type_group_id' in columns:
            indexes = [idx['name'] for idx in inspector.get_indexes('appointment_types')]
            if 'idx_appointment_types_clinic_group_order' in indexes:
                op.drop_index('idx_appointment_types_clinic_group_order', table_name='appointment_types')
            if 'idx_appointment_types_group_id' in indexes:
                op.drop_index('idx_appointment_types_group_id', table_name='appointment_types')
            
            # Drop foreign key constraint
            op.drop_constraint('fk_appointment_types_service_type_group_id', 'appointment_types', type_='foreignkey')
            op.drop_column('appointment_types', 'service_type_group_id')
    
    # Drop service_type_groups table
    if 'service_type_groups' in tables:
        indexes = [idx['name'] for idx in inspector.get_indexes('service_type_groups')]
        if 'idx_service_type_groups_clinic_order' in indexes:
            op.drop_index('idx_service_type_groups_clinic_order', table_name='service_type_groups')
        op.drop_index(op.f('ix_service_type_groups_clinic_id'), table_name='service_type_groups')
        op.drop_index(op.f('ix_service_type_groups_id'), table_name='service_type_groups')
        op.drop_table('service_type_groups')

