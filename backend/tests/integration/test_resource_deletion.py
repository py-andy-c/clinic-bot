"""
Integration tests for resource deletion functionality.

Tests the enhanced resource deletion that unallocates future appointments.
"""

import pytest
from datetime import datetime, date, time, timezone, timedelta
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
from models.appointment_resource_allocation import AppointmentResourceAllocation
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
def test_clinic_and_admin(db_session):
    """Create a test clinic with an admin user."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.commit()
    
    user, association = create_user_with_clinic_association(
        db_session, clinic, "Test Admin", "admin@example.com", "admin_sub", ["admin"], True
    )
    db_session.commit()
    
    return clinic, user


class TestResourceDeletion:
    """Test resource deletion with future appointment unallocation."""
    
    def test_delete_resource_with_future_appointments(
        self, client: TestClient, db_session: Session, test_clinic_and_admin
    ):
        """Test that deleting a resource unallocates it from future appointments."""
        clinic, admin_user = test_clinic_and_admin
        
        # Create resource type and resource
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()
        
        resource = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        db_session.add(resource)
        db_session.commit()
        
        # Create patient and appointment type
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()
        
        # Create future appointment
        tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
        future_calendar_event = create_calendar_event_with_clinic(
            db_session, admin_user, clinic,
            event_type="appointment",
            event_date=tomorrow.date(),
            start_time=tomorrow.time(),
            end_time=(tomorrow + timedelta(hours=1)).time()
        )
        db_session.commit()
        
        future_appointment = Appointment(
            calendar_event_id=future_calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(future_appointment)
        db_session.commit()
        
        # Allocate resource to future appointment
        future_allocation = AppointmentResourceAllocation(
            appointment_id=future_calendar_event.id,
            resource_id=resource.id
        )
        db_session.add(future_allocation)
        db_session.commit()
        
        # Create past appointment (should not be affected)
        yesterday = datetime.now(timezone.utc) - timedelta(days=1)
        past_calendar_event = create_calendar_event_with_clinic(
            db_session, admin_user, clinic,
            event_type="appointment",
            event_date=yesterday.date(),
            start_time=yesterday.time(),
            end_time=(yesterday + timedelta(hours=1)).time()
        )
        db_session.commit()
        
        past_appointment = Appointment(
            calendar_event_id=past_calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(past_appointment)
        db_session.commit()
        
        # Allocate resource to past appointment
        past_allocation = AppointmentResourceAllocation(
            appointment_id=past_calendar_event.id,
            resource_id=resource.id
        )
        db_session.add(past_allocation)
        db_session.commit()
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=admin_user.id,
                email=admin_user.email,
                active_clinic_id=clinic.id,
                roles=["admin"],
                google_subject_id="admin_sub",
                name="Test Admin"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Delete the resource
            response = client.delete(f"/api/clinic/resources/{resource.id}")
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify response
            assert data["success"] is True
            assert data["affected_appointments"] == 1
            assert "1 個未來預約中移除此資源配置" in data["message"]
            
            # Verify resource is soft deleted
            db_session.refresh(resource)
            assert resource.is_deleted is True
            
            # Verify future allocation is removed
            future_allocation_exists = db_session.query(AppointmentResourceAllocation).filter(
                AppointmentResourceAllocation.appointment_id == future_calendar_event.id,
                AppointmentResourceAllocation.resource_id == resource.id
            ).first()
            assert future_allocation_exists is None
            
            # Verify past allocation is preserved
            past_allocation_exists = db_session.query(AppointmentResourceAllocation).filter(
                AppointmentResourceAllocation.appointment_id == past_calendar_event.id,
                AppointmentResourceAllocation.resource_id == resource.id
            ).first()
            assert past_allocation_exists is not None
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)
    
    def test_delete_resource_no_future_appointments(
        self, client: TestClient, db_session: Session, test_clinic_and_admin
    ):
        """Test deleting a resource with no future appointments."""
        clinic, admin_user = test_clinic_and_admin
        
        # Create resource type and resource
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()
        
        resource = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        db_session.add(resource)
        db_session.commit()
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=admin_user.id,
                email=admin_user.email,
                active_clinic_id=clinic.id,
                roles=["admin"],
                google_subject_id="admin_sub",
                name="Test Admin"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Delete the resource
            response = client.delete(f"/api/clinic/resources/{resource.id}")
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify response
            assert data["success"] is True
            assert data["affected_appointments"] == 0
            assert data["message"] == "資源已刪除"
            
            # Verify resource is soft deleted
            db_session.refresh(resource)
            assert resource.is_deleted is True
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)
    
    def test_delete_resource_already_deleted(
        self, client: TestClient, db_session: Session, test_clinic_and_admin
    ):
        """Test deleting a resource that is already deleted."""
        clinic, admin_user = test_clinic_and_admin
        
        # Create resource type and resource
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()
        
        resource = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1",
            is_deleted=True  # Already deleted
        )
        db_session.add(resource)
        db_session.commit()
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=admin_user.id,
                email=admin_user.email,
                active_clinic_id=clinic.id,
                roles=["admin"],
                google_subject_id="admin_sub",
                name="Test Admin"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Try to delete the already deleted resource
            response = client.delete(f"/api/clinic/resources/{resource.id}")
            
            assert response.status_code == 400
            data = response.json()
            assert data["detail"] == "資源已刪除"
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)
    
    def test_delete_nonexistent_resource(
        self, client: TestClient, db_session: Session, test_clinic_and_admin
    ):
        """Test deleting a resource that doesn't exist."""
        clinic, admin_user = test_clinic_and_admin
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=admin_user.id,
                email=admin_user.email,
                active_clinic_id=clinic.id,
                roles=["admin"],
                google_subject_id="admin_sub",
                name="Test Admin"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Try to delete non-existent resource
            response = client.delete("/api/clinic/resources/99999")
            
            assert response.status_code == 404
            data = response.json()
            assert data["detail"] == "資源不存在"
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)


class TestResourceTypeBundleDeletion:
    """Test resource deletion through bundle updates."""
    
    def test_bundle_update_removes_resources_with_future_appointments(
        self, client: TestClient, db_session: Session, test_clinic_and_admin
    ):
        """Test that bundle updates properly handle resource deletion with future appointments."""
        clinic, admin_user = test_clinic_and_admin
        
        # Create resource type with resources
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()
        
        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        resource2 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室2"
        )
        db_session.add_all([resource1, resource2])
        db_session.commit()
        
        # Create future appointment with resource allocation
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()
        
        tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
        future_calendar_event = create_calendar_event_with_clinic(
            db_session, admin_user, clinic,
            event_type="appointment",
            event_date=tomorrow.date(),
            start_time=tomorrow.time(),
            end_time=(tomorrow + timedelta(hours=1)).time()
        )
        db_session.commit()
        
        future_appointment = Appointment(
            calendar_event_id=future_calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status="confirmed"
        )
        db_session.add(future_appointment)
        db_session.commit()
        
        # Allocate resource2 to future appointment
        future_allocation = AppointmentResourceAllocation(
            appointment_id=future_calendar_event.id,
            resource_id=resource2.id
        )
        db_session.add(future_allocation)
        db_session.commit()
        
        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=admin_user.id,
                email=admin_user.email,
                active_clinic_id=clinic.id,
                roles=["admin"],
                google_subject_id="admin_sub",
                name="Test Admin"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Update bundle to remove resource2 (keep only resource1)
            bundle_update = {
                "name": "治療室",
                "resources": [
                    {
                        "id": resource1.id,
                        "name": "治療室1",
                        "description": None
                    }
                    # resource2 is omitted, so it should be soft deleted
                ]
            }
            
            response = client.put(
                f"/api/clinic/resource-types/{resource_type.id}/bundle",
                json=bundle_update
            )
            
            assert response.status_code == 200
            
            # Verify resource2 is soft deleted
            db_session.refresh(resource2)
            assert resource2.is_deleted is True
            
            # Verify resource1 is still active
            db_session.refresh(resource1)
            assert resource1.is_deleted is False
            
            # Verify future allocation for resource2 is removed
            future_allocation_exists = db_session.query(AppointmentResourceAllocation).filter(
                AppointmentResourceAllocation.appointment_id == future_calendar_event.id,
                AppointmentResourceAllocation.resource_id == resource2.id
            ).first()
            assert future_allocation_exists is None
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_bundle_update_delete_and_add_same_name(
        self, client: TestClient, db_session: Session, test_clinic_and_admin
    ):
        """Test that bundle updates handle deleting a resource and adding it back with the same name."""
        clinic, admin_user = test_clinic_and_admin
        
        # Create resource type with resource
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()
        
        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        db_session.add(resource1)
        db_session.commit()

        # Mock authentication
        def override_get_current_user():
            return UserContext(
                user_type="clinic_user",
                user_id=admin_user.id,
                email=admin_user.email,
                active_clinic_id=clinic.id,
                roles=["admin"],
                google_subject_id="admin_sub",
                name="Test Admin"
            )
        
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            # Update bundle: remove resource1 (by omitting its ID) 
            # and add a "new" resource with the SAME name "治療室1"
            bundle_update = {
                "name": "治療室",
                "resources": [
                    {
                        "name": "治療室1",  # Same name, no ID (interpreted as new)
                        "description": "Re-added"
                    }
                ]
            }
            
            response = client.put(
                f"/api/clinic/resource-types/{resource_type.id}/bundle",
                json=bundle_update
            )
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify the response contains the new resource
            assert len(data["resources"]) == 1
            assert data["resources"][0]["name"] == "治療室1"
            assert data["resources"][0]["description"] == "Re-added"
            assert data["resources"][0]["id"] != resource1.id
            
            # Verify old resource is deleted and renamed (due to eviction logic)
            db_session.refresh(resource1)
            assert resource1.is_deleted is True
            assert "(deleted-" in resource1.name
            
        finally:
            app.dependency_overrides.pop(get_current_user, None)