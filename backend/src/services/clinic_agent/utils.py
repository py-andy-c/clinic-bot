# pyright: reportMissingTypeStubs=false
"""
Utility functions for clinic agent service.

This module provides helper functions for managing conversation history
and other agent-related operations.
"""

import logging

from agents.extensions.memory import SQLAlchemySession

logger = logging.getLogger(__name__)


async def trim_session(
    session: SQLAlchemySession,
    max_items: int
) -> None:
    """
    Trim conversation history in a session while preserving related items.
    
    The OpenAI Agent SDK stores items with relationships (e.g., message items
    have associated reasoning items with IDs like 'rs_...'). When truncating,
    we need to ensure that related items are kept together to avoid errors
    like "Item 'msg_...' was provided without its required 'reasoning' item".
    
    This function:
    1. Gets all items from the session
    2. Truncates to max_items while preserving related items
    3. Updates the session with the truncated items
    
    Args:
        session: SQLAlchemySession to trim
        max_items: Maximum number of items to keep
    """
    # Get all conversation items from session
    all_items = await session.get_items()
    
    # If we don't have more than max_items, no truncation needed
    if len(all_items) <= max_items:
        return
    

    idx = len(all_items) - max_items
    while not _is_legal_start_item(all_items[idx]):
        idx += 1
    
    items_to_keep = all_items[idx:]
    
    # Update the session with truncated items
    await session.clear_session()
    await session.add_items(items_to_keep)
    
    logger.debug(
        f"Truncated conversation history from {len(all_items)} to {len(items_to_keep)} "
        f"items (preserving related items)"
    )

def _is_legal_start_item(item: dict) -> bool:
    # TODO support tool call
    if item["role"] == "user":
        return True
    elif item["role"] == "assistant":
        if item["type"] == "message":
            assert item["id"].startswith("msg_")
            return False # assistant message should have a reasoning item before it
        elif item["type"] == "reasoning":
            assert item["id"].startswith("rs_")
            return True
    raise ValueError(f"Converation item: {item}")
