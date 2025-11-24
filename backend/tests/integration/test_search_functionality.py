"""
Integration tests for server-side search functionality.

Tests search functionality for patients and LINE users endpoints,
including search by name, phone number, and LINE user display name.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from core.database import get_db
from models import Clinic, User, UserClinicAssociation, LineUser, Patient
from services.jwt_service import jwt_service, TokenPayload


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
def test_clinic(db_session):
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token",
        settings={}
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


@pytest.fixture
def admin_user(db_session, test_clinic):
    """Create an admin user for the test clinic."""
    from tests.conftest import create_user_with_clinic_association
    user, _ = create_user_with_clinic_association(
        db_session,
        test_clinic,
        full_name="Admin User",
        email="admin@test.com",
        google_subject_id="admin_sub_123",
        roles=["admin"],
        is_active=True
    )
    return user


@pytest.fixture
def test_patients(db_session, test_clinic):
    """Create test patients with various names and phone numbers."""
    line_user1 = LineUser(
        line_user_id="U_test_user_1",
        clinic_id=test_clinic.id,
        display_name="張三"
    )
    line_user2 = LineUser(
        line_user_id="U_test_user_2",
        clinic_id=test_clinic.id,
        display_name="John Smith"
    )
    line_user3 = LineUser(
        line_user_id="U_test_user_3",
        clinic_id=test_clinic.id,
        display_name="李四"
    )
    db_session.add_all([line_user1, line_user2, line_user3])
    db_session.flush()
    
    patients = [
        Patient(
            clinic_id=test_clinic.id,
            full_name="張三",
            phone_number="0912345678",
            line_user_id=line_user1.id,
            is_deleted=False
        ),
        Patient(
            clinic_id=test_clinic.id,
            full_name="張小明",
            phone_number="0923456789",
            line_user_id=line_user1.id,
            is_deleted=False
        ),
        Patient(
            clinic_id=test_clinic.id,
            full_name="John Smith",
            phone_number="0934567890",
            line_user_id=line_user2.id,
            is_deleted=False
        ),
        Patient(
            clinic_id=test_clinic.id,
            full_name="Jane Doe",
            phone_number="0945678901",
            line_user_id=line_user2.id,
            is_deleted=False
        ),
        Patient(
            clinic_id=test_clinic.id,
            full_name="李四",
            phone_number="0956789012",
            line_user_id=line_user3.id,
            is_deleted=False
        ),
        Patient(
            clinic_id=test_clinic.id,
            full_name="王五",
            phone_number="0967890123",
            line_user_id=None,  # No LINE user
            is_deleted=False
        ),
    ]
    db_session.add_all(patients)
    db_session.commit()
    return patients


class TestPatientSearch:
    """Test patient search functionality."""
    
    def test_search_by_chinese_name(self, client, admin_user, test_clinic, test_patients):
        """Test searching patients by Chinese name."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/patients",
            params={"search": "張", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2  # 張三 and 張小明
        assert len(data["patients"]) == 2
        patient_names = {p["full_name"] for p in data["patients"]}
        assert "張三" in patient_names
        assert "張小明" in patient_names
    
    def test_search_by_english_name(self, client, admin_user, test_clinic, test_patients):
        """Test searching patients by English name."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/patients",
            params={"search": "John", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        # Search matches both patient name and LINE user display name, so may return multiple results
        assert data["total"] >= 1
        assert len(data["patients"]) >= 1
        patient_names = {p["full_name"] for p in data["patients"]}
        assert "John Smith" in patient_names
    
    def test_search_by_phone_number(self, client, admin_user, test_clinic, test_patients):
        """Test searching patients by phone number."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/patients",
            params={"search": "0912", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert len(data["patients"]) == 1
        assert data["patients"][0]["phone_number"] == "0912345678"
    
    def test_search_by_line_user_display_name(self, client, admin_user, test_clinic, test_patients):
        """Test searching patients by LINE user display name."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/patients",
            params={"search": "John Smith", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should find patient "John Smith" and also match LINE user display name
        assert data["total"] >= 1
        patient_names = {p["full_name"] for p in data["patients"]}
        assert "John Smith" in patient_names
    
    def test_search_no_results(self, client, admin_user, test_clinic, test_patients):
        """Test search with no matching results."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/patients",
            params={"search": "不存在", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert len(data["patients"]) == 0
    
    def test_search_with_pagination(self, client, admin_user, test_clinic, test_patients):
        """Test search with pagination."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        # Search for all patients (no search term), page 1
        response = client.get(
            "/api/clinic/patients",
            params={"page": 1, "page_size": 2},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 6  # All test patients
        assert len(data["patients"]) == 2
        assert data["page"] == 1
        assert data["page_size"] == 2
    
    def test_search_case_insensitive(self, client, admin_user, test_clinic, test_patients):
        """Test that search is case-insensitive."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        # Search with lowercase
        response_lower = client.get(
            "/api/clinic/patients",
            params={"search": "john", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Search with uppercase
        response_upper = client.get(
            "/api/clinic/patients",
            params={"search": "JOHN", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response_lower.status_code == 200
        assert response_upper.status_code == 200
        assert response_lower.json()["total"] == response_upper.json()["total"]
        # Search matches both patient name and LINE user display name, so may return multiple results
        assert response_lower.json()["total"] >= 1


class TestLineUserSearch:
    """Test LINE user search functionality."""
    
    def test_search_by_display_name(self, client, admin_user, test_clinic, test_patients):
        """Test searching LINE users by display name."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/line-users",
            params={"search": "張", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1  # LINE user with display name "張三"
        assert len(data["line_users"]) == 1
        assert data["line_users"][0]["display_name"] == "張三"
    
    def test_search_by_patient_name(self, client, admin_user, test_clinic, test_patients):
        """Test searching LINE users by associated patient name."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/line-users",
            params={"search": "張小明", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1  # LINE user with patient "張小明"
        assert len(data["line_users"]) == 1
        # The LINE user should have "張小明" in patient_names
        assert "張小明" in data["line_users"][0]["patient_names"]
    
    def test_search_english_name(self, client, admin_user, test_clinic, test_patients):
        """Test searching LINE users by English name."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/line-users",
            params={"search": "John", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1  # LINE user with display name "John Smith"
        assert len(data["line_users"]) == 1
        assert data["line_users"][0]["display_name"] == "John Smith"
    
    def test_search_no_results(self, client, admin_user, test_clinic, test_patients):
        """Test search with no matching results."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        response = client.get(
            "/api/clinic/line-users",
            params={"search": "不存在", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert len(data["line_users"]) == 0
    
    def test_search_with_pagination(self, client, admin_user, test_clinic, test_patients):
        """Test search with pagination."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        # Search for all LINE users (no search term), page 1
        response = client.get(
            "/api/clinic/line-users",
            params={"page": 1, "page_size": 2},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3  # 3 LINE users
        assert len(data["line_users"]) == 2
        assert data["page"] == 1
        assert data["page_size"] == 2
    
    def test_search_case_insensitive(self, client, admin_user, test_clinic, test_patients):
        """Test that search is case-insensitive."""
        payload = TokenPayload(
            sub=admin_user.google_subject_id or f"test_sub_{admin_user.id}",
            user_id=admin_user.id,
            email=admin_user.email,
            user_type="clinic_user",
            roles=["admin"],
            name=admin_user.email,
            active_clinic_id=test_clinic.id
        )
        token = jwt_service.create_access_token(payload)
        
        # Search with lowercase
        response_lower = client.get(
            "/api/clinic/line-users",
            params={"search": "john", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Search with uppercase
        response_upper = client.get(
            "/api/clinic/line-users",
            params={"search": "JOHN", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response_lower.status_code == 200
        assert response_upper.status_code == 200
        assert response_lower.json()["total"] == response_upper.json()["total"]
        assert response_lower.json()["total"] == 1

