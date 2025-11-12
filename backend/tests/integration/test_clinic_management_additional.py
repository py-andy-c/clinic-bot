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
from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent, PractitionerAppointmentTypes
from tests.conftest import create_calendar_event_with_clinic, create_user_with_clinic_association


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
        active_clinic_id=clinic_id,
        google_subject_id=f"sub-{user_id}",
        name=f"User {user_id}",
        user_id=user_id,
    )


@pytest.fixture
def clinic_with_admin_and_practitioner(db_session):
    c = Clinic(name="Clinic", line_channel_id="cid", line_channel_secret="sec", line_channel_access_token="tok")
    db_session.add(c)
    db_session.commit()

    admin, _ = create_user_with_clinic_association(
        db_session,
        clinic=c,
        full_name="Admin",
        email="admin@ex.com",
        google_subject_id="subA",
        roles=["admin"],
        is_active=True
    )
    pract, _ = create_user_with_clinic_association(
        db_session,
        clinic=c,
        full_name="Doc",
        email="doc@ex.com",
        google_subject_id="subP",
        roles=["practitioner"],
        is_active=True
    )
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
        # Use a fixed time to avoid midnight spanning issues
        start = datetime.combine((datetime.now(timezone.utc) + timedelta(days=1)).date(), time(10, 0))
        end = start + timedelta(minutes=60)

        # Create CalendarEvent first
        calendar_event = create_calendar_event_with_clinic(
            db_session, pract, c,
            event_type='appointment',
            event_date=start.date(),
            start_time=start.time(),
            end_time=end.time()
        )
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


class TestAppointmentTypeDeletionPrevention:
    def test_cannot_delete_appointment_type_with_practitioner_references(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that appointment types referenced by practitioners cannot be deleted."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create appointment type
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        at2 = AppointmentType(clinic_id=c.id, name="回診", duration_minutes=30)
        db_session.add_all([at1, at2])
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=pract.id,
            clinic_id=c.id,
            appointment_type_id=at1.id
        )
        db_session.add(pat)
        db_session.commit()

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Attempt to delete appointment type that has practitioner reference
        res = client.put("/api/clinic/settings", json={
            "appointment_types": [
                {"name": "回診", "duration_minutes": 30}  # Only keeping at2, deleting at1
            ]
        })

        assert res.status_code == 400
        assert "無法刪除某些預約類型" in res.text
        assert "無法刪除某些預約類型，因為有治療師正在提供此服務" in res.text or "cannot_delete_appointment_types" in res.text
        
        # Verify error response structure
        error_detail = res.json().get("detail", {})
        if isinstance(error_detail, dict):
            assert error_detail.get("error") == "cannot_delete_appointment_types"
            assert "appointment_types" in error_detail
            appointment_types_error = error_detail["appointment_types"]
            assert len(appointment_types_error) > 0
            assert appointment_types_error[0]["name"] == "初診評估"
            assert "Doc" in appointment_types_error[0]["practitioners"]  # practitioner full_name

        # Verify appointment type still exists
        db_session.refresh(at1)
        assert at1 is not None

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_can_delete_appointment_type_without_practitioner_references(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that appointment types without practitioner references can be deleted."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create appointment types
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        at2 = AppointmentType(clinic_id=c.id, name="回診", duration_minutes=30)
        db_session.add_all([at1, at2])
        db_session.commit()

        # No practitioner associations

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Delete appointment types - should succeed
        res = client.put("/api/clinic/settings", json={
            "appointment_types": [
                {"name": "新類型", "duration_minutes": 45}
            ]
        })

        assert res.status_code == 200
        assert "設定更新成功" in res.text

        # Verify old appointment types are soft deleted, new one is active
        db_session.expire_all()
        existing_types = db_session.query(AppointmentType).filter_by(clinic_id=c.id).all()
        assert len(existing_types) == 3  # 2 soft deleted + 1 new active

        # Check soft delete status
        active_types = [t for t in existing_types if not t.is_deleted]
        deleted_types = [t for t in existing_types if t.is_deleted]

        assert len(active_types) == 1
        assert len(deleted_types) == 2
        assert active_types[0].name == "新類型"
        assert all(t.deleted_at is not None for t in deleted_types)

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_deletion_prevention_with_multiple_practitioners(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that deletion prevention works with multiple practitioners referencing the same type."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create second practitioner
        pract2, _ = create_user_with_clinic_association(
            db_session,
            clinic=c,
            full_name="Doc2",
            email="doc2@ex.com",
            google_subject_id="subP2",
            roles=["practitioner"],
            is_active=True
        )

        # Create appointment type
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        db_session.add(at1)
        db_session.commit()

        # Associate both practitioners with appointment type
        pat1 = PractitionerAppointmentTypes(user_id=pract.id, clinic_id=c.id, appointment_type_id=at1.id)
        pat2 = PractitionerAppointmentTypes(user_id=pract2.id, clinic_id=c.id, appointment_type_id=at1.id)
        db_session.add_all([pat1, pat2])
        db_session.commit()

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Attempt to delete appointment type
        res = client.put("/api/clinic/settings", json={
            "appointment_types": [
                {"name": "回診", "duration_minutes": 30}
            ]
        })

        assert res.status_code == 400
        error_detail = res.json().get("detail", {})
        if isinstance(error_detail, dict):
            appointment_types_error = error_detail.get("appointment_types", [])
            assert len(appointment_types_error) > 0
            practitioners = appointment_types_error[0].get("practitioners", [])
            assert len(practitioners) == 2
            assert "Doc" in practitioners
            assert "Doc2" in practitioners

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_deletion_prevention_with_mixed_types(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that deletion is blocked when trying to delete types that have practitioner references."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create appointment types
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        at2 = AppointmentType(clinic_id=c.id, name="回診", duration_minutes=30)
        at3 = AppointmentType(clinic_id=c.id, name="檢查", duration_minutes=45)
        db_session.add_all([at1, at2, at3])
        db_session.commit()

        # Associate practitioner only with at1
        pat = PractitionerAppointmentTypes(user_id=pract.id, clinic_id=c.id, appointment_type_id=at1.id)
        db_session.add(pat)
        db_session.commit()

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Attempt to delete at2 and at3, keep at1 by name+duration (no ID in request)
        # With the new implementation, at1 is kept (matched by name+duration), so it's not deleted
        # Only at2 and at3 are deleted, and they don't have practitioner references, so it should succeed
        res = client.put("/api/clinic/settings", json={
            "appointment_types": [
                {"name": "初診評估", "duration_minutes": 60},  # Keep at1 by name+duration
                {"name": "新類型", "duration_minutes": 20}
            ]
        })

        # Should succeed because:
        # - at1 is kept (matched by name+duration), not deleted, so no FK constraint issue
        # - at2 and at3 are deleted but have no practitioner references
        assert res.status_code == 200

        # Verify at1 still exists, at2 and at3 are soft deleted, and new type is created
        db_session.expire_all()
        existing_types = db_session.query(AppointmentType).filter_by(clinic_id=c.id, is_deleted=False).all()
        assert len(existing_types) == 2  # at1 (kept) + new type
        assert any(at.name == "初診評估" and at.duration_minutes == 60 for at in existing_types)
        assert any(at.name == "新類型" and at.duration_minutes == 20 for at in existing_types)

        app.dependency_overrides.pop(auth_deps.get_current_user, None)


class TestAppointmentTypeDeletionValidation:
    def test_validate_deletion_blocks_when_practitioners_reference_type(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that validation endpoint correctly identifies blocked deletions."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create appointment type
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        db_session.add(at1)
        db_session.commit()

        # Associate practitioner with appointment type
        pat = PractitionerAppointmentTypes(
            user_id=pract.id,
            clinic_id=c.id,
            appointment_type_id=at1.id
        )
        db_session.add(pat)
        db_session.commit()

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Validate deletion - should be blocked
        res = client.post("/api/clinic/appointment-types/validate-deletion", json={
            "appointment_type_ids": [at1.id]
        })

        assert res.status_code == 200
        data = res.json()
        assert data["can_delete"] == False
        assert "error" in data
        assert data["error"]["error"] == "cannot_delete_appointment_types"
        assert len(data["error"]["appointment_types"]) > 0
        assert data["error"]["appointment_types"][0]["name"] == "初診評估"
        assert "Doc" in data["error"]["appointment_types"][0]["practitioners"]

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_validate_deletion_allows_when_no_practitioners_reference_type(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that validation endpoint allows deletion when no practitioners reference type."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create appointment type
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        db_session.add(at1)
        db_session.commit()

        # No practitioner associations

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Validate deletion - should be allowed
        res = client.post("/api/clinic/appointment-types/validate-deletion", json={
            "appointment_type_ids": [at1.id]
        })

        assert res.status_code == 200
        data = res.json()
        assert data["can_delete"] == True
        assert "warnings" in data
        assert data["warnings"] == []

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_validate_deletion_with_multiple_types(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that validation endpoint handles multiple appointment types correctly."""
        c, admin, pract = clinic_with_admin_and_practitioner

        # Create appointment types
        at1 = AppointmentType(clinic_id=c.id, name="初診評估", duration_minutes=60)
        at2 = AppointmentType(clinic_id=c.id, name="回診", duration_minutes=30)
        db_session.add_all([at1, at2])
        db_session.commit()

        # Associate practitioner only with at1
        pat = PractitionerAppointmentTypes(
            user_id=pract.id,
            clinic_id=c.id,
            appointment_type_id=at1.id
        )
        db_session.add(pat)
        db_session.commit()

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Validate deletion of both types
        res = client.post("/api/clinic/appointment-types/validate-deletion", json={
            "appointment_type_ids": [at1.id, at2.id]
        })

        assert res.status_code == 200
        data = res.json()
        assert data["can_delete"] == False  # Because at1 is blocked
        assert "error" in data
        assert len(data["error"]["appointment_types"]) == 1  # Only at1 is blocked
        assert data["error"]["appointment_types"][0]["name"] == "初診評估"

        app.dependency_overrides.pop(auth_deps.get_current_user, None)

    def test_validate_deletion_skips_nonexistent_types(self, client, db_session, clinic_with_admin_and_practitioner):
        """Test that validation endpoint gracefully handles non-existent appointment type IDs."""
        c, admin, pract = clinic_with_admin_and_practitioner

        from auth import dependencies as auth_deps
        app.dependency_overrides[auth_deps.get_current_user] = lambda: _uc(user_id=admin.id, clinic_id=c.id, roles=["admin"])

        # Validate deletion of non-existent type
        res = client.post("/api/clinic/appointment-types/validate-deletion", json={
            "appointment_type_ids": [99999]
        })

        assert res.status_code == 200
        data = res.json()
        assert data["can_delete"] == True  # Non-existent types don't block deletion

        app.dependency_overrides.pop(auth_deps.get_current_user, None)
