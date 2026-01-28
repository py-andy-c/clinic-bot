from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
import secrets
import logging

from core.database import get_db
from models import (
    User, UserClinicAssociation, Clinic,
    AppointmentType, Patient, PractitionerAppointmentTypes, PractitionerAvailability
)
from datetime import datetime, date, timezone, time

router = APIRouter()
logger = logging.getLogger(__name__)

class SeedRequest(BaseModel):
    scenario: str
    user_id: int | None = None
    clinic_id: int | None = None

def require_e2e_mode():
    import os
    if os.getenv("E2E_TEST_MODE") != "true":
        raise HTTPException(
            status_code=403,
            detail="此端點僅在 E2E 測試模式下可用"
        )
    return True

# --- Scenario Creation Functions ---
def create_minimal_clinic(db: Session, user_id: int | None = None, clinic_id: int | None = None) -> Dict[str, Any]:
    """Create minimal clinic with admin user only."""
    # Use existing clinic if provided, otherwise create new one
    if clinic_id:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(status_code=404, detail=f"找不到診所 {clinic_id}")
    else:
        clinic = Clinic(
            name=f"Test Clinic {secrets.token_hex(4)}",
            line_channel_id=f"test_channel_{secrets.token_hex(4)}",
            line_channel_secret="test_channel_secret",
            line_channel_access_token="test_access_token",
            settings={}
        )
        db.add(clinic)
        db.commit()
        db.refresh(clinic)

    # Use existing user if provided, otherwise create new one
    if user_id:
        admin_user = db.query(User).filter(User.id == user_id).first()
        if not admin_user:
            raise HTTPException(status_code=404, detail=f"找不到使用者 {user_id}")
    else:
        admin_user = User(
            email=f"admin_{secrets.token_hex(4)}@test.com",
            google_subject_id=f"google_{secrets.token_hex(8)}"
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)

    # Check if association already exists
    existing_assoc = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == admin_user.id,
        UserClinicAssociation.clinic_id == clinic.id
    ).first()

    if existing_assoc:
        admin_assoc = existing_assoc
    else:
        admin_assoc = UserClinicAssociation(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            roles=["admin"],
            full_name="Test Admin",
            is_active=True
        )
        db.add(admin_assoc)
        db.commit()

    return {
        "clinic_id": clinic.id,
        "users": [{
            "id": admin_user.id,
            "email": admin_user.email,
            "roles": ["admin"],
            "full_name": admin_assoc.full_name,
            "clinic_id": clinic.id
        }]
    }

def create_standard_clinic(db: Session, user_id: int | None = None, clinic_id: int | None = None) -> Dict[str, Any]:
    """Create standard clinic with admin, practitioner, appointment type, and patient."""
    # Start with minimal clinic
    result = create_minimal_clinic(db, user_id, clinic_id)
    clinic_id = result["clinic_id"]

    # Create practitioner user with unique identifier
    import time as time_module
    unique_id = f"{int(time_module.time())}_{secrets.token_hex(3)}"
    practitioner = User(
        email=f"practitioner_{unique_id}@test.com",
        google_subject_id=f"google_{secrets.token_hex(8)}"
    )
    db.add(practitioner)
    db.commit()
    db.refresh(practitioner)

    # Create practitioner association with unique name
    practitioner_assoc = UserClinicAssociation(
        user_id=practitioner.id,
        clinic_id=clinic_id,
        roles=["practitioner"],
        full_name=f"Dr. Test Practitioner {unique_id}",
        is_active=True
    )
    db.add(practitioner_assoc)
    db.commit()

    # Create an appointment type
    appt_type = AppointmentType(
        clinic_id=clinic_id,
        name="一般治療",
        duration_minutes=60,
        receipt_name="一般治療",
        allow_patient_booking=True,
        allow_patient_practitioner_selection=True,
        description="一般治療服務",
        scheduling_buffer_minutes=0,
        display_order=0,
        send_patient_confirmation=True,
        send_clinic_confirmation=True,
        send_reminder=True,
        patient_confirmation_message="您的預約已確認",
        clinic_confirmation_message="有新預約",
        reminder_message="提醒您有預約"
    )
    db.add(appt_type)
    db.commit()
    db.refresh(appt_type)

    # Create practitioner-appointment type mapping
    pat_mapping = PractitionerAppointmentTypes(
        user_id=practitioner.id,
        appointment_type_id=appt_type.id,
        clinic_id=clinic_id,
        is_deleted=False
    )
    db.add(pat_mapping)
    db.commit()

    # Create practitioner availability intervals (Monday 9 AM - 5 PM)
    monday_availability = PractitionerAvailability(
        user_id=practitioner.id,
        clinic_id=clinic_id,
        day_of_week=0,  # Monday (0=Monday, 6=Sunday)
        start_time=time(9, 0),   # 9:00 AM
        end_time=time(17, 0)     # 5:00 PM
    )
    db.add(monday_availability)
    db.commit()

    # Create patient
    patient = Patient(
        clinic_id=clinic_id,
        full_name="Test Patient",
        phone_number="0912345678",
        birthday=date(1990, 1, 1),
        created_at=datetime.now(timezone.utc)
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    # Add practitioner to result
    result["users"].append({
        "id": practitioner.id,
        "email": practitioner.email,
        "roles": ["practitioner"],
        "full_name": practitioner_assoc.full_name,
        "clinic_id": clinic_id
    })

    result.update({
        "appointment_types": [{
            "id": appt_type.id,
            "name": appt_type.name,
            "duration_minutes": appt_type.duration_minutes
        }],
        "patients": [{
            "id": patient.id,
            "full_name": patient.full_name,
            "phone_number": patient.phone_number
        }]
    })

    return result

SCENARIOS = {
    "minimal": create_minimal_clinic,
    "standard": create_standard_clinic,
}

@router.get("/health", dependencies=[Depends(require_e2e_mode)])
async def test_health():
    """Simple health check endpoint for testing."""
    return {"status": "ok", "message": "Seed API is available"}

@router.post("/seed", dependencies=[Depends(require_e2e_mode)])
async def seed_scenario(
    request: SeedRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    scenario = request.scenario
    if scenario not in SCENARIOS:
        raise HTTPException(
            status_code=400,
            detail=f"未知的測試情境: {scenario}。可用情境: {list(SCENARIOS.keys())}"
        )

    try:
        scenario_func = SCENARIOS[scenario]
        result = scenario_func(db, request.user_id, request.clinic_id)

        # Generate test tokens for authentication - use same format as test auth endpoint
        from services.jwt_service import jwt_service, TokenPayload
        tokens: List[Dict[str, Any]] = []
        for user in result["users"]:
            # Generate unique sub claim like the test auth endpoint does
            # Use google_subject_id if available, otherwise generate unique string
            user_obj = db.query(User).filter(User.id == user["id"]).first()
            sub_value = user_obj.google_subject_id if user_obj and user_obj.google_subject_id else f"seed_sub_{user['id']}_{secrets.token_hex(4)}"

            payload = TokenPayload(
                sub=sub_value,  # Use unique string like test auth endpoint
                user_id=user["id"],
                email=user["email"],
                user_type="clinic_user",
                roles=user["roles"],
                name=user["full_name"],
                active_clinic_id=user.get("clinic_id") or result.get("clinic_id")
            )
            access_token = jwt_service.create_access_token(payload)
            refresh_token = secrets.token_urlsafe(64)
            tokens.append({
                "user_id": user["id"],
                "access_token": access_token,
                "refresh_token": refresh_token
            })

        return {
            **result,
            "tokens": tokens,
            "scenario": scenario
        }

    except Exception as e:
        db.rollback()
        logger.error(f"[SEED API ERROR] Exception in scenario {scenario}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"測試情境 {scenario} 建立失敗: {str(e)}"
        )