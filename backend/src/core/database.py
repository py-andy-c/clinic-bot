# pyright: reportMissingTypeStubs=false
"""
Database configuration and session management.

This module sets up SQLAlchemy database connection, session management,
and provides dependency injection for database sessions in FastAPI routes.
"""

import logging
import os
from contextlib import contextmanager
from typing import Generator

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from core.config import DATABASE_URL
from core.constants import DB_POOL_RECYCLE_SECONDS

logger = logging.getLogger(__name__)

# E2E test mode configuration
E2E_TEST_MODE = os.getenv("E2E_TEST_MODE") == "true"

# Connection pool settings - stricter limits for E2E tests to prevent connection exhaustion
# E2E mode uses smaller pool to catch connection leaks early and prevent accumulation
# Production uses larger pool to handle higher concurrency
if E2E_TEST_MODE:
    # E2E mode: smaller pool, shorter timeouts
    # Smaller pool helps detect connection leaks during test runs
    pool_size = 5  # Maximum number of connections in pool
    max_overflow = 10  # Maximum overflow connections (total max = pool_size + max_overflow = 15)
    pool_timeout = 30  # Seconds to wait for connection from pool
else:
    # Production/dev mode: larger pool
    pool_size = 10
    max_overflow = 20
    pool_timeout = 30

# Build connection arguments
connect_args = {}
if E2E_TEST_MODE:
    # Set PostgreSQL timeouts for E2E tests to prevent infinite waits
    # statement_timeout: 30 seconds (prevents long-running queries from hanging)
    # idle_in_transaction_session_timeout: 10 seconds (prevents stuck transactions)
    connect_args = {
        "options": "-c statement_timeout=30000 -c idle_in_transaction_session_timeout=10000"
    }
    logger.info("E2E test mode: Using strict connection pool limits and PostgreSQL timeouts")
else:
    # Set PostgreSQL timeouts for production/dev to prevent stuck transactions
    # idle_in_transaction_session_timeout: 30 seconds (kills stuck transactions after 30s)
    # statement_timeout: not set (allow longer queries in production)
    connect_args = {
        "options": "-c idle_in_transaction_session_timeout=30000"
    }

# Create SQLAlchemy engine with optimized settings
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=DB_POOL_RECYCLE_SECONDS,
    pool_size=pool_size,
    max_overflow=max_overflow,
    pool_timeout=pool_timeout,
    connect_args=connect_args,
    echo=False,          # Disable SQL logging
    future=True,         # Use SQLAlchemy 2.0 style
)

# Create configured SessionLocal class
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,  # Don't expire objects after commit
)

# Create Base class for declarative models
class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


# SQLAlchemy event listeners to automatically set created_at and updated_at using Taiwan timezone
@event.listens_for(Base, "before_insert", propagate=True)  # type: ignore
def receive_before_insert(mapper, connection, target):  # type: ignore
    """Set created_at and updated_at on insert using Taiwan timezone."""
    # Import here to avoid circular import
    from utils.datetime_utils import taiwan_now
    now = taiwan_now()
    # Only set created_at if it's a mapped column (exists in mapper.columns)
    # Properties won't be in mapper.columns
    if hasattr(mapper, "columns") and "created_at" in mapper.columns:  # type: ignore
        try:
            current_value = getattr(target, "created_at", None)  # type: ignore
            if current_value is None:  # type: ignore
                setattr(target, "created_at", now)  # type: ignore
        except (AttributeError, TypeError):  # type: ignore
            # Skip if created_at is a property without setter
            pass
    # Only set updated_at if it's a mapped column (exists in mapper.columns)
    if hasattr(mapper, "columns") and "updated_at" in mapper.columns:  # type: ignore
        try:
            current_value = getattr(target, "updated_at", None)  # type: ignore
            if current_value is None:  # type: ignore
                setattr(target, "updated_at", now)  # type: ignore
        except (AttributeError, TypeError):  # type: ignore
            # Skip if updated_at is a property without setter
            pass


@event.listens_for(Base, "before_update", propagate=True)  # type: ignore
def receive_before_update(mapper, connection, target):  # type: ignore
    """Set updated_at on update using Taiwan timezone."""
    # Import here to avoid circular import
    from utils.datetime_utils import taiwan_now
    # Only update updated_at if it's a mapped column (exists in mapper.columns)
    if hasattr(mapper, "columns") and "updated_at" in mapper.columns:  # type: ignore
        try:
            setattr(target, "updated_at", taiwan_now())  # type: ignore
        except (AttributeError, TypeError):  # type: ignore
            # Skip if updated_at is a property without setter
            pass


# Event listener to reset reminder_sent_at when appointment time changes
@event.listens_for(Base, "before_update", propagate=True)  # type: ignore
def reset_reminder_on_appointment_reschedule(mapper, connection, target):  # type: ignore
    """
    Reset reminder_sent_at when appointment time changes (rescheduling).
    
    When a CalendarEvent's date or start_time changes, we need to reset
    the associated Appointment's reminder_sent_at so a new reminder can be sent
    for the rescheduled time.
    
    Uses before_update event to reset the field before the update is committed.
    """
    # Only process CalendarEvent updates
    if not hasattr(target, "__tablename__") or getattr(target, "__tablename__", None) != "calendar_events":  # type: ignore
        return
    
    # Verify target has an ID (must be an existing record, not a new one)
    if not hasattr(target, "id") or target.id is None:  # type: ignore
        return
    
    # Check if date or start_time changed using history tracking
    from sqlalchemy import inspect, text
    insp = inspect(target)  # type: ignore
    
    # Check if date changed
    date_changed = False
    if "date" in insp.attrs:  # type: ignore
        date_history = insp.attrs["date"].history  # type: ignore
        if date_history.has_changes():  # type: ignore
            # Check if there are deleted and added values
            if date_history.deleted and date_history.added:  # type: ignore
                if date_history.deleted[0] != date_history.added[0]:  # type: ignore
                    date_changed = True
            # Handle edge case where only deleted or only added values exist
            elif date_history.deleted or date_history.added:  # type: ignore
                date_changed = True
    
    # Check if start_time changed
    start_time_changed = False
    if "start_time" in insp.attrs:  # type: ignore
        start_time_history = insp.attrs["start_time"].history  # type: ignore
        if start_time_history.has_changes():  # type: ignore
            # Handle None values and edge cases
            old_value = start_time_history.deleted[0] if start_time_history.deleted else None  # type: ignore
            new_value = start_time_history.added[0] if start_time_history.added else None  # type: ignore
            if old_value != new_value:
                start_time_changed = True
    
    if date_changed or start_time_changed:
        # Log the rescheduling action
        logger.info(f"Resetting reminder_sent_at for appointment with calendar_event_id={target.id} due to rescheduling")  # type: ignore
        
        # Use direct SQL update to reset reminder_sent_at
        # This avoids session management issues
        connection.execute(  # type: ignore
            text("UPDATE appointments SET reminder_sent_at = NULL WHERE calendar_event_id = :event_id"),
            {"event_id": target.id}  # type: ignore
        )


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency to provide database sessions.

    Yields a database session that is automatically closed after the request.
    Handles cleanup even if an exception occurs during request processing.

    Yields:
        Session: SQLAlchemy database session

    Example:
        ```python
        @app.get("/items")
        def read_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
        ```
    """
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as e:
        logger.exception(f"Database error: {e}")
        db.rollback()
        raise
    except HTTPException:
        # Don't log HTTPExceptions as errors - they're expected business logic
        db.rollback()
        raise
    except Exception as e:
        logger.exception(f"Unexpected error in database session: {e}")
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def get_db_context() -> Generator[Session, None, None]:
    """
    Context manager for database sessions outside of FastAPI dependency injection.

    Useful for background tasks, scripts, or testing where you need manual
    session management.

    Yields:
        Session: SQLAlchemy database session

    Example:
        ```python
        with get_db_context() as db:
            user = db.query(User).filter(User.id == user_id).first()
        ```
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except HTTPException:
        # Don't log HTTPExceptions as errors - they're expected business logic
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Database transaction failed: {e}")
        raise
    finally:
        db.close()


def create_tables() -> None:
    """
    Create all database tables defined in SQLAlchemy models.

    This function creates tables for all models that inherit from Base.
    Safe to call multiple times - will not recreate existing tables.

    Note:
        In production, prefer using Alembic migrations instead of this function.
        This is primarily useful for testing or initial setup.
    """
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
    except SQLAlchemyError as e:
        logger.exception(f"Failed to create database tables: {e}")
        raise


def drop_tables() -> None:
    """
    Drop all database tables defined in SQLAlchemy models.

    WARNING: This will permanently delete all data in the tables!

    Note:
        Only use in testing or development environments.
        In production, prefer using Alembic migrations for schema changes.
    """
    try:
        Base.metadata.drop_all(bind=engine)
        logger.info("Database tables dropped successfully")
    except SQLAlchemyError as e:
        logger.exception(f"Failed to drop database tables: {e}")
        raise
