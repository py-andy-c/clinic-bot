"""
Database configuration and session management.

This module sets up SQLAlchemy database connection, session management,
and provides dependency injection for database sessions in FastAPI routes.
"""

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Session, sessionmaker

from core.config import DATABASE_URL, ENVIRONMENT
from core.constants import DB_POOL_RECYCLE_SECONDS

logger = logging.getLogger(__name__)

# Create SQLAlchemy engine with optimized settings
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=DB_POOL_RECYCLE_SECONDS,
    echo=ENVIRONMENT == "development",  # Log SQL in development
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
        logger.error(f"Database error: {e}")
        db.rollback()
        raise
    except Exception as e:
        logger.error(f"Unexpected error in database session: {e}")
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
    except Exception as e:
        db.rollback()
        logger.error(f"Database transaction failed: {e}")
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
        logger.error(f"Failed to create database tables: {e}")
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
        logger.error(f"Failed to drop database tables: {e}")
        raise
