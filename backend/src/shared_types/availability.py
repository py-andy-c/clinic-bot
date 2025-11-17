"""
Type definitions for availability-related functionality.
"""

from dataclasses import dataclass
from datetime import time
from typing import Optional


@dataclass(frozen=True)
class TimeWindow:
    """Time window definition with start, end time and display name."""
    start: time
    end: time
    display: str


@dataclass(frozen=True)
class Slot:
    """
    Available appointment slot.
    
    This represents a single available time slot for booking an appointment.
    """
    start_time: str  # Format: "HH:MM"
    end_time: str    # Format: "HH:MM"
    practitioner_id: int
    practitioner_name: str
    is_recommended: Optional[bool] = None  # True if slot is recommended for compact scheduling

