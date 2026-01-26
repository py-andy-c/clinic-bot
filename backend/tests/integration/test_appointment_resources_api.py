"""
Integration tests for appointment resources API endpoint.

Tests the GET /api/clinic/appointments/{appointment_id}/resources endpoint.
"""

import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from core.database import get_db
from auth.dependencies import get_current_user, UserContext
from models.clinic import Clinic
from models.user import User
from models.patient import Patient
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.resource_type import ResourceType
from models.resource import Resource
from models.appointment_resource_requirement import AppointmentResourceRequirement
from models.appointment_resource_allocation import AppointmentResourceAllocation
from models.user_clinic_association import UserClinicAssociation
from tests.conftest import create_user_with_clinic_association, create_calendar_event_with_clinic


@pytest.fixture
def client(db_session):
    """Create test client with database override."""
    def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def test_clinic_and_user(db_session):
    """Create a test clinic with a user."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.commit()
    
    user, association = create_user_with_clinic_association(
        db_session, clinic, "Test User", "test@example.com", "test_sub", ["practitioner"], True
    )
    db_session.commit()
    
    return clinic, user


class TestGetAppointmentResources:
    """Test GET /api/clinic/appointments/{appointment_id}/resources endpoint."""
    
    def test_get_appointment_resources_includes_resource_type_name(
        self, client: TestClient, db_session: Session, test_clinic_and_user
    ):
        """Test that the endpoint includes resource_type_name in the response."""
        clinic, user = test_clinic_and_user
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()
        
        # Create resource type
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()
        
        # Create resource
        resource = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        db_session.add(resource)
        db_session.commit()
        
        # Create calendar event and appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=datetime(2025, 1, 28).date(),
            start_time=datetime(2025, 1, 28, 10, 0).time(),
            end_time=datetime(2025, 1, 28, 11, 0).time()
        )
        db_session.commit()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Allocate resource
        allocation = AppointmentResourceAllocation(
            appointment_id=calendar_event.id,
            resource_id=resource.id
        )
        db_session.add(allocation)
        db_session.commit()
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=user.id,
                email=user.email,
                active_clinic_id=clinic.id,
                roles=["practitioner"],
                google_subject_id="test_sub",
                name="Test Practitioner"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Call the endpoint
            response = client.get(f"/api/clinic/appointments/{calendar_event.id}/resources")
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify response structure
            assert "resources" in data
            assert len(data["resources"]) == 1
            
            resource_response = data["resources"][0]
            
            # Verify all expected fields are present
            assert resource_response["id"] == resource.id
            assert resource_response["resource_type_id"] == resource_type.id
            assert resource_response["resource_type_name"] == resource_type.name  # ✅ This is the new field
            assert resource_response["name"] == resource.name
            assert resource_response["clinic_id"] == clinic.id
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)
    
    def test_get_appointment_resources_multiple_resources(
        self, client: TestClient, db_session: Session, test_clinic_and_user
    ):
        """Test that the endpoint returns resource_type_name for multiple resources."""
        clinic, user = test_clinic_and_user
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()
        
        # Create multiple resource types
        resource_type1 = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        resource_type2 = ResourceType(
            clinic_id=clinic.id,
            name="床"
        )
        db_session.add_all([resource_type1, resource_type2])
        db_session.commit()
        
        # Create resources
        resource1 = Resource(
            resource_type_id=resource_type1.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        resource2 = Resource(
            resource_type_id=resource_type2.id,
            clinic_id=clinic.id,
            name="床A"
        )
        db_session.add_all([resource1, resource2])
        db_session.commit()
        
        # Create calendar event and appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=datetime(2025, 1, 28).date(),
            start_time=datetime(2025, 1, 28, 10, 0).time(),
            end_time=datetime(2025, 1, 28, 11, 0).time()
        )
        db_session.commit()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Allocate both resources
        allocation1 = AppointmentResourceAllocation(
            appointment_id=calendar_event.id,
            resource_id=resource1.id
        )
        allocation2 = AppointmentResourceAllocation(
            appointment_id=calendar_event.id,
            resource_id=resource2.id
        )
        db_session.add_all([allocation1, allocation2])
        db_session.commit()
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=user.id,
                email=user.email,
                active_clinic_id=clinic.id,
                roles=["practitioner"],
                google_subject_id="test_sub",
                name="Test Practitioner"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Call the endpoint
            response = client.get(f"/api/clinic/appointments/{calendar_event.id}/resources")
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify response structure
            assert "resources" in data
            assert len(data["resources"]) == 2
            
            # Verify both resources have resource_type_name
            resource_ids = {r["id"] for r in data["resources"]}
            assert resource1.id in resource_ids
            assert resource2.id in resource_ids
            
            for resource_response in data["resources"]:
                assert "resource_type_name" in resource_response
                if resource_response["id"] == resource1.id:
                    assert resource_response["resource_type_name"] == resource_type1.name
                elif resource_response["id"] == resource2.id:
                    assert resource_response["resource_type_name"] == resource_type2.name
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)


class TestResourceConflicts:
    """Integration tests for resource conflicts endpoint."""

    def test_resource_conflicts_no_conflicts(self, client: TestClient, db_session: Session, test_clinic_and_user):
        """Test resource conflicts when no conflicts exist."""
        from datetime import datetime
        clinic, user = test_clinic_and_user

        # Create an appointment type for testing
        appointment_type = AppointmentType(
            name="Test Type",
            duration_minutes=30,
            clinic_id=clinic.id
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=user.id,
                email=user.email,
                active_clinic_id=clinic.id,
                roles=["practitioner"],
                google_subject_id="test_sub",
                name="Test Practitioner"
            )

        app.dependency_overrides[get_current_user] = override_get_current_user

        try:
            start_time = datetime.now().isoformat()
            end_time = (datetime.now().replace(hour=23, minute=59)).isoformat()

            response = client.get(
                "/api/clinic/appointments/check-resource-conflicts",
                params={
                    "appointment_type_id": appointment_type.id,
                    "start_time": start_time,
                    "end_time": end_time
                }
            )

            if response.status_code != 200:
                print(f"Response status: {response.status_code}")
                print(f"Response content: {response.json()}")

            assert response.status_code == 200
            data = response.json()

            assert data["has_conflict"] is False
            assert data["conflict_type"] is None
            assert data["selection_insufficient_warnings"] == []
            assert data["resource_conflict_warnings"] == []
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_resource_conflicts_with_conflicts(self, client: TestClient, db_session: Session, test_clinic_and_user):
        """Test resource conflicts when resources are not available."""
        from datetime import datetime, time, date
        clinic, user = test_clinic_and_user

        # Create appointment type
        appointment_type = AppointmentType(
            name="Test Type",
            duration_minutes=30,
            clinic_id=clinic.id
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create resource type and resource
        resource_type = ResourceType(
            name="Test Equipment",
            clinic_id=clinic.id
        )
        db_session.add(resource_type)
        db_session.flush()

        resource = Resource(
            name="Test Machine",
            resource_type_id=resource_type.id,
            clinic_id=clinic.id
        )
        db_session.add(resource)
        db_session.flush()

        # Create resource requirement
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.flush()

        # Create conflicting appointment
        calendar_event = create_calendar_event_with_clinic(
            db_session, user, clinic,
            event_type="appointment",
            event_date=date.today(),
            start_time=time(10, 0),
            end_time=time(10, 30),
            custom_event_name="Conflicting Appointment"
        )
        db_session.commit()

        # Create a patient for the appointment
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            birthday=date(1990, 1, 1)
        )
        db_session.add(patient)
        db_session.flush()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.flush()

        # Allocate the resource to the appointment
        allocation = AppointmentResourceAllocation(
            appointment_id=appointment.calendar_event_id,
            resource_id=resource.id
        )
        db_session.add(allocation)
        db_session.commit()

        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=user.id,
                email=user.email,
                active_clinic_id=clinic.id,
                roles=["practitioner"],
                google_subject_id="test_sub",
                name="Test Practitioner"
            )

        app.dependency_overrides[get_current_user] = override_get_current_user

        try:
            # Test resource conflict detection
            start_time = datetime.combine(date.today(), time(10, 0)).isoformat()
            end_time = datetime.combine(date.today(), time(10, 30)).isoformat()

            response = client.get(
                "/api/clinic/appointments/check-resource-conflicts",
                params={
                    "appointment_type_id": appointment_type.id,
                    "start_time": start_time,
                    "end_time": end_time
                }
            )

            assert response.status_code == 200
            data = response.json()

            assert data["has_conflict"] is True
            assert data["conflict_type"] == "resource"
            assert data["selection_insufficient_warnings"] is not None
            assert len(data["selection_insufficient_warnings"]) > 0
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_resource_conflicts_invalid_datetime(self, client: TestClient, db_session: Session, test_clinic_and_user):
        """Test resource conflicts with invalid datetime format."""
        clinic, user = test_clinic_and_user

        # Create an appointment type for testing
        appointment_type = AppointmentType(
            name="Test Type",
            duration_minutes=30,
            clinic_id=clinic.id
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=user.id,
                email=user.email,
                active_clinic_id=clinic.id,
                roles=["practitioner"],
                google_subject_id="test_sub",
                name="Test Practitioner"
            )

        app.dependency_overrides[get_current_user] = override_get_current_user

        try:
            response = client.get(
                "/api/clinic/appointments/check-resource-conflicts",
                params={
                    "appointment_type_id": appointment_type.id,
                    "start_time": "invalid-datetime",
                    "end_time": "2024-01-15T11:00:00"
                }
            )

            assert response.status_code == 400
        finally:
            app.dependency_overrides.pop(get_current_user, None)

