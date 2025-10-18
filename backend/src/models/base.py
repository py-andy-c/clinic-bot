"""
Database base models and utilities.

This module provides the base SQLAlchemy model class and common database
utilities used throughout the application.
"""

# Re-export Base from core.database for backward compatibility
from core.database import Base  # type: ignore[reportUnusedImport]
