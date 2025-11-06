"""
Datetime utilities for consistent timezone handling across the application.

This module provides utilities to ensure all datetime operations use timezone-aware
datetimes consistently. All times are in Taiwan timezone (UTC+8) for business logic.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional

# Taiwan timezone constant (UTC+8)
TAIWAN_TZ = timezone(timedelta(hours=8))


def taiwan_now() -> datetime:
    """
    Get current Taiwan datetime (UTC+8).
    
    All business logic in the application uses Taiwan timezone.
    
    Returns:
        Current datetime with Taiwan timezone (UTC+8)
    """
    return datetime.now(TAIWAN_TZ)


def ensure_taiwan(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Ensure a datetime is timezone-aware with Taiwan timezone.
    
    Args:
        dt: Datetime to ensure is Taiwan timezone-aware
        
    Returns:
        Timezone-aware datetime in Taiwan timezone, or None if input is None
    """
    if dt is None:
        return None
    
    if dt.tzinfo is None:
        # If naive, assume it's already in Taiwan time and localize it
        return dt.replace(tzinfo=TAIWAN_TZ)
    else:
        # If already timezone-aware, convert to Taiwan timezone
        return dt.astimezone(TAIWAN_TZ)


def format_datetime(dt: datetime) -> str:
    """
    Format datetime for user-facing display in Taiwan timezone.
    
    Formats datetime as: "12/25 (三) 1:30 PM"
    - Month/day in MM/DD format
    - Traditional Chinese weekday in parentheses
    - 12-hour time format with AM/PM
    
    Used for all user-facing messages (appointments, notifications, reminders, etc.)
    to ensure consistent date/time formatting across the platform.
    
    The datetime is stored as naive but represents Taiwan time.
    Localize it to Taiwan timezone for formatting.
    
    Args:
        dt: Datetime to format (naive or timezone-aware)
        
    Returns:
        Formatted datetime string in format "MM/DD (weekday) H:MM AM/PM"
    """
    # Ensure datetime is in Taiwan timezone
    local_datetime = ensure_taiwan(dt)
    if local_datetime is None:
        raise ValueError("Cannot format None datetime")
    
    # Format weekday in Traditional Chinese
    weekday_map = {
        0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六'
    }
    weekday_cn = weekday_map[local_datetime.weekday()]
    
    # Format time in 12-hour AM/PM format
    hour = local_datetime.hour
    minute = local_datetime.minute
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
    
    time_str = f"{hour_12}:{minute:02d} {period}"
    
    return f"{local_datetime.strftime('%m/%d')} ({weekday_cn}) {time_str}"
