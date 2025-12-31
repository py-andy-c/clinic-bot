"""migrate_admin_daily_reminder_time_to_next_day_notification

Revision ID: migrate_admin_reminder_time
Revises: add_patient_pract_assignments
Create Date: 2025-01-30 15:00:00.000000

Migrate admin_daily_reminder_time to next_day_notification_time.

This is a one-time data migration to copy existing admin_daily_reminder_time
settings to next_day_notification_time for admins who don't already have
next_day_notification_time set.

This migration runs BEFORE the code deployment that uses next_day_notification_time
for both admins and practitioners.

Migration logic:
- For each user_clinic_association with admin role:
  - If admin_daily_reminder_time exists in settings JSONB
  - AND next_day_notification_time is null/empty
  - Copy admin_daily_reminder_time to next_day_notification_time

This migration is idempotent - it only updates records where next_day_notification_time
is missing, so it's safe to run multiple times.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'migrate_admin_reminder_time'
down_revision: Union[str, None] = 'add_patient_pract_assignments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Migrate admin_daily_reminder_time to next_day_notification_time.
    
    This migration:
    1. Finds all user_clinic_associations with admin role
    2. For each association where admin_daily_reminder_time exists but next_day_notification_time is missing
    3. Copies admin_daily_reminder_time value to next_day_notification_time
    
    This is idempotent - only updates records where next_day_notification_time is missing.
    """
    conn = op.get_bind()
    
    # Update settings JSONB for associations where:
    # - admin_daily_reminder_time exists
    # - next_day_notification_time is null or empty
    # - User has admin role
    update_query = text("""
        UPDATE user_clinic_associations
        SET settings = jsonb_set(
            settings,
            '{next_day_notification_time}',
            settings->'admin_daily_reminder_time'
        )
        WHERE 
            settings->'admin_daily_reminder_time' IS NOT NULL
            AND (
                settings->'next_day_notification_time' IS NULL
                OR settings->'next_day_notification_time' = 'null'::jsonb
                OR settings->>'next_day_notification_time' = ''
            )
            AND roles @> '["admin"]'::jsonb
    """)
    
    result = conn.execute(update_query)
    updated_count = result.rowcount
    
    print(f"✅ Migrated {updated_count} admin settings from admin_daily_reminder_time to next_day_notification_time")
    
    # Validate migration: check if any admins still need migration
    # (This is informational only - migration is idempotent)
    validation_query = text("""
        SELECT COUNT(*)
        FROM user_clinic_associations
        WHERE 
            settings->'admin_daily_reminder_time' IS NOT NULL
            AND (
                settings->'next_day_notification_time' IS NULL
                OR settings->'next_day_notification_time' = 'null'::jsonb
                OR settings->>'next_day_notification_time' = ''
            )
            AND roles @> '["admin"]'::jsonb
    """)
    
    remaining_count = conn.execute(validation_query).scalar()
    
    if remaining_count > 0:
        print(f"⚠️  Note: {remaining_count} admin associations still have admin_daily_reminder_time but no next_day_notification_time")
        print("   This may be expected if admin_daily_reminder_time was set to an invalid value")
    else:
        print("✅ All valid admin_daily_reminder_time values have been migrated")


def downgrade() -> None:
    """
    Remove next_day_notification_time values that were migrated from admin_daily_reminder_time.
    
    Note: This is a destructive operation that removes next_day_notification_time values
    that were copied from admin_daily_reminder_time. This should only be used if reverting
    the entire unified notification feature.
    
    This does NOT restore admin_daily_reminder_time (it remains in settings JSONB).
    """
    conn = op.get_bind()
    
    # Remove next_day_notification_time from settings JSONB where:
    # - next_day_notification_time exists
    # - admin_daily_reminder_time also exists
    # - Values match (indicating it was migrated)
    # - User has admin role
    remove_query = text("""
        UPDATE user_clinic_associations
        SET settings = settings - 'next_day_notification_time'
        WHERE 
            settings->'next_day_notification_time' IS NOT NULL
            AND settings->'admin_daily_reminder_time' IS NOT NULL
            AND settings->'next_day_notification_time' = settings->'admin_daily_reminder_time'
            AND roles @> '["admin"]'::jsonb
    """)
    
    result = conn.execute(remove_query)
    removed_count = result.rowcount
    
    print(f"Removed next_day_notification_time from {removed_count} admin associations (values that matched admin_daily_reminder_time)")

