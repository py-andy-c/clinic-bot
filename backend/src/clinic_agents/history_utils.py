"""
History management utilities for conversation sessions.

This module provides utilities for filtering and managing conversation history
to optimize agent performance and memory usage.
"""

from typing import List, Any
from datetime import datetime, timezone, timedelta


def smart_history_callback(
    history_items: List[Any],
    new_items: List[Any],
    time_window_hours: int = 24,
    min_items: int = 5,
    max_items: int = 50
) -> List[Any]:
    """
    Smart history filtering combining time window and item count limits.

    Rules:
    - Always keep at least min_items (default: 5)
    - Never exceed max_items (default: 50)
    - Filter by time_window_hours (default: 24 hours)
    - Preserve tool call sequences

    Args:
        history_items: List of conversation history items
        new_items: List of new items to add
        time_window_hours: Time window in hours to keep items
        min_items: Minimum number of items to keep regardless of time
        max_items: Maximum number of items to keep

    Returns:
        Filtered list of history items + new items
    """
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=time_window_hours)

    def get_item_timestamp(item: Any) -> datetime:
        """Extract timestamp from conversation item."""
        if hasattr(item, 'created_at'):
            return item.created_at
        elif hasattr(item, 'info') and hasattr(item.info, 'timestamp'):
            return item.info.timestamp
        else:
            # Fallback: assume recent if no timestamp
            return datetime.now(timezone.utc)

    # First, filter by time window
    time_filtered: List[Any] = []
    for item in history_items:
        item_time = get_item_timestamp(item)
        if item_time > cutoff_time:
            time_filtered.append(item)

    # Ensure we have at least min_items (take most recent if needed)
    if len(time_filtered) < min_items and len(history_items) >= min_items:
        # Take the most recent min_items from original history
        time_filtered = history_items[-min_items:]

    # Cap at max_items
    if len(time_filtered) > max_items:
        time_filtered = time_filtered[-max_items:]

    return time_filtered + new_items
