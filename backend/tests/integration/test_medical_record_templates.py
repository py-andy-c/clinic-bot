import pytest
from fastapi.testclient import TestClient
from main import app
from core.database import get_db
from models.clinic import Clinic
from tests.conftest import create_user_with_clinic_association
from models import MedicalRecordTemplate

client = TestClient(app)

@pytest.fixture
def test_clinic_admin(db_session):
    """Create a test clinic and an admin user."""
    clinic = Clinic(
        name="Test Medical Clinic",
        line_channel_id="line_id_123",
        line_channel_secret="line_secret_456",
        line_channel_access_token="line_token_789"
    )
    db_session.add(clinic)
    db_session.commit()

    admin, admin_assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=clinic,
        full_name="Clinic Admin",
        email="admin@medclinic.com",
        google_subject_id="admin_sub_record_tests",
        roles=["admin"],
        is_active=True
    )
    db_session.commit()
    return clinic, admin, admin_assoc

@pytest.fixture
def auth_headers(test_clinic_admin):
    clinic, admin, admin_assoc = test_clinic_admin
    # In a real integration test, we might need a real token, 
    # but here we rely on dependency overrides for the user context.
    return {"X-Clinic-ID": str(clinic.id)}

class TestMedicalRecordTemplateAPI:
    """Integration tests for medical record template management."""

    def setup_method(self, method):
        # Override dependencies before each test
        pass

    def teardown_method(self, method):
        # Clean up overrides after each test
        app.dependency_overrides.clear()

    def test_create_template_success(self, db_session, test_clinic_admin):
        clinic, admin, admin_assoc = test_clinic_admin
        
        # Setup authentication override
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=clinic.id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        template_data = {
            "name": "General Assessment",
            "header_fields": [
                {
                    "id": "field_1",
                    "type": "text",
                    "label": "Chief Complaint",
                    "placeholder": "Enter patient complaint",
                    "required": True
                },
                {
                    "id": "field_2",
                    "type": "number",
                    "label": "Temperature",
                    "unit": "°C",
                    "required": False
                },
                {
                    "id": "field_3",
                    "type": "select",
                    "label": "Severity",
                    "options": ["Low", "Medium", "High"],
                    "required": True
                }
            ],
            "workspace_config": {
                "backgroundImageUrl": "https://example.com/anatomy.png",
                "base_layers": []
            }
        }

        response = client.post("/api/clinic/medical-record-templates", json=template_data)
        
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "General Assessment"
        assert len(data["header_fields"]) == 3
        assert data["header_fields"][1]["unit"] == "°C"
        assert data["header_fields"][0]["placeholder"] == "Enter patient complaint"
        assert data["workspace_config"]["backgroundImageUrl"] == "https://example.com/anatomy.png"
        assert data["is_active"] is True

    def test_list_templates_filtering(self, db_session, test_clinic_admin):
        clinic, admin, admin_assoc = test_clinic_admin
        
        # Setup authentication override
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=clinic.id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        # Create one active and one inactive template
        t1 = MedicalRecordTemplate(clinic_id=clinic.id, name="Active Template", is_active=True, header_fields=[])
        t2 = MedicalRecordTemplate(clinic_id=clinic.id, name="Inactive Template", is_active=False, header_fields=[])
        db_session.add_all([t1, t2])
        db_session.commit()

        # List default (active only)
        response = client.get("/api/clinic/medical-record-templates")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Active Template"

        # List including inactive
        response = client.get("/api/clinic/medical-record-templates?include_inactive=true")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    def test_get_template_success(self, db_session, test_clinic_admin):
        clinic, admin, admin_assoc = test_clinic_admin
        
        # Setup authentication override
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=clinic.id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        t = MedicalRecordTemplate(clinic_id=clinic.id, name="Test Get", header_fields=[{"id": "f1", "type": "text", "label": "L"}])
        db_session.add(t)
        db_session.commit()

        response = client.get(f"/api/clinic/medical-record-templates/{t.id}")
        assert response.status_code == 200
        assert response.json()["name"] == "Test Get"

    def test_update_template_success(self, db_session, test_clinic_admin):
        clinic, admin, admin_assoc = test_clinic_admin
        
        # Setup authentication override
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=clinic.id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        t = MedicalRecordTemplate(clinic_id=clinic.id, name="Old Name", header_fields=[])
        db_session.add(t)
        db_session.commit()

        update_data = {
            "name": "New Name",
            "header_fields": [{"id": "f1", "type": "textarea", "label": "Notes"}]
        }
        response = client.put(f"/api/clinic/medical-record-templates/{t.id}", json=update_data)
        assert response.status_code == 200
        assert response.json()["name"] == "New Name"
        assert response.json()["header_fields"][0]["type"] == "textarea"

    def test_soft_delete_template(self, db_session, test_clinic_admin):
        clinic, admin, admin_assoc = test_clinic_admin
        
        # Setup authentication override
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=admin.email,
            roles=admin_assoc.roles,
            active_clinic_id=clinic.id,
            google_subject_id=admin.google_subject_id,
            name=admin_assoc.full_name,
            user_id=admin.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        t = MedicalRecordTemplate(clinic_id=clinic.id, name="To Delete", is_active=True, header_fields=[])
        db_session.add(t)
        db_session.commit()

        response = client.delete(f"/api/clinic/medical-record-templates/{t.id}")
        assert response.status_code == 200
        assert "停用" in response.json()["message"]

        # Verify it's still in the database but inactive
        db_session.refresh(t)
        assert t.is_active is False

    def test_practitioner_cannot_create_template(self, db_session, test_clinic_admin):
        clinic, admin, admin_assoc = test_clinic_admin
        
        # Create a practitioner (non-admin)
        practitioner, practitioner_assoc = create_user_with_clinic_association(
            db_session=db_session,
            clinic=clinic,
            full_name="Dr. Smith",
            email="smith@medclinic.com",
            google_subject_id="practitioner_sub",
            roles=["practitioner"],
            is_active=True
        )
        db_session.commit()

        # Setup authentication override as practitioner
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=practitioner.email,
            roles=practitioner_assoc.roles,
            active_clinic_id=clinic.id,
            google_subject_id=practitioner.google_subject_id,
            name=practitioner_assoc.full_name,
            user_id=practitioner.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        response = client.post("/api/clinic/medical-record-templates", json={"name": "Naught"})
        assert response.status_code == 403
