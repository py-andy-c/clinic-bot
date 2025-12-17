"""add_facility_resource_constraints

Revision ID: add_resource_constraints
Revises: add_practitioner_selection
Create Date: 2025-01-28 00:00:00.000000

Add facility resource constraints system:
- resource_types table (categories of resources)
- resources table (individual resource instances)
- appointment_resource_requirements table (resource requirements per appointment type)
- appointment_resource_allocations table (resource allocations to appointments)

This enables clinics to manage facility resources (e.g., treatment rooms, equipment)
and automatically allocate them when creating appointments.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_resource_constraints'
down_revision: Union[str, None] = 'add_title_uca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add facility resource constraints tables and indexes.
    
    Creates:
    1. resource_types table - Categories of resources (e.g., "治療室", "設備")
    2. resources table - Individual resource instances (e.g., "治療室1", "治療室2")
    3. appointment_resource_requirements table - Resource requirements per appointment type
    4. appointment_resource_allocations table - Resource allocations to appointments
    
    Includes proper indexes and foreign key constraints with appropriate ON DELETE behavior.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    # Create resource_types table
    if 'resource_types' not in tables:
        op.create_table(
        'resource_types',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('clinic_id', 'name', name='uq_resource_type_clinic_name')
    )
        op.create_index(op.f('ix_resource_types_id'), 'resource_types', ['id'], unique=False)
        op.create_index(op.f('ix_resource_types_clinic_id'), 'resource_types', ['clinic_id'], unique=False)

    # Create resources table
    if 'resources' not in tables:
        op.create_table(
        'resources',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('resource_type_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resource_type_id'], ['resource_types.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('resource_type_id', 'name', name='uq_resource_type_name')
    )
        op.create_index(op.f('ix_resources_id'), 'resources', ['id'], unique=False)
        op.create_index(op.f('ix_resources_resource_type_id'), 'resources', ['resource_type_id'], unique=False)
        op.create_index(op.f('ix_resources_clinic_id'), 'resources', ['clinic_id'], unique=False)
        # Composite index for resource availability queries
        op.create_index('idx_resources_type_clinic_deleted', 'resources', ['resource_type_id', 'clinic_id', 'is_deleted'], unique=False)

    # Create appointment_resource_requirements table
    if 'appointment_resource_requirements' not in tables:
        op.create_table(
        'appointment_resource_requirements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('appointment_type_id', sa.Integer(), nullable=False),
        sa.Column('resource_type_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resource_type_id'], ['resource_types.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('appointment_type_id', 'resource_type_id', name='uq_appt_resource_req')
    )
        op.create_index(op.f('ix_appointment_resource_requirements_id'), 'appointment_resource_requirements', ['id'], unique=False)
        op.create_index(op.f('ix_appointment_resource_requirements_appointment_type_id'), 'appointment_resource_requirements', ['appointment_type_id'], unique=False)
        op.create_index(op.f('ix_appointment_resource_requirements_resource_type_id'), 'appointment_resource_requirements', ['resource_type_id'], unique=False)

    # Create appointment_resource_allocations table
    if 'appointment_resource_allocations' not in tables:
        op.create_table(
        'appointment_resource_allocations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('appointment_id', sa.Integer(), nullable=False),
        sa.Column('resource_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['appointment_id'], ['calendar_events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resource_id'], ['resources.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('appointment_id', 'resource_id', name='uq_appt_resource_alloc')
    )
        op.create_index(op.f('ix_appointment_resource_allocations_id'), 'appointment_resource_allocations', ['id'], unique=False)
        op.create_index(op.f('ix_appointment_resource_allocations_appointment_id'), 'appointment_resource_allocations', ['appointment_id'], unique=False)
        op.create_index(op.f('ix_appointment_resource_allocations_resource_id'), 'appointment_resource_allocations', ['resource_id'], unique=False)
        # Composite index for resource availability queries (appointment_id + resource_id)
        op.create_index('idx_allocations_appt_resource', 'appointment_resource_allocations', ['appointment_id', 'resource_id'], unique=False)

    # Add composite index to calendar_events for resource availability queries
    # This index helps with queries that filter by clinic_id, date, start_time, end_time
    indexes = [idx['name'] for idx in inspector.get_indexes('calendar_events')]
    if 'idx_calendar_events_clinic_date_time' not in indexes:
        op.create_index(
            'idx_calendar_events_clinic_date_time',
            'calendar_events',
            ['clinic_id', 'date', 'start_time', 'end_time'],
            unique=False
        )

    # Add composite index to appointments for resource availability queries
    # This index helps with queries that filter by status and calendar_event_id
    indexes = [idx['name'] for idx in inspector.get_indexes('appointments')]
    if 'idx_appointments_status_calendar_event' not in indexes:
        op.create_index(
            'idx_appointments_status_calendar_event',
            'appointments',
            ['status', 'calendar_event_id'],
            unique=False
        )


def downgrade() -> None:
    """
    Remove facility resource constraints tables and indexes.
    """
    # Drop indexes first
    op.drop_index('idx_appointments_status_calendar_event', table_name='appointments')
    op.drop_index('idx_calendar_events_clinic_date_time', table_name='calendar_events')
    op.drop_index('idx_allocations_appt_resource', table_name='appointment_resource_allocations')
    op.drop_index(op.f('ix_appointment_resource_allocations_resource_id'), table_name='appointment_resource_allocations')
    op.drop_index(op.f('ix_appointment_resource_allocations_appointment_id'), table_name='appointment_resource_allocations')
    op.drop_index(op.f('ix_appointment_resource_allocations_id'), table_name='appointment_resource_allocations')
    op.drop_index('idx_resources_type_clinic_deleted', table_name='resources')
    op.drop_index(op.f('ix_resources_clinic_id'), table_name='resources')
    op.drop_index(op.f('ix_resources_resource_type_id'), table_name='resources')
    op.drop_index(op.f('ix_resources_id'), table_name='resources')
    op.drop_index(op.f('ix_appointment_resource_requirements_resource_type_id'), table_name='appointment_resource_requirements')
    op.drop_index(op.f('ix_appointment_resource_requirements_appointment_type_id'), table_name='appointment_resource_requirements')
    op.drop_index(op.f('ix_appointment_resource_requirements_id'), table_name='appointment_resource_requirements')
    op.drop_index(op.f('ix_resource_types_clinic_id'), table_name='resource_types')
    op.drop_index(op.f('ix_resource_types_id'), table_name='resource_types')

    # Drop tables
    op.drop_table('appointment_resource_allocations')
    op.drop_table('appointment_resource_requirements')
    op.drop_table('resources')
    op.drop_table('resource_types')

