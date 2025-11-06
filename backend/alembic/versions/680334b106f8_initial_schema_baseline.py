"""initial_schema_baseline

Revision ID: 680334b106f8
Revises: 
Create Date: 2025-11-05 18:46:59.800551

This is the baseline migration that consolidates all previous migrations into a single
comprehensive schema definition. This migration creates all tables from scratch using
the current model definitions, which include all PostgreSQL optimizations from Week 1.

This replaces 23 previous migrations that were archived in alembic/versions_archive/.
"""
from typing import Sequence, Union
import sys
import os

# Add src directory to path to import models
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Import all models to ensure they're registered with Base.metadata
from core.database import Base
from models.clinic import Clinic
from models.user import User
from models.signup_token import SignupToken
from models.refresh_token import RefreshToken
from models.patient import Patient
from models.line_user import LineUser
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.practitioner_availability import PractitionerAvailability
from models.calendar_event import CalendarEvent
from models.availability_exception import AvailabilityException
from models.practitioner_appointment_types import PractitionerAppointmentTypes


# revision identifiers, used by Alembic.
revision: str = '680334b106f8'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create all database tables from SQLAlchemy models and apply PostgreSQL optimizations.
    
    This baseline migration creates all tables, indexes, constraints, and relationships
    as defined in the current model definitions. This includes:
    - All tables: clinics, users, patients, appointments, etc.
    - All indexes: including GIN indexes for JSONB, composite indexes, foreign key indexes
    - All constraints: check constraints, unique constraints, foreign keys
    - PostgreSQL-specific types: JSONB, TIMESTAMPTZ
    
    This consolidates 23 previous migrations into a single clean baseline.
    """
    # Step 1: Create all tables from models
    # This ensures the schema matches exactly what the models define
    # Models already use JSONB types, so columns will be created as JSONB
    # All future migrations will be incremental changes from this baseline
    Base.metadata.create_all(bind=op.get_bind())
    
    # Step 2: Create GIN indexes for JSONB fields (Week 1 optimization)
    # Note: Columns are already JSONB from models, so we can create GIN indexes directly
    op.create_index(
        'idx_users_roles_gin',
        'users',
        ['roles'],
        postgresql_using='gin'
    )
    
    op.create_index(
        'idx_clinics_settings_gin',
        'clinics',
        ['settings'],
        postgresql_using='gin'
    )
    
    op.create_index(
        'idx_signup_tokens_default_roles_gin',
        'signup_tokens',
        ['default_roles'],
        postgresql_using='gin'
    )
    
    # Step 4: Add check constraints (Week 1 optimization)
    op.create_check_constraint(
        'check_clinic_subscription_status',
        'clinics',
        "subscription_status IN ('trial', 'active', 'past_due', 'canceled')"
    )
    
    op.create_check_constraint(
        'check_appointment_status',
        'appointments',
        "status IN ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')"
    )
    
    # Step 5: Add additional foreign key indexes (Week 1 optimization)
    op.create_index(
        'idx_appointment_types_clinic_id',
        'appointment_types',
        ['clinic_id']
    )
    
    op.create_index(
        'idx_appointments_appointment_type_id',
        'appointments',
        ['appointment_type_id']
    )
    
    # Step 6: Add composite indexes for common query patterns (Week 1 optimization)
    op.create_index(
        'idx_patients_clinic_deleted',
        'patients',
        ['clinic_id', 'is_deleted']
    )
    
    op.create_index(
        'idx_appointment_types_clinic_deleted',
        'appointment_types',
        ['clinic_id', 'is_deleted']
    )
    
    op.create_index(
        'idx_users_clinic_active',
        'users',
        ['clinic_id', 'is_active']
    )


def downgrade() -> None:
    """
    Drop all database tables.
    
    This removes all tables, indexes, and constraints created by the baseline migration.
    """
    # Drop indexes first (before dropping tables)
    op.drop_index('idx_users_clinic_active', table_name='users')
    op.drop_index('idx_appointment_types_clinic_deleted', table_name='appointment_types')
    op.drop_index('idx_patients_clinic_deleted', table_name='patients')
    op.drop_index('idx_appointments_appointment_type_id', table_name='appointments')
    op.drop_index('idx_appointment_types_clinic_id', table_name='appointment_types')
    op.drop_index('idx_signup_tokens_default_roles_gin', table_name='signup_tokens')
    op.drop_index('idx_clinics_settings_gin', table_name='clinics')
    op.drop_index('idx_users_roles_gin', table_name='users')
    
    # Drop check constraints
    op.drop_constraint('check_appointment_status', 'appointments', type_='check')
    op.drop_constraint('check_clinic_subscription_status', 'clinics', type_='check')
    
    # Drop all tables from models
    Base.metadata.drop_all(bind=op.get_bind())
