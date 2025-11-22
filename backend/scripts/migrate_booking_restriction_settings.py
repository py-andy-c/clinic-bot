#!/usr/bin/env python3
"""
Migration script to deprecate same_day_disallowed and migrate to minimum_booking_hours_ahead.

This script:
1. Finds all clinics with booking_restriction_type = "same_day_disallowed"
2. Migrates them to use minimum_booking_hours_ahead (default: 24 hours)
3. Updates booking_restriction_type to "minimum_hours_required"
4. Removes the deprecated same_day_disallowed setting

Run this script after deploying the code changes that deprecate same_day_disallowed.

NOTE: This is a one-time migration script. After running, it can be archived.
If all clinics have been migrated, this script is no longer needed.
"""

import sys
import os
from pathlib import Path

# Add backend/src to path
backend_src = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(backend_src))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import get_database_url
from models.clinic import Clinic
from models.clinic import ClinicSettings, BookingRestrictionSettings

def migrate_clinic_settings(db_session):
    """
    Migrate clinic settings from same_day_disallowed to minimum_booking_hours_ahead.
    
    Args:
        db_session: SQLAlchemy database session
    """
    # Find all clinics
    clinics = db_session.query(Clinic).filter(Clinic.is_active == True).all()
    
    migrated_count = 0
    skipped_count = 0
    error_count = 0
    
    print(f"Found {len(clinics)} active clinics to check...")
    
    for clinic in clinics:
        try:
            # Get current settings
            settings = clinic.get_validated_settings()
            booking_settings = settings.booking_restriction_settings
            
            # Check if migration is needed
            if booking_settings.booking_restriction_type == "same_day_disallowed":
                # Migrate to minimum_hours_required
                # If minimum_booking_hours_ahead is not set or is 0, default to 24 hours
                if booking_settings.minimum_booking_hours_ahead is None or booking_settings.minimum_booking_hours_ahead == 0:
                    booking_settings.minimum_booking_hours_ahead = 24
                
                # Update booking_restriction_type
                booking_settings.booking_restriction_type = "minimum_hours_required"
                
                # Update clinic settings
                settings.booking_restriction_settings = booking_settings
                clinic.set_validated_settings(settings)
                
                migrated_count += 1
                print(f"✓ Migrated clinic {clinic.id} ({clinic.name})")
            else:
                # Already migrated or using different setting
                skipped_count += 1
                
        except Exception as e:
            error_count += 1
            print(f"✗ Error migrating clinic {clinic.id} ({clinic.name}): {e}")
            continue
    
    # Commit all changes
    try:
        db_session.commit()
        print(f"\nMigration complete:")
        print(f"  - Migrated: {migrated_count} clinics")
        print(f"  - Skipped: {skipped_count} clinics (already migrated or different setting)")
        print(f"  - Errors: {error_count} clinics")
    except Exception as e:
        db_session.rollback()
        print(f"\n✗ Error committing changes: {e}")
        raise

def main():
    """Main entry point for the migration script."""
    print("Starting booking restriction settings migration...")
    print("=" * 60)
    
    # Get database URL
    database_url = get_database_url()
    if not database_url:
        print("✗ Error: DATABASE_URL environment variable not set")
        sys.exit(1)
    
    # Create database engine and session
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    db_session = Session()
    
    try:
        migrate_clinic_settings(db_session)
        print("=" * 60)
        print("Migration completed successfully!")
    except Exception as e:
        print("=" * 60)
        print(f"✗ Migration failed: {e}")
        sys.exit(1)
    finally:
        db_session.close()

if __name__ == "__main__":
    main()

