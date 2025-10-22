"""
Datetime utilities for consistent timezone handling across the application.

This module provides utilities to ensure all datetime operations use timezone-aware
datetimes consistently, preventing timezone-related bugs.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional


def utc_now() -> datetime:
    """
    Get current UTC datetime.
    
    Returns:
        Current datetime with UTC timezone
    """
    return datetime.now(timezone.utc)


def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Ensure a datetime is timezone-aware with UTC timezone.
    
    Args:
        dt: Datetime to ensure is UTC timezone-aware
        
    Returns:
        Timezone-aware datetime in UTC, or None if input is None
    """
    if dt is None:
        return None
    
    if dt.tzinfo is None:
        # If naive, assume it's UTC
        return dt.replace(tzinfo=timezone.utc)
    else:
        # If already timezone-aware, convert to UTC
        return dt.astimezone(timezone.utc)


def safe_datetime_diff(dt1: datetime, dt2: datetime) -> timedelta:
    """
    Safely calculate the difference between two datetimes, handling timezone issues.
    
    Args:
        dt1: First datetime
        dt2: Second datetime
        
    Returns:
        Timedelta representing the difference (dt1 - dt2)
    """
    # Ensure both datetimes are timezone-aware
    dt1_utc = ensure_utc(dt1)
    dt2_utc = ensure_utc(dt2)
    
    if dt1_utc is None or dt2_utc is None:
        raise ValueError("Cannot calculate difference with None datetimes")
    
    return dt1_utc - dt2_utc


def is_within_hours(dt1: datetime, dt2: datetime, hours: int) -> bool:
    """
    Check if two datetimes are within a specified number of hours.
    
    Args:
        dt1: First datetime
        dt2: Second datetime  
        hours: Number of hours to check within
        
    Returns:
        True if the difference is within the specified hours
    """
    diff = safe_datetime_diff(dt1, dt2)
    return abs(diff) <= timedelta(hours=hours)
