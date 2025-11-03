# pyright: reportMissingTypeStubs=false
"""
LIFF (LINE Front-end Framework) API endpoints.

These endpoints handle requests from LIFF applications embedded in LINE.
They provide authentication, patient management, appointment booking, and
availability checking functionality for the UI-based appointment system.

All endpoints require JWT authentication from LIFF login flow.
"""

import logging
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import JWT_SECRET_KEY, JWT_ACCESS_TOKEN_EXPIRE_MINUTES
from models import (
    LineUser, Clinic, Patient
)
from services import PatientService, AppointmentService, AvailabilityService, PractitionerService, AppointmentTypeService
from utils.phone_validator import validate_taiwanese_phone, validate_taiwanese_phone_optional
from api.responses import (
    PatientResponse, PatientCreateResponse, PatientListResponse,
    AppointmentTypeResponse, AppointmentTypeListResponse,
    PractitionerResponse, PractitionerListResponse,
    AvailabilityResponse, AvailabilitySlot,
    AppointmentResponse, AppointmentListResponse, AppointmentListItem
)
from auth.dependencies import get_current_line_user_with_clinic

# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class LiffLoginRequest(BaseModel):
    """Request model for LIFF authentication."""
    line_user_id: str
    display_name: str
    liff_access_token: str
    clinic_id: int  # From URL parameter (?clinic_id=123)


class LiffLoginResponse(BaseModel):
    """Response model for LIFF authentication."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int = 604800  # 7 days
    is_first_time: bool
    display_name: str
    clinic_id: int


class PatientCreateRequest(BaseModel):
    """Request model for creating patient."""
    full_name: str
    phone_number: str

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('姓名不能為空')
        if len(v) > 255:
            raise ValueError('姓名長度過長')
        # Basic XSS prevention
        if '<' in v or '>' in v:
            raise ValueError('姓名包含無效字元')
        return v

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return validate_taiwanese_phone(v)


class PatientUpdateRequest(BaseModel):
    """Request model for updating patient."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError('姓名不能為空')
        if len(v) > 255:
            raise ValueError('姓名長度過長')
        # Basic XSS prevention
        if '<' in v or '>' in v:
            raise ValueError('姓名包含無效字元')
        return v

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        return validate_taiwanese_phone_optional(v)

    @model_validator(mode='after')
    def validate_at_least_one_field(self):
        """Ensure at least one field is provided for update."""
        if self.full_name is None and self.phone_number is None:
            raise ValueError('至少需提供一個欄位進行更新')
        return self




def parse_datetime(v: str | datetime) -> datetime:
    """Parse datetime from string or return datetime object.
    
    Expects Taiwan time (Asia/Taipei, UTC+8) with timezone indicator.
    If no timezone provided, assumes Taiwan time.
    """
    if isinstance(v, str):
        # Parse ISO format datetime string
        try:
            # Parse the datetime string
            dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
            
            # If it has timezone info, convert to Taiwan time
            if dt.tzinfo:
                taiwan_tz = timezone(timedelta(hours=8))
                return dt.astimezone(taiwan_tz)
            else:
                # No timezone, assume Taiwan time
                taiwan_tz = timezone(timedelta(hours=8))
                return dt.replace(tzinfo=taiwan_tz)
        except ValueError:
            # Fallback: parse and assume Taiwan time
            dt = datetime.fromisoformat(v)
            taiwan_tz = timezone(timedelta(hours=8))
            return dt.replace(tzinfo=taiwan_tz)
    return v


class AppointmentCreateRequest(BaseModel):
    """Request model for creating appointment."""
    model_config = {
        "json_encoders": {
            datetime: lambda v: v.isoformat()
        }
    }

    patient_id: int
    appointment_type_id: int
    practitioner_id: Optional[int] = None  # null for "不指定"
    start_time: datetime
    notes: Optional[str] = None

    @field_validator('notes')
    @classmethod
    def validate_notes(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 500:
            raise ValueError('備註過長（最多 500 字元）')
        # Basic XSS prevention
        if v and ('<' in v or '>' in v):
            raise ValueError('備註包含無效字元')
        return v

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation."""
        if 'start_time' in values:
            if isinstance(values['start_time'], str):
                values['start_time'] = parse_datetime(values['start_time'])
        return values

    @field_validator('start_time')
    @classmethod
    def validate_time(cls, v: datetime) -> datetime:
        # Use Taiwan time for all validations
        taiwan_tz = timezone(timedelta(hours=8))
        now = datetime.now(taiwan_tz)
        # Ensure v is timezone-aware in Taiwan timezone
        if v.tzinfo is None:
            # If naive, assume it's in Taiwan time
            v = v.replace(tzinfo=taiwan_tz)
        else:
            # Convert to Taiwan timezone for comparison
            v = v.astimezone(taiwan_tz)
        # Must be in future
        if v < now:
            raise ValueError('無法預約過去的時間')
        # Must be within 90 days
        if v > now + timedelta(days=90):
            raise ValueError('最多只能預約 90 天內的時段')
        return v




# ===== Helper Functions =====




# ===== API Endpoints =====

@router.post("/auth/liff-login", response_model=LiffLoginResponse)
async def liff_login(
    request: LiffLoginRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate LIFF user and create/update LINE user record.

    This endpoint is called after LIFF authentication succeeds.
    Clinic context comes from URL parameter (?clinic_id=123).
    It creates/updates the LINE user record and determines if this
    is a first-time user for the clinic.
    """
    try:
        # Get or create LINE user
        line_user = db.query(LineUser).filter_by(
            line_user_id=request.line_user_id
        ).first()

        if not line_user:
            line_user = LineUser(
                line_user_id=request.line_user_id,
                display_name=request.display_name
            )
            db.add(line_user)
            db.commit()
            db.refresh(line_user)
        else:
            # Update display name if changed
            if line_user.display_name != request.display_name:
                line_user.display_name = request.display_name
                db.commit()

        # Validate clinic exists and is active
        clinic = db.query(Clinic).filter(
            Clinic.id == request.clinic_id,
            Clinic.is_active == True
        ).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在或已停用"
            )

        # Check if patient exists for this clinic
        patient = db.query(Patient).filter_by(
            line_user_id=line_user.id,
            clinic_id=clinic.id
        ).first()

        is_first_time = patient is None

        # Generate JWT with LINE user context
        now = datetime.now(timezone.utc)
        token_payload = {
            "line_user_id": line_user.line_user_id,
            "clinic_id": clinic.id,
            "exp": now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
            "iat": now
        }
        access_token = jwt.encode(token_payload, JWT_SECRET_KEY, algorithm="HS256")

        return LiffLoginResponse(
            access_token=access_token,
            is_first_time=is_first_time,
            display_name=request.display_name,
            clinic_id=clinic.id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"LIFF login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="認證失敗"
        )


@router.post("/patients", response_model=PatientCreateResponse)
async def create_patient(
    request: PatientCreateRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Create a patient record for a LINE user at a clinic.

    This is called during registration after LIFF authentication.
    Users can create multiple patients (family members).
    Clinic context comes from LIFF token for proper isolation.
    """
    line_user, clinic = line_user_clinic

    try:
        patient = PatientService.create_patient(
            db=db,
            clinic_id=clinic.id,
            full_name=request.full_name,
            phone_number=request.phone_number,
            line_user_id=line_user.id
        )

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Patient creation error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立病患失敗"
        )


@router.get("/patients", response_model=PatientListResponse)
async def list_patients(
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    List all patients associated with the LINE user for the current clinic.

    Returns patients sorted by creation time (oldest first).
    Clinic isolation is enforced through LIFF token context.
    """
    line_user, clinic = line_user_clinic

    try:
        # Get patients using service
        patients = PatientService.list_patients_for_line_user(
            db=db,
            line_user_id=line_user.id,
            clinic_id=clinic.id
        )

        return PatientListResponse(
            patients=[
                PatientResponse(
                    id=p.id,
                    full_name=p.full_name,
                    phone_number=p.phone_number,
                    created_at=p.created_at
                ) for p in patients
            ]
        )

    except HTTPException:
        raise


@router.put("/patients/{patient_id}", response_model=PatientCreateResponse)
async def update_patient(
    patient_id: int,
    request: PatientUpdateRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Update a patient record for a LINE user.

    Allows updating patient name and/or phone number.
    Clinic isolation is enforced through LIFF token context.
    """
    line_user, clinic = line_user_clinic

    try:
        patient = PatientService.update_patient_for_line_user(
            db=db,
            patient_id=patient_id,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            full_name=request.full_name,
            phone_number=request.phone_number
        )

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Patient update error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新病患失敗"
        )


@router.delete("/patients/{patient_id}")
async def delete_patient(
    patient_id: int,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Delete a patient record.

    Prevents deletion if this is the last patient or if there are future appointments.
    Clinic isolation is enforced through LIFF token context.
    """
    line_user, clinic = line_user_clinic

    try:
        # Delete patient using service
        PatientService.delete_patient_for_line_user(
            db=db,
            patient_id=patient_id,
            line_user_id=line_user.id,
            clinic_id=clinic.id
        )

        return {"success": True, "message": "已移除病患"}

    except HTTPException:
        raise


@router.get("/appointment-types", response_model=AppointmentTypeListResponse)
async def list_appointment_types(
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    List all appointment types available at the clinic.
    Clinic context comes from LIFF token for proper isolation.
    """
    _, clinic = line_user_clinic

    try:
        # Get appointment types for clinic
        appointment_types = AppointmentTypeService.list_appointment_types_for_clinic(
            db, clinic.id
        )

        return AppointmentTypeListResponse(
            appointment_types=[
                AppointmentTypeResponse(
                    id=at.id,
                    clinic_id=at.clinic_id,
                    name=at.name,
                    duration_minutes=at.duration_minutes
                ) for at in appointment_types
            ]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Appointment types list error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預約類型"
        )


@router.get("/practitioners", response_model=PractitionerListResponse)
async def list_practitioners(
    appointment_type_id: Optional[int] = Query(None),
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    List practitioners who can offer the specified appointment type.

    If no appointment_type_id provided, returns all practitioners.
    Clinic isolation is enforced through LIFF token context.
    """
    _, clinic = line_user_clinic

    try:
        # Get practitioners using service
        practitioners_data = PractitionerService.list_practitioners_for_clinic(
            db=db,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type_id
        )

        # Convert dicts to response objects
        practitioners = [
            PractitionerResponse(**practitioner)
            for practitioner in practitioners_data
        ]

        return PractitionerListResponse(practitioners=practitioners)

    except HTTPException:
        raise


@router.get("/availability", response_model=AvailabilityResponse)
async def get_availability(
    date: str,
    appointment_type_id: int,
    practitioner_id: Optional[int] = Query(None),
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Get available time slots for booking.

    Returns time slots where appointments can be booked for the given date,
    appointment type, and optional practitioner.

    Clinic isolation is enforced through LIFF token context.
    Performance: Results are cached for 10 minutes to handle frequent queries.
    """
    _, clinic = line_user_clinic

    try:
        if practitioner_id:
            # Specific practitioner requested
            slots_data = AvailabilityService.get_available_slots_for_practitioner(
                db=db,
                practitioner_id=practitioner_id,
                date=date,
                appointment_type_id=appointment_type_id,
                clinic_id=clinic.id
            )
        else:
            # All practitioners in clinic
            slots_data = AvailabilityService.get_available_slots_for_clinic(
            db=db,
                clinic_id=clinic.id,
            date=date,
                appointment_type_id=appointment_type_id
        )

        # Convert dicts to response objects
        slots = [
            AvailabilitySlot(**slot)
            for slot in slots_data
        ]

        return AvailabilityResponse(date=date, slots=slots)

    except HTTPException:
        raise


@router.post("/appointments", response_model=AppointmentResponse)
async def create_appointment(
    request: AppointmentCreateRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Create a new appointment booking.

    Handles the complex booking logic including practitioner assignment,
    availability checking, and Google Calendar synchronization.
    Clinic isolation is enforced through LIFF token context.
    """
    line_user, clinic = line_user_clinic

    try:
        # Create appointment using service
        appointment_data = AppointmentService.create_appointment(
            db=db,
            clinic_id=clinic.id,
            patient_id=request.patient_id,
            appointment_type_id=request.appointment_type_id,
            start_time=request.start_time,
            practitioner_id=request.practitioner_id,
            notes=request.notes,
            line_user_id=line_user.id
        )

        return AppointmentResponse(**appointment_data)

    except HTTPException:
        raise


@router.get("/appointments", response_model=AppointmentListResponse)
async def list_appointments(
    upcoming_only: bool = Query(True),
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    List all appointments for the LINE user's patients at this clinic.
    Clinic isolation is enforced through LIFF token context.
    """
    line_user, clinic = line_user_clinic

    try:
        # Get appointments using service
        appointments_data = AppointmentService.list_appointments_for_line_user(
            db=db,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            upcoming_only=upcoming_only
        )

        # Convert dicts to response objects
        appointments = [
            AppointmentListItem(**appointment)
            for appointment in appointments_data
        ]

        return AppointmentListResponse(appointments=appointments)

    except HTTPException:
        raise


@router.delete("/appointments/{appointment_id}")
async def cancel_appointment(
    appointment_id: int,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Cancel an appointment.

    Verifies ownership and updates appointment status.
    Clinic isolation is enforced through LIFF token context.
    Google Calendar event deletion handled asynchronously.
    """
    line_user, clinic = line_user_clinic

    try:
        # Cancel appointment using service
        result = AppointmentService.cancel_appointment_by_patient(
            db=db,
            appointment_id=appointment_id,
            line_user_id=line_user.id,
            clinic_id=clinic.id
        )

        return result

    except HTTPException:
        raise
