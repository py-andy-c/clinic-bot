#!/usr/bin/env python3
"""
Database reset script for Clinic Bot.

This script clears all data and reinitializes the database with empty tables.
Use this to get a clean database state for testing.
"""

import sys
import os
from pathlib import Path

# Add backend/src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'src'))

from sqlalchemy import create_engine, text
from core.database import Base, engine
from core.config import DATABASE_URL

# Import all models to ensure they're registered with Base
from models.clinic import Clinic
from models.clinic_admin import ClinicAdmin
from models.therapist import Therapist
from models.patient import Patient
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser


def reset_database():
    """Reset the database by dropping all tables and recreating them."""

    print("🔄 Resetting Clinic Bot database...")
    print(f"Database URL: {DATABASE_URL}")

    # Confirm action (in case someone runs this accidentally)
    if 'test.db' not in str(DATABASE_URL):
        print("❌ ERROR: This script only works with test.db database!")
        print(f"Current database: {DATABASE_URL}")
        return

    try:
        # For SQLite, the most reliable way is to delete and recreate the file
        # The DATABASE_URL is "sqlite:///./test.db" which is relative to the backend directory
        # when run from the root, so we need to create it in the backend directory
        db_path = Path("backend/test.db")
        if db_path.exists():
            print("🗑️  Deleting existing database file...")
            db_path.unlink()
            print("✅ Database file deleted")

        # Change to backend directory to ensure correct relative path
        os.chdir("backend")

        # Recreate all tables
        print("🏗️  Creating fresh database with tables...")
        # Create a new engine pointing to the fresh database
        fresh_engine = create_engine(DATABASE_URL, echo=False)
        Base.metadata.create_all(bind=fresh_engine)
        print("✅ All tables created")

        # Verify tables exist
        with fresh_engine.connect() as conn:
            result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table';"))
            tables = result.fetchall()
            table_names = [row[0] for row in tables]

        fresh_engine.dispose()

        # Change back to root directory
        os.chdir("..")

        expected_tables = [
            'clinics', 'clinic_admins', 'therapists', 'patients',
            'appointment_types', 'appointments', 'line_users'
        ]

        print("📋 Created tables:")
        for table in expected_tables:
            if table in table_names:
                print(f"   ✅ {table}")
            else:
                print(f"   ❌ {table} (missing)")

        if all(table in table_names for table in expected_tables):
            print("🎉 Database reset complete! All tables created successfully.")
            print("\n📊 Database is now ready for testing with:")
            print("   - 0 clinics")
            print("   - 0 therapists")
            print("   - 0 patients")
            print("   - 0 appointments")
        else:
            print("⚠️  Warning: Some tables may be missing")

    except Exception as e:
        print(f"❌ Error resetting database: {e}")
        raise


def show_usage():
    """Show usage information."""
    print("Clinic Bot Database Reset Script")
    print("=" * 40)
    print()
    print("This script will:")
    print("1. Drop all existing tables")
    print("2. Recreate all tables with empty data")
    print("3. Provide a clean database for testing")
    print()
    print("Usage:")
    print("  python reset_database.py")
    print()
    print("Note: Only works with SQLite test.db database")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ['--help', '-h']:
        show_usage()
    else:
        reset_database()
