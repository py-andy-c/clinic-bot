#!/usr/bin/env python3
"""
Migration script to populate line_official_account_user_id for existing clinics.

This script:
1. Finds all clinics with NULL line_official_account_user_id
2. For each clinic, calls LINE API to get bot info
3. Updates clinic record with the bot's user ID
4. Logs successes and failures

Usage:
    python migrate_clinic_bot_user_ids.py

Environment:
    - DATABASE_URL: PostgreSQL connection string
    - Or uses .env file if available
"""

import logging
import sys
from pathlib import Path

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from core.config import DATABASE_URL
from models import Clinic
from services.line_service import LINEService


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)


def migrate_clinic_bot_user_ids():
    """
    Migrate existing clinics to populate line_official_account_user_id.
    
    For each clinic with NULL line_official_account_user_id:
    1. Create LINEService with clinic's credentials
    2. Call get_bot_info() to fetch bot user ID
    3. Update clinic record with user ID
    4. Log results
    """
    logger.info("Starting migration of clinic bot user IDs...")
    
    # Create database session
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    
    try:
        # Find all clinics without line_official_account_user_id
        clinics_to_migrate = db.query(Clinic).filter(
            Clinic.line_official_account_user_id.is_(None)
        ).all()
        
        if not clinics_to_migrate:
            logger.info("No clinics need migration. All clinics already have line_official_account_user_id.")
            return
        
        logger.info(f"Found {len(clinics_to_migrate)} clinics to migrate")
        
        success_count = 0
        failure_count = 0
        skipped_count = 0
        
        for clinic in clinics_to_migrate:
            logger.info(f"Processing clinic_id={clinic.id}, name={clinic.name}")
            
            # Check if clinic has required credentials
            if not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.warning(
                    f"Skipping clinic_id={clinic.id}: missing LINE credentials"
                )
                skipped_count += 1
                continue
            
            try:
                # Create LINE service
                line_service = LINEService(
                    channel_secret=clinic.line_channel_secret,
                    channel_access_token=clinic.line_channel_access_token
                )
                
                # Fetch bot info
                bot_user_id = line_service.get_bot_info()
                
                if bot_user_id:
                    # Update clinic record
                    clinic.line_official_account_user_id = bot_user_id
                    db.commit()
                    logger.info(
                        f"Successfully migrated clinic_id={clinic.id}: "
                        f"line_official_account_user_id={bot_user_id[:10]}..."
                    )
                    success_count += 1
                else:
                    logger.error(
                        f"Failed to get bot info for clinic_id={clinic.id}. "
                        f"LINE API returned no user ID."
                    )
                    failure_count += 1
                    
            except Exception as e:
                logger.exception(
                    f"Error migrating clinic_id={clinic.id}: {e}"
                )
                failure_count += 1
                db.rollback()
        
        # Summary
        logger.info("=" * 60)
        logger.info("Migration Summary:")
        logger.info(f"  Total clinics: {len(clinics_to_migrate)}")
        logger.info(f"  Successfully migrated: {success_count}")
        logger.info(f"  Failed: {failure_count}")
        logger.info(f"  Skipped (missing credentials): {skipped_count}")
        logger.info("=" * 60)
        
        if failure_count > 0:
            logger.warning(
                f"{failure_count} clinics failed to migrate. "
                f"Please check logs and fix issues manually."
            )
            sys.exit(1)
        else:
            logger.info("Migration completed successfully!")
    finally:
        db.close()


if __name__ == "__main__":
    try:
        migrate_clinic_bot_user_ids()
    except KeyboardInterrupt:
        logger.info("Migration interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"Migration failed with error: {e}")
        sys.exit(1)

