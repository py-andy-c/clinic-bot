"""
Availability notification service.

Handles sending notifications to LINE users when appointment slots become available
for their configured notification preferences.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Dict, List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
from apscheduler.triggers.cron import CronTrigger  # type: ignore
from sqlalchemy.orm import Session, joinedload

from core.constants import (
    NOTIFICATION_CHECK_HOURS,
    NOTIFICATION_CLEANUP_HOUR,
)
from utils.liff_token import generate_liff_url
from core.database import get_db_context
from models.availability_notification import AvailabilityNotification
from models.clinic import Clinic
from models.line_user import LineUser
from services.availability_service import AvailabilityService
from services.line_service import LINEService
from shared_types.availability import SlotData
from utils.datetime_utils import TAIWAN_TZ, taiwan_now

logger = logging.getLogger(__name__)


@dataclass
class TimeWindowEntry:
    """Represents a time window entry from notification."""
    date_str: str  # YYYY-MM-DD format
    time_window: str  # "morning", "afternoon", or "evening"
    
    def to_date(self) -> date:
        """Convert date string to date object."""
        return datetime.strptime(self.date_str, "%Y-%m-%d").date()


@dataclass
class AvailabilityCacheKey:
    """Key for availability cache."""
    clinic_id: int
    appointment_type_id: int
    practitioner_id: Optional[int]  # None for "不指定"
    date_str: str  # YYYY-MM-DD format
    
    def __hash__(self) -> int:
        """Make hashable for use as dict key."""
        return hash((self.clinic_id, self.appointment_type_id, self.practitioner_id, self.date_str))


@dataclass
class NotificationProcessingResult:
    """Result of processing a notification."""
    notification_id: int
    slots_found: bool
    slots_by_date: Dict[str, List[str]]  # {date_str: [slot_times]}
    success: bool
    error: Optional[str] = None


class AvailabilityNotificationService:
    """
    Service for managing availability notifications.
    
    Sends LINE notifications to users when appointment slots become available
    matching their notification preferences.
    """
    
    def __init__(self):
        """Initialize the notification service."""
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False
    
    async def start_scheduler(self) -> None:
        """Start the notification scheduler."""
        if self._is_started:
            return
        
        # Schedule job to run at 9am, 3pm, 9pm Taiwan time
        self.scheduler.add_job(  # type: ignore[attr-defined]
            self._check_and_send_notifications,
            CronTrigger(hour=",".join(map(str, NOTIFICATION_CHECK_HOURS))),
            id="send_availability_notifications",
            name="Send availability notifications",
            max_instances=1,
            replace_existing=True
        )
        
        # Schedule cleanup job at 3 AM Taiwan time
        self.scheduler.add_job(  # type: ignore[attr-defined]
            self._cleanup_expired_notifications,
            CronTrigger(hour=NOTIFICATION_CLEANUP_HOUR, minute=0),
            id="cleanup_expired_notifications",
            name="Cleanup expired availability notifications",
            max_instances=1,
            replace_existing=True
        )
        
        self.scheduler.start()
        self._is_started = True
        logger.info("Availability notification scheduler started")
        
        # Run notification check immediately on startup to catch up on missed notifications
        # during downtime. Deduplication prevents sending duplicate notifications.
        await self._check_and_send_notifications()
    
    async def stop_scheduler(self) -> None:
        """Stop the notification scheduler."""
        if not self._is_started:
            return
        
        self.scheduler.shutdown(wait=True)
        self._is_started = False
        logger.info("Availability notification scheduler stopped")
    
    async def _check_and_send_notifications(self) -> None:
        """
        Main job function: Check all active notifications and send alerts.
        
        Called by scheduler at 9am, 3pm, 9pm Taiwan time.
        """
        with get_db_context() as db:
            try:
                logger.info("Checking availability notifications...")
                
                today = taiwan_now().date()
                
                # Fetch and filter eligible notifications
                eligible_notifications = self._fetch_and_filter_notifications(db, today)
                
                if not eligible_notifications:
                    logger.info("No eligible notifications to process")
                    return
                
                logger.info(f"Processing {len(eligible_notifications)} eligible notifications")
                
                # Build availability cache (batch queries)
                availability_cache = self._build_availability_cache(
                    db, eligible_notifications, today
                )
                
                # Process each notification
                results: List[NotificationProcessingResult] = []
                for notification in eligible_notifications:
                    result = await self._process_notification(
                        db, notification, today, availability_cache
                    )
                    results.append(result)
                
                # Log summary
                sent_count = sum(1 for r in results if r.success)
                errors_count = sum(1 for r in results if r.error)
                logger.info(
                    f"Notification check complete: "
                    f"processed={len(results)}, "
                    f"sent={sent_count}, "
                    f"errors={errors_count}"
                )
            
            except Exception as e:
                logger.exception(f"Error in notification scheduler: {e}")
    
    def _fetch_and_filter_notifications(
        self, db: Session, today: date
    ) -> List[AvailabilityNotification]:
        """
        Fetch active notifications and filter eligible ones.
        
        Filters by:
        - is_active = True
        - last_notified_date != today (deduplication)
        - Has at least one future date in time_windows
        """
        # Fetch all active notifications with relationships pre-loaded
        active_notifications = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.is_active == True
        ).options(
            # Pre-load relationships to avoid N+1 queries
            joinedload(AvailabilityNotification.appointment_type),
            joinedload(AvailabilityNotification.practitioner, innerjoin=False),
            joinedload(AvailabilityNotification.clinic),
            joinedload(AvailabilityNotification.line_user)
        ).all()
        
        logger.info(f"Found {len(active_notifications)} active notifications")
        
        eligible_notifications: List[AvailabilityNotification] = []
        for notification in active_notifications:
            # Check deduplication: Skip if already notified today
            if notification.last_notified_date == today:
                logger.debug(
                    f"Skipping notification {notification.id}: "
                    f"already notified today ({today})"
                )
                continue
            
            # Check if notification has any future dates
            if not self._has_future_dates(notification, today):
                logger.debug(
                    f"Skipping notification {notification.id}: "
                    f"all dates are in the past"
                )
                continue
            
            eligible_notifications.append(notification)
        
        return eligible_notifications
    
    def _has_future_dates(
        self, notification: AvailabilityNotification, today: date
    ) -> bool:
        """Check if notification has any time windows with future dates."""
        for time_window_entry in notification.time_windows:
            window_date = datetime.strptime(
                time_window_entry["date"],
                "%Y-%m-%d"
            ).date()
            if window_date >= today:
                return True
        return False
    
    def _build_availability_cache(
        self,
        db: Session,
        notifications: List[AvailabilityNotification],
        today: date
    ) -> Dict[AvailabilityCacheKey, List[SlotData]]:
        """
        Build cache of availability data by batching queries.
        
        Groups notifications by (clinic_id, appointment_type_id, practitioner_id, date)
        to avoid redundant availability queries.
        """
        # Collect unique cache keys
        cache_keys: Dict[AvailabilityCacheKey, List[int]] = {}  # notification_ids per key
        
        for notification in notifications:
            for time_window_entry in notification.time_windows:
                date_str = time_window_entry["date"]
                window_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                
                if window_date < today:
                    continue
                
                cache_key = AvailabilityCacheKey(
                    clinic_id=notification.clinic_id,
                    appointment_type_id=notification.appointment_type_id,
                    practitioner_id=notification.practitioner_id,
                    date_str=date_str
                )
                
                if cache_key not in cache_keys:
                    cache_keys[cache_key] = []
                cache_keys[cache_key].append(notification.id)
        
        logger.info(
            f"Need to check {len(cache_keys)} unique availability queries "
            f"for {len(notifications)} notifications"
        )
        
        # Batch fetch availability for all unique combinations
        availability_cache: Dict[AvailabilityCacheKey, List[SlotData]] = {}
        
        for cache_key in cache_keys:
            try:
                slots_data = self._fetch_availability_for_key(db, cache_key)
                availability_cache[cache_key] = slots_data
            except Exception as e:
                logger.error(
                    f"Error checking availability for cache_key {cache_key}: {e}"
                )
                # Continue with other queries
                continue
        
        return availability_cache
    
    def _fetch_availability_for_key(
        self, db: Session, cache_key: AvailabilityCacheKey
    ) -> List[SlotData]:
        """
        Fetch availability slots for a cache key.
        
        Returns list of SlotData objects.
        """
        if cache_key.practitioner_id:
            slots_dicts = AvailabilityService.get_available_slots_for_practitioner(
                db=db,
                practitioner_id=cache_key.practitioner_id,
                date=cache_key.date_str,
                appointment_type_id=cache_key.appointment_type_id,
                clinic_id=cache_key.clinic_id
            )
        else:
            slots_dicts = AvailabilityService.get_available_slots_for_clinic(
                db=db,
                clinic_id=cache_key.clinic_id,
                date=cache_key.date_str,
                appointment_type_id=cache_key.appointment_type_id
            )
        
        # Convert dicts to SlotData objects with error handling
        slots: List[SlotData] = []
        for slot_dict in slots_dicts:
            try:
                slots.append(SlotData.from_dict(slot_dict))
            except (ValueError, KeyError, TypeError) as e:
                logger.warning(f"Invalid slot data: {slot_dict}, error: {e}")
                continue
        return slots
    
    async def _process_notification(
        self,
        db: Session,
        notification: AvailabilityNotification,
        today: date,
        availability_cache: Dict[AvailabilityCacheKey, List[SlotData]]
    ) -> NotificationProcessingResult:
        """
        Process a single notification: collect slots and send if found.
        
        Returns result with success status and error message if failed.
        """
        try:
            # Collect slots for this notification using cached data
            slots_by_date = self._collect_slots_for_notification(
                notification, today, availability_cache
            )
            
            if not slots_by_date:
                logger.debug(f"No slots found for notification {notification.id}")
                return NotificationProcessingResult(
                    notification_id=notification.id,
                    slots_found=False,
                    slots_by_date={},
                    success=False
                )
            
            # Send notification
            success = await self._send_notification(
                db, notification, slots_by_date
            )
            
            if success:
                # Update last_notified_date after successful send
                # Commit immediately to ensure atomicity.
                # Trade-off: Slower but safer - if process crashes,
                # only current notification might be lost, not entire batch.
                notification.last_notified_date = today
                db.commit()
                logger.info(
                    f"Sent notification {notification.id} "
                    f"to LINE user {notification.line_user_id}"
                )
                return NotificationProcessingResult(
                    notification_id=notification.id,
                    slots_found=True,
                    slots_by_date=slots_by_date,
                    success=True
                )
            else:
                logger.error(f"Failed to send notification {notification.id}")
                return NotificationProcessingResult(
                    notification_id=notification.id,
                    slots_found=True,
                    slots_by_date=slots_by_date,
                    success=False,
                    error="Failed to send LINE message"
                )
        
        except Exception as e:
            logger.exception(f"Error processing notification {notification.id}: {e}")
            return NotificationProcessingResult(
                notification_id=notification.id,
                slots_found=False,
                slots_by_date={},
                success=False,
                error=str(e)
            )
    
    def _collect_slots_for_notification(
        self,
        notification: AvailabilityNotification,
        today: date,
        availability_cache: Dict[AvailabilityCacheKey, List[SlotData]]
    ) -> Dict[str, List[str]]:
        """
        Collect all available slots for a notification using cached availability data.
        
        Returns dict mapping date strings to list of slot time strings.
        Example: {"2024-01-15": ["09:00", "10:00", "14:00"], ...}
        """
        slots_by_date: Dict[str, List[str]] = {}
        
        # Group time windows by date
        date_windows: Dict[str, List[str]] = {}  # {date_str: [time_window, ...]}
        
        for time_window_entry in notification.time_windows:
            date_str = time_window_entry["date"]
            time_window = time_window_entry["time_window"]
            
            # Skip past dates
            window_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            if window_date < today:
                continue
            
            if date_str not in date_windows:
                date_windows[date_str] = []
            date_windows[date_str].append(time_window)
        
        # Use cached availability data for each date
        for date_str, time_windows in date_windows.items():
            cache_key = AvailabilityCacheKey(
                clinic_id=notification.clinic_id,
                appointment_type_id=notification.appointment_type_id,
                practitioner_id=notification.practitioner_id,
                date_str=date_str
            )
            
            # Get slots from cache
            slots_data = availability_cache.get(cache_key)
            
            if not slots_data:
                logger.warning(
                    f"No cached availability for notification {notification.id}, "
                    f"cache_key {cache_key}"
                )
                continue
            
            # Filter slots by time windows for this date
            matching_slots: List[str] = []
            for time_window in time_windows:
                filtered_slots = self._filter_slots_by_time_window(
                    slots_data, time_window
                )
                # Extract just the start_time strings
                for slot in filtered_slots:
                    slot_time = slot.start_time
                    if slot_time not in matching_slots:
                        matching_slots.append(slot_time)
            
            if matching_slots:
                # Sort slots by time
                matching_slots.sort()
                slots_by_date[date_str] = matching_slots
        
        return slots_by_date
    
    def _filter_slots_by_time_window(
        self, slots: List[SlotData], time_window: str
    ) -> List[SlotData]:
        """
        Filter slots by time window (morning/afternoon/evening).
        
        Args:
            slots: List of SlotData objects
            time_window: "morning", "afternoon", or "evening"
        
        Returns:
            Filtered list of slots within the time window
        """
        window_ranges = {
            "morning": (8, 12),      # 08:00-12:00
            "afternoon": (12, 18),   # 12:00-18:00
            "evening": (18, 22),     # 18:00-22:00
        }
        
        start_hour, end_hour = window_ranges[time_window]
        filtered: List[SlotData] = []
        
        for slot in slots:
            # Parse start_time (format: "HH:MM" or "HH:MM:SS")
            hour, _ = map(int, slot.start_time.split(':')[:2])
            
            # Check if slot is within time window
            if start_hour <= hour < end_hour:
                filtered.append(slot)
        
        return filtered
    
    async def _send_notification(
        self,
        db: Session,
        notification: AvailabilityNotification,
        slots_by_date: Dict[str, List[str]]
    ) -> bool:
        """
        Send LINE notification message with batched slots.
        
        Returns:
            True if sent successfully, False otherwise
        """
        try:
            # Get clinic for LINE service credentials
            clinic = db.query(Clinic).filter(Clinic.id == notification.clinic_id).first()
            if not clinic or not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.error(f"Clinic {notification.clinic_id} missing LINE credentials")
                return False
            
            # Get LINE user
            line_user = db.query(LineUser).filter(LineUser.id == notification.line_user_id).first()
            if not line_user:
                logger.error(f"LINE user {notification.line_user_id} not found")
                return False
            
            # Format full message text (without URL)
            full_message_text = self._format_notification_message(
                notification, slots_by_date, clinic, db
            )
            
            if not full_message_text:
                logger.error(f"Failed to format message for notification {notification.id}")
                return False
            
            # Generate LIFF URL for button
            liff_url = self._generate_liff_url(notification, clinic)
            if not liff_url:
                logger.error(f"Failed to generate LIFF URL for notification {notification.id}")
                return False
            
            # Send LINE messages
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            
            # Labels for tracking push messages
            labels = {
                'recipient_type': 'patient',
                'event_type': 'availability_notification',
                'trigger_source': 'system_triggered',
                'notification_context': 'new_slots_available'
            }
            
            # Check if message fits in template (160 char limit)
            if len(full_message_text) <= 160:
                # Single template message with button and full text
                line_service.send_template_message_with_button(
                    line_user_id=line_user.line_user_id,
                    text=full_message_text,
                    button_label="立即預約",
                    button_uri=liff_url,
                    db=db,
                    clinic_id=clinic.id,
                    labels=labels
                )
            else:
                # Message too long: send text message first, then template with button only
                # Send full details as text message with labels for tracking
                line_service.send_text_message(
                    line_user_id=line_user.line_user_id,
                    text=full_message_text,
                    db=db,
                    clinic_id=clinic.id,
                    labels=labels
                )
                
                # Send template message with button only (minimal text - LINE requires non-empty text)
                # Using a single space as minimal text since full details are already in the text message
                # No need to track this one since the text message above is already tracked
                line_service.send_template_message_with_button(
                    line_user_id=line_user.line_user_id,
                    text=" ",  # Minimal text (LINE requires non-empty text)
                    button_label="立即預約",
                    button_uri=liff_url
                )
            
            return True
        
        except Exception as e:
            logger.exception(f"Error sending notification: {e}")
            return False
    
    def _format_notification_message(
        self,
        notification: AvailabilityNotification,
        slots_by_date: Dict[str, List[str]],
        clinic: Clinic,
        db: Session
    ) -> str:
        """
        Format batched notification message text (without URL).
        
        The URL will be added as a button in the template message.
        
        Example output:
        【空位提醒】您關注的預約時段有新的空位了！
        
        預約類型：物理治療
        治療師：不指定
        
        可用時間：
        01/15 (一): 09:00 AM, 10:00 AM, 02:00 PM
        01/16 (二): 09:00 AM, 11:00 AM
        """
        # Get appointment type name (with null check)
        if not notification.appointment_type:
            logger.error(f"Notification {notification.id} has deleted appointment type")
            return ""
        
        appointment_type_name = notification.appointment_type.name
        
        # Get practitioner name
        # Note: User model doesn't have full_name directly, it's accessed via UserClinicAssociation
        practitioner_name = "不指定"
        if notification.practitioner:
            # Get name from association if available
            from models.user_clinic_association import UserClinicAssociation
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == notification.practitioner.id,
                UserClinicAssociation.clinic_id == notification.clinic_id,
                UserClinicAssociation.is_active == True
            ).first()
            if association:
                practitioner_name = association.full_name
            else:
                # Fallback to email if no association found
                practitioner_name = notification.practitioner.email
        
        # Format slots by date
        slots_lines: List[str] = []
        for date_str in sorted(slots_by_date.keys()):
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
            
            # Format date: "01/15 (一)"
            formatted_date = self._format_date_for_display(date_obj)
            
            # Format slots: "09:00 AM, 10:00 AM, 02:00 PM"
            formatted_slots = self._format_slots(slots_by_date[date_str])
            
            slots_lines.append(f"{formatted_date}: {formatted_slots}")
        
        # Build message (without URL - URL will be in button)
        message = f"""【空位提醒】您關注的預約時段有新的空位了！

預約類型：{appointment_type_name}
治療師：{practitioner_name}

可用時間：
{chr(10).join(slots_lines)}"""
        
        return message
    
    def _format_date_for_display(self, date_obj: date) -> str:
        """Format date as 'MM/DD (weekday)'."""
        weekday_map = {
            0: '一', 1: '二', 2: '三', 3: '四',
            4: '五', 5: '六', 6: '日'
        }
        weekday_cn = weekday_map[date_obj.weekday()]
        return f"{date_obj.strftime('%m/%d')} ({weekday_cn})"
    
    def _format_slots(self, slots: List[str]) -> str:
        """Format slot times as '09:00 AM, 10:00 AM, 02:00 PM'."""
        formatted: List[str] = []
        for slot_time in slots:
            # Parse "09:00" or "09:00:00"
            hour, minute = map(int, slot_time.split(':')[:2])
            
            # Convert to 12-hour format
            if hour == 0:
                hour_12 = 12
                period = 'AM'
            elif hour < 12:
                hour_12 = hour
                period = 'AM'
            elif hour == 12:
                hour_12 = 12
                period = 'PM'
            else:
                hour_12 = hour - 12
                period = 'PM'
            
            formatted.append(f"{hour_12}:{minute:02d} {period}")
        
        return ", ".join(formatted)
    
    def _generate_liff_url(
        self, notification: AvailabilityNotification, clinic: Clinic
    ) -> str:
        """
        Generate LIFF URL for booking page.

        Uses secure clinic_token instead of clinic_id for better security.
        Falls back to clinic_id for backward compatibility if token not available.

        Example: https://liff.line.me/{liff_id}?mode=book&clinic_token=...
        """
        # Use the shared utility function for consistency
        return generate_liff_url(clinic, mode="book")
    
    async def _cleanup_expired_notifications(self) -> None:
        """Set is_active=False for notifications where all dates are in the past."""
        with get_db_context() as db:
            try:
                today = taiwan_now().date()
                
                # Get all active notifications
                active_notifications = db.query(AvailabilityNotification).filter(
                    AvailabilityNotification.is_active == True
                ).all()
                
                expired_count = 0
                for notification in active_notifications:
                    # Check if all dates are in the past
                    all_past = True
                    for time_window_entry in notification.time_windows:
                        window_date = datetime.strptime(
                            time_window_entry["date"],
                            "%Y-%m-%d"
                        ).date()
                        if window_date >= today:
                            all_past = False
                            break
                    
                    if all_past:
                        notification.is_active = False
                        expired_count += 1
                
                if expired_count > 0:
                    db.commit()
                    logger.info(f"Cleaned up {expired_count} expired notifications")
            except Exception as e:
                logger.exception(f"Error during notification cleanup: {e}")


# Global service instance
_availability_notification_service: Optional[AvailabilityNotificationService] = None


async def start_availability_notification_scheduler() -> None:
    """Start the availability notification scheduler."""
    global _availability_notification_service
    if _availability_notification_service is None:
        _availability_notification_service = AvailabilityNotificationService()
    await _availability_notification_service.start_scheduler()


async def stop_availability_notification_scheduler() -> None:
    """Stop the availability notification scheduler."""
    global _availability_notification_service
    if _availability_notification_service is not None:
        await _availability_notification_service.stop_scheduler()
        _availability_notification_service = None

