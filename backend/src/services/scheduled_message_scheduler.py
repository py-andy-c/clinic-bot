"""
Scheduled message scheduler for sending scheduled LINE messages.

This scheduler runs hourly to send all pending scheduled messages
(follow-ups, reminders, etc.) that are due to be sent.
"""

import logging
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore

from core.constants import REMINDER_SCHEDULER_MAX_INSTANCES
from core.database import get_db_context
from services.scheduled_message_service import ScheduledMessageService
from utils.datetime_utils import TAIWAN_TZ

logger = logging.getLogger(__name__)


class ScheduledMessageScheduler:
    """
    Scheduler for sending scheduled LINE messages.
    
    This service schedules and sends all scheduled LINE messages (follow-ups,
    reminders, practitioner notifications, etc.) via hourly cron job.
    """

    def __init__(self):
        """
        Initialize the scheduled message scheduler.
        
        Note: Database sessions are created fresh for each scheduler run
        to avoid stale session issues. Do not pass a session here.
        """
        # Configure scheduler to use Taiwan timezone to ensure correct timing
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False

    async def start_scheduler(self) -> None:
        """
        Start the background scheduler for sending scheduled messages.
        
        This should be called during application startup.
        """
        if self._is_started:
            logger.warning("Scheduled message scheduler is already started")
            return

        # Schedule to run every hour
        self.scheduler.add_job(  # type: ignore
            self._send_pending_messages,
            CronTrigger(hour="*"),  # Run every hour
            id="send_scheduled_messages",
            name="Send scheduled LINE messages",
            max_instances=REMINDER_SCHEDULER_MAX_INSTANCES,  # Prevent overlapping runs
            replace_existing=True
        )

        self.scheduler.start()
        self._is_started = True
        logger.info("Scheduled message scheduler started")
        
        # Run immediately on startup to catch up on missed messages
        from datetime import datetime
        startup_task_start = datetime.utcnow()
        logger.info(f"[{startup_task_start.isoformat()}Z] [STARTUP] Starting immediate _send_pending_messages() task...")
        await self._send_pending_messages()
        startup_task_duration = (datetime.utcnow() - startup_task_start).total_seconds()
        logger.info(f"[{datetime.utcnow().isoformat()}Z] [STARTUP] Immediate _send_pending_messages() task completed (took {startup_task_duration:.2f}s)")

    async def stop_scheduler(self) -> None:
        """
        Stop the background scheduler.
        
        This should be called during application shutdown.
        """
        if self._is_started:
            self.scheduler.shutdown(wait=True)
            self._is_started = False
            logger.info("Scheduled message scheduler stopped")

    async def _send_pending_messages(self) -> None:
        """
        Send all pending scheduled messages.
        
        This method is called by the scheduler every hour to send
        all scheduled messages that are due.
        
        Uses a fresh database session for each run to avoid stale session issues.
        """
        # Use fresh database session for each scheduler run
        with get_db_context() as db:
            try:
                logger.info("Checking for pending scheduled messages...")
                ScheduledMessageService.send_pending_messages(db)
                logger.info("Finished processing pending scheduled messages")
            except Exception as e:
                logger.exception(f"Error sending pending scheduled messages: {e}")


# Global scheduler instance
_scheduled_message_scheduler: Optional[ScheduledMessageScheduler] = None


def get_scheduled_message_scheduler() -> ScheduledMessageScheduler:
    """
    Get the global scheduled message scheduler instance.
    
    Returns:
        The global scheduled message scheduler instance
    """
    global _scheduled_message_scheduler
    if _scheduled_message_scheduler is None:
        _scheduled_message_scheduler = ScheduledMessageScheduler()
    return _scheduled_message_scheduler


async def start_scheduled_message_scheduler() -> None:
    """
    Start the global scheduled message scheduler.
    
    This should be called during application startup.
    Note: Database sessions are created fresh for each scheduler run.
    """
    scheduler = get_scheduled_message_scheduler()
    await scheduler.start_scheduler()


async def stop_scheduled_message_scheduler() -> None:
    """
    Stop the global scheduled message scheduler.
    
    This should be called during application shutdown.
    """
    global _scheduled_message_scheduler
    if _scheduled_message_scheduler:
        await _scheduled_message_scheduler.stop_scheduler()

