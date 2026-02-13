import pytest
from fastapi.testclient import TestClient
from main import app
from models.clinic import Clinic
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from auth.dependencies import get_current_user, UserContext
from core.database import get_db

client = TestClient(app)

@pytest.fixture
def test_clinic(db_session):
    """Create a test clinic with initial settings."""
    clinic = Clinic(
        name="Deep Merge Test Clinic",
        line_channel_id="test_channel_merge",
        line_channel_secret="test_secret_merge",
        line_channel_access_token="test_token_merge",
        settings={
            "clinic_info_settings": {
                "display_name": "Initial Display Name",
                "phone_number": "000-000",
                "address": "Initial Address"
            },
            "chat_settings": {
                "chat_enabled": True,
                "ai_instructions": "Initial instructions"
            }
        }
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic

@pytest.fixture
def admin_user(db_session, test_clinic):
    """Create an admin user for the test clinic."""
    user = User(email="admin@merge-test.com", google_subject_id="admin_merge_sub")
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

def test_clinic_settings_deep_merge_persistence(db_session, test_clinic, admin_user):
    """
    Test that partial settings update is correctly merged and persisted.
    This specifically tests both deep merge and SQLAlchemy's flag_modified.
    """
    
    # Setup auth context
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
    
    try:
        # Perform partial update:
        # 1. Update clinic_info_settings (add new fields, preserve old ones)
        # 2. Update chat_settings (nested update)
        payload = {
            "clinic_info_settings": {
                "appointment_notes_instructions": "New notes here",
                "require_birthday": True
            },
            "chat_settings": {
                "ai_instructions": "Updated AI instructions"
                # chat_enabled is NOT included
            }
        }
        
        response = client.put("/api/clinic/settings", json=payload)
        assert response.status_code == 200
        
        # Verify persistence (this tests flag_modified is working)
        db_session.expire_all() # Ensure we get fresh data from DB
        clinic = db_session.query(Clinic).get(test_clinic.id)
        
        # Check clinic_info_settings
        info = clinic.settings.get("clinic_info_settings", {})
        assert info.get("display_name") == "Initial Display Name" # Preserved
        assert info.get("appointment_notes_instructions") == "New notes here" # Added
        assert info.get("require_birthday") is True # Added
        
        # Check chat_settings (deep merge)
        chat = clinic.settings.get("chat_settings", {})
        assert chat.get("chat_enabled") is True # Preserved from initial
        assert chat.get("ai_instructions") == "Updated AI instructions" # Updated
        
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

def test_practitioner_settings_deep_merge_consistency(db_session, test_clinic, admin_user):
    """
    Test that practitioner settings update independently of the admin update.
    """
    # Create a practitioner
    pract_user = User(email="pract@merge-test.com", google_subject_id="pract_merge_sub")
    db_session.add(pract_user)
    db_session.flush()
    
    assoc = UserClinicAssociation(
        user_id=pract_user.id,
        clinic_id=test_clinic.id,
        roles=["practitioner"],
        full_name="Pract User",
        settings={
            "reminder_days_ahead": 5,
            "compact_schedule_enabled": False
        }
    )
    db_session.add(assoc)
    db_session.commit()
    
    # Auth as admin to update practitioner's settings
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
    
    try:
        # Partial update for practitioner
        payload = {
            "settings": {
                "compact_schedule_enabled": True
            }
        }
        
        response = client.put(f"/api/clinic/practitioners/{pract_user.id}/settings", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        updated_assoc = db_session.query(UserClinicAssociation).filter_by(
            user_id=pract_user.id, clinic_id=test_clinic.id
        ).one()
        
        # Verify both fields (merged)
        assert updated_assoc.settings.get("compact_schedule_enabled") is True
        assert updated_assoc.settings.get("reminder_days_ahead") == 5
        
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

def test_deep_nesting_merge_behavior():
    """Unit test for deep_merge with multiple levels."""
    from utils.dict_utils import deep_merge
    import copy
    
    target = {
        "level1": {
            "level2": {
                "level3": "original",
                "keep_me": True
            },
            "other": 1
        }
    }
    source = {
        "level1": {
            "level2": {
                "level3": "updated"
            }
        }
    }
    
    # In-place merge
    result = deep_merge(copy.deepcopy(target), source)
    
    assert result["level1"]["level2"]["level3"] == "updated"
    assert result["level1"]["level2"]["keep_me"] is True
    assert result["level1"]["other"] == 1

def test_explicit_null_clears_field(db_session, test_clinic, admin_user):
    """Test that sending null explicitly clears a field while preserving siblings."""
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
    
    try:
        # Initial check
        assert test_clinic.settings["clinic_info_settings"]["phone_number"] == "000-000"
        
        # Explicit null for phone_number, omit address
        payload = {
            "clinic_info_settings": {
                "phone_number": None
            }
        }
        
        response = client.put("/api/clinic/settings", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        clinic = db_session.query(Clinic).get(test_clinic.id)
        info = clinic.settings.get("clinic_info_settings", {})
        
        assert info.get("phone_number") is None  # Should be cleared
        assert info.get("address") == "Initial Address"  # Should be preserved
        assert info.get("display_name") == "Initial Display Name"  # Should be preserved
        
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

def test_actual_bug_scenario_simulation(db_session, test_clinic, admin_user):
    """
    Simulates the exact scenario that caused the incident.
    Frontend sends a subset of fields in a section.
    """
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
    
    try:
        # This mirrors the payload from the Appointments Settings page
        # which lacked display_name, address, and phone_number in its schema.
        payload = {
            "clinic_info_settings": {
                "appointment_notes_instructions": "New Instructions",
                "require_birthday": True
            }
        }
        
        response = client.put("/api/clinic/settings", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        clinic = db_session.query(Clinic).get(test_clinic.id)
        info = clinic.settings.get("clinic_info_settings", {})
        
        # CRITICAL: These MUST be preserved
        assert info.get("display_name") == "Initial Display Name"
        assert info.get("address") == "Initial Address"
        assert info.get("phone_number") == "000-000"
        
        # These should be updated/added
        assert info.get("appointment_notes_instructions") == "New Instructions"
        assert info.get("require_birthday") is True
        
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)
