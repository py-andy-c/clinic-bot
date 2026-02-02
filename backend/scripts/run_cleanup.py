"""
Manual cleanup script for medical records and photos.

NOTE: Automatic cleanup is now handled by CleanupScheduler (runs daily at 3 AM).
This script is provided for:
- Manual/emergency cleanup operations
- Testing cleanup logic in development
- One-time maintenance tasks

For production, the scheduler in services/cleanup_scheduler.py handles automatic cleanup.
"""
import sys
import os

# Add the parent directory to sys.path to allow imports from src
sys.path.append(os.path.join(os.path.dirname(__file__), '../src'))

from core.database import SessionLocal
from services.cleanup_service import CleanupService

def main():
    print("Starting Cleanup Job...")
    db = SessionLocal()
    try:
        service = CleanupService(db)
        
        # 1. Database Cleanup
        print("Running Soft-Delete Cleanup (Retention: 30 days)...")
        deleted_rows = service.cleanup_soft_deleted_data(retention_days=30)
        print(f"Deleted {deleted_rows} expired database rows.")
        
        # 2. S3 Garbage Collection
        print("Running S3 Garbage Collection...")
        deleted_objects = service.garbage_collect_s3(dry_run=False)
        print(f"Deleted {deleted_objects} unreferenced S3 objects.")
        
        print("Cleanup Job Completed Successfully.")
    except Exception as e:
        print(f"Error during cleanup: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
