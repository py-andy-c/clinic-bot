"""
Integration tests for clinic user patient creation endpoints.

Tests the manual patient creation feature for clinic users (admins and practitioners).
"""
import pytest
from datetime import date, datetime, timezone
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from tests.conftest import create_user_with_clinic_association

client = TestClient(app)


@pytest.fixture
def test_clinic(db_session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel_123",
        line_channel_secret="test_secret_456",
        line_channel_access_token="test_access_token_789"
    )
    db_session.add(clinic)
    db_session.commit()
    return clinic


@pytest.fixture
def clinic_admin(db_session, test_clinic):
    """Create a clinic admin user."""
    admin, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Admin User",
        email="admin@test.com",
        google_subject_id="admin_sub_123",
        roles=["admin"],
        is_active=True
    )
    return admin, test_clinic


@pytest.fixture
def clinic_practitioner(db_session, test_clinic):
    """Create a clinic practitioner user."""
    practitioner, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Practitioner User",
        email="practitioner@test.com",
        google_subject_id="practitioner_sub_123",
        roles=["practitioner"],
        is_active=True
    )
    return practitioner, test_clinic


@pytest.fixture
def read_only_user(db_session, test_clinic):
    """Create a read-only user."""
    user, assoc = create_user_with_clinic_association(
        db_session=db_session,
        clinic=test_clinic,
        full_name="Read Only User",
        email="readonly@test.com",
        google_subject_id="readonly_sub_123",
        roles=[],  # No roles = read-only
        is_active=True
    )
    return user, test_clinic


@pytest.fixture
def auth_headers_admin(clinic_admin, db_session):
    """Get auth headers for clinic admin."""
    admin, clinic = clinic_admin
    # Refresh to ensure user is loaded
    db_session.refresh(admin)
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=admin.google_subject_id or f"test_sub_{admin.id}",
        user_id=admin.id,
        email=admin.email,
        user_type="clinic_user",
        roles=["admin"],
        name="Admin User",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_practitioner(clinic_practitioner, db_session):
    """Get auth headers for clinic practitioner."""
    practitioner, clinic = clinic_practitioner
    # Refresh to ensure user is loaded
    db_session.refresh(practitioner)
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=practitioner.google_subject_id or f"test_sub_{practitioner.id}",
        user_id=practitioner.id,
        email=practitioner.email,
        user_type="clinic_user",
        roles=["practitioner"],
        name="Practitioner User",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_readonly(read_only_user, db_session):
    """Get auth headers for read-only user."""
    user, clinic = read_only_user
    # Refresh to ensure user is loaded
    db_session.refresh(user)
    from services.jwt_service import jwt_service, TokenPayload
    
    payload = TokenPayload(
        sub=user.google_subject_id or f"test_sub_{user.id}",
        user_id=user.id,
        email=user.email,
        user_type="clinic_user",
        roles=[],
        name="Read Only User",
        active_clinic_id=clinic.id
    )
    token = jwt_service.create_access_token(payload)
    return {"Authorization": f"Bearer {token}"}


class TestClinicPatientCreation:
    """Tests for POST /clinic/patients endpoint."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_create_patient_with_all_fields_admin(self, db_session, auth_headers_admin, clinic_admin):
        """Test admin can create patient with all fields."""
        _, clinic = clinic_admin
        
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "王小明",
                "phone_number": "0912345678",
                "birthday": "1990-01-01"
            },
            headers=auth_headers_admin
        )
        
        if response.status_code != 200:
            print(f"Response status: {response.status_code}")
            print(f"Response body: {response.text}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["patient_id"] > 0
        assert data["full_name"] == "王小明"
        assert data["phone_number"] == "0912345678"
        assert data["birthday"] == "1990-01-01"
        assert "created_at" in data
        
        # Verify in database
        patient = db_session.query(Patient).filter(Patient.id == data["patient_id"]).first()
        assert patient is not None
        assert patient.full_name == "王小明"
        assert patient.phone_number == "0912345678"
        assert patient.birthday == date(1990, 1, 1)
        assert patient.clinic_id == clinic.id
        assert patient.line_user_id is None
        assert patient.created_by_type == "clinic_user"

    def test_create_patient_name_only_admin(self, db_session, auth_headers_admin, clinic_admin):
        """Test admin can create patient with only name (no phone, no birthday)."""
        _, clinic = clinic_admin
        
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "李美麗"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "李美麗"
        assert data["phone_number"] is None
        assert data["birthday"] is None
        
        # Verify in database
        patient = db_session.query(Patient).filter(Patient.id == data["patient_id"]).first()
        assert patient.phone_number is None
        assert patient.birthday is None

    def test_create_patient_with_phone_no_birthday(self, db_session, auth_headers_admin, clinic_admin):
        """Test creating patient with phone but no birthday."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "張三",
                "phone_number": "0923456789"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["phone_number"] == "0923456789"
        assert data["birthday"] is None

    def test_create_patient_with_birthday_no_phone(self, db_session, auth_headers_admin, clinic_admin):
        """Test creating patient with birthday but no phone."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "趙四",
                "birthday": "1985-05-15"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["phone_number"] is None
        assert data["birthday"] == "1985-05-15"

    def test_create_patient_practitioner_can_create(self, db_session, auth_headers_practitioner, clinic_practitioner):
        """Test practitioner can also create patients."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "陳五",
                "phone_number": "0934567890"
            },
            headers=auth_headers_practitioner
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "陳五"

    def test_create_patient_readonly_cannot_create(self, db_session, auth_headers_readonly):
        """Test read-only user cannot create patients."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患"
            },
            headers=auth_headers_readonly
        )
        
        assert response.status_code == 403

    def test_create_patient_duplicate_phone_allowed(self, db_session, auth_headers_admin, clinic_admin):
        """Test duplicate phone numbers are allowed."""
        _, clinic = clinic_admin
        
        # Create first patient
        response1 = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "王小明",
                "phone_number": "0912345678"
            },
            headers=auth_headers_admin
        )
        assert response1.status_code == 200
        
        # Create second patient with same phone (should succeed)
        response2 = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "王大明",
                "phone_number": "0912345678"
            },
            headers=auth_headers_admin
        )
        assert response2.status_code == 200
        assert response2.json()["patient_id"] != response1.json()["patient_id"]

    def test_create_patient_empty_phone_allowed(self, db_session, auth_headers_admin):
        """Test empty phone number is allowed."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "無電話病患",
                "phone_number": ""  # Empty string
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["phone_number"] is None

    def test_create_patient_null_phone_allowed(self, db_session, auth_headers_admin):
        """Test null phone number is allowed."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "無電話病患2"
                # phone_number not provided (null)
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["phone_number"] is None

    def test_create_patient_invalid_phone_format(self, db_session, auth_headers_admin):
        """Test invalid phone format is rejected."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試",
                "phone_number": "123"  # Invalid format
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 422  # Pydantic validation error
        # Check that validation error mentions phone
        detail = str(response.json())
        assert "phone" in detail.lower() or "格式" in detail or "09" in detail

    def test_create_patient_missing_name(self, db_session, auth_headers_admin):
        """Test missing name is rejected."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "phone_number": "0912345678"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 422  # Validation error

    def test_create_patient_empty_name(self, db_session, auth_headers_admin):
        """Test empty name is rejected."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": ""
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 422  # Pydantic validation error
        # Check that validation error mentions name
        detail = str(response.json())
        assert "姓名" in detail or "name" in detail.lower()

    def test_create_patient_invalid_birthday_future(self, db_session, auth_headers_admin):
        """Test future birthday is rejected."""
        from datetime import timedelta
        from utils.datetime_utils import taiwan_now
        # Use Taiwan time to match validation logic
        future_date = (taiwan_now().date() + timedelta(days=1)).isoformat()
        
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試",
                "birthday": future_date
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 422  # Pydantic validation error
        # Check that validation error mentions future date
        detail = str(response.json())
        assert "未來" in detail or "future" in detail.lower() or "生日" in detail

    def test_create_patient_phone_with_formatting(self, db_session, auth_headers_admin):
        """Test phone number with formatting is cleaned."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試",
                "phone_number": "0912-345-678"  # With dashes
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        # Phone should be cleaned (no dashes)
        assert response.json()["phone_number"] == "0912345678"

    def test_create_patient_with_gender(self, db_session, auth_headers_admin, clinic_admin):
        """Test creating patient with gender field."""
        _, clinic = clinic_admin
        
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患",
                "gender": "male"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["gender"] == "male"
        
        # Verify in database
        patient = db_session.query(Patient).filter(Patient.id == data["patient_id"]).first()
        assert patient.gender == "male"

    def test_create_patient_with_gender_case_insensitive(self, db_session, auth_headers_admin, clinic_admin):
        """Test gender validation is case-insensitive."""
        _, clinic = clinic_admin
        
        # Test uppercase
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患",
                "gender": "FEMALE"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["gender"] == "female"
        
        # Test mixed case
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患2",
                "gender": "Other"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["gender"] == "other"

    def test_create_patient_invalid_gender(self, db_session, auth_headers_admin):
        """Test invalid gender value is rejected."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患",
                "gender": "invalid"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 422  # Validation error
        detail = str(response.json())
        assert "性別" in detail or "gender" in detail.lower()

    def test_create_patient_required_gender(self, db_session, auth_headers_admin, clinic_admin):
        """Test that gender is required when clinic setting requires it."""
        _, clinic = clinic_admin
        
        # Set clinic to require gender
        clinic_settings = clinic.get_validated_settings()
        clinic_settings.clinic_info_settings.require_gender = True
        clinic.set_validated_settings(clinic_settings)
        db_session.commit()
        
        # Try to create patient without gender
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 400
        detail = response.json().get("detail", "")
        assert "生理性別" in detail or "gender" in detail.lower()
        
        # Create patient with gender should succeed
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患2",
                "gender": "male"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200


class TestDuplicateDetection:
    """Tests for GET /clinic/patients/check-duplicate endpoint."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_check_duplicate_no_matches(self, db_session, auth_headers_admin):
        """Test duplicate check with no matches."""
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "不存在的病患"},
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_check_duplicate_exact_match(self, db_session, auth_headers_admin, clinic_admin):
        """Test duplicate check finds exact match."""
        _, clinic = clinic_admin
        
        # Create a patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="王小明",
            phone_number="0912345678",
            created_by_type="clinic_user"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Check for duplicate
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "王小明"},
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 1

    def test_check_duplicate_case_insensitive(self, db_session, auth_headers_admin, clinic_admin):
        """Test duplicate check is case-insensitive."""
        _, clinic = clinic_admin
        
        # Create patient with lowercase
        patient = Patient(
            clinic_id=clinic.id,
            full_name="王小明",
            phone_number="0912345678",
            created_by_type="clinic_user"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Check with different case (should still match)
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "王小明"},  # Same, but test case variation
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 1

    def test_check_duplicate_multiple_matches(self, db_session, auth_headers_admin, clinic_admin):
        """Test duplicate check finds multiple matches."""
        _, clinic = clinic_admin
        
        # Create multiple patients with same name
        for i in range(3):
            patient = Patient(
                clinic_id=clinic.id,
                full_name="王小明",
                phone_number=f"091234567{i}",
                created_by_type="clinic_user"
            )
            db_session.add(patient)
        db_session.commit()
        
        # Check for duplicate
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "王小明"},
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 3

    def test_check_duplicate_partial_name_no_match(self, db_session, auth_headers_admin, clinic_admin):
        """Test partial name does not match (exact match only)."""
        _, clinic = clinic_admin
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="王小明美",
            phone_number="0912345678",
            created_by_type="clinic_user"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Check with partial name (should NOT match)
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "王小明"},
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 0  # No match (exact match only)

    def test_check_duplicate_excludes_deleted(self, db_session, auth_headers_admin, clinic_admin):
        """Test duplicate check excludes soft-deleted patients."""
        _, clinic = clinic_admin
        
        # Create and soft-delete a patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="已刪除病患",
            phone_number="0912345678",
            is_deleted=True,
            deleted_at=datetime.now(timezone.utc),
            created_by_type="clinic_user"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Check for duplicate (should not find deleted patient)
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "已刪除病患"},
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_check_duplicate_short_name(self, db_session, auth_headers_admin):
        """Test very short names return 0 (not meaningful to check)."""
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "A"},  # Too short
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_check_duplicate_readonly_can_check(self, db_session, auth_headers_readonly):
        """Test read-only user can check duplicates."""
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "測試"},
            headers=auth_headers_readonly
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_check_duplicate_whitespace_trimmed(self, db_session, auth_headers_admin, clinic_admin):
        """Test whitespace in name is trimmed."""
        _, clinic = clinic_admin
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="王小明",
            phone_number="0912345678",
            created_by_type="clinic_user"
        )
        db_session.add(patient)
        db_session.commit()
        
        # Check with whitespace (should still match after trimming)
        response = client.get(
            "/api/clinic/patients/check-duplicate",
            params={"name": "  王小明  "},
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        assert response.json()["count"] == 1


class TestCreatedByType:
    """Tests for created_by_type field tracking."""

    @pytest.fixture(autouse=True)
    def setup_db_override(self, db_session):
        """Override get_db dependency to use test session."""
        app.dependency_overrides[get_db] = lambda: db_session
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_clinic_created_patient_has_clinic_user_type(self, db_session, auth_headers_admin, clinic_admin):
        """Test clinic-created patients have created_by_type='clinic_user'."""
        response = client.post(
            "/api/clinic/patients",
            json={
                "full_name": "測試病患"
            },
            headers=auth_headers_admin
        )
        
        assert response.status_code == 200
        patient_id = response.json()["patient_id"]
        
        # Verify in database
        patient = db_session.query(Patient).filter(Patient.id == patient_id).first()
        assert patient.created_by_type == "clinic_user"

