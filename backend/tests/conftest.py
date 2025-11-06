"""
Test configuration and shared fixtures for the Clinic Bot test suite.

Uses PostgreSQL for all tests with transaction-based isolation.
Each test gets a clean database state via automatic transaction rollback.
"""

import asyncio
import os
import tempfile
import pytest
from pathlib import Path
from typing import Generator
from unittest.mock import Mock

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from core.database import Base
from alembic.config import Config
from alembic import command

# Import all models to ensure they're registered with SQLAlchemy before any relationships are resolved
from models.clinic import Clinic
from models.user import User
from models.signup_token import SignupToken
from models.refresh_token import RefreshToken
from models.patient import Patient
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.line_user import LineUser


# Test database URL
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://localhost/clinic_bot_test")
)


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def db_engine():
    """
    Create a database engine for the test session.
    
    This engine is shared across all tests for performance.
    Uses NullPool to avoid connection pool issues with transactions.
    """
    engine = create_engine(
        TEST_DATABASE_URL,
        poolclass=NullPool,  # Don't pool connections (each test gets fresh connection)
        echo=False,
    )
    
    yield engine
    
    engine.dispose()


def get_parent_revision(alembic_cfg: Config) -> str:
    """Get the parent revision of the current head migration.
    
    This is used to stamp the database with the parent of head when
    we've already created tables from models (which include all columns).
    This allows us to test only new migrations without conflicts.
    """
    from alembic.script import ScriptDirectory
    script = ScriptDirectory.from_config(alembic_cfg)
    head_revision = script.get_current_head()
    
    if not head_revision:
        return "base"
    
    head_script = script.get_revision(head_revision)
    if not head_script or not head_script.down_revision:
        return "base"
    
    # Handle multiple parents (branching) by using the first one
    if isinstance(head_script.down_revision, tuple):
        return head_script.down_revision[0]
    elif isinstance(head_script.down_revision, str):
        return head_script.down_revision
    else:
        return "base"


@pytest.fixture(scope="session", autouse=True)
def setup_test_database(db_engine):
    """
    Setup test database schema using Alembic migrations.

    This runs once at the start of the test session and ensures
    the test database has the correct schema from migrations.

    Strategy: Create base tables from models, stamp with parent of head, then run new migrations.
    This ensures base tables exist (since some migrations only modify them),
    while still testing that new migrations work correctly.
    """
    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)

    # Drop all tables to start fresh
    Base.metadata.drop_all(bind=db_engine)

    # Create base tables from models first
    # Some migrations assume tables exist and only modify them (e.g., add columns)
    # Creating base tables ensures the schema exists before migrations run
    Base.metadata.create_all(bind=db_engine)

    # Stamp database with parent of head
    # Since models already have all columns from existing migrations,
    # we stamp with the parent of head to mark existing migrations as applied
    # This allows us to test only new migrations without conflicts
    stamp_revision = get_parent_revision(alembic_cfg)
    command.stamp(alembic_cfg, stamp_revision)

    # Run migrations to upgrade to head
    # This applies only new migrations that come after the stamp point
    command.upgrade(alembic_cfg, "head")

    yield

    # Cleanup: drop all tables after test session
    Base.metadata.drop_all(bind=db_engine)


@pytest.fixture(scope="function")
def db_session(db_engine) -> Generator[Session, None, None]:
    """
    Provide a database session for a test with automatic rollback.
    
    This fixture uses the "nested transaction" pattern:
    1. Start a transaction
    2. Create a savepoint
    3. Run the test
    4. Rollback to savepoint (undoes all test changes)
    5. Close transaction
    
    This ensures perfect test isolation - each test gets a clean database
    state, but we don't recreate the database between tests (fast!).
    """
    # Start a connection
    connection = db_engine.connect()
    
    # Begin a transaction
    transaction = connection.begin()
    
    # Create a session bound to the connection
    Session = sessionmaker(bind=connection)
    session = Session()
    
    # Start a nested transaction (savepoint)
    # This allows the test to commit/rollback without affecting the outer transaction
    nested = connection.begin_nested()
    
    # If the application code calls session.commit(), it will only commit to the savepoint
    # We need to intercept this and create a new savepoint
    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(session, transaction):
        if transaction.nested and not transaction._parent.nested:
            # Re-establish a new savepoint after the nested transaction ends
            session.begin_nested()
    
    yield session
    
    # Teardown: rollback everything
    session.close()
    transaction.rollback()  # Rollback the outer transaction
    connection.close()


# Removed client fixture - creating clients directly in tests for better reliability


@pytest.fixture
def mock_google_oauth():
    """Mock Google OAuth service."""
    mock_service = Mock()
    mock_service.get_authorization_url.return_value = "https://accounts.google.com/oauth/test"
    mock_service.handle_oauth_callback.return_value = Mock(
        id=1,
        name="Test Therapist"
    )
    return mock_service


@pytest.fixture
def sample_clinic_data():
    """Sample clinic data for tests."""
    return {
        "name": "Test Clinic",
        "line_channel_id": "test_channel_123",
        "line_channel_secret": "test_secret_456",
        "subscription_status": "trial",
        "settings": {}
    }


@pytest.fixture
def sample_user_data():
    """Sample user data for tests."""
    return {
        "full_name": "Dr. Test",
        "email": "dr.test@example.com",
        "roles": ["practitioner"]
    }


@pytest.fixture
def sample_patient_data():
    """Sample patient data for tests."""
    return {
        "full_name": "Test Patient",
        "phone_number": "+1234567890"
    }
@pytest.fixture
def session_database():
    """
    Fixture that sets up a temporary SQLite database for session storage testing.

    Creates a temporary SQLite file and sets DATABASE_URL to point to it.
    This ensures session storage tests use isolated, persistent databases.

    Usage:
        @pytest.mark.parametrize("session_database", [None], indirect=True)
        class TestConversationFlowIntegration:
            # DATABASE_URL is automatically set to a temp SQLite file
            pass

    Yields:
        str: The database URL that was set
    """
    # Create temporary SQLite file
    temp_file = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    temp_file.close()  # Close but keep the file

    # Set DATABASE_URL to point to the temporary file
    db_url = f'sqlite:///{temp_file.name}'
    old_db_url = os.environ.get('DATABASE_URL')  # Save original value
    os.environ['DATABASE_URL'] = db_url

    yield db_url

    # Cleanup: Remove temporary database file and restore original DATABASE_URL
    try:
        os.unlink(temp_file.name)
    except OSError:
        pass  # Ignore cleanup errors

    if old_db_url is not None:
        os.environ['DATABASE_URL'] = old_db_url
    elif 'DATABASE_URL' in os.environ:
        del os.environ['DATABASE_URL']
