
import pytest
from fastapi.testclient import TestClient
from main import app
from models import Clinic, User, AppointmentType, FollowUpMessage
from models.user_clinic_association import UserClinicAssociation
from auth.dependencies import get_current_user, UserContext
from core.database import get_db
from core.sentinels import MISSING
from core.message_template_constants import (
    DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
    DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
    DEFAULT_REMINDER_MESSAGE,
    DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE
)

client = TestClient(app)

@pytest.fixture
def test_clinic(db_session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Service Item Integrity Test Clinic",
        line_channel_id="test_channel_integrity",
        line_channel_secret="test_secret_integrity",
        line_channel_access_token="test_token_integrity",
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic

@pytest.fixture
def admin_user(db_session, test_clinic):
    """Create an admin user."""
    user = User(email="admin@integrity-test.com", google_subject_id="admin_integrity_sub")
    db_session.add(user)
    db_session.flush()
    
    assoc = UserClinicAssociation(
        user_id=user.id,
        clinic_id=test_clinic.id,
        roles=["admin"],
        full_name="Admin User",
        is_active=True
    )
    db_session.add(assoc)
    db_session.commit()
    return user

def setup_auth(admin_user, test_clinic, db_session):
    user_context = UserContext(
        user_type="clinic_user",
        email=admin_user.email,
        roles=["admin"],
        active_clinic_id=test_clinic.id,
        google_subject_id=admin_user.google_subject_id,
        name="Admin User",
        user_id=admin_user.id
    )
    app.dependency_overrides[get_current_user] = lambda: user_context
    app.dependency_overrides[get_db] = lambda: db_session

def teardown_auth():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)

def test_empty_message_reverts_to_default_when_toggle_on(db_session, test_clinic, admin_user):
    """
    Test that sending an empty message reverts to default when the toggle is ON.
    This is the "Reset to Default" behavior for required messages.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        # 1. Create a service item with custom messages and toggles ON
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Test Service",
            duration_minutes=30,
            send_patient_confirmation=True,
            patient_confirmation_message="Custom Patient Message"
        )
        db_session.add(at)
        db_session.commit()
        
        # 2. Attempt to clear message while toggle is ON
        payload = {
            "item": {
                "name": "Test Service",
                "duration_minutes": 30,
                "send_patient_confirmation": True,
                "patient_confirmation_message": "   " # Whitespace
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        
        # Should revert to default because toggle is ON and message is whitespace
        assert updated_at.patient_confirmation_message == DEFAULT_PATIENT_CONFIRMATION_MESSAGE
        
    finally:
        teardown_auth()

def test_explicit_null_reverts_to_default(db_session, test_clinic, admin_user):
    """
    Test that sending explicit null for a message field reverts to default.
    This ensures we don't store literal "None" string.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Null Test",
            duration_minutes=30,
            patient_confirmation_message="Custom"
        )
        db_session.add(at)
        db_session.commit()
        
        payload = {
            "item": {
                "name": "Null Test",
                "duration_minutes": 30,
                "patient_confirmation_message": None # Explicit null
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.refresh(at)
        assert at.patient_confirmation_message == DEFAULT_PATIENT_CONFIRMATION_MESSAGE
        assert at.patient_confirmation_message != "None"
        
    finally:
        teardown_auth()


def test_notes_instructions_can_be_cleared(db_session, test_clinic, admin_user):
    """
    Test that notes_instructions can be explicitly cleared (set to None).
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Test Service",
            duration_minutes=30,
            notes_instructions="Original Instructions"
        )
        db_session.add(at)
        db_session.commit()
        
        # Send empty string for notes_instructions
        payload = {
            "item": {
                "name": "Test Service",
                "duration_minutes": 30,
                "notes_instructions": ""
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        assert updated_at.notes_instructions is None
        
    finally:
        teardown_auth()


def test_recurrent_message_integrity(db_session, test_clinic, admin_user):
    """
    Test that recurrent_clinic_confirmation_message follows the same integrity rules.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Recurrent Test",
            duration_minutes=30,
            send_recurrent_clinic_confirmation=True,
            recurrent_clinic_confirmation_message="Custom Recurrent Message"
        )
        db_session.add(at)
        db_session.commit()
        
        # 1. Partial update omitting recurrent message should preserve it
        payload = {
            "item": {
                "name": "Recurrent Test Updated",
                "duration_minutes": 30
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        assert updated_at.recurrent_clinic_confirmation_message == "Custom Recurrent Message"
        
        # 2. Sending empty string should revert to default
        payload["item"]["recurrent_clinic_confirmation_message"] = ""
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        assert updated_at.recurrent_clinic_confirmation_message == DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE
        
    finally:
        teardown_auth()


def test_association_preservation_not_applicable(db_session, test_clinic, admin_user):
    """
    Note: The 'associations' object is currently REQUIRED by the bundle API.
    If it's missing, the API returns 422.
    If it's empty, it clears associations (Replace-All Sync).
    This test verifies that partial updates to the 'item' do NOT affect associations
    IF they are provided correctly in the payload.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        from models import UserClinicAssociation
        # 1. Setup existing association
        practitioner = User(email="prac@test.com", google_subject_id="prac_sub")
        db_session.add(practitioner)
        db_session.flush()
        
        assoc = UserClinicAssociation(
            user_id=practitioner.id,
            clinic_id=test_clinic.id,
            roles=["practitioner"],
            full_name="Practitioner One",
            is_active=True
        )
        db_session.add(assoc)
        db_session.commit()
        
        # Link practitioner to appointment type
        at = AppointmentType(clinic_id=test_clinic.id, name="Assoc Test", duration_minutes=30)
        db_session.add(at)
        db_session.flush()
        
        # Use a real service or direct DB to link them
        from services import AvailabilityService, PractitionerService
        PractitionerService.update_practitioner_appointment_types(
            db_session, practitioner.id, [at.id], test_clinic.id
        )
        db_session.commit()
        
        # 2. Update item name, but provide same practitioner_ids in associations
        payload = {
            "item": {
                "name": "Assoc Test Updated",
                "duration_minutes": 30
            },
            "associations": {
                "practitioner_ids": [practitioner.id], # MUST provide if we want to keep it
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        # Verify name updated
        updated_at = db_session.query(AppointmentType).get(at.id)
        assert updated_at.name == "Assoc Test Updated"
        
        # Verify association still exists
        practitioners = AvailabilityService.get_practitioners_for_appointment_type(
            db_session, at.id, test_clinic.id
        )
        assert len(practitioners) == 1
        assert practitioners[0].id == practitioner.id
        
    finally:
        teardown_auth()


def test_toggle_state_changes_preserved(db_session, test_clinic, admin_user):
    """
    Test that turning toggles OFF/ON works and doesn't wipe messages unexpectedly.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Test Service",
            duration_minutes=30,
            send_patient_confirmation=True,
            patient_confirmation_message="Custom Message"
        )
        db_session.add(at)
        db_session.commit()
        
        # 1. Turn toggle OFF
        payload = {
            "item": {
                "name": "Test Service",
                "duration_minutes": 30,
                "send_patient_confirmation": False
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        assert updated_at.send_patient_confirmation is False
        # Message should still be "Custom Message" (or at least not wiped to empty)
        assert updated_at.patient_confirmation_message == "Custom Message"
        
        # 2. Turn toggle back ON with OMITTED message
        payload = {
            "item": {
                "name": "Test Service",
                "duration_minutes": 30,
                "send_patient_confirmation": True
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        assert updated_at.send_patient_confirmation is True
        assert updated_at.patient_confirmation_message == "Custom Message"
        
    finally:
        teardown_auth()

def test_partial_update_preserves_omitted_fields(db_session, test_clinic, admin_user):
    """
    Test that fields omitted from the HTTP request are NOT updated/cleared.
    This verifies that model_dump(exclude_unset=True) is working as expected.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        # 1. Create a service item with specific values
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Original Name",
            duration_minutes=60,
            description="Original Description",
            notes_instructions="Original Notes",
            send_patient_confirmation=True,
            patient_confirmation_message="Original Patient Message"
        )
        db_session.add(at)
        db_session.commit()
        
        # 2. Update ONLY the name and duration via HTTP
        # Omit description, notes_instructions, messages from the 'item' sub-object
        payload = {
            "item": {
                "name": "New Name",
                "duration_minutes": 45
                # OMITTED: description, notes_instructions, messages
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_at = db_session.query(AppointmentType).get(at.id)
        
        # 3. Verify omitted fields are preserved
        assert updated_at.name == "New Name"
        assert updated_at.duration_minutes == 45
        assert updated_at.description == "Original Description"
        assert updated_at.notes_instructions == "Original Notes"
        assert updated_at.patient_confirmation_message == "Original Patient Message"
        
    finally:
        teardown_auth()
