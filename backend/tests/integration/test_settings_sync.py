
import pytest
from fastapi.testclient import TestClient
from main import app
from models import Clinic, User, AppointmentType, FollowUpMessage, BillingScenario
from models.user_clinic_association import UserClinicAssociation
from auth.dependencies import get_current_user, UserContext
from core.database import get_db
from core.constants import TEMPORARY_ID_THRESHOLD
import time

client = TestClient(app)

@pytest.fixture
def test_clinic(db_session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Sync Test Clinic",
        line_channel_id="test_channel_sync",
        line_channel_secret="test_secret_sync",
        line_channel_access_token="test_token_sync",
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic

@pytest.fixture
def admin_user(db_session, test_clinic):
    """Create an admin user."""
    user = User(email="admin@sync-test.com", google_subject_id="admin_sync_sub")
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

@pytest.fixture
def other_clinic(db_session):
    """Create another clinic for isolation testing."""
    clinic = Clinic(
        name="Other Clinic",
        line_channel_id="other_channel",
        line_channel_secret="other_secret",
        line_channel_access_token="other_token",
    )
    db_session.add(clinic)
    db_session.commit()
    return clinic

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

def test_sync_rejections_and_creations(db_session, test_clinic, admin_user):
    """
    Test that temporary IDs are rejected and new items are created with null IDs.
    Also tests boundary cases for ID validation.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        # 1. Create a service item
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="Sync Test Service",
            duration_minutes=30
        )
        db_session.add(at)
        db_session.commit()
        
        # 2. Test Rejection: Temporary ID
        temp_id = TEMPORARY_ID_THRESHOLD + 100
        payload_temp = {
            "item": {"name": "Sync Test Service", "duration_minutes": 30},
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": [{
                    "id": temp_id,
                    "timing_mode": "hours_after",
                    "hours_after": 24,
                    "message_template": "Test template",
                    "is_enabled": True,
                    "display_order": 0
                }]
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload_temp)
        assert response.status_code == 400
        assert "exceeds temporary threshold" in response.json()["detail"]

        # 3. Test Rejection: Boundary ID (Exactly at threshold)
        payload_boundary = {
            "item": {"name": "Sync Test Service", "duration_minutes": 30},
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [{
                    "id": TEMPORARY_ID_THRESHOLD,
                    "practitioner_id": admin_user.id,
                    "name": "Boundary Scenario",
                    "amount": 100,
                    "revenue_share": 10,
                    "is_default": True
                }],
                "resource_requirements": [],
                "follow_up_messages": []
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload_boundary)
        assert response.status_code == 400
        assert "exceeds temporary threshold" in response.json()["detail"]

        # 4. Test Success: ID 0 (Should be treated as new, not found in DB)
        payload_zero = {
            "item": {"name": "Sync Test Service", "duration_minutes": 30},
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": [{
                    "id": 0,
                    "timing_mode": "hours_after",
                    "hours_after": 24,
                    "message_template": "Zero ID template",
                    "is_enabled": True,
                    "display_order": 0
                }]
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload_zero)
        assert response.status_code == 200
        
        # Verify it was created as a new record
        fms = db_session.query(FollowUpMessage).filter(FollowUpMessage.appointment_type_id == at.id).all()
        assert len(fms) == 1
        assert fms[0].message_template == "Zero ID template"
        assert fms[0].id > 0
        assert fms[0].id < TEMPORARY_ID_THRESHOLD

        # 5. Test Success: Normal Creation (ID = null)
        payload_null = {
            "item": {"name": "Sync Test Service", "duration_minutes": 30},
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": [
                    # Keep existing one (id from fms[0])
                    {
                        "id": fms[0].id,
                        "timing_mode": "hours_after",
                        "hours_after": 24,
                        "message_template": "Zero ID template",
                        "is_enabled": True,
                        "display_order": 0
                    },
                    # Add new one
                    {
                        "id": None,
                        "timing_mode": "hours_after",
                        "hours_after": 48,
                        "message_template": "New template",
                        "is_enabled": True,
                        "display_order": 1
                    }
                ]
            }
        }
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload_null)
        assert response.status_code == 200
        
        fms_final = db_session.query(FollowUpMessage).filter(FollowUpMessage.appointment_type_id == at.id).order_by(FollowUpMessage.display_order).all()
        assert len(fms_final) == 2
        assert fms_final[1].message_template == "New template"

    finally:
        teardown_auth()


def test_sync_security_clinic_isolation(db_session, test_clinic, admin_user, other_clinic):
    """
    Test that IDs belonging to another clinic are not updated but created as new.
    """
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        # 1. Create a service item in other clinic
        other_at = AppointmentType(
            clinic_id=other_clinic.id,
            name="Other Service",
            duration_minutes=30
        )
        db_session.add(other_at)
        db_session.commit()
        
        other_fm = FollowUpMessage(
            clinic_id=other_clinic.id,
            appointment_type_id=other_at.id,
            timing_mode="hours_after",
            hours_after=1,
            message_template="Other FM",
            is_enabled=True,
            display_order=0
        )
        db_session.add(other_fm)
        db_session.commit()
        
        # 2. Try to "update" using other_fm.id in test_clinic
        at = AppointmentType(
            clinic_id=test_clinic.id,
            name="My Service",
            duration_minutes=30
        )
        db_session.add(at)
        db_session.commit()
        
        payload = {
            "item": {
                "name": "My Service",
                "duration_minutes": 30
            },
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": [
                    {
                        "id": other_fm.id,  # REAL ID but from WRONG CLINIC
                        "timing_mode": "hours_after",
                        "hours_after": 5,
                        "message_template": "Attempted Hack",
                        "is_enabled": True,
                        "display_order": 0
                    }
                ]
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        # 3. Verify:
        # - The other clinic's message was NOT changed
        # - A NEW message was created for the test clinic
        db_session.expire_all()
        
        # Other clinic's message stays same
        db_session.refresh(other_fm)
        assert other_fm.message_template == "Other FM"
        
        # My clinic got a NEW message
        my_fms = db_session.query(FollowUpMessage).filter_by(appointment_type_id=at.id).all()
        assert len(my_fms) == 1
        assert my_fms[0].message_template == "Attempted Hack"
        assert my_fms[0].id != other_fm.id
        
    finally:
        teardown_auth()

def test_sync_update_existing_real_id(db_session, test_clinic, admin_user):
    """Test that real IDs are properly updated, not duplicated."""
    setup_auth(admin_user, test_clinic, db_session)
    
    try:
        at = AppointmentType(clinic_id=test_clinic.id, name="Update Test", duration_minutes=30)
        db_session.add(at)
        db_session.flush()
        
        fm = FollowUpMessage(
            clinic_id=test_clinic.id,
            appointment_type_id=at.id,
            timing_mode="hours_after",
            hours_after=1,
            message_template="Original",
            is_enabled=True,
            display_order=0
        )
        db_session.add(fm)
        db_session.commit()
        
        # Update existing message
        payload = {
            "item": {"name": "Update Test", "duration_minutes": 30},
            "associations": {
                "practitioner_ids": [],
                "billing_scenarios": [],
                "resource_requirements": [],
                "follow_up_messages": [
                    {
                        "id": fm.id,
                        "timing_mode": "hours_after",
                        "hours_after": 10,
                        "message_template": "Updated",
                        "is_enabled": True,
                        "display_order": 0
                    }
                ]
            }
        }
        
        response = client.put(f"/api/clinic/service-items/{at.id}/bundle", json=payload)
        assert response.status_code == 200
        
        db_session.expire_all()
        fms = db_session.query(FollowUpMessage).filter_by(appointment_type_id=at.id).all()
        assert len(fms) == 1
        assert fms[0].id == fm.id
        assert fms[0].message_template == "Updated"
        assert fms[0].hours_after == 10
        
    finally:
        teardown_auth()
