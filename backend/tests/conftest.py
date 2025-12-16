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
from datetime import date, time

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from core.database import Base
from alembic.config import Config
from alembic import command

# Import all models to ensure they're registered with SQLAlchemy before any relationships are resolved
from models.clinic import Clinic
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from models.signup_token import SignupToken
from models.refresh_token import RefreshToken
from models.patient import Patient
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.line_user import LineUser
from models.line_message import LineMessage
from models.line_push_message import LinePushMessage
from models.line_ai_reply import LineAiReply
from models.practitioner_availability import PractitionerAvailability
from models.calendar_event import CalendarEvent
from models.availability_notification import AvailabilityNotification
from models.practitioner_link_code import PractitionerLinkCode
from models.practitioner_appointment_types import PractitionerAppointmentTypes
from models.billing_scenario import BillingScenario
from models.receipt import Receipt


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


@pytest.fixture(scope="session", autouse=True)
def setup_test_database(db_engine):
    """
    Setup test database schema using Alembic migrations.

    This runs once at the start of the test session and ensures
    the test database has the correct schema from migrations.

    Strategy: Run all migrations from scratch (base → head).
    This tests that ALL migrations work correctly together.

    After Path B Week 2 (migration history reset), we now have a baseline migration
    that creates all tables from scratch. This allows us to use the simplified
    approach of just running all migrations from scratch.
    """
    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)

    # Drop all tables to start fresh (including alembic_version if it exists)
    # Use CASCADE to handle any leftover tables from previous implementations
    with db_engine.connect() as conn:
        # Drop any leftover tables from previous implementations first
        conn.execute(text("DROP TABLE IF EXISTS practitioner_line_link_tokens CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
        conn.commit()

    # Now drop all tables using SQLAlchemy metadata
    Base.metadata.drop_all(bind=db_engine)

    # Run all migrations from scratch (base → head)
    # With the baseline migration, this creates all tables from scratch
    # This tests that ALL migrations work correctly together
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
        "line_channel_access_token": "test_token",
        "subscription_status": "trial",
        "settings": {}
    }


@pytest.fixture
def sample_user_data():
    """Sample user data for tests."""
    return {
        # full_name removed from User model - names are stored in UserClinicAssociation
        "email": "dr.test@example.com"
    }


@pytest.fixture
def sample_patient_data():
    """Sample patient data for tests."""
    return {
        "full_name": "Test Patient",
        "phone_number": "+1234567890"
    }


# Helper functions for creating users with clinic associations
def create_user_with_clinic_association(
    db_session: Session,
    clinic: Clinic,
    full_name: str,
    email: str,
    google_subject_id: str,
    roles: list[str],
    is_active: bool = True,
    clinic_name: str | None = None
) -> tuple[User, UserClinicAssociation]:
    """
    Create a user and their clinic association.

    This helper function creates both a User record and a UserClinicAssociation
    record, which is required for multi-clinic support.

    Args:
        db_session: Database session
        clinic: Clinic to associate the user with
        full_name: User's full name
        email: User's email (must be globally unique)
        google_subject_id: Google OAuth subject ID (must be globally unique)
        roles: List of roles for this clinic (e.g., ["admin"], ["practitioner"])
        is_active: Whether the association is active (clinic-specific)
        clinic_name: Optional clinic-specific name (defaults to full_name)

    Returns:
        Tuple of (User, UserClinicAssociation)
    """
    # Create user (full_name is now only in UserClinicAssociation)
    user = User(
        email=email,
        google_subject_id=google_subject_id
    )
    db_session.add(user)
    db_session.flush()  # Flush to get user.id

    # Create clinic association
    association = UserClinicAssociation(
        user_id=user.id,
        clinic_id=clinic.id,
        roles=roles,
        full_name=clinic_name or full_name,
        is_active=is_active
    )
    db_session.add(association)
    db_session.commit()

    return user, association


def get_user_clinic_id(user: User, clinic: Clinic | None = None) -> int:
    """
    Get clinic_id for a user.

    For backward compatibility, this function:
    1. Returns clinic_id from user.clinic_id if available (deprecated)
    2. Returns clinic_id from the first active association if available
    3. Returns the provided clinic.id if given
    4. Raises ValueError if none available

    Args:
        user: User object
        clinic: Optional clinic to use if user has no clinic_id or associations

    Returns:
        Clinic ID
    """
    # Try deprecated clinic_id first (for backward compatibility)
    if user.clinic_id is not None:
        return user.clinic_id

    # Try associations
    if hasattr(user, 'clinic_associations') and user.clinic_associations:
        active_associations = [a for a in user.clinic_associations if a.is_active]
        if active_associations:
            return active_associations[0].clinic_id

    # Fall back to provided clinic
    if clinic:
        return clinic.id

    raise ValueError(f"User {user.id} has no clinic_id or active associations, and no clinic provided")


def create_practitioner_availability_with_clinic(
    db_session: Session,
    practitioner: User,
    clinic: Clinic,
    day_of_week: int,
    start_time: time,
    end_time: time
) -> PractitionerAvailability:
    """
    Helper to create PractitionerAvailability with clinic_id automatically set.

    This ensures clinic_id is always provided when creating availability records,
    making it easier to maintain when schema changes occur.

    Args:
        db_session: Database session
        practitioner: User (practitioner) to create availability for
        clinic: Clinic to associate the availability with
        day_of_week: Day of week (0=Monday, 6=Sunday)
        start_time: Start time for availability
        end_time: End time for availability

    Returns:
        Created PractitionerAvailability instance
    """
    availability = PractitionerAvailability(
        user_id=practitioner.id,
        clinic_id=clinic.id,
        day_of_week=day_of_week,
        start_time=start_time,
        end_time=end_time
    )
    db_session.add(availability)
    return availability


def create_calendar_event_with_clinic(
    db_session: Session,
    practitioner: User,
    clinic: Clinic,
    event_type: str,
    event_date: date,
    start_time: time | None = None,
    end_time: time | None = None,
    custom_event_name: str | None = None
) -> CalendarEvent:
    """
    Helper to create CalendarEvent with clinic_id automatically set.

    This ensures clinic_id is always provided when creating calendar events,
    making it easier to maintain when schema changes occur.

    Args:
        db_session: Database session
        practitioner: User (practitioner) to create event for
        clinic: Clinic to associate the event with
        event_type: Type of event (e.g., "appointment", "availability_exception")
        event_date: Date of the event
        start_time: Optional start time
        end_time: Optional end time

    Returns:
        Created CalendarEvent instance
    """
    calendar_event = CalendarEvent(
        user_id=practitioner.id,
        clinic_id=clinic.id,
        event_type=event_type,
        date=event_date,
        start_time=start_time,
        end_time=end_time,
        custom_event_name=custom_event_name
    )
    db_session.add(calendar_event)
    return calendar_event


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
