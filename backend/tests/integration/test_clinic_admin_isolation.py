"""
Integration tests for clinic admin/practitioner endpoint isolation and role checks.

Covers:
- Practitioner can list only their clinic's patients/members.
- Admin cannot mutate members of another clinic (404 due to scoping filter).
- Non-admin cannot access admin-only endpoints (403).
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock

from main import app
from core.database import get_db
from auth.dependencies import UserContext
from models import Clinic, User, Patient, AppointmentType


@pytest.fixture
def client(db_session):
    def override_get_db():
        return db_session
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


def _uc(user_id, clinic_id, roles):
    return UserContext(
        user_type="clinic_user",
        email=f"u{user_id}@ex.com",
        roles=roles,
        active_clinic_id=clinic_id,
        google_subject_id=f"sub-{user_id}",
        name=f"User {user_id}",
        user_id=user_id,
    )


@pytest.fixture
def two_clinics_with_members(db_session):
    c1 = Clinic(name="Clinic 1", line_channel_id="c1", line_channel_secret="s1", line_channel_access_token="t1")
    c2 = Clinic(name="Clinic 2", line_channel_id="c2", line_channel_secret="s2", line_channel_access_token="t2")
    db_session.add_all([c1, c2])
    db_session.commit()

    # Members - use helper function to create users with clinic associations
    from tests.conftest import create_user_with_clinic_association
    
    a1, a1_assoc = create_user_with_clinic_association(db_session, c1, "Admin A1", "a1@ex.com", "a1sub", ["admin"], True)
    p1, p1_assoc = create_user_with_clinic_association(db_session, c1, "Doc P1", "p1@ex.com", "p1sub", ["practitioner"], True)
    a2, a2_assoc = create_user_with_clinic_association(db_session, c2, "Admin A2", "a2@ex.com", "a2sub", ["admin"], True)
    p2, p2_assoc = create_user_with_clinic_association(db_session, c2, "Doc P2", "p2@ex.com", "p2sub", ["practitioner"], True)
    
    db_session.commit()

    # Patients
    pa1 = Patient(clinic_id=c1.id, full_name="P C1", phone_number="0912000001")
    pa2 = Patient(clinic_id=c2.id, full_name="P C2", phone_number="0912000002")
    db_session.add_all([pa1, pa2])
    db_session.commit()

    return c1, c2, a1, p1, a2, p2, pa1, pa2


def test_practitioner_lists_only_their_clinic_patients(client, db_session, two_clinics_with_members):
    c1, c2, a1, p1, a2, p2, pa1, pa2 = two_clinics_with_members

    # Override auth to simulate practitioner of clinic 1
    from auth import dependencies as auth_deps
    app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=p1.id, clinic_id=c1.id, roles=["practitioner"]) 

    res = client.get("/api/clinic/patients")
    assert res.status_code == 200
    data = res.json()
    ids = [p["id"] for p in data.get("patients", [])]
    assert pa1.id in ids
    assert pa2.id not in ids

    app.dependency_overrides.pop(auth_deps.get_current_user, None)


def test_admin_cannot_update_roles_of_other_clinic_member(client, db_session, two_clinics_with_members):
    c1, c2, a1, p1, a2, p2, pa1, pa2 = two_clinics_with_members

    from auth import dependencies as auth_deps
    # Admin of clinic 1 tries to update roles of member in clinic 2
    app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=a1.id, clinic_id=c1.id, roles=["admin"]) 

    res = client.put(f"/api/clinic/members/{p2.id}/roles", json={"roles": ["practitioner"]})
    # Endpoint filters by current_user.clinic_id, so it should not find member → 404
    assert res.status_code == 404

    app.dependency_overrides.pop(auth_deps.get_current_user, None)


def test_non_admin_forbidden_on_admin_endpoint(client, db_session, two_clinics_with_members):
    c1, c2, a1, p1, a2, p2, pa1, pa2 = two_clinics_with_members

    from auth import dependencies as auth_deps
    app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=p1.id, clinic_id=c1.id, roles=["practitioner"]) 

    # Practitioner calling admin-only invite endpoint should be 403
    res = client.post("/api/clinic/members/invite", json={"default_roles": ["practitioner"]})
    assert res.status_code == 403

    app.dependency_overrides.pop(auth_deps.get_current_user, None)
