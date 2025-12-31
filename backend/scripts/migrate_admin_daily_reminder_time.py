"""
Migration script to copy admin_daily_reminder_time to next_day_notification_time.

This script migrates existing admin_daily_reminder_time settings to next_day_notification_time
for admins who don't already have next_day_notification_time set.

Run this before deploying the unified daily notification refactor.
"""

import sys
import os

# Add parent directory to path to import models
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from core.database import get_database_url


def migrate_admin_daily_reminder_time():
    """
    Migrate admin_daily_reminder_time to next_day_notification_time.
    
    For each user_clinic_association:
    - If admin_daily_reminder_time exists and next_day_notification_time is null/empty
    - Copy admin_daily_reminder_time to next_day_notification_time
    """
    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
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
        
        result = session.execute(update_query)
        session.commit()
        
        updated_count = result.rowcount
        print(f"✅ Migrated {updated_count} admin settings from admin_daily_reminder_time to next_day_notification_time")
        
        return updated_count
        
    except Exception as e:
        session.rollback()
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    print("Starting migration: admin_daily_reminder_time → next_day_notification_time")
    migrate_admin_daily_reminder_time()
    print("Migration completed!")

