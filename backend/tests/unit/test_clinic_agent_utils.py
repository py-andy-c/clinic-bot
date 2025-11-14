"""
Unit tests for clinic agent utility functions.

Tests time-based and count-based conversation history filtering.
"""

import json
import pytest
from unittest.mock import AsyncMock, Mock, patch
from datetime import datetime, timedelta, timezone
from typing import Any

from agents.extensions.memory import SQLAlchemySession
from sqlalchemy.ext.asyncio import AsyncEngine
from services.clinic_agent.utils import (
    trim_session,
    _ensure_legal_start,
    _is_legal_start_item
)


@pytest.fixture
def mock_session():
    """Create a mock SQLAlchemySession."""
    session = AsyncMock(spec=SQLAlchemySession)
    return session


@pytest.fixture
def mock_engine():
    """Create a mock AsyncEngine."""
    engine = AsyncMock(spec=AsyncEngine)
    return engine


@pytest.fixture
def sample_items():
    """Create sample conversation items for testing."""
    return [
        {"id": "msg_1", "role": "user", "type": "message", "content": "Hello"},
        {"id": "rs_1", "role": "assistant", "type": "reasoning", "summary": []},
        {"id": "msg_2", "role": "assistant", "type": "message", "content": "Hi there"},
        {"id": "msg_3", "role": "user", "type": "message", "content": "How are you?"},
        {"id": "rs_2", "role": "assistant", "type": "reasoning", "summary": []},
        {"id": "msg_4", "role": "assistant", "type": "message", "content": "I'm good"},
    ]


class TestIsLegalStartItem:
    """Test _is_legal_start_item function."""
    
    def test_user_message_is_legal_start(self):
        """Test that user messages are legal starts."""
        item = {"role": "user", "type": "message", "id": "msg_1"}
        assert _is_legal_start_item(item) is True
    
    def test_reasoning_item_is_legal_start(self):
        """Test that reasoning items are legal starts."""
        item = {"role": "assistant", "type": "reasoning", "id": "rs_1"}
        assert _is_legal_start_item(item) is True
    
    def test_assistant_message_is_not_legal_start(self):
        """Test that assistant messages are not legal starts."""
        item = {"role": "assistant", "type": "message", "id": "msg_1"}
        assert _is_legal_start_item(item) is False
    
    def test_invalid_item_returns_false(self):
        """Test that invalid items return False."""
        item = {"role": "unknown", "type": "unknown"}
        assert _is_legal_start_item(item) is False


class TestEnsureLegalStart:
    """Test _ensure_legal_start function."""
    
    def test_items_starting_with_user_message(self, sample_items):
        """Test items that already start with legal item."""
        result = _ensure_legal_start(sample_items)
        assert result == sample_items
    
    def test_items_starting_with_assistant_message(self):
        """Test items that start with illegal item."""
        items = [
            {"id": "msg_1", "role": "assistant", "type": "message"},
            {"id": "msg_2", "role": "user", "type": "message"},
        ]
        result = _ensure_legal_start(items)
        assert len(result) == 1
        assert result[0]["id"] == "msg_2"
    
    def test_empty_list_returns_empty(self):
        """Test that empty list returns empty."""
        assert _ensure_legal_start([]) == []
    
    def test_no_legal_start_returns_empty(self):
        """Test that if no legal start found, returns empty."""
        items = [
            {"id": "msg_1", "role": "assistant", "type": "message"},
            {"id": "msg_2", "role": "assistant", "type": "message"},
        ]
        result = _ensure_legal_start(items)
        assert result == []




class TestTrimSession:
    """Test trim_session function."""
    
    @pytest.mark.asyncio
    async def test_empty_session(self, mock_session, mock_engine):
        """Test that empty session is handled correctly."""
        mock_session.get_items.return_value = []
        mock_session.clear_session = AsyncMock()
        mock_session.add_items = AsyncMock()
        
        await trim_session(
            session=mock_session,
            session_id="test-1-1",
            engine=mock_engine,
            max_items=10
        )
        
        # Should not clear or add items for empty session
        mock_session.clear_session.assert_not_called()
        mock_session.add_items.assert_not_called()
    
    @pytest.mark.asyncio
    async def test_time_based_filtering_with_mock_timestamps(
        self, mock_session, mock_engine, sample_items
    ):
        """Test time-based filtering with mocked database timestamps."""
        mock_session.get_items.return_value = sample_items
        mock_session.clear_session = AsyncMock()
        mock_session.add_items = AsyncMock()
        
        # Mock database query to return timestamps
        now = datetime.now(timezone.utc)
        timestamps = {
            "msg_1": now - timedelta(hours=1),  # Recent
            "rs_1": now - timedelta(hours=1),
            "msg_2": now - timedelta(hours=1),
            "msg_3": now - timedelta(hours=25),  # Older than 24h
            "rs_2": now - timedelta(hours=25),
            "msg_4": now - timedelta(hours=25),
        }
        
        # Mock the database query
        async def mock_execute(query, params):
            mock_result = Mock()
            rows = []
            for item_id, timestamp in timestamps.items():
                message_data = json.dumps({"id": item_id})
                rows.append((message_data, timestamp))
            mock_result.fetchall.return_value = rows
            return mock_result
        
        mock_async_session = AsyncMock()
        mock_async_session.execute = AsyncMock(side_effect=mock_execute)
        
        with patch('services.clinic_agent.utils.AsyncSession') as mock_session_class:
            mock_session_class.return_value.__aenter__.return_value = mock_async_session
            
            await trim_session(
                session=mock_session,
                max_items=10,
                max_age_hours=24,
                min_items=2,
                session_expiry_hours=168,
                session_id="test-1-1",
                engine=mock_engine
            )
        
        mock_session.clear_session.assert_called_once()
        mock_session.add_items.assert_called_once()
        # Should filter to recent items (within 24h)
        added_items = mock_session.add_items.call_args[0][0]
        assert len(added_items) > 0


class TestTimeBasedFilteringScenarios:
    """Test specific time-based filtering scenarios."""
    
    @pytest.mark.asyncio
    async def test_hard_cutoff_enforced(self, mock_session, mock_engine):
        """Test that hard cutoff (session_expiry_hours) is always enforced."""
        now = datetime.now(timezone.utc)
        
        # Create items with various ages
        items = [
            {"id": "msg_1", "role": "user", "type": "message", "content": "Recent"},
            {"id": "msg_2", "role": "user", "type": "message", "content": "Old"},
        ]
        
        timestamps = {
            "msg_1": now - timedelta(hours=1),  # Recent
            "msg_2": now - timedelta(hours=200),  # Older than 168h (7 days)
        }
        
        mock_session.get_items.return_value = items
        mock_session.clear_session = AsyncMock()
        mock_session.add_items = AsyncMock()
        
        # Mock database query
        async def mock_execute(query, params):
            mock_result = Mock()
            rows = []
            for item_id, timestamp in timestamps.items():
                import json
                message_data = json.dumps({"id": item_id})
                rows.append((message_data, timestamp))
            mock_result.fetchall.return_value = rows
            return mock_result
        
        mock_async_session = AsyncMock()
        mock_async_session.execute = AsyncMock(side_effect=mock_execute)
        
        with patch('services.clinic_agent.utils.AsyncSession') as mock_session_class:
            mock_session_class.return_value.__aenter__.return_value = mock_async_session
            
            await trim_session(
                session=mock_session,
                max_items=10,
                min_items=5,  # Would want to keep 5, but hard cutoff applies
                session_expiry_hours=168,
                session_id="test-1-1",
                engine=mock_engine
            )
        
        # Should only keep recent item (old one deleted by hard cutoff)
        added_items = mock_session.add_items.call_args[0][0]
        assert len(added_items) == 1
        assert added_items[0]["id"] == "msg_1"
    
    @pytest.mark.asyncio
    async def test_minimum_guarantee_expands_window(self, mock_session, mock_engine):
        """Test that minimum guarantee expands to include older items."""
        now = datetime.now(timezone.utc)
        
        # Create items: 2 recent, 5 older (but within expiry)
        items = [
            {"id": f"msg_{i}", "role": "user", "type": "message", "content": f"Message {i}"}
            for i in range(7)
        ]
        
        timestamps = {
            "msg_0": now - timedelta(hours=1),  # Recent (within 24h)
            "msg_1": now - timedelta(hours=1),
            "msg_2": now - timedelta(hours=48),  # Older than 24h but within 168h
            "msg_3": now - timedelta(hours=48),
            "msg_4": now - timedelta(hours=48),
            "msg_5": now - timedelta(hours=48),
            "msg_6": now - timedelta(hours=48),
        }
        
        mock_session.get_items.return_value = items
        mock_session.clear_session = AsyncMock()
        mock_session.add_items = AsyncMock()
        
        # Mock database query
        async def mock_execute(query, params):
            mock_result = Mock()
            rows = []
            for item_id, timestamp in timestamps.items():
                import json
                message_data = json.dumps({"id": item_id})
                rows.append((message_data, timestamp))
            mock_result.fetchall.return_value = rows
            return mock_result
        
        mock_async_session = AsyncMock()
        mock_async_session.execute = AsyncMock(side_effect=mock_execute)
        
        with patch('services.clinic_agent.utils.AsyncSession') as mock_session_class:
            mock_session_class.return_value.__aenter__.return_value = mock_async_session
            
            await trim_session(
                session=mock_session,
                max_items=10,
                max_age_hours=24,  # Preferred window
                min_items=5,  # Minimum guarantee
                session_expiry_hours=168,
                session_id="test-1-1",
                engine=mock_engine
            )
        
        # Should keep at least 5 items (expanding beyond 24h window)
        added_items = mock_session.add_items.call_args[0][0]
        assert len(added_items) >= 5
    
    @pytest.mark.asyncio
    async def test_upper_bound_respected(self, mock_session, mock_engine):
        """Test that upper bound (max_items) is respected."""
        now = datetime.now(timezone.utc)
        
        # Create many recent items
        items = [
            {"id": f"msg_{i}", "role": "user", "type": "message", "content": f"Message {i}"}
            for i in range(30)
        ]
        
        timestamps = {
            f"msg_{i}": now - timedelta(hours=1)
            for i in range(30)
        }
        
        mock_session.get_items.return_value = items
        mock_session.clear_session = AsyncMock()
        mock_session.add_items = AsyncMock()
        
        # Mock database query
        async def mock_execute(query, params):
            mock_result = Mock()
            rows = []
            for item_id, timestamp in timestamps.items():
                import json
                message_data = json.dumps({"id": item_id})
                rows.append((message_data, timestamp))
            mock_result.fetchall.return_value = rows
            return mock_result
        
        mock_async_session = AsyncMock()
        mock_async_session.execute = AsyncMock(side_effect=mock_execute)
        
        with patch('services.clinic_agent.utils.AsyncSession') as mock_session_class:
            mock_session_class.return_value.__aenter__.return_value = mock_async_session
            
            await trim_session(
                session=mock_session,
                max_items=25,  # Upper bound
                max_age_hours=24,
                min_items=5,
                session_expiry_hours=168,
                session_id="test-1-1",
                engine=mock_engine
            )
        
        # Should not exceed max_items
        added_items = mock_session.add_items.call_args[0][0]
        assert len(added_items) <= 25

