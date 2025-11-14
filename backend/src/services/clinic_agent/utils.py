# pyright: reportMissingTypeStubs=false
"""
Utility functions for clinic agent service.

This module provides helper functions for managing conversation history
and other agent-related operations.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy import text
from agents.extensions.memory import SQLAlchemySession

logger = logging.getLogger(__name__)


async def trim_session(
    session: SQLAlchemySession,
    session_id: str,
    engine: AsyncEngine,
    max_items: Optional[int] = None,
    max_age_hours: Optional[int] = None,
    min_items: Optional[int] = None,
    session_expiry_hours: Optional[int] = None
) -> None:
    """
    Trim conversation history in a session using time-based filtering.

    Implements the following priority:
    1. Hard cutoff: Delete items older than session_expiry_hours (always enforced)
    2. Preferred window: Keep items within max_age_hours
    3. Minimum guarantee: Keep at least min_items (even if older than max_age_hours)
    4. Upper bound: Never keep more than max_items

    The filtered items are then validated to ensure they start with a legal item type.
    The actual number of items passed to the agent might be slightly less than the
    filtered count if some items need to be removed to ensure a legal start.

    Args:
        session: SQLAlchemySession to trim
        max_items: Upper bound on number of items to keep
        max_age_hours: Preferred time window in hours
        min_items: Minimum number of items to keep (even if older than max_age_hours)
        session_expiry_hours: Hard cutoff age in hours (always enforced)
        session_id: Session ID (required)
        engine: AsyncEngine (required)
    """
    # Get all conversation items from session
    all_items = await session.get_items()

    # If no items, nothing to do
    if not all_items:
        return

    try:
        items_to_keep = await _trim_by_time(
            all_items=all_items,
            session_id=session_id,
            engine=engine,
            max_age_hours=max_age_hours,
            min_items=min_items,
            session_expiry_hours=session_expiry_hours,
            max_items=max_items
        )
    except Exception as e:
        logger.error(
            f"Time-based filtering failed: {e}",
            exc_info=True
        )
        # If filtering fails, keep all items (better than losing everything)
        items_to_keep = all_items

    # Update the session with truncated items
    await session.clear_session()
    await session.add_items(items_to_keep)

    logger.debug(
        f"Truncated conversation history from {len(all_items)} to {len(items_to_keep)} items"
    )

async def _get_item_timestamps(
    session_id: str,
    engine: AsyncEngine
) -> dict[str, datetime]:
    """
    Query database to get item IDs and their created_at timestamps.

    Args:
        session_id: Session ID to query
        engine: AsyncEngine for database queries

    Returns:
        Dictionary mapping item_id -> created_at datetime
    """
    item_timestamps: dict[str, datetime] = {}

    try:
        async with AsyncSession(engine) as async_session:
            # Query agent_messages table for items in this session
            query = text("""
                SELECT message_data, created_at
                FROM agent_messages
                WHERE session_id = :session_id
                ORDER BY created_at
            """)

            result = await async_session.execute(query, {"session_id": session_id})
            rows = result.fetchall()

            for row in rows:
                message_data_str, created_at = row
                try:
                    # Parse JSON to get item ID
                    message_data = json.loads(message_data_str)
                    item_id = message_data.get("id")
                    if item_id and created_at:
                        # Normalize to timezone-naive to match database column type
                        if created_at.tzinfo is not None:
                            item_timestamps[item_id] = created_at.replace(tzinfo=None)
                        else:
                            item_timestamps[item_id] = created_at
                except (json.JSONDecodeError, KeyError) as e:
                    logger.debug(f"Could not parse message_data for timestamp: {e}")
                    continue

    except Exception as e:
        logger.warning(f"Error querying item timestamps: {e}")
        # Return empty dict - items without timestamps will be handled in filtering logic

    return item_timestamps


async def _trim_by_time(
    all_items: list[dict[str, Any]],
    session_id: str,
    engine: AsyncEngine,
    max_age_hours: Optional[int],
    min_items: Optional[int],
    session_expiry_hours: Optional[int],
    max_items: Optional[int]
) -> list[dict[str, Any]]:
    """
    Trim items using time-based filtering.

    Implements the priority-based filtering logic:
    1. Hard cutoff (session_expiry_hours)
    2. Preferred window (max_age_hours)
    3. Minimum guarantee (min_items)
    4. Upper bound (max_items)
    """
    # Use timezone-naive datetime to match database columns (timestamp without time zone)
    # Convert UTC-aware datetime to naive to match database column type
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Get timestamps for all items
    item_timestamps = await _get_item_timestamps(session_id, engine)

    # Create lookup: item_id -> (item_dict, created_at)
    items_by_id: dict[str, tuple[dict[str, Any], Optional[datetime]]] = {}
    for item in all_items:
        item_id = item.get("id")
        if item_id:
            timestamp = item_timestamps.get(item_id)
            items_by_id[item_id] = (item, timestamp)

    # Step 1: Apply hard cutoff (session_expiry_hours)
    if session_expiry_hours is not None:
        expiry_cutoff = now - timedelta(hours=session_expiry_hours)
        items_after_expiry = {
            item_id: (item, ts)
            for item_id, (item, ts) in items_by_id.items()
            if ts is None or ts >= expiry_cutoff
        }
    else:
        items_after_expiry = items_by_id

    # If no items remain after expiry, return empty list
    if not items_after_expiry:
        return []

    # Step 2: Identify preferred window (max_age_hours)
    if max_age_hours is not None:
        preferred_cutoff = now - timedelta(hours=max_age_hours)
        preferred_items = {
            item_id: (item, ts)
            for item_id, (item, ts) in items_after_expiry.items()
            if ts is None or ts >= preferred_cutoff
        }
    else:
        preferred_items = items_after_expiry

    # Step 3: Apply minimum guarantee (min_items)
    if min_items is not None and len(preferred_items) < min_items:
        # Need to expand to include older items to meet minimum
        # Sort all items after expiry by timestamp (newest first)
        sorted_items = sorted(
            items_after_expiry.items(),
            key=lambda x: x[1][1] or datetime.min,
            reverse=True
        )
        # Take at least min_items (or all if fewer)
        items_to_keep_ids = {item_id for item_id, _ in sorted_items[:max(min_items, len(sorted_items))]}
    else:
        items_to_keep_ids = set(preferred_items.keys())

    # Step 4: Apply upper bound (max_items)
    if max_items is not None and len(items_to_keep_ids) > max_items:
        # Keep only most recent max_items
        sorted_all = sorted(
            items_after_expiry.items(),
            key=lambda x: x[1][1] or datetime.min,
            reverse=True
        )
        items_to_keep_ids = {item_id for item_id, _ in sorted_all[:max_items]}

    # Step 5: Filter items from all_items based on IDs to keep (preserve order)
    items_to_keep = [item for item in all_items if item.get("id") in items_to_keep_ids]

    # Step 6: Ensure valid start (may reduce count slightly)
    items_to_keep = _ensure_legal_start(items_to_keep)

    return items_to_keep


def _ensure_legal_start(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Ensure the filtered items start with a legal item type.

    Args:
        items: List of items to validate

    Returns:
        Items with valid start, possibly truncated
    """
    if not items:
        return items

    # Find the first legal start item
    for i, item in enumerate(items):
        if _is_legal_start_item(item):
            return items[i:]

    # If no legal start found, return empty list
    logger.warning("No legal start item found in filtered items")
    return []


def _is_legal_start_item(item: dict[str, Any]) -> bool:
    """
    Check if an item is a legal starting point for conversation history.

    User messages and reasoning items are legal starts.
    Assistant messages are not (they need reasoning items before them).

    Args:
        item: Item dictionary to check

    Returns:
        True if item is a legal start, False otherwise
    """
    try:
        # TODO support tool call
        if "summary" in item and item["summary"] is not None:
            return True
        if item["role"] == "user":
            return True
        elif item["role"] == "assistant":
            if item["type"] == "message":
                item_id: str = item["id"]
                assert item_id.startswith("msg_")
                return False # assistant message should have a reasoning item before it
            elif item["type"] == "reasoning":
                item_id: str = item["id"]
                assert item_id.startswith("rs_")
                return True
        logger.exception(f"Unexpected conversation item: {item}")
        return False
    except Exception as e:
        logger.exception(f"Error checking if item is a legal start item: {e}, item: {item}")
        return False
