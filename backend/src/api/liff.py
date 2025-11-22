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
from datetime import datetime, timedelta, timezone, date
from typing import Optional, Dict, Any, List, Literal, Union

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.config import JWT_SECRET_KEY, JWT_ACCESS_TOKEN_EXPIRE_MINUTES
from core.constants import (
    MAX_TIME_WINDOWS_PER_NOTIFICATION,
    MAX_NOTIFICATIONS_PER_USER,
    NOTIFICATION_DATE_RANGE_DAYS,
)
from models import (
    LineUser, Clinic, Patient, AvailabilityNotification, AppointmentType, User, Appointment, CalendarEvent
)
from services import PatientService, AppointmentService, AvailabilityService, PractitionerService, AppointmentTypeService
from utils.phone_validator import validate_taiwanese_phone, validate_taiwanese_phone_optional
from utils.datetime_utils import TAIWAN_TZ, taiwan_now, parse_datetime_to_taiwan, parse_date_string
from utils.practitioner_helpers import get_practitioner_display_name
from utils.liff_token import generate_liff_access_token, validate_token_format
from api.responses import (
    PatientResponse, PatientCreateResponse, PatientListResponse,
    AppointmentTypeResponse, AppointmentTypeListResponse,
    PractitionerResponse, PractitionerListResponse,
    AvailabilityResponse, AvailabilitySlot,
    AppointmentResponse, AppointmentListResponse, AppointmentListItem
)
from auth.dependencies import get_current_line_user_with_clinic, get_current_line_user

# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Helper Functions =====

# get_practitioner_name removed - use get_practitioner_display_name from utils.practitioner_helpers instead

def validate_birthday_field(v: Union[str, date, None]) -> Optional[date]:
    """
    Validate birthday format (YYYY-MM-DD) and reasonable range.

    Validates that:
    - Date is not in the future
    - Date is not unreasonably old (> 150 years, approximate)

    Note: The 150-year check uses days (150 * 365) as an approximation.
    For exact calendar years accounting for leap years, consider using
    dateutil.relativedelta, but the current approach is simpler and sufficient.
    """
    if v is None:
        return None
    if isinstance(v, date):
        # Already a date object, just validate range
        today = taiwan_now().date()
        if v > today:
            raise ValueError('生日不能是未來日期')
        # Approximate 150 years check (doesn't account for leap years, but sufficient)
        if (today - v).days > 150 * 365:
            raise ValueError('生日日期不合理')
        return v
    # v is str at this point (Union[str, date, None] with None and date already handled)
    try:
        birthday_date = parse_date_string(v)
        # Validate reasonable range: not in the future, not too old (e.g., > 150 years)
        today = taiwan_now().date()
        if birthday_date > today:
            raise ValueError('生日不能是未來日期')
        # Approximate 150 years check (doesn't account for leap years, but sufficient)
        if (today - birthday_date).days > 150 * 365:
            raise ValueError('生日日期不合理')
        return birthday_date
    except ValueError as e:
        if '生日' in str(e) or '日期' in str(e):
            raise
        raise ValueError('生日格式錯誤，請使用 YYYY-MM-DD 格式')


# ===== Request/Response Models =====

class LiffLoginRequest(BaseModel):
    """Request model for LIFF authentication."""
    line_user_id: str
    display_name: str
    liff_access_token: str
    clinic_token: Optional[str] = None  # New preferred method (secure token)
    clinic_id: Optional[int] = None     # Deprecated, for backward compatibility

    @model_validator(mode='after')
    def validate_clinic_identifier(self):
        """Ensure either clinic_token or clinic_id is provided, but not both."""
        if not self.clinic_token and not self.clinic_id:
            raise ValueError("Either clinic_token or clinic_id required")
        if self.clinic_token and self.clinic_id:
            raise ValueError("Provide either clinic_token or clinic_id, not both")
        return self


class LiffLoginResponse(BaseModel):
    """Response model for LIFF authentication."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int = 604800  # 7 days
    is_first_time: bool
    display_name: str
    clinic_id: int
    preferred_language: Optional[str] = 'zh-TW'  # User's preferred language, defaults to Traditional Chinese


class LanguagePreferenceRequest(BaseModel):
    """Request model for updating language preference."""
    language: str
    
    @field_validator('language')
    @classmethod
    def validate_language(cls, v: str) -> str:
        if v not in ['zh-TW', 'en']:
            raise ValueError("Invalid language code. Must be 'zh-TW' or 'en'")
        return v


class LanguagePreferenceResponse(BaseModel):
    """Response model for language preference update."""
    preferred_language: str


class PatientCreateRequest(BaseModel):
    """Request model for creating patient."""
    full_name: str
    phone_number: str
    birthday: Optional[date] = None

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

    @field_validator('birthday', mode='before')
    @classmethod
    def validate_birthday(cls, v: Union[str, date, None]) -> Optional[date]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        return validate_birthday_field(v)


class PatientUpdateRequest(BaseModel):
    """Request model for updating patient."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    birthday: Optional[date] = None

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

    @field_validator('birthday', mode='before')
    @classmethod
    def validate_birthday(cls, v: Union[str, date, None]) -> Optional[date]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        return validate_birthday_field(v)

    @model_validator(mode='after')
    def validate_at_least_one_field(self):
        """Ensure at least one field is provided for update."""
        if self.full_name is None and self.phone_number is None and self.birthday is None:
            raise ValueError('至少需提供一個欄位進行更新')
        return self




# parse_datetime removed - use parse_datetime_to_taiwan from utils.datetime_utils instead


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
                values['start_time'] = parse_datetime_to_taiwan(values['start_time'])
        return values

    @field_validator('start_time')
    @classmethod
    def validate_time(cls, v: datetime) -> datetime:
        # Use Taiwan time for all validations
        now = taiwan_now()
        # Ensure v is timezone-aware in Taiwan timezone
        if v.tzinfo is None:
            # If naive, assume it's in Taiwan time
            v = v.replace(tzinfo=TAIWAN_TZ)
        else:
            # Convert to Taiwan timezone for comparison
            v = v.astimezone(TAIWAN_TZ)
        # Must be in future
        if v < now:
            raise ValueError('無法預約過去的時間')
        # System-wide maximum: 365 days (clinic-specific limit is checked in service layer)
        if v > now + timedelta(days=365):
            raise ValueError('最多只能預約 365 天內的時段')
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
    Clinic context comes from URL parameter (?clinic_token=... or ?clinic_id=123).
    It creates/updates the LINE user record and determines if this
    is a first-time user for the clinic.

    Supports both clinic_token (preferred, secure) and clinic_id (deprecated, backward compatibility).
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

        # Look up clinic by token or ID (with backward compatibility)
        clinic = None

        if request.clinic_token:
            # Validate token format first
            if not validate_token_format(request.clinic_token):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid token format"
                )

            clinic = db.query(Clinic).filter(
                Clinic.liff_access_token == request.clinic_token,
                Clinic.is_active == True
            ).first()

            if not clinic:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="診所不存在或已停用"
                )

        elif request.clinic_id:  # Backward compatibility
            logger.warning(f"Deprecated clinic_id parameter used: {request.clinic_id}")
            clinic = db.query(Clinic).filter(
                Clinic.id == request.clinic_id,
                Clinic.is_active == True
            ).first()

            if not clinic:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="診所不存在或已停用"
                )

            # Auto-generate token if missing (with race condition protection)
            # This is acceptable here because it's part of the authentication flow,
            # not a read-only endpoint. The generate_liff_access_token function
            # uses database locking to prevent race conditions.
            if clinic and not clinic.liff_access_token:
                clinic.liff_access_token = generate_liff_access_token(db, clinic.id)
                # Note: generate_liff_access_token already commits, but we refresh to ensure consistency
                db.refresh(clinic)
                logger.info(f"Auto-generated token for clinic {clinic.id} during LIFF login")
        else:
            # This should not happen due to model validation, but defensive check
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either clinic_token or clinic_id required"
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

        # Get user's preferred language (default to 'zh-TW' if not set)
        preferred_language = line_user.preferred_language or 'zh-TW'

        return LiffLoginResponse(
            access_token=access_token,
            is_first_time=is_first_time,
            display_name=request.display_name,
            clinic_id=clinic.id,
            preferred_language=preferred_language
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"LIFF login error: {e}")
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
        # Check if clinic requires birthday
        clinic_settings = clinic.get_validated_settings()
        require_birthday = clinic_settings.clinic_info_settings.require_birthday

        # Validate birthday is provided if required
        if require_birthday and not request.birthday:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="此診所要求填寫生日"
            )

        patient = PatientService.create_patient(
            db=db,
            clinic_id=clinic.id,
            full_name=request.full_name,
            phone_number=request.phone_number,
            line_user_id=line_user.id,
            birthday=request.birthday
        )

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Patient creation error: {e}")
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
    Includes future appointment count and limit information for appointment booking validation.
    """
    line_user, clinic = line_user_clinic

    try:
        # Get patients using service
        patients = PatientService.list_patients_for_line_user(
            db=db,
            line_user_id=line_user.id,
            clinic_id=clinic.id
        )

        # Get clinic settings for max_future_appointments
        settings = clinic.get_validated_settings()
        booking_settings = settings.booking_restriction_settings
        max_future_appointments = booking_settings.max_future_appointments

        # Count future appointments for each patient
        # Note: This uses N+1 queries, but is acceptable since LIFF users typically have 1-5 patients.
        # If performance becomes an issue with many patients, consider optimizing with a bulk query.
        from utils.appointment_queries import count_future_appointments_for_patient
        patient_responses: List[PatientResponse] = []
        for p in patients:
            future_count = count_future_appointments_for_patient(
                db, p.id, status="confirmed"
            )
            patient_responses.append(
                PatientResponse(
                    id=p.id,
                    full_name=p.full_name,
                    phone_number=p.phone_number,
                    birthday=p.birthday,
                    created_at=p.created_at,
                    future_appointments_count=future_count,
                    max_future_appointments=max_future_appointments
                )
            )

        return PatientListResponse(patients=patient_responses)

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

    Allows updating patient name, phone number, and/or birthday.
    Clinic isolation is enforced through LIFF token context.

    Note: The `require_birthday` clinic setting does NOT apply to updates.
    This allows existing patients without birthdays to be updated even after
    the clinic enables the requirement. Birthday can be added via update
    when convenient, but is not enforced on updates.
    """
    line_user, clinic = line_user_clinic

    try:
        patient = PatientService.update_patient_for_line_user(
            db=db,
            patient_id=patient_id,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            full_name=request.full_name,
            phone_number=request.phone_number,
            birthday=request.birthday
        )

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Patient update error: {e}")
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
        # Get appointment types available for booking (only those with active practitioners)
        appointment_types = AppointmentTypeService.list_appointment_types_for_booking(
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
            ],
            appointment_type_instructions=clinic.appointment_type_instructions
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Appointment types list error: {e}")
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
    exclude_calendar_event_id: Optional[int] = Query(None, description="Calendar event ID to exclude from conflict checking (for appointment editing)"),
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
            # Apply booking restrictions for patient-facing LIFF endpoint
            slots_data = AvailabilityService.get_available_slots_for_practitioner(
                db=db,
                practitioner_id=practitioner_id,
                date=date,
                appointment_type_id=appointment_type_id,
                clinic_id=clinic.id,
                exclude_calendar_event_id=exclude_calendar_event_id,
                apply_booking_restrictions=True  # Patients must follow booking restrictions
            )
        else:
            # All practitioners in clinic
            # Apply booking restrictions for patient-facing LIFF endpoint
            slots_data = AvailabilityService.get_available_slots_for_clinic(
                db=db,
                clinic_id=clinic.id,
                date=date,
                appointment_type_id=appointment_type_id,
                apply_booking_restrictions=True  # Patients must follow booking restrictions
            )

        # Convert dicts to response objects
        slots = [
            AvailabilitySlot(**slot)
            for slot in slots_data
        ]

        return AvailabilityResponse(date=date, slots=slots)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Unexpected error in availability endpoint: date={date}, "
            f"appointment_type_id={appointment_type_id}, practitioner_id={practitioner_id}, "
            f"clinic_id={clinic.id}, error={e}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時間"
        )


# Batch availability request/response models
class BatchAvailabilityRequest(BaseModel):
    """Request model for batch availability query."""
    dates: List[str]  # List of dates in YYYY-MM-DD format
    appointment_type_id: int
    practitioner_id: Optional[int] = None
    exclude_calendar_event_id: Optional[int] = None


class BatchAvailabilityResponse(BaseModel):
    """Response model for batch availability query."""
    results: List[AvailabilityResponse]  # One response per date


@router.post("/availability/batch", response_model=BatchAvailabilityResponse)
async def get_availability_batch(
    request: BatchAvailabilityRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Get available time slots for multiple dates in a single request.

    This endpoint efficiently fetches availability for multiple dates,
    reducing API calls from N to 1.

    Clinic isolation is enforced through LIFF token context.
    
    Args:
        request: Batch availability request with dates, appointment_type_id, and optional practitioner_id
        
    Returns:
        BatchAvailabilityResponse with one AvailabilityResponse per date
        
    Raises:
        HTTPException: If validation fails or dates are invalid
    """
    _, clinic = line_user_clinic

    try:
        # Use shared service method for batch availability fetching
        # Apply booking restrictions for patient-facing LIFF endpoint
        batch_results = AvailabilityService.get_batch_available_slots_for_clinic(
            db=db,
            clinic_id=clinic.id,
            dates=request.dates,
            appointment_type_id=request.appointment_type_id,
            practitioner_id=request.practitioner_id,
            exclude_calendar_event_id=request.exclude_calendar_event_id,
            apply_booking_restrictions=True  # Patients must follow booking restrictions
        )
        
        # Convert to response format
        results: List[AvailabilityResponse] = []
        for result in batch_results:
            # Convert dicts to response objects
            slots = [
                AvailabilitySlot(**slot)
                for slot in result['slots']
            ]
            results.append(AvailabilityResponse(date=result['date'], slots=slots))

        return BatchAvailabilityResponse(results=results)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Unexpected error in batch availability endpoint: "
            f"dates={request.dates}, appointment_type_id={request.appointment_type_id}, "
            f"practitioner_id={request.practitioner_id}, clinic_id={clinic.id}, error={e}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時間"
        )


@router.post("/appointments", response_model=AppointmentResponse)
async def create_appointment(
    request: AppointmentCreateRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Create a new appointment booking.

    Handles the complex booking logic including practitioner assignment
    and availability checking.
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


@router.get("/appointments/{appointment_id}/details")
async def get_appointment_details(
    appointment_id: int,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Get appointment details for rescheduling.

    Returns appointment information including practitioner_id and appointment_type_id
    needed for the reschedule flow.
    Clinic isolation is enforced through LIFF token context.
    
    Note: The `appointment_id` parameter is actually the calendar_event_id.
    This is consistent with other endpoints that use calendar_event_id as the identifier.
    """
    line_user, clinic = line_user_clinic

    try:
        # Get appointment with relationships
        # Note: appointment_id parameter is actually calendar_event_id (see docstring above)
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        # Validate appointment belongs to patient (via line_user_id)
        if appointment.patient.line_user_id != line_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限查看此預約"
            )

        # Validate appointment belongs to clinic
        if appointment.patient.clinic_id != clinic.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="此預約不屬於此診所"
            )

        calendar_event = appointment.calendar_event
        if not calendar_event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到預約事件"
            )

        # Format datetime
        event_date = calendar_event.date
        if calendar_event.start_time:
            start_datetime = datetime.combine(event_date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
        else:
            start_datetime = None
        if calendar_event.end_time:
            end_datetime = datetime.combine(event_date, calendar_event.end_time).replace(tzinfo=TAIWAN_TZ)
        else:
            end_datetime = None

        # Get practitioner name from association
        # For auto-assigned appointments, return "不指定" instead of actual practitioner name
        from utils.practitioner_helpers import get_practitioner_display_name_for_appointment
        practitioner_name = get_practitioner_display_name_for_appointment(
            db, appointment, clinic.id
        )

        return {
            "id": appointment.calendar_event_id,
            "calendar_event_id": appointment.calendar_event_id,
            "patient_id": appointment.patient_id,
            "patient_name": appointment.patient.full_name,
            "practitioner_id": calendar_event.user_id,
            "practitioner_name": practitioner_name,
            "appointment_type_id": appointment.appointment_type_id,
            "appointment_type_name": appointment.appointment_type.name if appointment.appointment_type else "未知",
            "start_time": start_datetime.isoformat() if start_datetime else "",
            "end_time": end_datetime.isoformat() if end_datetime else "",
            "status": appointment.status,
            "notes": appointment.notes,
            "is_auto_assigned": appointment.is_auto_assigned
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting appointment details: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預約詳情"
        )


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
    """
    # Permission validation is handled by get_current_line_user_with_clinic dependency
    # which ensures the LINE user is authenticated and belongs to the clinic
    _line_user, _clinic = line_user_clinic

    try:
        # Cancel appointment using service
        result = AppointmentService.cancel_appointment(
            db=db,
            appointment_id=appointment_id,
            cancelled_by='patient'
        )

        return result

    except HTTPException:
        raise


class RescheduleAppointmentRequest(BaseModel):
    """Request model for rescheduling an appointment."""
    new_practitioner_id: Optional[int] = None  # None = keep current, -1 = auto-assign (不指定)
    new_start_time: str  # ISO datetime string
    new_notes: Optional[str] = None  # None = keep current

    @field_validator('new_start_time')
    @classmethod
    def validate_start_time(cls, v: str) -> str:
        """Validate start time format."""
        try:
            parse_datetime_to_taiwan(v)
        except ValueError:
            raise ValueError('時間格式錯誤，請使用 ISO 格式')
        return v


@router.post("/appointments/{appointment_id}/reschedule")
async def reschedule_appointment(
    appointment_id: int,
    request: RescheduleAppointmentRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
):
    """
    Reschedule an appointment.

    Allows patients to change the time and/or practitioner of their appointment.
    Verifies ownership and validates booking restrictions.
    Clinic isolation is enforced through LIFF token context.
    """
    line_user, _clinic = line_user_clinic

    try:
        # Parse start time
        new_start_time = parse_datetime_to_taiwan(request.new_start_time)

        # Validate appointment belongs to patient (authorization check)
        # Query with eager loading to avoid duplicate query in service
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        if appointment.patient.line_user_id != line_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限改期此預約"
            )

        # Reschedule appointment using service
        # Pass pre-fetched appointment to avoid duplicate query (already fetched for authorization check)
        result = AppointmentService.update_appointment(
            db=db,
            appointment_id=appointment_id,
            new_practitioner_id=request.new_practitioner_id,
            new_start_time=new_start_time,
            new_notes=request.new_notes,
            apply_booking_constraints=True,  # Patients must adhere to booking constraints
            allow_auto_assignment=True,  # Patients can request auto-assignment
            reassigned_by_user_id=None,  # Patient reschedule, not clinic user
            notification_note=None,  # No custom note for patient reschedule
            success_message='預約已改期',
            appointment=appointment  # Pass pre-fetched appointment to avoid duplicate query
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Reschedule appointment error: {e}")
        # Note: Service layer handles its own transaction management
        # If the service already committed, rollback won't help
        # If the service didn't commit, rollback is unnecessary
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="改期失敗"
        )


@router.get("/clinic-info", summary="Get clinic information for LIFF app")
async def get_clinic_info(
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
) -> Dict[str, Any]:
    """
    Get clinic information including display name, address, and phone number.

    Used by LIFF app to populate calendar events with clinic information.
    """
    try:
        _, clinic = line_user_clinic
        clinic_settings = clinic.get_validated_settings()

        return {
            "clinic_id": clinic.id,
            "clinic_name": clinic.name,
            "display_name": clinic.effective_display_name,
            "address": clinic.address,
            "phone_number": clinic.phone_number,
            "require_birthday": clinic_settings.clinic_info_settings.require_birthday,
            "minimum_cancellation_hours_before": clinic_settings.booking_restriction_settings.minimum_cancellation_hours_before,
            "appointment_notes_instructions": clinic_settings.clinic_info_settings.appointment_notes_instructions,
        }

    except Exception as e:
        logger.exception(f"Error getting clinic info: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得診所資訊"
        )


# ===== Availability Notification Models =====

class TimeWindowEntry(BaseModel):
    """Single time window entry."""
    date: str  # YYYY-MM-DD format
    time_window: Literal["morning", "afternoon", "evening"]

    @field_validator('date')
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        """Validate date format."""
        try:
            parse_date_string(v)
        except ValueError:
            raise ValueError('日期格式錯誤，請使用 YYYY-MM-DD 格式')
        return v


class AvailabilityNotificationCreateRequest(BaseModel):
    """Request model for creating availability notification."""
    appointment_type_id: int
    practitioner_id: Optional[int] = None  # null for "不指定"
    time_windows: List[TimeWindowEntry]

    @field_validator('time_windows')
    @classmethod
    def validate_time_windows(cls, v: List[TimeWindowEntry]) -> List[TimeWindowEntry]:
        """Validate time windows."""
        if len(v) > MAX_TIME_WINDOWS_PER_NOTIFICATION:
            raise ValueError(f'最多只能設定{MAX_TIME_WINDOWS_PER_NOTIFICATION}個時段')
        if len(v) == 0:
            raise ValueError('至少需要設定1個時段')
        
        # Check for duplicate date+time_window combinations
        seen: set[tuple[str, str]] = set()
        for tw in v:
            key = (tw.date, tw.time_window)
            if key in seen:
                raise ValueError(f'重複的時段設定：{tw.date} {tw.time_window}')
            seen.add(key)
        
        # Validate dates are within 30 days
        today = taiwan_now().date()
        max_date = today + timedelta(days=NOTIFICATION_DATE_RANGE_DAYS)
        
        for tw in v:
            tw_date = parse_date_string(tw.date)
            if tw_date < today:
                raise ValueError(f'日期 {tw.date} 不能是過去日期')
            if tw_date > max_date:
                raise ValueError(f'日期 {tw.date} 不能超過{NOTIFICATION_DATE_RANGE_DAYS}天後')
        
        return v


class AvailabilityNotificationResponse(BaseModel):
    """Response model for single notification."""
    id: int
    appointment_type_id: int
    appointment_type_name: str
    practitioner_id: Optional[int]
    practitioner_name: Optional[str]  # "不指定" if None
    time_windows: List[Dict[str, str]]
    created_at: datetime
    min_date: str  # YYYY-MM-DD
    max_date: str  # YYYY-MM-DD


class AvailabilityNotificationListResponse(BaseModel):
    """Response model for notification list."""
    notifications: List[AvailabilityNotificationResponse]
    total: int
    page: int
    page_size: int


# ===== Availability Notification Endpoints =====

@router.post("/availability-notifications", response_model=AvailabilityNotificationResponse)
async def create_notification(
    request: AvailabilityNotificationCreateRequest,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
) -> AvailabilityNotificationResponse:
    """Create new availability notification."""
    line_user, clinic = line_user_clinic

    try:
        # Check user notification limit
        active_count = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.line_user_id == line_user.id,
            AvailabilityNotification.clinic_id == clinic.id,
            AvailabilityNotification.is_active == True
        ).count()

        if active_count >= MAX_NOTIFICATIONS_PER_USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"已達到提醒上限（{MAX_NOTIFICATIONS_PER_USER}個），請先刪除現有提醒"
            )

        # Validate appointment type exists
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == request.appointment_type_id,
            AppointmentType.clinic_id == clinic.id,
            AppointmentType.is_deleted == False
        ).first()

        if not appointment_type:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "預約類型不存在")

        # Validate practitioner if specified
        if request.practitioner_id:
            from models.user_clinic_association import UserClinicAssociation
            practitioner = db.query(User).join(UserClinicAssociation).filter(
                User.id == request.practitioner_id,
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()

            if not practitioner:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "治療師不存在")

        # Create notification (clinic_id from JWT token, not request)
        notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,  # From JWT token
            appointment_type_id=request.appointment_type_id,
            practitioner_id=request.practitioner_id,
            time_windows=[tw.model_dump() for tw in request.time_windows],
            is_active=True
        )

        db.add(notification)
        try:
            db.commit()
            db.refresh(notification)
        except Exception as e:
            db.rollback()
            raise

        # Calculate min/max dates from time_windows
        dates = [tw["date"] for tw in notification.time_windows]

        # Get practitioner name safely
        practitioner_name = get_practitioner_display_name(db, notification.practitioner.id, clinic.id) if notification.practitioner else None

        return AvailabilityNotificationResponse(
            id=notification.id,
            appointment_type_id=notification.appointment_type_id,
            appointment_type_name=appointment_type.name,
            practitioner_id=notification.practitioner_id,
            practitioner_name=practitioner_name,
            time_windows=notification.time_windows,
            created_at=notification.created_at,
            min_date=min(dates),
            max_date=max(dates)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error creating notification: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立提醒失敗"
        )


@router.get("/availability-notifications", response_model=AvailabilityNotificationListResponse)
async def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
) -> AvailabilityNotificationListResponse:
    """List all active notifications for LINE user."""
    line_user, clinic = line_user_clinic

    try:
        query = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.line_user_id == line_user.id,
            AvailabilityNotification.clinic_id == clinic.id,  # Clinic isolation
            AvailabilityNotification.is_active == True
        )

        total = query.count()
        notifications = query.order_by(
            AvailabilityNotification.created_at.desc()
        ).offset((page - 1) * page_size).limit(page_size).all()

        # Convert to response models
        notification_responses: List[AvailabilityNotificationResponse] = []
        for notification in notifications:
            dates = [tw["date"] for tw in notification.time_windows]

            # Get appointment type name safely
            appointment_type_name = "已刪除"
            if notification.appointment_type:
                appointment_type_name = notification.appointment_type.name

            # Get practitioner name safely
            practitioner_name = get_practitioner_display_name(db, notification.practitioner.id, clinic.id) if notification.practitioner else None

            notification_responses.append(
                AvailabilityNotificationResponse(
                    id=notification.id,
                    appointment_type_id=notification.appointment_type_id,
                    appointment_type_name=appointment_type_name,
                    practitioner_id=notification.practitioner_id,
                    practitioner_name=practitioner_name,
                    time_windows=notification.time_windows,
                    created_at=notification.created_at,
                    min_date=min(dates),
                    max_date=max(dates)
                )
            )

        return AvailabilityNotificationListResponse(
            notifications=notification_responses,
            total=total,
            page=page,
            page_size=page_size
        )

    except Exception as e:
        logger.exception(f"Error listing notifications: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="取得提醒列表失敗"
        )


@router.delete("/availability-notifications/{notification_id}")
async def delete_notification(
    notification_id: int,
    line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Delete notification (soft delete: set is_active=False)."""
    line_user, clinic = line_user_clinic

    try:
        notification = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.id == notification_id,
            AvailabilityNotification.clinic_id == clinic.id,  # Clinic isolation
            AvailabilityNotification.is_active == True
        ).first()

        if not notification:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "提醒不存在")

        # Authorization check: user must own the notification
        if notification.line_user_id != line_user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "無權限刪除此提醒")

        # Soft delete
        notification.is_active = False
        db.commit()

        return {"success": True, "message": "提醒已刪除"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error deleting notification: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="刪除提醒失敗"
        )


@router.put("/language-preference", response_model=LanguagePreferenceResponse)
async def update_language_preference(
    request: LanguagePreferenceRequest,
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
) -> LanguagePreferenceResponse:
    """
    Update LINE user's language preference.
    
    Note: get_current_line_user requires LineUser to exist (created during LIFF login).
    This endpoint is only accessible after successful login, so LineUser will always exist.
    """
    try:
        # Update LineUser record
        # Language code is already validated by Pydantic model
        line_user.preferred_language = request.language
        db.commit()
        # Note: No need to refresh - line_user is already attached to session
        return LanguagePreferenceResponse(preferred_language=request.language)
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to update language preference: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新語言偏好失敗"
        )
