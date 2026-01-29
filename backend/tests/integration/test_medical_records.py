import pytest
from fastapi.testclient import TestClient
from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.medical_record_template import MedicalRecordTemplate
from models.medical_record import MedicalRecord
from tests.conftest import create_user_with_clinic_association

client = TestClient(app)

@pytest.fixture
def test_clinic_with_patient(db_session):
    """Create a test clinic, admin user, and patient."""
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
    
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="0912345678"
    )
    db_session.add(patient)
    db_session.commit()
    
    return clinic, admin, admin_assoc, patient

@pytest.fixture
def test_template(db_session, test_clinic_with_patient):
    """Create a test medical record template."""
    clinic, admin, admin_assoc, patient = test_clinic_with_patient
    
    template = MedicalRecordTemplate(
        clinic_id=clinic.id,
        name="General Assessment",
        header_fields=[
            {
                "id": "field_1",
                "type": "text",
                "label": "Chief Complaint",
                "required": True
            },
            {
                "id": "field_2",
                "type": "number",
                "label": "Temperature",
                "unit": "°C",
                "required": False
            }
        ],
        workspace_config={
            "backgroundImageUrl": "https://example.com/anatomy.png",
            "base_layers": []
        },
        is_active=True
    )
    db_session.add(template)
    db_session.commit()
    
    return template

class TestMedicalRecordAPI:
    """Integration tests for medical record management."""

    def setup_method(self, method):
        # Override dependencies before each test
        pass

    def teardown_method(self, method):
        # Clean up overrides after each test
        app.dependency_overrides.clear()

    def test_create_medical_record_success(self, db_session, test_clinic_with_patient, test_template):
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        record_data = {
            "patient_id": patient.id,
            "template_id": test_template.id
        }

        response = client.post(f"/api/clinic/patients/{patient.id}/medical-records", json=record_data)
        
        assert response.status_code == 201
        data = response.json()
        assert data["patient_id"] == patient.id
        assert data["template_id"] == test_template.id
        assert data["template_name"] == "General Assessment"
        assert len(data["header_structure"]) == 2
        assert data["header_structure"][0]["label"] == "Chief Complaint"
        assert data["header_values"] == {}
        assert "workspace_data" in data
        assert data["workspace_data"]["version"] == 1

    def test_list_patient_medical_records(self, db_session, test_clinic_with_patient, test_template):
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        # Create two records
        record1 = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        record2 = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        db_session.add_all([record1, record2])
        db_session.commit()

        response = client.get(f"/api/clinic/patients/{patient.id}/medical-records")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        # Should be ordered by created_at descending (newest first)
        assert data[0]["id"] == record2.id
        assert data[1]["id"] == record1.id

    def test_get_medical_record_success(self, db_session, test_clinic_with_patient, test_template):
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        record = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={"field_1": "Headache"},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        db_session.add(record)
        db_session.commit()

        response = client.get(f"/api/clinic/medical-records/{record.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == record.id
        assert data["header_values"]["field_1"] == "Headache"

    def test_update_medical_record_success(self, db_session, test_clinic_with_patient, test_template):
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        record = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        db_session.add(record)
        db_session.commit()

        update_data = {
            "header_values": {"field_1": "Fever", "field_2": 38.5},
            "workspace_data": {
                "version": 1,
                "layers": [{"type": "drawing", "tool": "pen", "color": "#000", "width": 2, "points": [[10, 10], [20, 20]]}],
                "canvas_height": 1500
            }
        }

        response = client.patch(f"/api/clinic/medical-records/{record.id}", json=update_data)
        assert response.status_code == 200
        data = response.json()
        assert data["header_values"]["field_1"] == "Fever"
        assert data["header_values"]["field_2"] == 38.5
        assert len(data["workspace_data"]["layers"]) == 1
        assert data["workspace_data"]["canvas_height"] == 1500

    def test_delete_medical_record_success(self, db_session, test_clinic_with_patient, test_template):
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        record = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        db_session.add(record)
        db_session.commit()

        response = client.delete(f"/api/clinic/medical-records/{record.id}")
        assert response.status_code == 200
        assert "刪除" in response.json()["message"]

        # Verify it's deleted from database
        deleted_record = db_session.query(MedicalRecord).filter(MedicalRecord.id == record.id).first()
        assert deleted_record is None

    def test_practitioner_can_create_record(self, db_session, test_clinic_with_patient, test_template):
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        record_data = {
            "patient_id": patient.id,
            "template_id": test_template.id
        }

        response = client.post(f"/api/clinic/patients/{patient.id}/medical-records", json=record_data)
        assert response.status_code == 201

    def test_template_snapshotting(self, db_session, test_clinic_with_patient, test_template):
        """Test that template changes don't affect existing records."""
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        # Create a record with the original template
        record_data = {
            "patient_id": patient.id,
            "template_id": test_template.id
        }
        response = client.post(f"/api/clinic/patients/{patient.id}/medical-records", json=record_data)
        assert response.status_code == 201
        record_id = response.json()["id"]

        # Modify the template
        test_template.header_fields = [
            {
                "id": "field_3",
                "type": "text",
                "label": "New Field",
                "required": True
            }
        ]
        db_session.commit()

        # Fetch the record and verify it still has the original structure
        response = client.get(f"/api/clinic/medical-records/{record_id}")
        assert response.status_code == 200
        data = response.json()
        assert len(data["header_structure"]) == 2  # Original structure
        assert data["header_structure"][0]["label"] == "Chief Complaint"
        assert data["header_structure"][1]["label"] == "Temperature"

    def test_base_layers_snapshotting(self, db_session, test_clinic_with_patient):
        """Test that base_layers from template workspace_config are snapshotted into record."""
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
        # Create a template with base_layers
        template_with_layers = MedicalRecordTemplate(
            clinic_id=clinic.id,
            name="Template with Background",
            header_fields=[],
            workspace_config={
                "backgroundImageUrl": "https://example.com/anatomy.png",
                "base_layers": [
                    {
                        "type": "media",
                        "id": "base_layer_1",
                        "origin": "template",
                        "url": "https://example.com/anatomy.png",
                        "x": 0,
                        "y": 0,
                        "width": 800,
                        "height": 1000,
                        "rotation": 0
                    }
                ]
            },
            is_active=True
        )
        db_session.add(template_with_layers)
        db_session.commit()
        
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

        # Create a record from this template
        record_data = {
            "patient_id": patient.id,
            "template_id": template_with_layers.id
        }
        response = client.post(f"/api/clinic/patients/{patient.id}/medical-records", json=record_data)
        assert response.status_code == 201
        data = response.json()
        
        # Verify base_layers were snapshotted into workspace_data
        assert "workspace_data" in data
        assert "layers" in data["workspace_data"]
        assert len(data["workspace_data"]["layers"]) == 1
        assert data["workspace_data"]["layers"][0]["type"] == "media"
        assert data["workspace_data"]["layers"][0]["id"] == "base_layer_1"
        assert data["workspace_data"]["layers"][0]["origin"] == "template"
        
        # Modify the template's base_layers
        template_with_layers.workspace_config = {
            "backgroundImageUrl": "https://example.com/new_image.png",
            "base_layers": []  # Remove base layers
        }
        db_session.commit()
        
        # Fetch the record and verify it still has the original base_layers
        response = client.get(f"/api/clinic/medical-records/{data['id']}")
        assert response.status_code == 200
        fetched_data = response.json()
        assert len(fetched_data["workspace_data"]["layers"]) == 1  # Still has original layer
        assert fetched_data["workspace_data"]["layers"][0]["id"] == "base_layer_1"

    def test_cannot_access_other_clinic_records(self, db_session, test_clinic_with_patient, test_template):
        """Test that users cannot access records from other clinics."""
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
        # Create another clinic with admin
        other_clinic = Clinic(
            name="Other Clinic",
            line_channel_id="other_line_id",
            line_channel_secret="other_secret",
            line_channel_access_token="other_token"
        )
        db_session.add(other_clinic)
        db_session.commit()

        other_admin, other_admin_assoc = create_user_with_clinic_association(
            db_session=db_session,
            clinic=other_clinic,
            full_name="Other Admin",
            email="other@clinic.com",
            google_subject_id="other_admin_sub",
            roles=["admin"],
            is_active=True
        )
        db_session.commit()

        # Create a record in the first clinic
        record = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        db_session.add(record)
        db_session.commit()

        # Try to access it from the other clinic
        from auth.dependencies import get_current_user, UserContext
        user_context = UserContext(
            user_type="clinic_user",
            email=other_admin.email,
            roles=other_admin_assoc.roles,
            active_clinic_id=other_clinic.id,
            google_subject_id=other_admin.google_subject_id,
            name=other_admin_assoc.full_name,
            user_id=other_admin.id
        )
        app.dependency_overrides[get_current_user] = lambda: user_context
        app.dependency_overrides[get_db] = lambda: db_session

        response = client.get(f"/api/clinic/medical-records/{record.id}")
        assert response.status_code == 404

    def test_update_header_values_only(self, db_session, test_clinic_with_patient, test_template):
        """Test updating only header_values without touching workspace_data."""
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        # Create a record
        record = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [{"type": "drawing", "tool": "pen", "color": "#000", "width": 2, "points": [[10, 10]]}], "canvas_height": 1000}
        )
        db_session.add(record)
        db_session.commit()

        # Update only header_values
        update_data = {
            "header_values": {"field_1": "Updated Chief Complaint", "field_2": 37.5}
        }

        response = client.patch(f"/api/clinic/medical-records/{record.id}", json=update_data)
        assert response.status_code == 200
        data = response.json()
        
        # Verify header_values updated
        assert data["header_values"]["field_1"] == "Updated Chief Complaint"
        assert data["header_values"]["field_2"] == 37.5
        
        # Verify workspace_data unchanged
        assert len(data["workspace_data"]["layers"]) == 1
        assert data["workspace_data"]["layers"][0]["type"] == "drawing"

    def test_field_validation_in_header(self, db_session, test_clinic_with_patient, test_template):
        """Test that header field types are properly validated."""
        clinic, admin, admin_assoc, patient = test_clinic_with_patient
        
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

        # Create a record
        record = MedicalRecord(
            patient_id=patient.id,
            clinic_id=clinic.id,
            template_id=test_template.id,
            header_structure=test_template.header_fields,
            header_values={},
            workspace_data={"version": 1, "layers": [], "canvas_height": 1000}
        )
        db_session.add(record)
        db_session.commit()

        # Update with various field types including arrays for checkboxes
        update_data = {
            "header_values": {
                "field_1": "Text value",  # text field
                "field_2": 38.5,  # number field
                "checkbox_field": ["Option 1", "Option 2"],  # checkbox array
            }
        }

        response = client.patch(f"/api/clinic/medical-records/{record.id}", json=update_data)
        assert response.status_code == 200
        data = response.json()
        
        # Verify types are preserved
        assert isinstance(data["header_values"]["field_1"], str)
        assert isinstance(data["header_values"]["field_2"], (int, float))
        # Verify checkbox array is preserved
        assert isinstance(data["header_values"]["checkbox_field"], list)
        assert len(data["header_values"]["checkbox_field"]) == 2
        assert "Option 1" in data["header_values"]["checkbox_field"]
