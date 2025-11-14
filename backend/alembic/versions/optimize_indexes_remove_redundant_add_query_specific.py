"""optimize_indexes_remove_redundant_add_query_specific

Revision ID: a1b2c3d4e5f6
Revises: d26badef0731
Create Date: 2025-01-27 12:00:00.000000

Remove redundant indexes and add query-specific indexes for better performance.

Based on database analysis consensus:
- Remove 5 redundant indexes that are covered by more comprehensive indexes
- Add partial index for reminder queries
- Add composite index for date/time range queries
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '1b2375d21e4f'
down_revision: Union[str, None] = 'd26badef0731'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove redundant indexes and add query-specific indexes.
    
    Removes:
    1. idx_user_clinic_associations_active - redundant with idx_user_clinic_associations_user_active_accessed_id
    2. idx_user_clinic_associations_last_accessed - redundant with idx_user_clinic_associations_user_active_accessed_id
    3. idx_practitioner_types_user_clinic_type - redundant with unique constraint index
    4. idx_patients_clinic - redundant with idx_patients_clinic_phone
    5. idx_practitioner_availability_user_day - redundant with idx_practitioner_availability_user_day_time
    
    Adds:
    1. idx_appointments_reminder_candidates - partial index for reminder queries
    2. idx_calendar_events_date_time - composite index for date/time range queries
    """
    # Remove redundant indexes
    # Check if indexes exist before dropping (for idempotency)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    
    # 1. Remove idx_user_clinic_associations_active
    indexes = [idx['name'] for idx in inspector.get_indexes('user_clinic_associations')]
    if 'idx_user_clinic_associations_active' in indexes:
        op.drop_index('idx_user_clinic_associations_active', table_name='user_clinic_associations')
    
    # 2. Remove idx_user_clinic_associations_last_accessed
    if 'idx_user_clinic_associations_last_accessed' in indexes:
        op.drop_index('idx_user_clinic_associations_last_accessed', table_name='user_clinic_associations')
    
    # 3. Remove idx_practitioner_types_user_clinic_type (redundant with unique constraint)
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_appointment_types')]
    if 'idx_practitioner_types_user_clinic_type' in indexes:
        op.drop_index('idx_practitioner_types_user_clinic_type', table_name='practitioner_appointment_types')
    
    # 4. Remove idx_patients_clinic
    indexes = [idx['name'] for idx in inspector.get_indexes('patients')]
    if 'idx_patients_clinic' in indexes:
        op.drop_index('idx_patients_clinic', table_name='patients')
    
    # 5. Remove idx_practitioner_availability_user_day
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_availability')]
    if 'idx_practitioner_availability_user_day' in indexes:
        op.drop_index('idx_practitioner_availability_user_day', table_name='practitioner_availability')
    
    # Add query-specific indexes
    
    # 1. Partial index for reminder queries
    # This index optimizes queries that filter by status='confirmed' and reminder_sent_at IS NULL
    indexes = [idx['name'] for idx in inspector.get_indexes('appointments')]
    if 'idx_appointments_reminder_candidates' not in indexes:
        op.create_index(
            'idx_appointments_reminder_candidates',
            'appointments',
            ['status', 'reminder_sent_at', 'calendar_event_id'],
            postgresql_where=sa.text("status = 'confirmed' AND reminder_sent_at IS NULL")
        )
    
    # 2. Composite index for date/time range queries
    # This index optimizes queries that filter by date and start_time together
    indexes = [idx['name'] for idx in inspector.get_indexes('calendar_events')]
    if 'idx_calendar_events_date_time' not in indexes:
        op.create_index(
            'idx_calendar_events_date_time',
            'calendar_events',
            ['date', 'start_time']
        )


def downgrade() -> None:
    """
    Restore removed indexes and drop newly added indexes.
    """
    # Drop newly added indexes
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    
    indexes = [idx['name'] for idx in inspector.get_indexes('appointments')]
    if 'idx_appointments_reminder_candidates' in indexes:
        op.drop_index('idx_appointments_reminder_candidates', table_name='appointments')
    
    indexes = [idx['name'] for idx in inspector.get_indexes('calendar_events')]
    if 'idx_calendar_events_date_time' in indexes:
        op.drop_index('idx_calendar_events_date_time', table_name='calendar_events')
    
    # Restore removed indexes
    # Note: These are redundant but we restore them for downgrade compatibility
    
    # 1. Restore idx_user_clinic_associations_active
    indexes = [idx['name'] for idx in inspector.get_indexes('user_clinic_associations')]
    if 'idx_user_clinic_associations_active' not in indexes:
        op.create_index(
            'idx_user_clinic_associations_active',
            'user_clinic_associations',
            ['user_id', 'is_active'],
            postgresql_where=sa.text('is_active = TRUE')
        )
    
    # 2. Restore idx_user_clinic_associations_last_accessed
    if 'idx_user_clinic_associations_last_accessed' not in indexes:
        op.create_index(
            'idx_user_clinic_associations_last_accessed',
            'user_clinic_associations',
            ['user_id', 'last_accessed_at'],
            postgresql_where=sa.text('is_active = TRUE')
        )
    
    # 3. Restore idx_practitioner_types_user_clinic_type
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_appointment_types')]
    if 'idx_practitioner_types_user_clinic_type' not in indexes:
        op.create_index(
            'idx_practitioner_types_user_clinic_type',
            'practitioner_appointment_types',
            ['user_id', 'clinic_id', 'appointment_type_id']
        )
    
    # 4. Restore idx_patients_clinic
    indexes = [idx['name'] for idx in inspector.get_indexes('patients')]
    if 'idx_patients_clinic' not in indexes:
        op.create_index('idx_patients_clinic', 'patients', ['clinic_id'])
    
    # 5. Restore idx_practitioner_availability_user_day
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_availability')]
    if 'idx_practitioner_availability_user_day' not in indexes:
        op.create_index(
            'idx_practitioner_availability_user_day',
            'practitioner_availability',
            ['user_id', 'day_of_week']
        )

