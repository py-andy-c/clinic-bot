"""
Datetime utilities for consistent timezone handling across the application.

This module provides utilities to ensure all datetime operations use timezone-aware
datetimes consistently. All times are in Taiwan timezone (UTC+8) for business logic.
"""

from __future__ import annotations
import logging
from datetime import datetime, timezone, timedelta, date, time
from typing import Optional

logger = logging.getLogger(__name__)

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
    
    Formats datetime as: "12/25 (三) 13:30"
    - Month/day in MM/DD format
    - Traditional Chinese weekday in parentheses
    - 24-hour time format (HH:MM)
    
    Used for all user-facing messages (appointments, notifications, reminders, etc.)
    to ensure consistent date/time formatting across the platform.
    
    The datetime is stored as naive but represents Taiwan time.
    Localize it to Taiwan timezone for formatting.
    
    Args:
        dt: Datetime to format (naive or timezone-aware)
        
    Returns:
        Formatted datetime string in format "MM/DD (weekday) HH:MM"
    """
    # Ensure datetime is in Taiwan timezone
    local_datetime = ensure_taiwan(dt)
    if local_datetime is None:
        raise ValueError("Cannot format None datetime")
    
    # Format weekday in Traditional Chinese
    # Python's weekday() returns 0=Monday, 1=Tuesday, ..., 6=Sunday
    weekday_map = {
        0: '一', 1: '二', 2: '三', 3: '四', 4: '五', 5: '六', 6: '日'
    }
    weekday_cn = weekday_map[local_datetime.weekday()]
    
    # Format time in 24-hour format (HH:MM)
    hour = local_datetime.hour
    minute = local_datetime.minute
    time_str = f"{hour:02d}:{minute:02d}"
    
    return f"{local_datetime.strftime('%m/%d')} ({weekday_cn}) {time_str}"


def parse_datetime_string_to_taiwan(dt_str: str) -> datetime:
    """
    Parse an ISO format datetime string and convert to Taiwan timezone.
    
    Handles various datetime string formats:
    - ISO format with timezone (e.g., "2024-01-01T09:00:00+08:00")
    - ISO format with Z (UTC) (e.g., "2024-01-01T01:00:00Z")
    - ISO format without timezone (assumes Taiwan time)
    
    IMPORTANT: If the input datetime string has no timezone information (naive),
    it is assumed to already represent Taiwan time. This is the expected behavior
    for frontend inputs, which should always send timezone-aware strings using
    moment.tz() with 'Asia/Taipei'. If a naive datetime is received, it may
    indicate a bug in the frontend or integration code.
    
    Args:
        dt_str: ISO format datetime string
        
    Returns:
        Datetime object in Taiwan timezone
        
    Raises:
        ValueError: If datetime string cannot be parsed
    """
    try:
        # Replace Z with +00:00 for UTC
        dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
        # Convert to Taiwan timezone
        if dt.tzinfo:
            return dt.astimezone(TAIWAN_TZ)
        else:
            # No timezone, assume Taiwan time
            # NOTE: Frontend should always send timezone-aware strings. If we receive
            # a naive datetime, log a warning for debugging (but don't fail, as this
            # may be intentional for some edge cases)
            logger.debug(
                f"Received naive datetime string (no timezone): {dt_str}. "
                f"Assuming Taiwan time. Frontend should send timezone-aware strings."
            )
            return dt.replace(tzinfo=TAIWAN_TZ)
    except ValueError:
        # Fallback: try to parse without timezone handling
        try:
            dt = datetime.fromisoformat(dt_str)
            return dt.replace(tzinfo=TAIWAN_TZ)
        except ValueError as e:
            raise ValueError(f"Invalid datetime string format: {dt_str}") from e


def parse_datetime_to_taiwan(v: str | datetime) -> datetime:
    """
    Parse datetime from string or return datetime object, ensuring Taiwan timezone.
    
    This is a unified function that handles both string and datetime inputs,
    consolidating logic from multiple locations in the codebase.
    
    Args:
        v: Either a datetime string or a datetime object
        
    Returns:
        Datetime object in Taiwan timezone
        
    Raises:
        ValueError: If datetime string cannot be parsed
    """
    if isinstance(v, str):
        return parse_datetime_string_to_taiwan(v)
    else:
        # v is datetime
        result = ensure_taiwan(v)
        if result is None:
            raise ValueError("Cannot parse None datetime")
        return result


def parse_date_string(date_str: str) -> date:
    """
    Parse a date string in YYYY-MM-DD or YYYY/MM/DD format.

    Accepts both formats:
    - YYYY-MM-DD (e.g., "2022-01-01", "2022-1-1")
    - YYYY/MM/DD (e.g., "2022/01/01", "2022/1/1")

    Automatically normalizes single-digit months/days.

    Args:
        date_str: Date string in YYYY-MM-DD or YYYY/MM/DD format

    Returns:
        Date object

    Raises:
        ValueError: If date string cannot be parsed
    """
    if not date_str or not date_str.strip():
        raise ValueError("Date string cannot be empty")

    date_str = date_str.strip()

    # Normalize separators and pad single-digit months/days
    # Try to detect separator (either - or /)
    if '/' in date_str:
        parts = date_str.split('/')
    elif '-' in date_str:
        parts = date_str.split('-')
    else:
        raise ValueError(f"Invalid date format (expected YYYY-MM-DD or YYYY/MM/DD): {date_str}")

    if len(parts) != 3:
        raise ValueError(f"Invalid date format (expected YYYY-MM-DD or YYYY/MM/DD): {date_str}")

    # Pad year, month, day to ensure proper format
    year = parts[0].zfill(4)  # Ensure 4 digits
    month = parts[1].zfill(2)  # Ensure 2 digits
    day = parts[2].zfill(2)    # Ensure 2 digits

    # Normalize to YYYY-MM-DD format for parsing
    normalized = f"{year}-{month}-{day}"

    try:
        return datetime.strptime(normalized, '%Y-%m-%d').date()
    except ValueError as e:
        raise ValueError(f"Invalid date format (expected YYYY-MM-DD or YYYY/MM/DD): {date_str}") from e


def parse_time_12h_to_24h(time_12h: str) -> str:
    """
    Parse 12-hour format time string to 24-hour format (HH:MM).
    
    Accepts formats like:
    - "9:00 PM" or "9:00PM" (with or without space)
    - "09:00 PM" or "09:00PM"
    - "9:00 AM" or "9:00AM"
    - "12:00 AM" (midnight) -> "00:00"
    - "12:00 PM" (noon) -> "12:00"
    
    This function stores time internally as 24-hour format (HH:MM) for easy
    migration to 24-hour format in the future. The UI can display 12-hour format
    by converting back using format_time_24h_to_12h.
    
    Args:
        time_12h: Time string in 12-hour format (e.g., "9:00 PM")
        
    Returns:
        Time string in 24-hour format (e.g., "21:00")
        
    Raises:
        ValueError: If time string cannot be parsed
    """
    import re
    
    if not time_12h or not time_12h.strip():
        raise ValueError("Time string cannot be empty")
    
    time_12h = time_12h.strip().upper()
    
    # Pattern to match: hour:minute AM/PM (with or without space)
    # Examples: "9:00 PM", "9:00PM", "09:00 AM", "12:00 PM"
    pattern = r'^(\d{1,2}):(\d{2})\s*(AM|PM)$'
    match = re.match(pattern, time_12h)
    
    if not match:
        raise ValueError(f"Invalid 12-hour time format (expected H:MM AM/PM): {time_12h}")
    
    hour = int(match.group(1))
    minute = int(match.group(2))
    period = match.group(3)
    
    # Validate hour and minute ranges
    if hour < 1 or hour > 12:
        raise ValueError(f"Invalid hour (must be 1-12): {hour}")
    if minute < 0 or minute > 59:
        raise ValueError(f"Invalid minute (must be 0-59): {minute}")
    
    # Convert to 24-hour format
    if period == 'AM':
        if hour == 12:
            hour_24 = 0  # 12:00 AM = 00:00
        else:
            hour_24 = hour
    else:  # PM
        if hour == 12:
            hour_24 = 12  # 12:00 PM = 12:00
        else:
            hour_24 = hour + 12
    
    # Return as HH:MM string
    return f"{hour_24:02d}:{minute:02d}"


def format_time_24h_to_12h(time_24h: str) -> str:
    """
    Format 24-hour format time string (HH:MM) to 12-hour format (H:MM AM/PM).
    
    Converts time strings like:
    - "21:00" -> "9:00 PM"
    - "09:00" -> "9:00 AM"
    - "00:00" -> "12:00 AM"
    - "12:00" -> "12:00 PM"

    .. deprecated::
        This function is deprecated. Use 24-hour format directly instead.
        Kept for backward compatibility during migration period.

    Args:
        time_24h: Time string in 24-hour format (e.g., "21:00")
        
    Returns:
        Time string in 12-hour format (e.g., "9:00 PM")
        
    Raises:
        ValueError: If time string cannot be parsed
    """
    
    if not time_24h or not time_24h.strip():
        raise ValueError("Time string cannot be empty")
    
    time_24h = time_24h.strip()
    
    # Parse HH:MM format
    try:
        hour, minute = map(int, time_24h.split(':'))
    except ValueError:
        raise ValueError(f"Invalid 24-hour time format (expected HH:MM): {time_24h}")
    
    # Validate ranges
    if hour < 0 or hour > 23:
        raise ValueError(f"Invalid hour (must be 0-23): {hour}")
    if minute < 0 or minute > 59:
        raise ValueError(f"Invalid minute (must be 0-59): {minute}")
    
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
    
    # Return as H:MM AM/PM (no leading zero on hour for display)
    return f"{hour_12}:{minute:02d} {period}"


def parse_time_12h_to_time_object(time_12h: str):
    """
    Parse 12-hour format time string to Python time object.
    
    Convenience function that combines parse_time_12h_to_24h and time parsing.
    
    Args:
        time_12h: Time string in 12-hour format (e.g., "9:00 PM")
        
    Returns:
        time object
        
    Raises:
        ValueError: If time string cannot be parsed
    """
    from datetime import time as time_type
    
    time_24h = parse_time_12h_to_24h(time_12h)
    hour, minute = map(int, time_24h.split(':'))
    return time_type(hour, minute)


def parse_deadline_time_string(time_str: str, default_hour: int = 8, default_minute: int = 0) -> time:
    """
    Parse deadline time string (24-hour format HH:MM) to time object.
    
    Utility function to reduce code duplication for deadline time parsing.
    
    Args:
        time_str: Time string in 24-hour format (e.g., "08:00")
        default_hour: Default hour if parsing fails (default: 8)
        default_minute: Default minute if parsing fails (default: 0)
        
    Returns:
        time object
    """
    if not time_str:
        return time(default_hour, default_minute)
    
    try:
        hour, minute = map(int, time_str.split(':'))
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            return time(default_hour, default_minute)
        return time(hour, minute)
    except (ValueError, AttributeError):
        return time(default_hour, default_minute)


def datetime_validator(field_name: str = 'start_time'):
    """
    Create a reusable Pydantic validator for datetime fields.
    
    This validator can be used in Pydantic model_validator decorators to
    automatically parse datetime strings to Taiwan timezone.
    
    Usage example:
        ```python
        class MyModel(BaseModel):
            start_time: datetime
            
            @model_validator(mode='before')
            @classmethod
            def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
                return datetime_validator('start_time')(cls, values)
        ```
    
    The validator will:
    - Parse ISO format datetime strings to Taiwan timezone
    - Handle timezone-aware and naive datetime strings
    - Log parsing errors at debug level (Pydantic will still validate)
    
    Args:
        field_name: Name of the datetime field to parse (default: 'start_time')
        
    Returns:
        Validator function for use in Pydantic models
    """
    from typing import Dict, Any
    
    # Type: ignore for cls parameter - Pydantic validators use dynamic typing
    # The cls parameter is provided by Pydantic at runtime, type checking can't verify it
    def validator(cls: Any, values: Dict[str, Any]) -> Dict[str, Any]:  # pyright: ignore[reportUnknownParameterType, reportMissingParameterType]
        if field_name in values and values.get(field_name):
            if isinstance(values[field_name], str):
                try:
                    values[field_name] = parse_datetime_string_to_taiwan(values[field_name])
                except ValueError as e:
                    # Log the error for debugging, but let Pydantic handle validation
                    logger.debug(
                        f"Failed to parse datetime string for field '{field_name}': "
                        f"{values[field_name]}, error: {e}. Pydantic will handle validation."
                    )
                    # Let Pydantic handle the error with its own validation
                    pass
        return values
    return validator
