from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Dict, Any, List
import uuid
import time
from datetime import datetime, timezone, date, time as time_type

from core.database import get_db, Base
from models import (
    Clinic, User, UserClinicAssociation, AppointmentType, 
    Patient, PractitionerAppointmentTypes, RefreshToken,
    Appointment, CalendarEvent
)
from models.clinic import ClinicSettings
from api.test.auth import require_e2e_mode
from services.jwt_service import jwt_service, TokenPayload

router = APIRouter()

class SeedRequest(BaseModel):
    scenario: str = "minimal"

# --- Token Helpers ---

def create_tokens_for_user(db: Session, user: User, clinic_id: int):
    """Helper to create access and refresh tokens for a test user."""
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id,
        UserClinicAssociation.clinic_id == clinic_id
    ).first()
    
    if not association:
        raise ValueError(f"User {user.id} is not associated with clinic {clinic_id}")
    
    token_payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_id=user.id,
        user_type="clinic_user",
        email=user.email,
        roles=association.roles,
        active_clinic_id=clinic_id,
        name=association.full_name or user.email
    )
    
    token_data = jwt_service.create_token_pair(token_payload)
    
    # Store refresh token record
    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=token_data["refresh_token_hash"],
        token_hash_sha256=token_data.get("refresh_token_hash_sha256"),
        expires_at=jwt_service.get_token_expiry("refresh"),
    )
    db.add(refresh_token_record)
    
    return token_data

# --- Modular Seeding Helpers ---

def create_clinic(db: Session, unique_id: str, now: datetime, name_prefix: str = "Clinic"):
    """Creates a basic clinic."""
    clinic = Clinic(
        name=f"{name_prefix} {unique_id}",
        line_channel_id=f"channel_{unique_id}_{name_prefix.lower()}",
        line_channel_secret=f"secret_{unique_id}",
        line_channel_access_token=f"token_{unique_id}",
        settings=ClinicSettings().model_dump(),
        created_at=now,
        updated_at=now
    )
    db.add(clinic)
    db.flush()
    return clinic

def create_user(db: Session, email: str, unique_id: str, now: datetime):
    """Creates a basic user."""
    user = User(
        email=email,
        google_subject_id=f"google_{unique_id}_{email.split('@')[0]}",
        created_at=now,
        updated_at=now
    )
    db.add(user)
    db.flush()
    return user

def associate_user_to_clinic(db: Session, user: User, clinic: Clinic, roles: List[str], full_name: str, now: datetime):
    """Associates a user with a clinic."""
    assoc = UserClinicAssociation(
        user_id=user.id,
        clinic_id=clinic.id,
        roles=roles,
        full_name=full_name,
        is_active=True,
        created_at=now,
        updated_at=now
    )
    db.add(assoc)
    db.flush()
    return assoc

# --- Scenario Implementations ---

def seed_minimal(db: Session, unique_id: str, now: datetime) -> Dict[str, Any]:
    """Scenario: 1 Clinic, 1 Admin."""
    clinic = create_clinic(db, unique_id, now)
    admin_email = f"admin_{unique_id}@test.com"
    admin = create_user(db, admin_email, unique_id, now)
    associate_user_to_clinic(db, admin, clinic, ["admin", "practitioner"], f"Admin {unique_id}", now)
    
    auth = create_tokens_for_user(db, admin, clinic.id)
    
    return {
        "status": "success",
        "clinic_id": clinic.id,
        "tokens": [{
            "role": "admin",
            "email": admin_email,
            "access_token": auth["access_token"],
            "refresh_token": auth["refresh_token"]
        }]
    }

def seed_standard(db: Session, unique_id: str, now: datetime) -> Dict[str, Any]:
    """Scenario: 1 Clinic, 1 Admin, 1 Practitioner, 1 ApptType, 1 Patient."""
    # Start with minimal
    result = seed_minimal(db, unique_id, now)
    clinic_id: int = result["clinic_id"] # type: ignore
    
    # Add Practitioner
    prac_email = f"prac_{unique_id}@test.com"
    prac = create_user(db, prac_email, unique_id, now)
    clinic = db.query(Clinic).get(clinic_id)
    if not clinic:
        raise ValueError(f"Clinic {clinic_id} not found")

    associate_user_to_clinic(db, prac, clinic, ["practitioner"], f"Practitioner {unique_id}", now)
    
    prac_auth = create_tokens_for_user(db, prac, clinic_id)
    tokens: List[Dict[str, Any]] = result["tokens"] # type: ignore
    tokens.append({
        "role": "practitioner",
        "email": prac_email,
        "access_token": prac_auth["access_token"],
        "refresh_token": prac_auth["refresh_token"]
    })
    
    # Add Appointment Type
    # Note: AppointmentType does not have created_at/updated_at fields
    appt_type = AppointmentType(
        clinic_id=clinic_id,
        name=f"Standard Service {unique_id}",
        duration_minutes=30,
        allow_patient_booking=True
    )
    db.add(appt_type)
    db.flush()
    
    # Link Practitioner to Appointment Type
    db.add(PractitionerAppointmentTypes(
        user_id=prac.id,
        appointment_type_id=appt_type.id,
        clinic_id=clinic_id,
        created_at=now
    ))
    
    # Add Patient
    phone = f"09{str(int(time.time() * 1000))[-8:]}"
    patient = Patient(
        clinic_id=clinic_id,
        full_name=f"Patient {unique_id}",
        phone_number=phone,
        created_by_type='clinic_user',
        created_at=now
    )
    db.add(patient)
    db.flush()
    
    result.update({
        "appointment_type_id": appt_type.id,
        "appointment_type_name": appt_type.name,
        "patient_id": patient.id,
        "patient_name": patient.full_name,
        "practitioner_id": prac.id
    })
    
    return result

def seed_multi_clinic(db: Session, unique_id: str, now: datetime) -> Dict[str, Any]:
    """Scenario: 2 Clinics, 1 Admin associated with both."""
    admin_email = f"multi_admin_{unique_id}@test.com"
    admin = create_user(db, admin_email, unique_id, now)
    
    tokens: List[Dict[str, Any]] = []
    clinic_ids: List[int] = []
    clinic_names: List[str] = []

    for i in range(2):
        c = create_clinic(db, unique_id, now, name_prefix=f"Clinic {i+1}")
        clinic_ids.append(c.id)
        clinic_names.append(c.name)
        associate_user_to_clinic(db, admin, c, ["admin", "practitioner"], f"Admin {unique_id}", now)
        
        auth = create_tokens_for_user(db, admin, c.id)
        tokens.append({
            "role": "admin",
            "clinic_id": c.id,
            "clinic_name": c.name,
            "access_token": auth["access_token"],
            "refresh_token": auth["refresh_token"]
        })

    return {
        "status": "success",
        "clinic_ids": clinic_ids,
        "clinic_names": clinic_names,
        "tokens": tokens
    }

def seed_with_appointment(db: Session, unique_id: str, now: datetime) -> Dict[str, Any]:
    """Scenario: Standard + 1 clinical appointment for today."""
    result = seed_standard(db, unique_id, now)
    
    today = date.today()
    # Explicitly casting result lookups to correct types for typing
    practitioner_id: int = result["practitioner_id"] # type: ignore
    clinic_id: int = result["clinic_id"] # type: ignore
    patient_id: int = result["patient_id"] # type: ignore
    appointment_type_id: int = result["appointment_type_id"] # type: ignore

    event = CalendarEvent(
        user_id=practitioner_id,
        clinic_id=clinic_id,
        event_type='appointment',
        date=today,
        start_time=time_type(10, 0),
        end_time=time_type(10, 30),
        created_at=now,
        updated_at=now
    )
    db.add(event)
    db.flush()

    appt = Appointment(
        calendar_event_id=event.id,
        patient_id=patient_id,
        appointment_type_id=appointment_type_id,
        status='confirmed'
    )
    db.add(appt)
    
    result["appointment_id"] = appt.calendar_event_id
    return result

# --- Router Definitions ---

from typing import Callable
SCENARIO_HANDLERS: Dict[str, Callable[[Session, str, datetime], Dict[str, Any]]] = {
    "minimal": seed_minimal,
    "standard": seed_standard,
    "multi_clinic": seed_multi_clinic,
    "with_appointment": seed_with_appointment,
}

@router.post("/reset-database", summary="Reset database for E2E tests (E2E only)")
async def reset_database(
    _e2e_mode: bool = Depends(require_e2e_mode),
    db: Session = Depends(get_db)
):
    """Truncates all business tables in the database."""
    try:
        tables = Base.metadata.sorted_tables
        table_names = [t.name for t in tables if t.name != 'alembic_version']
        
        if table_names:
            db.execute(text(f"TRUNCATE TABLE {', '.join(table_names)} RESTART IDENTITY CASCADE;"))
            db.commit()
            
        return {"status": "success", "message": f"Truncated {len(table_names)} tables"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/seed", summary="Seed test data scenarios (E2E only)")
async def seed_data(
    request: SeedRequest,
    _e2e_mode: bool = Depends(require_e2e_mode),
    db: Session = Depends(get_db)
):
    """Endpoint to seed specific data scenarios for E2E tests."""
    handler = SCENARIO_HANDLERS.get(request.scenario)
    if not handler:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown scenario: {request.scenario}"
        )
    
    unique_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc)
    
    try:
        result = handler(db, unique_id, now)
        db.commit()
        # Ensure scenario name is in result
        result["scenario"] = request.scenario
        return result
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Seeding failed: {str(e)}"
        )
