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
