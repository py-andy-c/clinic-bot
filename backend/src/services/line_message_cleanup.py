# pyright: reportMissingTypeStubs=false
"""
LINE message cleanup service.

This module handles periodic cleanup of old LINE message metadata using APScheduler.
Deletes messages older than LINE_MESSAGE_RETENTION_HOURS to prevent unbounded table growth.
"""

import logging
from datetime import timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore

from core.database import SessionLocal
from core.constants import LINE_MESSAGE_RETENTION_HOURS
from utils.datetime_utils import taiwan_now, TAIWAN_TZ

logger = logging.getLogger(__name__)


class LineMessageCleanupService:
    """
    Service for cleaning up old LINE message metadata.
    
    Uses APScheduler to periodically delete messages older than
    LINE_MESSAGE_RETENTION_HOURS (10 days). This prevents unbounded table growth
    while keeping messages long enough to support quoted message functionality.
    """
    
    def __init__(self):
        """Initialize the cleanup service."""
        # Configure scheduler to use Taiwan timezone to ensure correct timing
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False
    
    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for cleaning up old LINE messages.
        
        This should be called during application startup.
        Runs cleanup daily at 3 AM Taiwan time.
        """
        if self._is_started:
            logger.warning("LINE message cleanup scheduler is already started")
            return
        
        # Schedule cleanup to run daily at 3 AM Taiwan time
        self.scheduler.add_job(  # type: ignore
            self._cleanup_old_messages,
            CronTrigger(hour=3, minute=0),  # Run daily at 3 AM Taiwan time
            id="cleanup_line_messages",
            name="Cleanup old LINE messages",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True
        )
        
        self.scheduler.start()
        self._is_started = True
        logger.info("LINE message cleanup scheduler started")
        
        # Run cleanup immediately on startup (but don't block if it fails)
        # Schedule it to run in background to avoid blocking server startup
        try:
            import asyncio
            # Get the current event loop and create a background task
            loop = asyncio.get_event_loop()
            loop.create_task(self._cleanup_old_messages())
            logger.info("Initial cleanup scheduled in background")
        except Exception as e:
            logger.warning(f"Failed to schedule initial cleanup (non-blocking): {e}")
            # Don't raise - allow scheduler to start even if initial cleanup fails
    
    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("LINE message cleanup scheduler stopped")
    
    async def _cleanup_old_messages(self) -> None:
        """
        Clean up old LINE messages.
        
        Deletes all messages older than LINE_MESSAGE_RETENTION_HOURS (10 days).
        """
        try:
            deleted_count = LineMessageCleanupService.cleanup_old_messages()
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old LINE messages")
        except Exception as e:
            logger.exception(f"Error during LINE message cleanup: {e}")
    
    @staticmethod
    def cleanup_old_messages(max_age_hours: int = LINE_MESSAGE_RETENTION_HOURS) -> int:
        """
        Delete LINE messages older than max_age_hours.
        
        This is a time-based cleanup that deletes all messages older than the threshold.
        It's reliable and doesn't depend on external dependencies.
        
        Args:
            max_age_hours: Maximum age in hours before deletion (default: LINE_MESSAGE_RETENTION_HOURS)
            
        Returns:
            int: Number of messages deleted
        """
        try:
            db: Session = SessionLocal()
            try:
                # Use Taiwan timezone to match how created_at is set (via taiwan_now())
                # created_at is stored as TIMESTAMP(timezone=True) with Taiwan timezone (UTC+8)
                cutoff_time = taiwan_now() - timedelta(hours=max_age_hours)
                
                # Delete old messages
                query = text("""
                    DELETE FROM line_messages 
                    WHERE created_at < :cutoff_time
                """)
                
                result = db.execute(query, {"cutoff_time": cutoff_time})
                # Type ignore: SQLAlchemy Result type doesn't expose rowcount in type hints
                rowcount_value = result.rowcount if hasattr(result, 'rowcount') else 0  # type: ignore
                deleted_count: int = int(rowcount_value) if rowcount_value is not None else 0  # type: ignore
                db.commit()
                
                if deleted_count > 0:
                    logger.info(
                        f"Cleaned up {deleted_count} old LINE messages "
                        f"(older than {max_age_hours} hours)"
                    )
                
                return deleted_count
            finally:
                db.close()
                
        except Exception as e:
            logger.exception(f"Error during LINE message cleanup: {e}")
            # Don't raise - cleanup failures shouldn't break the app
            return 0


# Global cleanup service instance
_cleanup_service = None


def get_cleanup_service() -> LineMessageCleanupService:
    """
    Get or create the global LINE message cleanup service.
    
    Returns:
        LineMessageCleanupService: Global cleanup service instance
    """
    global _cleanup_service
    if _cleanup_service is None:
        _cleanup_service = LineMessageCleanupService()
    return _cleanup_service


async def start_line_message_cleanup() -> None:
    """
    Start the global LINE message cleanup scheduler.
    
    This should be called during application startup.
    """
    service = get_cleanup_service()
    await service.start_scheduler()


async def stop_line_message_cleanup() -> None:
    """
    Stop the global LINE message cleanup scheduler.
    
    This should be called during application shutdown.
    """
    service = get_cleanup_service()
    await service.stop_scheduler()

