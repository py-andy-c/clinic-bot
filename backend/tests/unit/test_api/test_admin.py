"""
Unit tests for admin API endpoints.

Tests authentication, therapist management, patient management, and settings.
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from fastapi import HTTPException

from api.admin import (
    initiate_google_auth,
    google_auth_callback,
    get_dashboard_stats,
    get_therapists,
    invite_therapist,
    get_patients
)
from core.database import get_db
from models.therapist import Therapist
from models.patient import Patient


class TestAdminAuth:
    """Test admin authentication endpoints."""

    @pytest.mark.asyncio
    async def test_initiate_google_auth_success(self):
        """Test successful admin Google OAuth initiation."""
        with patch('api.admin.GOOGLE_CLIENT_ID', 'test_client_id'), \
             patch('api.admin.API_BASE_URL', 'http://localhost:8000'):

            result = await initiate_google_auth()

            assert "auth_url" in result
            assert "accounts.google.com" in result["auth_url"]
            # The client_id will be empty if GOOGLE_CLIENT_ID is not set in the env

    @pytest.mark.asyncio
    async def test_google_auth_callback_success(self):
        """Test successful admin Google OAuth callback."""
        mock_db = Mock()

        # Mock admin user
        mock_admin = Mock()
        mock_admin.id = 1
        mock_admin.email = "admin@test.com"
        mock_admin.full_name = "Test Admin"

        # Mock clinic
        mock_clinic = Mock()
        mock_clinic.id = 1
        mock_clinic.name = "Test Clinic"

        def query_side_effect(model):
            mock_query = Mock()
            mock_filter = Mock()
            if hasattr(mock_filter, 'first'):
                if model.__name__ == "ClinicAdmin":
                    mock_filter.first.return_value = mock_admin
                elif model.__name__ == "Clinic":
                    mock_filter.first.return_value = mock_clinic
                mock_query.filter.return_value = mock_filter
            return mock_query

        mock_db.query.side_effect = query_side_effect

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client

            # Mock token response
            mock_token_response = AsyncMock()
            mock_token_response.raise_for_status = AsyncMock()
            mock_token_response.json = AsyncMock(return_value={
                "access_token": "test_token",
                "id_token": "test_id_token"
            })

            # Mock user info response
            mock_user_response = AsyncMock()
            mock_user_response.raise_for_status = AsyncMock()
            mock_user_response.json = AsyncMock(return_value={
                "email": "admin@test.com",
                "name": "Test Admin"
            })

            mock_client.post = AsyncMock(return_value=mock_token_response)
            mock_client.get = AsyncMock(return_value=mock_user_response)

            result = await google_auth_callback("test_code", "admin", mock_db)

            assert result["user"]["email"] == "admin@test.com"
            assert result["message"] == "Authentication successful"

    @pytest.mark.asyncio
    async def test_google_auth_callback_invalid_state(self):
        """Test Google OAuth callback with invalid state."""
        mock_db = Mock()

        with pytest.raises(HTTPException) as exc_info:
            await google_auth_callback("test_code", "invalid_state", mock_db)

        assert exc_info.value.status_code == 400
        assert "Invalid authentication state" in str(exc_info.value.detail)


class TestDashboardStats:
    """Test dashboard statistics endpoint."""

    @pytest.mark.asyncio
    async def test_get_dashboard_stats_success(self):
        """Test successful dashboard stats retrieval."""
        mock_db = Mock()

        # Mock current admin
        current_admin = {"clinic_id": 1, "id": 1}

        # Mock queries
        mock_appointment_query = Mock()
        mock_appointment_query.count.return_value = 100
        mock_appointment_query.filter.return_value = mock_appointment_query

        mock_patient_query = Mock()
        mock_patient_query.count.return_value = 50
        mock_patient_query.filter.return_value = mock_patient_query

        def query_side_effect(model):
            if model.__name__ == "Appointment":
                return mock_appointment_query
            elif model.__name__ == "Patient":
                return mock_patient_query
            return Mock()

        mock_db.query.side_effect = query_side_effect

        result = await get_dashboard_stats(current_admin, mock_db)

        assert result["total_appointments"] == 100
        assert result["new_patients"] == 50
        assert "upcoming_appointments" in result
        assert "cancellation_rate" in result


class TestTherapistManagement:
    """Test therapist management endpoints."""

    @pytest.mark.asyncio
    async def test_get_therapists_success(self):
        """Test successful therapist list retrieval."""
        mock_db = Mock()
        current_admin = {"clinic_id": 1}

        # Mock therapists as actual objects with attributes
        class MockTherapist:
            def __init__(self, id, name, email, gcal_credentials, gcal_sync_enabled):
                self.id = id
                self.name = name
                self.email = email
                self.gcal_credentials = gcal_credentials
                self.gcal_sync_enabled = gcal_sync_enabled
                self.created_at = Mock()

        mock_therapists = [
            MockTherapist(1, "Dr. Smith", "smith@test.com", None, False)
        ]

        mock_db.query.return_value.filter.return_value.all.return_value = mock_therapists

        result = await get_therapists(current_admin, mock_db)

        assert len(result) == 1
        assert result[0]["name"] == "Dr. Smith"
        assert result[0]["gcal_sync_enabled"] == False

    @pytest.mark.asyncio
    async def test_invite_therapist_success(self):
        """Test successful therapist invitation."""
        mock_db = Mock()
        current_admin = {"clinic_id": 1}

        # Mock therapist creation
        mock_therapist = Mock(id=1, name="Dr. Smith", email="smith@test.com")
        mock_db.add = Mock()
        mock_db.commit = Mock()
        mock_db.refresh = Mock()

        result = await invite_therapist({"name": "Dr. Smith", "email": "smith@test.com"}, current_admin, mock_db)

        assert result["name"] == "Dr. Smith"
        assert result["email"] == "smith@test.com"


class TestPatientManagement:
    """Test patient management endpoints."""

    @pytest.mark.asyncio
    async def test_get_patients_success(self):
        """Test successful patient list retrieval."""
        mock_db = Mock()
        current_admin = {"clinic_id": 1}

        # Mock patients as actual objects with attributes
        class MockPatient:
            def __init__(self, id, full_name, phone_number, line_user):
                self.id = id
                self.full_name = full_name
                self.phone_number = phone_number
                self.line_user = line_user
                self.created_at = Mock()

        mock_patients = [
            MockPatient(1, "John Doe", "1234567890", Mock(line_user_id="line123"))
        ]

        mock_db.query.return_value.filter.return_value.all.return_value = mock_patients

        result = await get_patients(current_admin, mock_db)

        assert len(result) == 1
        assert result[0]["full_name"] == "John Doe"
        assert result[0]["line_user_id"] == "line123"
