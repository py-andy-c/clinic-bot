# pyright: reportMissingTypeStubs=false
"""
Session management utilities for agent conversations.

This module provides utilities for creating and managing conversation sessions
for the OpenAI Agent SDK.
"""

from agents.extensions.memory import SQLAlchemySession


def get_session_storage(line_user_id: str) -> SQLAlchemySession:
    """Get a SQLAlchemySession for the given LINE user."""
    # Read DATABASE_URL dynamically from environment
    from core.config import get_database_url
    db_url = get_database_url()

    # Convert SQLite URL to async-compatible format for SQLAlchemySession
    session_url = db_url
    if db_url.startswith("sqlite:///"):
        # Replace sqlite:/// with sqlite+aiosqlite:/// for async operations
        session_url = db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)

    return SQLAlchemySession.from_url(
        session_id=line_user_id,
        url=session_url,
        create_tables=True
    )
