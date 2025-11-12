"""add_user_clinic_associations_for_multi_clinic_support

Revision ID: fe49cf078f8b
Revises: d4e5f6a7b8c9
Create Date: 2025-01-27 17:15:00.000000

Add user_clinic_associations table for multi-clinic user support.

This migration implements the foundation for multi-clinic user support by:
1. Creating user_clinic_associations table (many-to-many relationship)
2. Adding clinic_id to clinic-scoped tables (practitioner_availability, calendar_events, practitioner_appointment_types)
3. Migrating existing data from users.clinic_id to user_clinic_associations
4. Populating clinic_id in clinic-scoped tables
5. Removing unique constraint on (clinic_id, email) from users table
6. Creating indexes for performance

This is part of the multi-clinic user support implementation documented in
docs/design_doc/multi-clinic-user.md
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'fe49cf078f8b'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add user_clinic_associations table and migrate data for multi-clinic support.
    """
    # Step 1: Ensure all users have full_name (backfill if needed)
    op.execute("""
        UPDATE users 
        SET full_name = COALESCE(full_name, email, 'User')
        WHERE full_name IS NULL OR full_name = ''
    """)
    
    # Step 2: Create user_clinic_associations table
    op.create_table(
        'user_clinic_associations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('roles', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('full_name', sa.String(255), nullable=False),  # CRITICAL: Include full_name
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_accessed_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'clinic_id', name='uq_user_clinic')
    )
    
    # Step 3: Add clinic_id to clinic-scoped tables (nullable initially)
    op.add_column('practitioner_availability', 
                  sa.Column('clinic_id', sa.Integer(), nullable=True))
    op.add_column('calendar_events', 
                  sa.Column('clinic_id', sa.Integer(), nullable=True))
    op.add_column('practitioner_appointment_types', 
                  sa.Column('clinic_id', sa.Integer(), nullable=True))
    
    # Step 4: Populate user_clinic_associations from users.clinic_id
    # CRITICAL: Include full_name in INSERT
    op.execute("""
        INSERT INTO user_clinic_associations (user_id, clinic_id, roles, full_name, created_at, updated_at)
        SELECT id, clinic_id, roles, COALESCE(full_name, email, 'User'), created_at, updated_at
        FROM users
        WHERE clinic_id IS NOT NULL
    """)
    
    # Step 5: Populate clinic_id in clinic-scoped tables
    # For practitioner_availability: get clinic_id from user
    op.execute("""
        UPDATE practitioner_availability pa
        SET clinic_id = u.clinic_id
        FROM users u
        WHERE pa.user_id = u.id AND pa.clinic_id IS NULL AND u.clinic_id IS NOT NULL
    """)
    
    # For calendar_events: get clinic_id from user
    op.execute("""
        UPDATE calendar_events ce
        SET clinic_id = u.clinic_id
        FROM users u
        WHERE ce.user_id = u.id AND ce.clinic_id IS NULL AND u.clinic_id IS NOT NULL
    """)
    
    # For practitioner_appointment_types: get clinic_id from user
    op.execute("""
        UPDATE practitioner_appointment_types pat
        SET clinic_id = u.clinic_id
        FROM users u
        WHERE pat.user_id = u.id AND pat.clinic_id IS NULL AND u.clinic_id IS NOT NULL
    """)
    
    # Step 6: Verify no NULL clinic_id remains (should be 0)
    conn = op.get_bind()
    null_availability = conn.execute(sa.text("SELECT COUNT(*) FROM practitioner_availability WHERE clinic_id IS NULL")).scalar()
    null_events = conn.execute(sa.text("SELECT COUNT(*) FROM calendar_events WHERE clinic_id IS NULL")).scalar()
    null_types = conn.execute(sa.text("SELECT COUNT(*) FROM practitioner_appointment_types WHERE clinic_id IS NULL")).scalar()
    
    if null_availability > 0 or null_events > 0 or null_types > 0:
        raise Exception(f"Migration failed: Found NULL clinic_id values (availability: {null_availability}, events: {null_events}, types: {null_types})")
    
    # Step 7: Make clinic_id NOT NULL after populating
    op.alter_column('practitioner_availability', 'clinic_id', nullable=False)
    op.alter_column('calendar_events', 'clinic_id', nullable=False)
    op.alter_column('practitioner_appointment_types', 'clinic_id', nullable=False)
    
    # Step 8: Add foreign key constraints
    op.create_foreign_key(
        'fk_practitioner_availability_clinic',
        'practitioner_availability', 'clinics', ['clinic_id'], ['id'], ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_calendar_events_clinic',
        'calendar_events', 'clinics', ['clinic_id'], ['id'], ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_practitioner_appointment_types_clinic',
        'practitioner_appointment_types', 'clinics', ['clinic_id'], ['id'], ondelete='CASCADE'
    )
    
    # Step 9: Remove unique constraint on (clinic_id, email) from users table
    # Email remains globally unique via unique=True on the column
    op.drop_constraint('uq_clinic_user_email', 'users', type_='unique')
    
    # Step 10: Create indexes for user_clinic_associations
    op.create_index('idx_user_clinic_associations_user', 'user_clinic_associations', ['user_id'])
    op.create_index('idx_user_clinic_associations_clinic', 'user_clinic_associations', ['clinic_id'])
    op.create_index(
        'idx_user_clinic_associations_active', 
        'user_clinic_associations', 
        ['user_id', 'is_active'], 
        postgresql_where=sa.text('is_active = TRUE')
    )
    op.create_index(
        'idx_user_clinic_associations_user_active_clinic', 
        'user_clinic_associations', 
        ['user_id', 'is_active', 'clinic_id'], 
        postgresql_where=sa.text('is_active = TRUE')
    )
    op.create_index(
        'idx_user_clinic_associations_last_accessed', 
        'user_clinic_associations', 
        ['user_id', 'last_accessed_at'], 
        postgresql_where=sa.text('is_active = TRUE')
    )


def downgrade() -> None:
    """
    Rollback migration - remove user_clinic_associations and restore previous schema.
    """
    # Drop indexes
    op.drop_index('idx_user_clinic_associations_last_accessed', table_name='user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_user_active_clinic', table_name='user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_active', table_name='user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_clinic', table_name='user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_user', table_name='user_clinic_associations')
    
    # Restore unique constraint
    op.create_unique_constraint('uq_clinic_user_email', 'users', ['clinic_id', 'email'])
    
    # Drop foreign keys
    op.drop_constraint('fk_practitioner_appointment_types_clinic', 'practitioner_appointment_types', type_='foreignkey')
    op.drop_constraint('fk_calendar_events_clinic', 'calendar_events', type_='foreignkey')
    op.drop_constraint('fk_practitioner_availability_clinic', 'practitioner_availability', type_='foreignkey')
    
    # Drop clinic_id columns
    op.drop_column('practitioner_appointment_types', 'clinic_id')
    op.drop_column('calendar_events', 'clinic_id')
    op.drop_column('practitioner_availability', 'clinic_id')
    
    # Drop user_clinic_associations table
    op.drop_table('user_clinic_associations')
