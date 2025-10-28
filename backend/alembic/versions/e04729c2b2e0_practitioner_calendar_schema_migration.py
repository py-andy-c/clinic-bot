"""practitioner_calendar_schema_migration

Revision ID: e04729c2b2e0
Revises: 14aae079a414
Create Date: 2025-10-27 22:37:01.624553

This migration implements the practitioner calendar schema changes:
1. Creates calendar_events base table for unified calendar management
2. Creates availability_exceptions table for practitioner unavailability periods
3. Migrates existing appointments to use calendar_events schema
4. Updates practitioner_availability table to support multiple intervals per day
5. Updates appointments table structure to reference calendar_events

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy import TIMESTAMP, Integer, String, Date, Time, ForeignKey, Index, CheckConstraint, func


# revision identifiers, used by Alembic.
revision: str = 'e04729c2b2e0'
down_revision: Union[str, None] = '14aae079a414'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade to practitioner calendar schema."""
    
    # Step 1: Create calendar_events base table
    op.create_table('calendar_events',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('user_id', Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('event_type', String(50), nullable=False),
        sa.Column('date', Date, nullable=False),
        sa.Column('start_time', Time, nullable=True),  # null = all day event
        sa.Column('end_time', Time, nullable=True),    # null = all day event
        sa.Column('gcal_event_id', String(255), nullable=True, unique=True),
        sa.Column('gcal_watch_resource_id', String(255), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )

    # Create constraints for calendar_events
    op.create_check_constraint(
        'check_valid_event_type',
        'calendar_events',
        "event_type IN ('appointment', 'availability_exception')"
    )
    
    op.create_check_constraint(
        'check_valid_time_range',
        'calendar_events',
        "start_time IS NULL OR end_time IS NULL OR start_time < end_time"
    )

    # Create indexes for calendar_events
    op.create_index('idx_calendar_events_user_date', 'calendar_events', ['user_id', 'date'])
    op.create_index('idx_calendar_events_type', 'calendar_events', ['event_type'])
    op.create_index('idx_calendar_events_gcal_sync', 'calendar_events', ['gcal_event_id'])
    op.create_index('idx_calendar_events_user_date_type', 'calendar_events', ['user_id', 'date', 'event_type'])

    # Step 2: Create availability_exceptions table
    op.create_table('availability_exceptions',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('calendar_event_id', Integer, sa.ForeignKey('calendar_events.id', ondelete='CASCADE'), nullable=False),
    )

    # Create index for availability_exceptions
    op.create_index('idx_availability_exceptions_calendar_event', 'availability_exceptions', ['calendar_event_id'])

    # Step 3: Migrate existing appointments to calendar_events
    # This is done in Python to handle the data migration properly
    connection = op.get_bind()
    
    # First, add calendar_event_id column to appointments table
    op.add_column('appointments', sa.Column('calendar_event_id', Integer, sa.ForeignKey('calendar_events.id'), nullable=True))
    
    # Get all existing appointments
    result = connection.execute(sa.text("""
        SELECT id, patient_id, user_id, appointment_type_id, start_time, end_time, 
               status, gcal_event_id, created_at, updated_at
        FROM appointments
    """))
    
    appointments = result.fetchall()
    
    # Create calendar_events records for each appointment
    for appointment in appointments:
        # Extract date and time from datetime fields
        start_datetime = appointment.start_time
        end_datetime = appointment.end_time
        
        # Create calendar_event record
        connection.execute(sa.text("""
            INSERT INTO calendar_events 
            (user_id, event_type, date, start_time, end_time, gcal_event_id, created_at, updated_at)
            VALUES (:user_id, 'appointment', :date, :start_time, :end_time, :gcal_event_id, :created_at, :updated_at)
        """), {
            'user_id': appointment.user_id,
            'date': start_datetime.date(),
            'start_time': start_datetime.time(),
            'end_time': end_datetime.time(),
            'gcal_event_id': appointment.gcal_event_id,
            'created_at': appointment.created_at,
            'updated_at': appointment.updated_at
        })
        
        # Get the calendar_event_id for this appointment
        calendar_event_result = connection.execute(sa.text("""
            SELECT id FROM calendar_events 
            WHERE user_id = :user_id AND event_type = 'appointment' 
            AND date = :date AND start_time = :start_time AND end_time = :end_time
            ORDER BY id DESC LIMIT 1
        """), {
            'user_id': appointment.user_id,
            'date': start_datetime.date(),
            'start_time': start_datetime.time(),
            'end_time': end_datetime.time()
        })
        
        calendar_event_id = calendar_event_result.fetchone()[0]
        
        # Update appointment with calendar_event_id
        connection.execute(sa.text("""
            UPDATE appointments 
            SET calendar_event_id = :calendar_event_id
            WHERE id = :appointment_id
        """), {
            'calendar_event_id': calendar_event_id,
            'appointment_id': appointment.id
        })

    # Step 4: Modify appointments table structure
    # Drop old columns and constraints
    op.drop_index('idx_patient_upcoming', table_name='appointments')
    op.drop_index('idx_user_schedule', table_name='appointments')
    op.drop_index('idx_gcal_sync', table_name='appointments')
    
    # Drop old columns
    op.drop_column('appointments', 'user_id')
    op.drop_column('appointments', 'start_time')
    op.drop_column('appointments', 'end_time')
    op.drop_column('appointments', 'gcal_event_id')
    op.drop_column('appointments', 'created_at')
    op.drop_column('appointments', 'updated_at')
    
    # Drop the old primary key and create new one
    op.drop_constraint('appointments_pkey', 'appointments', type_='primary')
    op.create_primary_key('appointments_pkey', 'appointments', ['calendar_event_id'])
    
    # Create new index for appointments
    op.create_index('idx_appointments_patient', 'appointments', ['patient_id'])

    # Step 5: Update practitioner_availability table
    # Remove is_available column (not needed in new design)
    op.drop_column('practitioner_availability', 'is_available')
    
    # Drop unique constraint to allow multiple intervals per day
    op.drop_constraint('uq_user_day_availability', 'practitioner_availability', type_='unique')
    
    # Add composite index for better performance
    op.create_index('idx_practitioner_availability_user_day_time', 'practitioner_availability', ['user_id', 'day_of_week', 'start_time'])


def downgrade() -> None:
    """Downgrade from practitioner calendar schema."""
    
    # Step 1: Restore practitioner_availability table
    op.drop_index('idx_practitioner_availability_user_day_time', table_name='practitioner_availability')
    op.create_unique_constraint('uq_user_day_availability', 'practitioner_availability', ['user_id', 'day_of_week'])
    op.add_column('practitioner_availability', sa.Column('is_available', sa.Boolean(), default=True, nullable=False))

    # Step 2: Restore appointments table structure
    op.drop_index('idx_appointments_patient', table_name='appointments')
    
    # Drop new primary key and restore old structure
    op.drop_constraint('appointments_pkey', 'appointments', type_='primary')
    
    # Add back old columns
    op.add_column('appointments', sa.Column('id', Integer, primary_key=True, index=True))
    op.add_column('appointments', sa.Column('user_id', Integer, sa.ForeignKey('users.id')))
    op.add_column('appointments', sa.Column('start_time', TIMESTAMP(timezone=True)))
    op.add_column('appointments', sa.Column('end_time', TIMESTAMP(timezone=True)))
    op.add_column('appointments', sa.Column('gcal_event_id', String(255), nullable=True))
    op.add_column('appointments', sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now()))
    op.add_column('appointments', sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()))
    
    # Migrate data back from calendar_events
    connection = op.get_bind()
    
    # Get appointments with their calendar events
    result = connection.execute(sa.text("""
        SELECT a.calendar_event_id, a.patient_id, a.appointment_type_id, a.status,
               ce.user_id, ce.date, ce.start_time, ce.end_time, ce.gcal_event_id, ce.created_at, ce.updated_at
        FROM appointments a
        JOIN calendar_events ce ON a.calendar_event_id = ce.id
    """))
    
    appointments = result.fetchall()
    
    # Update appointments with restored data
    for appointment in appointments:
        # Combine date and time back to datetime
        start_datetime = datetime.combine(appointment.date, appointment.start_time)
        end_datetime = datetime.combine(appointment.date, appointment.end_time)
        
        connection.execute(sa.text("""
            UPDATE appointments 
            SET user_id = :user_id, start_time = :start_time, end_time = :end_time,
                gcal_event_id = :gcal_event_id, created_at = :created_at, updated_at = :updated_at
            WHERE calendar_event_id = :calendar_event_id
        """), {
            'user_id': appointment.user_id,
            'start_time': start_datetime,
            'end_time': end_datetime,
            'gcal_event_id': appointment.gcal_event_id,
            'created_at': appointment.created_at,
            'updated_at': appointment.updated_at,
            'calendar_event_id': appointment.calendar_event_id
        })
    
    # Drop calendar_event_id column
    op.drop_column('appointments', 'calendar_event_id')
    
    # Restore old indexes
    op.create_index('idx_patient_upcoming', 'appointments', ['patient_id', 'start_time'])
    op.create_index('idx_user_schedule', 'appointments', ['user_id', 'start_time'])
    op.create_index('idx_gcal_sync', 'appointments', ['gcal_event_id'])

    # Step 3: Drop new tables
    op.drop_table('availability_exceptions')
    op.drop_table('calendar_events')
