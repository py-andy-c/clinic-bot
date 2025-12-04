"""
Datetime utilities for consistent timezone handling across the application.

This module provides utilities to ensure all datetime operations use timezone-aware
datetimes consistently. All times are in Taiwan timezone (UTC+8) for business logic.
"""

import logging
from datetime import datetime, timezone, timedelta, date
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
    # Python's weekday() returns 0=Monday, 1=Tuesday, ..., 6=Sunday
    weekday_map = {
        0: '一', 1: '二', 2: '三', 3: '四', 4: '五', 5: '六', 6: '日'
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


def parse_datetime_string_to_taiwan(dt_str: str) -> datetime:
    """
    Parse an ISO format datetime string and convert to Taiwan timezone.
    
    Handles various datetime string formats:
    - ISO format with timezone (e.g., "2024-01-01T09:00:00+08:00")
    - ISO format with Z (UTC) (e.g., "2024-01-01T01:00:00Z")
    - ISO format without timezone (assumes Taiwan time)
    
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
