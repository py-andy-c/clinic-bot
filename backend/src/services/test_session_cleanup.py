# pyright: reportMissingTypeStubs=false
"""
Test session cleanup service.

This module handles periodic cleanup of old test chat sessions using APScheduler.
Implements Option C: time-based cleanup (deletes all test sessions older than threshold).
"""

import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore

from core.constants import MISFIRE_GRACE_TIME_SECONDS
from services.clinic_agent import ClinicAgentService
from utils.datetime_utils import TAIWAN_TZ

logger = logging.getLogger(__name__)


class TestSessionCleanupService:
    """
    Service for cleaning up old test chat sessions.
    
    Uses APScheduler to periodically delete test sessions older than 1 hour.
    This is a safety net for cases where frontend cleanup fails (browser crash, etc.).
    """
    
    def __init__(self):
        """Initialize the cleanup service."""
        # Configure scheduler to use Taiwan timezone to ensure correct timing
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False
    
    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for cleaning up old test sessions.
        
        This should be called during application startup.
        Runs cleanup daily at 3 AM Taiwan time.
        """
        if self._is_started:
            logger.warning("Test session cleanup scheduler is already started")
            return
        
        # Schedule cleanup to run daily at 3 AM Taiwan time
        self.scheduler.add_job(  # type: ignore
            self._cleanup_old_sessions,
            CronTrigger(hour=3, minute=0),  # Run daily at 3 AM Taiwan time
            id="cleanup_test_sessions",
            name="Cleanup old test chat sessions",
            max_instances=1,  # Prevent overlapping runs
            replace_existing=True,
            misfire_grace_time=MISFIRE_GRACE_TIME_SECONDS  # Allow jobs to run up to 15 minutes late
        )
        
        self.scheduler.start()
        self._is_started = True
        logger.info("Test session cleanup scheduler started")
        
        # Run cleanup immediately on startup
        await self._cleanup_old_sessions()
    
    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Test session cleanup scheduler stopped")
    
    async def _cleanup_old_sessions(self) -> None:
        """
        Clean up old test sessions.
        
        Deletes all test sessions older than 1 hour (Option C: time-based).
        Runs daily at 3 AM Taiwan time.
        """
        try:
            deleted_count = await ClinicAgentService.cleanup_old_test_sessions(max_age_hours=1)
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old test sessions")
        except Exception as e:
            logger.exception(f"Error during test session cleanup: {e}")


# Global cleanup service instance
_cleanup_service = None


def get_cleanup_service() -> TestSessionCleanupService:
    """
    Get or create the global test session cleanup service.
    
    Returns:
        TestSessionCleanupService: Global cleanup service instance
    """
    global _cleanup_service
    if _cleanup_service is None:
        _cleanup_service = TestSessionCleanupService()
    return _cleanup_service


async def start_test_session_cleanup() -> None:
    """
    Start the global test session cleanup scheduler.
    
    This should be called during application startup.
    """
    service = get_cleanup_service()
    await service.start_scheduler()


async def stop_test_session_cleanup() -> None:
    """
    Stop the global test session cleanup scheduler.
    
    This should be called during application shutdown.
    """
    service = get_cleanup_service()
    await service.stop_scheduler()

