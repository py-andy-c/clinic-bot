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

from src.core.database import Base, get_db
from src.core.config import Settings


# Test database URL using SQLite in-memory
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    """Test settings with SQLite database."""
    return Settings(database_url=TEST_DATABASE_URL)


@pytest.fixture(scope="session")
def test_engine():
    """Create test database engine."""
    engine = create_engine(
        TEST_DATABASE_URL,
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


@pytest.fixture
def sample_appointment_type_data():
    """Sample appointment type data for tests."""
    return {
        "name": "初診評估",
        "duration_minutes": 60
    }


@pytest.fixture
def sample_appointment_types_data():
    """Sample appointment types data for tests."""
    return [
        {"name": "初診評估", "duration_minutes": 60},
        {"name": "一般複診", "duration_minutes": 30},
        {"name": "徒手治療", "duration_minutes": 45}
    ]


@pytest.fixture
def create_sample_clinic(db_session):
    """Create a sample clinic for testing."""
    from src.models.clinic import Clinic
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        subscription_status="trial"
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


@pytest.fixture
def create_sample_therapists(db_session, create_sample_clinic):
    """Create sample therapists for testing."""
    from src.models.therapist import Therapist
    therapists = []
    therapist_names = ["王大明", "陳醫師", "李治療師"]

    for name in therapist_names:
        therapist = Therapist(
            clinic_id=create_sample_clinic.id,
            name=name,
            email=f"{name.lower().replace(' ', '')}@clinic.com"
        )
        db_session.add(therapist)
        therapists.append(therapist)

    db_session.commit()
    for therapist in therapists:
        db_session.refresh(therapist)
    return therapists


@pytest.fixture
def create_sample_patients(db_session, create_sample_clinic):
    """Create sample patients for testing."""
    from src.models.patient import Patient
    patients = []
    patient_data = [
        {"full_name": "陳小姐", "phone_number": "0912345678"},
        {"full_name": "林先生", "phone_number": "0987654321"},
        {"full_name": "張太太", "phone_number": "0955123456"}
    ]

    for data in patient_data:
        patient = Patient(
            clinic_id=create_sample_clinic.id,
            **data
        )
        db_session.add(patient)
        patients.append(patient)

    db_session.commit()
    for patient in patients:
        db_session.refresh(patient)
    return patients


@pytest.fixture
def create_sample_appointment_types(db_session, create_sample_clinic, sample_appointment_types_data):
    """Create sample appointment types for testing."""
    from src.models.appointment_type import AppointmentType
    appointment_types = []

    for data in sample_appointment_types_data:
        appt_type = AppointmentType(
            clinic_id=create_sample_clinic.id,
            **data
        )
        db_session.add(appt_type)
        appointment_types.append(appt_type)

    db_session.commit()
    for appt_type in appointment_types:
        db_session.refresh(appt_type)
    return appointment_types
