"""
Tests for smart history filtering functionality.

This module tests the smart_history_callback function that combines
time window and item count filtering for conversation history management.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock
from typing import List, Any

from clinic_agents.history_utils import smart_history_callback


class MockHistoryItem:
    """Mock history item with timestamp support."""
    
    def __init__(self, created_at: datetime, content: str = "test"):
        self.created_at = created_at
        self.content = content


class MockHistoryItemWithInfo:
    """Mock history item with info.timestamp."""
    
    def __init__(self, timestamp: datetime, content: str = "test"):
        self.info = Mock()
        self.info.timestamp = timestamp
        self.content = content


class MockHistoryItemNoTimestamp:
    """Mock history item without timestamp."""
    
    def __init__(self, content: str = "test"):
        self.content = content


@pytest.mark.asyncio
class TestSmartHistoryCallback:
    """Test cases for smart_history_callback function."""

    async def test_basic_time_filtering(self):
        """Test basic time window filtering."""
        now = datetime.now(timezone.utc)
        
        # Create items: 2 recent (within 24h), 2 old (outside 24h)
        recent_item1 = MockHistoryItem(now - timedelta(hours=12))
        recent_item2 = MockHistoryItem(now - timedelta(hours=6))
        old_item1 = MockHistoryItem(now - timedelta(hours=25))
        old_item2 = MockHistoryItem(now - timedelta(hours=48))
        
        history_items = [old_item1, recent_item1, old_item2, recent_item2]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=history_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep only recent items + new items
        assert len(result) == 3  # 2 recent + 1 new
        assert recent_item1 in result
        assert recent_item2 in result
        assert old_item1 not in result
        assert old_item2 not in result
        assert new_items[0] in result

    async def test_min_items_guarantee(self):
        """Test that minimum items are always kept regardless of time."""
        now = datetime.now(timezone.utc)
        
        # Create 10 old items (outside 24h window)
        old_items = [
            MockHistoryItem(now - timedelta(hours=25 + i))
            for i in range(10)
        ]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=old_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep at least 5 items (most recent) + new items
        assert len(result) == 6  # 5 most recent + 1 new
        assert new_items[0] in result

    async def test_max_items_cap(self):
        """Test that maximum items limit is enforced."""
        now = datetime.now(timezone.utc)
        
        # Create 100 recent items (all within 24h window)
        # Use smaller time increments to ensure all items are within 24h
        recent_items = [
            MockHistoryItem(now - timedelta(minutes=i))  # 1 minute increments, so all within 24h
            for i in range(100)
        ]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=recent_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should cap at max_items + new items
        # Note: All 100 items are within 24h, so we take the most recent 50 + 1 new = 51 total
        assert len(result) == 51  # 50 most recent + 1 new
        assert new_items[0] in result
        # Verify we kept the most recent items (last 50 from the list)
        for i in range(50):
            assert recent_items[99 - i] in result  # Most recent 50 items

    async def test_info_timestamp_extraction(self):
        """Test timestamp extraction from info.timestamp."""
        now = datetime.now(timezone.utc)
        
        # Create items with info.timestamp
        recent_item = MockHistoryItemWithInfo(now - timedelta(hours=12))
        old_item = MockHistoryItemWithInfo(now - timedelta(hours=25))
        
        history_items = [old_item, recent_item]
        new_items = [MockHistoryItemWithInfo(now)]
        
        result = smart_history_callback(
            history_items=history_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep only recent item + new item
        assert len(result) == 2
        assert recent_item in result
        assert old_item not in result
        assert new_items[0] in result

    async def test_no_timestamp_fallback(self):
        """Test fallback behavior for items without timestamps."""
        now = datetime.now(timezone.utc)
        
        # Create items without timestamps
        no_timestamp_item1 = MockHistoryItemNoTimestamp("item1")
        no_timestamp_item2 = MockHistoryItemNoTimestamp("item2")
        
        history_items = [no_timestamp_item1, no_timestamp_item2]
        new_items = [MockHistoryItemNoTimestamp("new")]
        
        result = smart_history_callback(
            history_items=history_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep all items (fallback assumes recent)
        assert len(result) == 3
        assert no_timestamp_item1 in result
        assert no_timestamp_item2 in result
        assert new_items[0] in result

    async def test_empty_history(self):
        """Test behavior with empty history."""
        new_items = [MockHistoryItem(datetime.now(timezone.utc))]
        
        result = smart_history_callback(
            history_items=[],
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should return only new items
        assert len(result) == 1
        assert new_items[0] in result

    async def test_custom_parameters(self):
        """Test with custom time window and limits."""
        now = datetime.now(timezone.utc)
        
        # Create items with 2-hour spacing
        items = [
            MockHistoryItem(now - timedelta(hours=i * 2))
            for i in range(10)
        ]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=items,
            new_items=new_items,
            time_window_hours=6,  # Only keep last 6 hours
            min_items=3,
            max_items=5
        )
        
        # Should keep 3 items (within 6h) + new item, capped at 5 total
        assert len(result) == 4  # 3 recent + 1 new
        assert new_items[0] in result

    async def test_mixed_timestamp_types(self):
        """Test with mixed timestamp types in same history."""
        now = datetime.now(timezone.utc)
        
        # Mix of different timestamp types
        created_at_item = MockHistoryItem(now - timedelta(hours=12))
        info_timestamp_item = MockHistoryItemWithInfo(now - timedelta(hours=6))
        no_timestamp_item = MockHistoryItemNoTimestamp("no_timestamp")
        
        history_items = [created_at_item, info_timestamp_item, no_timestamp_item]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=history_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep all items (all recent or fallback)
        assert len(result) == 4
        assert created_at_item in result
        assert info_timestamp_item in result
        assert no_timestamp_item in result
        assert new_items[0] in result

    async def test_edge_case_exactly_at_cutoff(self):
        """Test items exactly at the cutoff time."""
        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(hours=24)
        
        # Item exactly at cutoff (should be excluded)
        at_cutoff_item = MockHistoryItem(cutoff_time)
        # Item just after cutoff (should be included)
        just_after_item = MockHistoryItem(cutoff_time + timedelta(minutes=1))
        
        history_items = [at_cutoff_item, just_after_item]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=history_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep only the item just after cutoff + new item
        assert len(result) == 2
        assert at_cutoff_item not in result
        assert just_after_item in result
        assert new_items[0] in result

    async def test_preserve_order(self):
        """Test that item order is preserved."""
        now = datetime.now(timezone.utc)
        
        # Create items in specific order
        items = [
            MockHistoryItem(now - timedelta(hours=i))
            for i in range(5)
        ]
        new_items = [MockHistoryItem(now)]
        
        result = smart_history_callback(
            history_items=items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should preserve original order + new items at end
        assert len(result) == 6
        for i, item in enumerate(items):
            assert result[i] == item
        assert result[-1] == new_items[0]


@pytest.mark.asyncio
class TestSmartHistoryCallbackIntegration:
    """Integration tests for smart history filtering with real-world scenarios."""

    async def test_conversation_flow_simulation(self):
        """Test realistic conversation flow with multiple interactions."""
        now = datetime.now(timezone.utc)
        
        # Simulate a conversation over 2 days
        conversation_items = [
            MockHistoryItem(now - timedelta(hours=48), "Day 1: User asks about appointment"),
            MockHistoryItem(now - timedelta(hours=47), "Day 1: Agent responds"),
            MockHistoryItem(now - timedelta(hours=46), "Day 1: User provides phone number"),
            MockHistoryItem(now - timedelta(hours=45), "Day 1: Agent confirms account linking"),
            MockHistoryItem(now - timedelta(hours=2), "Day 2: User asks to book appointment"),
            MockHistoryItem(now - timedelta(hours=1), "Day 2: Agent asks for details"),
        ]
        
        new_items = [MockHistoryItem(now, "Day 2: User provides appointment details")]
        
        result = smart_history_callback(
            history_items=conversation_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep recent Day 2 items + new item
        # Day 1 items should be filtered out (older than 24h)
        # But we have min_items=5, so we'll keep the most recent 5 items + new item = 6 total
        assert len(result) == 6  # 5 most recent + 1 new (due to min_items=5)
        assert conversation_items[4] in result  # Day 2: User asks to book
        assert conversation_items[5] in result  # Day 2: Agent asks for details
        assert new_items[0] in result
        # Day 1 items should be filtered out due to time window
        assert conversation_items[0] not in result  # Day 1: User asks about appointment

    async def test_tool_call_preservation_scenario(self):
        """Test scenario that might break tool call sequences."""
        now = datetime.now(timezone.utc)
        
        # Simulate a tool call sequence
        tool_call_items = [
            MockHistoryItem(now - timedelta(minutes=5), "User: I want to book an appointment"),
            MockHistoryItem(now - timedelta(minutes=4), "Agent: Let me check availability"),
            MockHistoryItem(now - timedelta(minutes=3), "Tool Call: get_practitioner_availability"),
            MockHistoryItem(now - timedelta(minutes=2), "Tool Response: Available slots found"),
            MockHistoryItem(now - timedelta(minutes=1), "Agent: Here are available times"),
        ]
        
        new_items = [MockHistoryItem(now, "User: I'll take the 9:30 slot")]
        
        result = smart_history_callback(
            history_items=tool_call_items,
            new_items=new_items,
            time_window_hours=24,
            min_items=5,
            max_items=50
        )
        
        # Should keep all items (all recent) + new item
        assert len(result) == 6
        for item in tool_call_items:
            assert item in result
        assert new_items[0] in result
