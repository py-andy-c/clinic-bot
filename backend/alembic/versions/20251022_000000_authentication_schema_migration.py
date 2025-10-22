"""Authentication schema migration - unified user model and authentication tables

Revision ID: auth_schema_migration
Revises: add_line_token_gcal_indexes
Create Date: 2025-10-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import TIMESTAMP, String, Integer, TIMESTAMP, Boolean, JSON, ForeignKey, Index, UniqueConstraint, func


# revision identifiers, used by Alembic.
revision = 'auth_schema_migration'
down_revision = 'add_line_token_gcal_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop existing tables that will be replaced
    op.drop_table('clinic_admins')
    op.drop_table('therapists')
    op.drop_index('idx_gcal_sync', table_name='appointments')
    op.drop_index('idx_therapist_schedule', table_name='appointments')
    op.drop_index('idx_patient_upcoming', table_name='appointments')

    # Modify appointments table - change therapist_id to user_id
    op.alter_column('appointments', 'therapist_id', new_column_name='user_id')

    # Add missing columns to existing tables
    op.add_column('patients', sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False))
    op.add_column('appointments', sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False))
    op.add_column('appointments', sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False))

    # Create new authentication tables
    op.create_table('users',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('clinic_id', Integer, sa.ForeignKey('clinics.id'), nullable=False),
        sa.Column('email', String(255), unique=True, nullable=False),
        sa.Column('google_subject_id', String(255), unique=True, nullable=False),
        sa.Column('full_name', String(255), nullable=False),
        sa.Column('is_active', Boolean, default=True, nullable=False),
        sa.Column('roles', JSON, default=list, nullable=False),
        sa.Column('gcal_credentials', String, nullable=True),
        sa.Column('gcal_sync_enabled', Boolean, default=False, nullable=False),
        sa.Column('gcal_watch_resource_id', String(255), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
        sa.Column('last_login_at', TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table('signup_tokens',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('token', String(255), unique=True, nullable=False),
        sa.Column('clinic_id', Integer, sa.ForeignKey('clinics.id'), nullable=False),
        sa.Column('default_roles', JSON, nullable=False),
        sa.Column('expires_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('used_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('used_by_email', String(255), nullable=True),
        sa.Column('is_revoked', Boolean, default=False, nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
    )

    op.create_table('refresh_tokens',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('user_id', Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('token_hash', String(255), unique=True, nullable=False),
        sa.Column('expires_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
        sa.Column('last_used_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('revoked', Boolean, default=False, nullable=False),
    )

    # Create constraints and indexes
    op.create_unique_constraint('uq_clinic_user_email', 'users', ['clinic_id', 'email'])
    op.create_unique_constraint('uq_google_subject_id', 'users', ['google_subject_id'])
    op.create_unique_constraint('uq_clinic_patient_phone', 'patients', ['clinic_id', 'phone_number'])

    # Create indexes
    op.create_index('idx_users_clinic_id', 'users', ['clinic_id'])
    op.create_index('idx_users_email', 'users', ['email'])
    op.create_index('idx_users_google_subject_id', 'users', ['google_subject_id'])
    op.create_index('idx_users_is_active', 'users', ['is_active'])
    op.create_index('idx_signup_tokens_active', 'signup_tokens', ['expires_at', 'is_revoked', 'used_at'])
    op.create_index('idx_signup_tokens_clinic_id', 'signup_tokens', ['clinic_id'])
    op.create_index('idx_refresh_tokens_user_id', 'refresh_tokens', ['user_id'])
    op.create_index('idx_refresh_tokens_token_hash', 'refresh_tokens', ['token_hash'])
    op.create_index('idx_refresh_tokens_expires_at', 'refresh_tokens', ['expires_at'])

    # Recreate appointment indexes with correct names
    op.create_index('idx_patient_upcoming', 'appointments', ['patient_id', 'start_time'])
    op.create_index('idx_user_schedule', 'appointments', ['user_id', 'start_time'])
    op.create_index('idx_gcal_sync', 'appointments', ['gcal_event_id'])


def downgrade() -> None:
    # Drop new tables and indexes
    op.drop_index('idx_gcal_sync', table_name='appointments')
    op.drop_index('idx_user_schedule', table_name='appointments')
    op.drop_index('idx_patient_upcoming', table_name='appointments')
    op.drop_index('idx_refresh_tokens_expires_at', table_name='refresh_tokens')
    op.drop_index('idx_refresh_tokens_token_hash', table_name='refresh_tokens')
    op.drop_index('idx_refresh_tokens_user_id', table_name='refresh_tokens')
    op.drop_index('idx_signup_tokens_clinic_id', table_name='signup_tokens')
    op.drop_index('idx_signup_tokens_active', table_name='signup_tokens')
    op.drop_index('idx_users_is_active', table_name='users')
    op.drop_index('idx_users_google_subject_id', table_name='users')
    op.drop_index('idx_users_email', table_name='users')
    op.drop_index('idx_users_clinic_id', table_name='users')

    # Drop constraints
    op.drop_constraint('uq_clinic_patient_phone', 'patients')
    op.drop_constraint('uq_google_subject_id', 'users')
    op.drop_constraint('uq_clinic_user_email', 'users')

    # Drop new tables
    op.drop_table('refresh_tokens')
    op.drop_table('signup_tokens')
    op.drop_table('users')

    # Remove added columns
    op.drop_column('appointments', 'updated_at')
    op.drop_column('appointments', 'created_at')
    op.drop_column('patients', 'created_at')

    # Revert appointments table - change user_id back to therapist_id
    op.alter_column('appointments', 'user_id', new_column_name='therapist_id')

    # Recreate original indexes
    op.create_index('idx_gcal_sync', 'appointments', ['gcal_event_id'])
    op.create_index('idx_therapist_schedule', 'appointments', ['therapist_id', 'start_time'])
    op.create_index('idx_patient_upcoming', 'appointments', ['patient_id', 'start_time'])

    # Recreate original tables
    op.create_table('therapists',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('clinic_id', Integer, sa.ForeignKey('clinics.id'), nullable=False),
        sa.Column('name', String(255), nullable=False),
        sa.Column('email', String(255), nullable=True),
        sa.Column('gcal_credentials', sa.Text, nullable=True),
        sa.Column('gcal_sync_enabled', Boolean, default=False, nullable=False),
        sa.Column('gcal_watch_resource_id', String(255), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )

    op.create_table('clinic_admins',
        sa.Column('id', Integer, primary_key=True, index=True),
        sa.Column('clinic_id', Integer, sa.ForeignKey('clinics.id'), nullable=False),
        sa.Column('email', String(255), unique=True, nullable=False),
        sa.Column('full_name', String(255), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )
