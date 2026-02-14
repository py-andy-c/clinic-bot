"""
Timing calculation utilities for scheduled messages.

This module provides shared timing calculation logic for both follow-up messages
and patient form automation. It handles both 'before' and 'after' timing modes
with support for hours-based and specific-time-based scheduling.
"""

import logging
from datetime import datetime, timedelta, time as time_type
from typing import Optional, Literal

from utils.datetime_utils import ensure_taiwan

logger = logging.getLogger(__name__)


def calculate_scheduled_time(
    reference_time: datetime,
    timing_type: Literal['before', 'after'],
    timing_mode: Literal['hours', 'specific_time', 'hours_after'],
    hours: Optional[int] = None,
    days: Optional[int] = None,
    time_of_day: Optional[time_type] = None
) -> datetime:
    """
    Calculate scheduled send time based on timing configuration.
    
    This is a unified timing calculation function that supports both:
    - Follow-up messages (after appointments)
    - Patient forms (before or after appointments)
    
    Args:
        reference_time: Reference datetime (appointment start for 'before', end for 'after')
        timing_type: 'before' or 'after' the reference time
        timing_mode: 'hours', 'specific_time', or 'hours_after' (legacy)
        hours: For hours mode: X hours before/after reference time (x >= 0)
        days: For specific_time mode: Y days before/after reference date (y >= 0)
        time_of_day: For specific_time mode: specific time (e.g., 09:00)
        
    Returns:
        Scheduled send time
        
    Raises:
        ValueError: If parameters are invalid or inconsistent
        
    Examples:
        # 2 hours after appointment end
        calculate_scheduled_time(end_time, 'after', 'hours', hours=2)
        
        # 1 day before appointment at 09:00
        calculate_scheduled_time(start_time, 'before', 'specific_time', days=1, time_of_day=time(9, 0))
        
        # 3 days after appointment at 21:00
        calculate_scheduled_time(end_time, 'after', 'specific_time', days=3, time_of_day=time(21, 0))
    """
    ref_time = ensure_taiwan(reference_time)
    if ref_time is None:
        raise ValueError("reference_time cannot be None")
    
    # Normalize timing_mode: 'hours_after' is legacy, treat as 'hours' with timing_type='after'
    if timing_mode == 'hours_after':
        timing_mode = 'hours'
        if timing_type != 'after':
            logger.warning(
                f"timing_mode='hours_after' should only be used with timing_type='after', "
                f"but got timing_type='{timing_type}'. Treating as 'hours' mode."
            )
    
    if timing_mode == 'hours':
        if hours is None:
            raise ValueError(f"hours is required for timing_mode='hours'")
        if hours < 0:
            raise ValueError(f"hours must be non-negative, got {hours}")
        
        # Calculate hours before or after reference time
        if timing_type == 'before':
            return ref_time - timedelta(hours=hours)
        else:  # after
            return ref_time + timedelta(hours=hours)
    
    elif timing_mode == 'specific_time':
        if days is None or time_of_day is None:
            raise ValueError(
                f"days and time_of_day are required for timing_mode='specific_time'"
            )
        if days < 0:
            raise ValueError(f"days must be non-negative, got {days}")
        
        # Calculate target date
        if timing_type == 'before':
            target_date = ref_time.date() - timedelta(days=days)
        else:  # after
            target_date = ref_time.date() + timedelta(days=days)
        
        # Combine date and time
        scheduled_time = datetime.combine(target_date, time_of_day)
        scheduled_time = ensure_taiwan(scheduled_time)
        if scheduled_time is None:
            raise ValueError("Failed to ensure timezone for scheduled_time")
        
        # Auto-adjust if time is in past (for days=0 case)
        if timing_type == 'after' and scheduled_time < ref_time:
            # Move to next day at same time
            scheduled_time = scheduled_time + timedelta(days=1)
            logger.info(
                f"Auto-adjusted scheduled time from {scheduled_time - timedelta(days=1)} "
                f"to {scheduled_time} (time was in past for 'after' timing)"
            )
        elif timing_type == 'before' and scheduled_time > ref_time:
            # Move to previous day at same time
            scheduled_time = scheduled_time - timedelta(days=1)
            logger.info(
                f"Auto-adjusted scheduled time from {scheduled_time + timedelta(days=1)} "
                f"to {scheduled_time} (time was in future for 'before' timing)"
            )
        
        return scheduled_time
    
    else:
        raise ValueError(f"Invalid timing_mode: {timing_mode}")


def calculate_follow_up_scheduled_time(
    appointment_end_time: datetime,
    timing_mode: str,
    hours_after: Optional[int] = None,
    days_after: Optional[int] = None,
    time_of_day: Optional[time_type] = None
) -> datetime:
    """
    Calculate scheduled time for follow-up messages (legacy wrapper).
    
    This function maintains backward compatibility with the existing
    FollowUpMessageService.calculate_scheduled_time() API.
    
    Args:
        appointment_end_time: When the appointment ends
        timing_mode: 'hours_after' or 'specific_time'
        hours_after: For hours_after mode: hours after appointment end
        days_after: For specific_time mode: days after appointment date
        time_of_day: For specific_time mode: specific time (e.g., 21:00)
        
    Returns:
        Scheduled send time
    """
    # Cast timing_mode to the expected literal type for type safety
    mode: Literal['hours', 'specific_time', 'hours_after'] = timing_mode  # type: ignore
    return calculate_scheduled_time(
        reference_time=appointment_end_time,
        timing_type='after',
        timing_mode=mode,
        hours=hours_after,
        days=days_after,
        time_of_day=time_of_day
    )
