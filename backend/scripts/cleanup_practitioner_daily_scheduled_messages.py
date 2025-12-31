"""
Cleanup script to mark existing practitioner_daily ScheduledLineMessage entries as skipped.

This script marks all pending practitioner_daily messages as skipped since we've migrated
to hourly check (real-time aggregation) instead of pre-scheduling.

Run this after deploying the unified daily notification refactor.
"""

import sys
import os

# Add parent directory to path to import models
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from core.database import get_database_url


def cleanup_practitioner_daily_messages():
    """
    Mark all pending practitioner_daily ScheduledLineMessage entries as skipped.
    
    This preserves audit trail while preventing them from being sent.
    """
    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Mark all pending practitioner_daily messages as skipped
        update_query = text("""
            UPDATE scheduled_line_messages
            SET status = 'skipped'
            WHERE 
                message_type = 'practitioner_daily'
                AND status = 'pending'
        """)
        
        result = session.execute(update_query)
        session.commit()
        
        updated_count = result.rowcount
        print(f"✅ Marked {updated_count} pending practitioner_daily messages as skipped")
        
        return updated_count
        
    except Exception as e:
        session.rollback()
        print(f"❌ Cleanup failed: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    print("Starting cleanup: Mark pending practitioner_daily messages as skipped")
    cleanup_practitioner_daily_messages()
    print("Cleanup completed!")

