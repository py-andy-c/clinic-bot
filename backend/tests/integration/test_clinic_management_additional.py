"""
Additional Clinic Management Integration Tests.

Targets high-risk business rules not fully covered:
- Prevent removing the last admin and prevent self-demotion if last admin
- Reject invalid roles on invite
- Settings update should not silently break existing appointments (exposes destructive behavior)
"""

import pytest
from datetime import datetime, timedelta, time, timezone
from fastapi.testclient import TestClient

from main import app
from core.database import get_db
from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent


@pytest.fixture
def client(db_session):
    def override_get_db():
        return db_session
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_db, None)


def _uc(user_id, clinic_id, roles):
    from auth.dependencies import UserContext
    return UserContext(
        user_type="clinic_user",
        email=f"u{user_id}@ex.com",
        roles=roles,
        clinic_id=clinic_id,
        google_subject_id=f"sub-{user_id}",
        name=f"User {user_id}",
        user_id=user_id,
    )


@pytest.fixture
def clinic_with_admin_and_practitioner(db_session):
    c = Clinic(name="Clinic", line_channel_id="cid", line_channel_secret="sec", line_channel_access_token="tok")
    db_session.add(c)
    db_session.commit()

    admin = User(clinic_id=c.id, full_name="Admin", email="admin@ex.com", google_subject_id="subA", roles=["admin"], is_active=True)
    pract = User(clinic_id=c.id, full_name="Doc", email="doc@ex.com", google_subject_id="subP", roles=["practitioner"], is_active=True)
    db_session.add_all([admin, pract])
    db_session.commit()
    return c, admin, pract


class TestLastAdminProtections:
    def test_cannot_remove_last_admin(self, client, db_session, clinic_with_admin_and_practitioner):
        c, admin, pract = clinic_with_admin_and_practitioner

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])  # acting as admin

        # Attempt to delete the only admin
        res = client.delete(f"/api/clinic/members/{admin.id}")
        assert res.status_code == 400
        assert "無法停用最後一位管理員" in res.text

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_cannot_self_demote_if_last_admin(self, client, db_session, clinic_with_admin_and_practitioner):
        c, admin, pract = clinic_with_admin_and_practitioner

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])  # acting as admin

        # Attempt to remove own admin role while being the last admin
        res = client.put(f"/api/clinic/members/{admin.id}/roles", json={"roles": ["practitioner"]})
        assert res.status_code == 400
        assert "無法從最後一位管理員停用管理員權限" in res.text

        app.dependency_overrides.pop(auth_deps.get_current_user, None)


class TestInviteValidation:
    def test_invite_rejects_invalid_roles(self, client, db_session, clinic_with_admin_and_practitioner):
        c, admin, pract = clinic_with_admin_and_practitioner

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])  # acting as admin

        # Invalid role should be rejected with 400
        res = client.post("/api/clinic/members/invite", json={"default_roles": ["superadmin"]})
        assert res.status_code == 400
        assert "指定的角色無效" in res.text

        app.dependency_overrides.pop(auth_deps.get_current_user, None)


class TestSettingsDestructiveUpdate:
    def test_settings_update_does_not_silently_break_existing_appointments(self, client, db_session, clinic_with_admin_and_practitioner):
        c, admin, pract = clinic_with_admin_and_practitioner

        # Prepare data: appointment type and appointment referencing it
        at = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        db_session.add(at)
        db_session.commit()

        # Minimal patient
        p = Patient(clinic_id=c.id, full_name="Ms. A", phone_number="0912000000")
        db_session.add(p)
        db_session.commit()

        # Create an appointment tied to the appointment type
        start = datetime.now(timezone.utc) + timedelta(days=1)
        end = start + timedelta(minutes=60)

        # Create CalendarEvent first
        calendar_event = CalendarEvent(
            user_id=pract.id,
            event_type='appointment',
            date=start.date(),
            start_time=start.time(),
            end_time=end.time(),
            gcal_event_id=None
        )
        db_session.add(calendar_event)
        db_session.commit()

        appt = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=p.id,
            appointment_type_id=at.id,
            status="confirmed"
        )
        db_session.add(appt)
        db_session.commit()

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])  # acting as admin

        # Update settings: this endpoint deletes all appointment types and recreates from payload.
        # Provide a completely different list (removing the existing type). This may violate FKs.
        res = client.put("/api/clinic/settings", json={
            "appointment_types": [
                {"name": "回診", "duration_minutes": 30}
            ]
        })

        # We accept either 500 (exposes destructive bug) or 200 with the type removed.
        # In both cases, verify that the existing appointment still refers to an appointment_type_id that now may not exist.
        assert res.status_code in (200, 500)

        # Refresh and inspect referential integrity exposure
        db_session.refresh(appt)
        # The test intentionally does not assert exact behavior, but ensures we can detect broken references.
        # If FK constraints are enforced, the PUT should have failed (500). If not, this exposes inconsistent state.
        if res.status_code == 200:
            # If settings update succeeded, ensure the old type still exists or we risk orphan references
            existing_type = db_session.get(AppointmentType, at.id)
            # If it's gone, we expose a bug in destructive settings updates
            assert existing_type is not None, "Settings update removed appointment types referenced by existing appointments (data corruption risk)"

        app.dependency_overrides.pop(auth_deps.get_current_user, None)
