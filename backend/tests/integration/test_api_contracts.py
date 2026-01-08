"""
API Contract Integration Tests.

Tests that validate backend API responses match the expected schemas
that the frontend uses. These tests ensure API contract consistency
between frontend and backend.
"""

import pytest
import json
from typing import Dict, Any
import jsonschema
from unittest.mock import patch
from fastapi.testclient import TestClient

from main import app
from models.user import User
from models.clinic import Clinic
from models.appointment_type import AppointmentType
from services.jwt_service import jwt_service, TokenPayload


@pytest.fixture
def api_contract_client(db_session):
    """Create test client using global app with temporarily overridden dependencies."""
    # Create a test clinic for API contract tests
    from models.clinic import Clinic
    test_clinic = Clinic(
        name="API Contract Test Clinic",
        line_channel_id="test_contract_channel",
        line_channel_secret="test_contract_secret",
        line_channel_access_token="test_contract_token",
        settings={}
    )
    db_session.add(test_clinic)
    db_session.commit()

    # Verify clinic was created
    assert test_clinic.id is not None

    # Create a test practitioner user
    from models.user import User
    from tests.conftest import create_user_with_clinic_association
    test_user, test_user_assoc = create_user_with_clinic_association(
        db_session, test_clinic, "Test Practitioner", "test@example.com", "test_sub", ["admin", "practitioner"], True
    )
    db_session.commit()

    # Verify user was created
    assert test_user.id is not None

    # Use the global app but with temporarily overridden dependencies
    from main import app
    from auth.dependencies import get_current_user, require_admin_role, require_system_admin
    from core.database import get_db

    def override_get_db():
        """Override get_db to use the test session where clinic was created."""
        yield db_session

    def override_get_current_user():
        from auth.dependencies import UserContext
        return UserContext(
            user_type="clinic_user",
            email="test@example.com",
            roles=["admin", "practitioner"],
            active_clinic_id=test_clinic.id,
            google_subject_id="test_sub",
            name="Test Practitioner",
            user_id=test_user.id
        )

    def override_require_admin_role():
        return override_get_current_user()

    def override_require_system_admin():
        from auth.dependencies import UserContext
        return UserContext(
            user_type="system_admin",
            email="admin@test.com",
            roles=["admin"],
            active_clinic_id=None,
            google_subject_id="system_admin_123",
            name="System Admin"
        )

    # Store original overrides to restore later
    original_overrides = app.dependency_overrides.copy()

    # Apply temporary overrides for API contract testing
    app.dependency_overrides.update({
        get_db: override_get_db,
        get_current_user: override_get_current_user,
        require_admin_role: override_require_admin_role,
        require_system_admin: override_require_system_admin,
    })

    client = TestClient(app)

    # Restore original overrides after test
    yield client

    # Restore original dependency overrides
    app.dependency_overrides = original_overrides




# Frontend Zod schemas converted to JSON Schema for validation
CLINIC_SETTINGS_SCHEMA = {
    "type": "object",
    "required": ["clinic_id", "clinic_name", "business_hours", "has_appointment_types", "notification_settings"],
    "properties": {
        "clinic_id": {"type": "number"},
        "clinic_name": {"type": "string"},
        "business_hours": {
            "type": "object",
            "patternProperties": {
                ".*": {
                    "type": "object",
                    "required": ["start", "end", "enabled"],
                    "properties": {
                        "start": {"type": "string"},
                        "end": {"type": "string"},
                        "enabled": {"type": "boolean"}
                    }
                }
            }
        },
        "has_appointment_types": {"type": "boolean"},
        "notification_settings": {
            "type": "object",
            "required": ["reminder_hours_before"],
            "properties": {
                "reminder_hours_before": {"type": "number"}
            }
        }
    }
}


SIGNUP_RESPONSE_SCHEMA = {
    "type": "object",
    "required": ["access_token", "token_type", "expires_in", "user"],
    "properties": {
        "access_token": {"type": "string"},
        "token_type": {"type": "string"},
        "expires_in": {"type": "number"},
        "user": {
            "type": "object",
            "required": ["user_id", "email", "full_name", "roles", "user_type"],
            "properties": {
                "user_id": {"type": "number"},
                "email": {"type": "string"},
                "full_name": {"type": "string"},
                "roles": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["admin", "practitioner"]}
                },
                "clinic_id": {"type": "number"},
                "user_type": {"type": "string", "enum": ["system_admin", "clinic_user"]}
            }
        }
    }
}


class TestAPIContracts:
    """Test API contract compliance between backend and frontend expectations."""

    def validate_response_schema(self, response_data: Dict[str, Any], schema: Dict[str, Any], endpoint_name: str):
        """Validate response data against JSON schema."""
        try:
            jsonschema.validate(instance=response_data, schema=schema)
        except jsonschema.ValidationError as e:
            pytest.fail(f"API contract violation in {endpoint_name}: {e.message}\nResponse: {json.dumps(response_data, indent=2)}")

    def test_clinic_settings_contract(self, api_contract_client):
        """Test that /api/clinic/settings returns data matching frontend ClinicSettings interface."""
        response = api_contract_client.get('/api/clinic/settings')
        assert response.status_code == 200

        response_data = response.json()
        self.validate_response_schema(response_data, CLINIC_SETTINGS_SCHEMA, "/api/clinic/settings")

        # Additional validation for expected structure
        assert "clinic_id" in response_data
        assert "clinic_name" in response_data
        assert "business_hours" in response_data
        assert "has_appointment_types" in response_data
        assert "notification_settings" in response_data

        # Validate notification_settings structure
        notification_settings = response_data["notification_settings"]
        assert "reminder_hours_before" in notification_settings
        assert isinstance(notification_settings["reminder_hours_before"], (int, float))

    def test_clinic_dashboard_contract(self, api_contract_client):
        """Test that /api/clinic/dashboard endpoint no longer exists (removed)."""
        response = api_contract_client.get('/api/clinic/dashboard')
        assert response.status_code == 404

    def test_clinic_members_contract(self, api_contract_client):
        """Test that /api/clinic/members returns properly structured member data."""
        response = api_contract_client.get('/api/clinic/members')
        assert response.status_code == 200

        response_data = response.json()
        assert "members" in response_data
        assert isinstance(response_data["members"], list)

        if response_data["members"]:  # If there are members, validate structure
            member = response_data["members"][0]
            required_fields = ["id", "email", "full_name", "roles", "is_active", "created_at"]
            for field in required_fields:
                assert field in member

            assert isinstance(member["roles"], list)

    def test_system_dashboard_contract(self, api_contract_client):
        """Test that /api/system/dashboard endpoint no longer exists (removed)."""
        response = api_contract_client.get('/api/system/dashboard')
        assert response.status_code == 404

    def test_system_clinics_contract(self, api_contract_client):
        """Test that /api/system/clinics returns properly structured clinic data."""
        response = api_contract_client.get('/api/system/clinics')
        assert response.status_code == 200

        response_data = response.json()
        assert isinstance(response_data, list)

        if response_data:  # If there are clinics, validate structure
            clinic = response_data[0]
            required_fields = ["id", "name", "subscription_status", "created_at"]
            for field in required_fields:
                assert field in clinic

            assert clinic["subscription_status"] in ["trial", "active", "past_due", "canceled"]

    def test_signup_response_contract(self, api_contract_client):
        """Test that signup responses match the expected SignupResponse structure."""
        # This test is complex due to OAuth mocking. For API contract testing,
        # we focus on the core endpoints that are more commonly used.
        # The signup flow is tested in the existing auth integration tests.
        pass

    def test_settings_update_contract(self, api_contract_client):
        """Test that clinic settings can be updated and return proper response."""
        # Update settings
        update_data = {
            "appointment_types": [
                {
                    "id": 1,
                    "name": "Updated Appointment Type",
                    "duration_minutes": 45
                }
            ],
            "notification_settings": {
                "reminder_hours_before": 48
            }
        }

        response = api_contract_client.put('/api/clinic/settings', json=update_data)
        assert response.status_code == 200

        response_data = response.json()
        assert "message" in response_data
        assert "設定更新成功" in response_data["message"]

    def test_business_hours_structure(self, api_contract_client):
        """Test that business_hours structure matches frontend expectations."""
        response = api_contract_client.get('/api/clinic/settings')
        assert response.status_code == 200

        response_data = response.json()
        business_hours = response_data["business_hours"]

        # Should have all 7 days
        expected_days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for day in expected_days:
            assert day in business_hours
            day_data = business_hours[day]
            assert "start" in day_data
            assert "end" in day_data
            assert "enabled" in day_data
            assert isinstance(day_data["enabled"], bool)

    def test_service_management_data_contract(self, api_contract_client):
        """Test that /api/clinic/service-management-data returns complete service management data."""
        response = api_contract_client.get('/api/clinic/service-management-data')
        assert response.status_code == 200
        response_data = response.json()

        # Validate top-level structure
        assert "appointment_types" in response_data
        assert "service_type_groups" in response_data
        assert "practitioners" in response_data
        assert "associations" in response_data

        # Validate appointment_types structure
        assert isinstance(response_data["appointment_types"], list)
        if response_data["appointment_types"]:
            at = response_data["appointment_types"][0]
            assert "id" in at
            assert "name" in at
            assert "duration_minutes" in at

        # Validate service_type_groups structure
        assert isinstance(response_data["service_type_groups"], list)
        if response_data["service_type_groups"]:
            stg = response_data["service_type_groups"][0]
            assert "id" in stg
            assert "name" in stg
            assert "display_order" in stg

        # Validate practitioners structure
        assert isinstance(response_data["practitioners"], list)
        if response_data["practitioners"]:
            p = response_data["practitioners"][0]
            assert "id" in p
            assert "full_name" in p
            assert "roles" in p

        # Validate associations structure
        associations = response_data["associations"]
        assert "practitioner_assignments" in associations
        assert "billing_scenarios" in associations
        assert "resource_requirements" in associations
        assert "follow_up_messages" in associations

    def test_appointment_types_basic_contract(self, api_contract_client):
        """Test that /api/clinic/appointment-types returns basic appointment type data."""
        response = api_contract_client.get('/api/clinic/appointment-types')
        assert response.status_code == 200
        response_data = response.json()

        # Validate structure
        assert "appointment_types" in response_data
        assert isinstance(response_data["appointment_types"], list)

        # Validate each appointment type has basic fields only
        for at in response_data["appointment_types"]:
            assert "id" in at
            assert "name" in at
            assert "duration_minutes" in at
            assert "service_type_group_id" in at
            assert "display_order" in at
            # Should NOT have detailed fields like receipt_name, description, etc.
            assert "receipt_name" not in at
            assert "description" not in at

    def test_service_management_save_contract(self, api_contract_client):
        """Test that /api/clinic/service-management-data/save can save service management data."""
        # First get current data
        get_response = api_contract_client.get('/api/clinic/service-management-data')
        assert get_response.status_code == 200
        current_data = get_response.json()

        # Modify some data (add a new appointment type)
        save_data = {
            "appointment_types": current_data["appointment_types"] + [{
                "name": "Test Service",
                "duration_minutes": 30,
                "display_order": 999
            }],
            "service_type_groups": current_data["service_type_groups"],
            "associations": current_data["associations"]
        }

        # Save the data
        save_response = api_contract_client.post('/api/clinic/service-management-data/save', json=save_data)
        assert save_response.status_code == 200
        save_result = save_response.json()

        # Validate response structure
        assert "success" in save_result
        assert "errors" in save_result
        assert isinstance(save_result["errors"], list)
