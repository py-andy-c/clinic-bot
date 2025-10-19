"""
Test configuration and shared fixtures for the Clinic Bot test suite.
"""

import asyncio
import os
import pytest
from typing import AsyncGenerator, Generator
from unittest.mock import Mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base, get_db
from core.config import DATABASE_URL

# Import all models to ensure they're registered with SQLAlchemy before any relationships are resolved
from models.clinic import Clinic
from models.clinic_admin import ClinicAdmin
from models.therapist import Therapist
from models.patient import Patient
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.line_user import LineUser


# Test database URL using SQLite in-memory
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def test_database_url() -> str:
    """Test database URL using SQLite in-memory."""
    return TEST_DATABASE_URL


@pytest.fixture(scope="session")
def test_engine(test_database_url):
    """Create test database engine."""
    engine = create_engine(
        test_database_url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    return engine


@pytest.fixture(scope="session")
def tables(test_engine):
    """Create all database tables."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session(test_engine, tables) -> Generator:
    """Database session fixture for tests."""
    connection = test_engine.connect()
    transaction = connection.begin()
    session = sessionmaker(bind=connection)()

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
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
        "subscription_status": "trial"
    }


@pytest.fixture
def sample_therapist_data():
    """Sample therapist data for tests."""
    return {
        "name": "Dr. Test",
        "email": "dr.test@example.com"
    }


@pytest.fixture
def sample_patient_data():
    """Sample patient data for tests."""
    return {
        "full_name": "Test Patient",
        "phone_number": "+1234567890"
    }
