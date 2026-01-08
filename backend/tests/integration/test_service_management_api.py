"""
Service Management API Integration Tests.

Tests for the new service management endpoints that provide bulk loading
and saving of service items, practitioners, and associations.
"""

import pytest
import json
import os
from typing import Dict, Any
from fastapi.testclient import TestClient

# Set test database URL before importing app
os.environ.setdefault('DATABASE_URL', 'postgresql://localhost/clinic_bot_test')

from main import app
from models.user import User
from models.clinic import Clinic
from models.appointment_type import AppointmentType
from models.service_type_group import ServiceTypeGroup
from services.jwt_service import jwt_service, TokenPayload


@pytest.fixture
def service_management_client(db_session):
    """Create test client with service management test data using dependency overrides."""
    from auth.dependencies import get_current_user, require_admin_role, require_authenticated
    from core.database import get_db

    # Create a test clinic
    test_clinic = Clinic(
        name="Service Management Test Clinic",
        line_channel_id="test_service_channel",
        line_channel_secret="test_service_secret",
        line_channel_access_token="test_service_token",
        settings={}
    )
    db_session.add(test_clinic)
    db_session.flush()  # Get clinic.id

    # Create a service type group
    group = ServiceTypeGroup(
        clinic_id=test_clinic.id,
        name="Manual Therapy",
        display_order=1
    )
    db_session.add(group)
    db_session.flush()  # Get group.id

    # Create test appointment types
    at1 = AppointmentType(
        clinic_id=test_clinic.id,
        name="Initial Consultation",
        duration_minutes=60,
        service_type_group_id=group.id,
        display_order=1,
        allow_patient_booking=True,
        allow_new_patient_booking=True,
        allow_existing_patient_booking=True,
        allow_patient_practitioner_selection=True
    )
    at2 = AppointmentType(
        clinic_id=test_clinic.id,
        name="Follow-up Session",
        duration_minutes=30,
        service_type_group_id=group.id,
        display_order=2,
        allow_patient_booking=True,
        allow_new_patient_booking=True,
        allow_existing_patient_booking=True,
        allow_patient_practitioner_selection=True
    )
    db_session.add(at1)
    db_session.add(at2)
    db_session.flush()

    # Create test practitioners (clinic members with practitioner role)
    from tests.conftest import create_user_with_clinic_association
    practitioner1, assoc1 = create_user_with_clinic_association(
        db_session, test_clinic, "Dr. Smith", "smith@example.com", "test_sub_1",
        ["admin", "practitioner"], True
    )
    practitioner2, assoc2 = create_user_with_clinic_association(
        db_session, test_clinic, "Dr. Jones", "jones@example.com", "test_sub_2",
        ["practitioner"], True
    )

    db_session.commit()

    # Override authentication dependencies
    def override_get_db():
        yield db_session

    def override_get_current_user():
        from auth.dependencies import UserContext
        return UserContext(
            user_type="clinic_user",
            email=practitioner1.email,
            roles=assoc1.roles,
            active_clinic_id=test_clinic.id,
            google_subject_id=practitioner1.google_subject_id,
            name=assoc1.full_name,
            user_id=practitioner1.id
        )

    def override_require_authenticated():
        return override_get_current_user()

    def override_require_admin_role():
        return override_get_current_user()

    # Create test client with overridden dependencies
    from main import app
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[require_authenticated] = override_require_authenticated
    app.dependency_overrides[require_admin_role] = override_require_admin_role

    client = TestClient(app)

    # Store test data for use in tests
    client.test_clinic = test_clinic
    client.test_practitioners = [practitioner1, practitioner2]
    client.test_appointment_types = [at1, at2]
    client.test_group = group

    yield client

    # Clean up dependency overrides
    app.dependency_overrides.clear()


class TestServiceManagementAPI:
    """Test suite for service management API endpoints."""

    def test_get_service_management_data_success(self, service_management_client):
        """Test successful retrieval of service management data."""
        response = service_management_client.get('/api/clinic/service-management-data')
        assert response.status_code == 200

        data = response.json()

        # Check structure
        assert "appointment_types" in data
        assert "service_type_groups" in data
        assert "practitioners" in data
        assert "associations" in data

        # Check appointment types
        appointment_types = data["appointment_types"]
        assert len(appointment_types) == 2
        assert appointment_types[0]["name"] == "Initial Consultation"
        assert appointment_types[1]["name"] == "Follow-up Session"

        # Check service type groups
        groups = data["service_type_groups"]
        assert len(groups) == 1
        assert groups[0]["name"] == "Manual Therapy"

        # Check practitioners
        practitioners = data["practitioners"]
        assert len(practitioners) == 2
        practitioner_names = [p["full_name"] for p in practitioners]
        assert "Dr. Smith" in practitioner_names
        assert "Dr. Jones" in practitioner_names

        # Check associations structure
        associations = data["associations"]
        assert "practitioner_assignments" in associations
        assert "billing_scenarios" in associations
        assert "resource_requirements" in associations
        assert "follow_up_messages" in associations

    def test_get_appointment_types_lightweight_success(self, service_management_client):
        """Test successful retrieval of lightweight appointment types."""
        response = service_management_client.get('/api/clinic/appointment-types')
        assert response.status_code == 200

        data = response.json()

        # Should be a list of appointment types with basic fields
        assert isinstance(data, list)
        assert len(data) == 2

        # Check structure
        at = data[0]
        expected_fields = ["id", "name", "duration_minutes", "service_type_group_id", "display_order"]
        for field in expected_fields:
            assert field in at

        # Should NOT have association fields
        association_fields = ["practitioner_assignments", "billing_scenarios", "resource_requirements"]
        for field in association_fields:
            assert field not in at

    def test_get_settings_excludes_appointment_types(self, service_management_client):
        """Test that /clinic/settings no longer includes appointment_types."""
        response = service_management_client.get('/api/clinic/settings')
        assert response.status_code == 200

        data = response.json()

        # Should NOT have appointment_types
        assert "appointment_types" not in data

        # Should have has_appointment_types flag
        assert "has_appointment_types" in data
        assert data["has_appointment_types"] is True

        # Should still have other settings
        expected_fields = ["clinic_id", "clinic_name", "business_hours", "notification_settings",
                          "booking_restriction_settings", "clinic_info_settings", "chat_settings",
                          "receipt_settings"]
        for field in expected_fields:
            assert field in data

    def test_get_settings_has_appointment_types_flag_false(self, db_session):
        """Test that has_appointment_types flag is False when clinic has no appointment types."""
        from auth.dependencies import get_current_user, require_authenticated
        from core.database import get_db

        # Create a clinic with no appointment types
        empty_clinic = Clinic(
            name="Empty Clinic",
            line_channel_id="empty_channel",
            line_channel_secret="empty_secret",
            line_channel_access_token="empty_token",
            settings={}
        )
        db_session.add(empty_clinic)
        db_session.flush()

        # Create admin user for this clinic
        from tests.conftest import create_user_with_clinic_association
        admin_user, admin_assoc = create_user_with_clinic_association(
            db_session, empty_clinic, "Empty Admin", "empty@example.com", "empty_sub",
            ["admin"], True
        )
        db_session.commit()

        # Override authentication dependencies
        def override_get_db():
            yield db_session

        def override_get_current_user():
            from auth.dependencies import UserContext
            return UserContext(
                user_type="clinic_user",
                email=admin_user.email,
                roles=admin_assoc.roles,
                active_clinic_id=empty_clinic.id,
                google_subject_id=admin_user.google_subject_id,
                name=admin_assoc.full_name,
                user_id=admin_user.id
            )

        def override_require_authenticated():
            return override_get_current_user()

        # Create test client with overridden dependencies
        from main import app
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_get_current_user
        app.dependency_overrides[require_authenticated] = override_require_authenticated

        client = TestClient(app)

        response = client.get('/api/clinic/settings')
        assert response.status_code == 200

        data = response.json()
        assert data["has_appointment_types"] is False

        # Clean up dependency overrides
        app.dependency_overrides.clear()

    def test_bulk_save_service_management_data_success(self, service_management_client):
        """Test successful bulk save of service management data."""
        save_data = {
            "appointment_types": [
                {
                    "name": "New Service",
                    "duration_minutes": 45,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [
                {
                    "name": "New Group",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {},
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        response = service_management_client.post('/api/clinic/service-management-data/save', json=save_data)
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True
        assert "message" in data

    def test_bulk_save_validation_error(self, service_management_client):
        """Test bulk save with invalid data returns validation errors."""
        # Missing required fields
        invalid_data = {
            "appointment_types": [
                {
                    "duration_minutes": 45,
                    "display_order": 1
                    # Missing required "name" field
                }
            ],
            "service_type_groups": [],
            "associations": {
                "practitioner_assignments": {},
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        response = service_management_client.post('/api/clinic/service-management-data/save', json=invalid_data)
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data

    def test_service_management_data_with_associations(self, service_management_client):
        """Test that service management data includes associations when they exist."""
        # This test would need to set up billing scenarios, resource requirements, etc.
        # For now, just verify the structure is correct
        response = service_management_client.get('/api/clinic/service-management-data')
        assert response.status_code == 200

        data = response.json()

        # Verify associations structure even when empty
        associations = data["associations"]
        required_association_keys = [
            "practitioner_assignments", "billing_scenarios",
            "resource_requirements", "follow_up_messages"
        ]

        for key in required_association_keys:
            assert key in associations
            assert isinstance(associations[key], dict)
