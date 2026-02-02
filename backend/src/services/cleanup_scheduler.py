"""
Cleanup scheduler for medical records and photos.

This scheduler runs daily to:
1. Hard delete soft-deleted medical records older than 30 days
2. Clean up abandoned photo uploads (is_pending=True) older than 30 days
3. Garbage collect unreferenced S3 objects older than 31 days
"""

import logging
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore

from utils.datetime_utils import TAIWAN_TZ
from core.database import get_db_context
from services.cleanup_service import CleanupService

logger = logging.getLogger(__name__)

# Global singleton instance
_cleanup_scheduler: Optional['CleanupScheduler'] = None


class CleanupScheduler:
    """
    Scheduler for running cleanup tasks.
    
    Runs daily at 3 AM Taiwan time to:
    - Clean up soft-deleted medical records and photos
    - Garbage collect unreferenced S3 objects
    """

    def __init__(self):
        """
        Initialize the cleanup scheduler.
        
        Note: Database sessions are created fresh for each scheduler run
        to avoid stale session issues.
        """
        # Configure scheduler to use Taiwan timezone (UTC+8)
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False

    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for cleanup tasks.
        
        This should be called during application startup.
        Note: Database sessions are created fresh for each scheduler run.
        """
        if self._is_started:
            logger.warning("Cleanup scheduler is already started")
            return

        # Schedule cleanup to run daily at 3 AM Taiwan time
        # This is a low-traffic time to minimize impact on users
        self.scheduler.add_job(  # type: ignore
            self._run_cleanup,
            CronTrigger(hour=3, minute=0),  # Run at 3:00 AM daily
            id="medical_record_cleanup",
            name="Medical record and photo cleanup",
            replace_existing=True,
            misfire_grace_time=3600,  # Allow 1 hour grace time if server was down
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Cleanup scheduler started (runs daily at 3 AM Taiwan time)")

    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Cleanup scheduler stopped")

    async def _run_cleanup(self) -> None:
        """
        Run cleanup tasks.
        
        This method is called by the scheduler daily at 3 AM.
        Uses a fresh database session for each run to avoid stale session issues.
        
        Note: Offloads blocking operations to a thread pool to prevent blocking
        the main asyncio event loop and freezing the FastAPI application.
        """
        logger.info("Starting scheduled cleanup tasks...")
        
        # Run blocking cleanup logic in a separate thread to avoid blocking the event loop
        import asyncio
        await asyncio.to_thread(self._execute_cleanup_logic)

    def _execute_cleanup_logic(self) -> None:
        """
        Execute the actual cleanup logic (synchronous/blocking operations).
        
        This method runs in a thread pool to avoid blocking the main event loop.
        """
        # Use fresh database session for each scheduler run
        with get_db_context() as db:
            try:
                cleanup_service = CleanupService(db)
                
                # Run cleanup tasks
                logger.info("Running soft-deleted data cleanup...")
                deleted_count = cleanup_service.cleanup_soft_deleted_data(retention_days=30)
                logger.info(f"Cleaned up {deleted_count} soft-deleted records")
                
                logger.info("Running S3 garbage collection...")
                gc_count = cleanup_service.garbage_collect_s3(dry_run=False, prefix="clinic_assets/")
                logger.info(f"Garbage collected {gc_count} unreferenced S3 objects")
                
                logger.info("✅ Scheduled cleanup tasks completed successfully")
                
            except Exception as e:
                logger.exception(f"❌ Error during scheduled cleanup: {e}")
                # Don't re-raise - allow scheduler to continue


def get_cleanup_scheduler() -> CleanupScheduler:
    """
    Get the global cleanup scheduler instance.
    
    Returns:
        CleanupScheduler: The global scheduler instance
    """
    global _cleanup_scheduler
    if _cleanup_scheduler is None:
        _cleanup_scheduler = CleanupScheduler()
    return _cleanup_scheduler


async def start_cleanup_scheduler() -> None:
    """
    Start the global cleanup scheduler.
    
    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    scheduler = get_cleanup_scheduler()
    await scheduler.start_scheduler()


async def stop_cleanup_scheduler() -> None:
    """
    Stop the global cleanup scheduler.
    
    This should be called during application shutdown.
    """
    global _cleanup_scheduler
    if _cleanup_scheduler:
        await _cleanup_scheduler.stop_scheduler()
