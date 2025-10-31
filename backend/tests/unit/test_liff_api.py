"""
Tests for LIFF API endpoints.
"""

import pytest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import LineUser, Clinic
from core.database import get_db


client = TestClient(app)


class TestLiffAuth:
    """Test LIFF authentication endpoints."""

    def test_liff_login_missing_required_field(self, db_session):
        """Test LIFF login with missing required field."""
        response = client.post("/api/liff/auth/liff-login", json={
            "line_user_id": "U1234567890abcdef",
            "display_name": "Test User"
            # Missing liff_access_token
        })

        assert response.status_code == 422  # Validation error
        assert "liff_access_token" in str(response.json())

    def test_liff_login_missing_token_field(self, db_session):
        """Test LIFF login with missing required token field."""
        response = client.post("/api/liff/auth/liff-login", json={
            "line_user_id": "U1234567890abcdef",
            "display_name": "Test User"
            # Missing liff_access_token
        })

        # Should fail with validation error
        assert response.status_code == 422


class TestPatientManagement:
    """Test patient management endpoints."""

    def test_create_patient_missing_auth(self, db_session):
        """Test creating patient without authentication."""
        response = client.post("/api/liff/patients/primary", json={
            "full_name": "Test Patient",
            "phone_number": "0912345678"
        })

        assert response.status_code == 401

    def test_list_patients_missing_auth(self, db_session):
        """Test listing patients without authentication."""
        response = client.get("/api/liff/patients")

        assert response.status_code == 401


class TestAppointmentManagement:
    """Test appointment management endpoints."""

    def test_create_appointment_missing_auth(self, db_session):
        """Test creating appointment without authentication."""
        response = client.post("/api/liff/appointments", json={
            "patient_id": 1,
            "appointment_type_id": 1,
            "start_time": "2025-11-15T09:00:00+08:00",
            "notes": "Test appointment"
        })

        assert response.status_code == 401

    def test_get_appointments_missing_auth(self, db_session):
        """Test getting appointments without authentication."""
        response = client.get("/api/liff/appointments")

        assert response.status_code == 401

    def test_get_availability_missing_auth(self, db_session):
        """Test getting availability without authentication."""
        response = client.get("/api/liff/availability?date=2025-11-15&appointment_type_id=1")

        assert response.status_code == 401


class TestAppointmentTypes:
    """Test appointment type endpoints."""

    def test_get_appointment_types_missing_auth(self, db_session):
        """Test getting appointment types without authentication."""
        response = client.get("/api/liff/appointment-types")

        assert response.status_code == 401


class TestPractitioners:
    """Test practitioner endpoints."""

    def test_get_practitioners_missing_auth(self, db_session):
        """Test getting practitioners without authentication."""
        response = client.get("/api/liff/practitioners")

        assert response.status_code == 401
