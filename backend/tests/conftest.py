"""
Test configuration and shared fixtures for the Clinic Bot test suite.
"""

import asyncio
import os
import tempfile
import pytest
from pathlib import Path
from unittest.mock import Mock

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base

# Import all models to ensure they're registered with SQLAlchemy before any relationships are resolved
from models.clinic import Clinic
from models.user import User
from models.signup_token import SignupToken
from models.refresh_token import RefreshToken
from models.patient import Patient
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.line_user import LineUser


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="function")
def db_session():
    """
    Create a new in-memory SQLite database for each test function.
    This provides perfect isolation at the cost of recreating the schema for each test.
    """
    # 1. Create a new engine for an anonymous in-memory database.
    #    Allow multi-threading to avoid SQLite threading issues with FastAPI TestClient
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool  # Required for in-memory databases
    )

    # 2. Execute PRAGMA to allow foreign keys and improve thread safety
    with engine.connect() as conn:
        conn.execute(text("PRAGMA foreign_keys=ON"))

    # 3. Create the database schema. This runs for EVERY test.
    Base.metadata.create_all(engine)

    # 4. Create a session to interact with this new database.
    Session = sessionmaker(bind=engine)
    session = Session()

    yield session

    # 5. Teardown: Close the session and dispose of the engine.
    #    The in-memory database is automatically destroyed.
    session.close()
    engine.dispose()


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
        "subscription_status": "trial"
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


@pytest.fixture
def require_env_vars(request):
    """
    Fixture that ensures required environment variables are set.

    Usage:
        @pytest.mark.parametrize("require_env_vars", [["OPENAI_API_KEY"]], indirect=True)
        def test_real_agent(require_env_vars):
            # Ensures OPENAI_API_KEY is set
            pass

    Args:
        request: pytest request object containing the parametrized env var names

    Returns:
        dict: Dictionary of validated environment variables

    Raises:
        pytest.skip: If any required env vars are missing
    """
    if not hasattr(request, 'param'):
        return {}

    required_vars = request.param
    validated_vars = {}

    for var_name in required_vars:
        var_value = os.getenv(var_name)
        validated_vars[var_name] = var_value

    return validated_vars

