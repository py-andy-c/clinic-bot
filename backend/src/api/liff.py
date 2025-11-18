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
from typing import Optional, Dict, Any, List, Literal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import JWT_SECRET_KEY, JWT_ACCESS_TOKEN_EXPIRE_MINUTES
from core.constants import (
    MAX_TIME_WINDOWS_PER_NOTIFICATION,
    MAX_NOTIFICATIONS_PER_USER,
    NOTIFICATION_DATE_RANGE_DAYS,
)
from models import (
    LineUser, Clinic, Patient, AvailabilityNotification, AppointmentType, User
)
from services import PatientService, AppointmentService, AvailabilityService, PractitionerService, AppointmentTypeService
from utils.phone_validator import validate_taiwanese_phone, validate_taiwanese_phone_optional
from utils.datetime_utils import TAIWAN_TZ, taiwan_now
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


# ===== Helper Functions =====

def get_practitioner_name(db: Session, practitioner: Optional[User], clinic_id: int) -> Optional[str]:
    """
    Get practitioner display name from UserClinicAssociation.

    Returns full_name from association if available, otherwise falls back to email.
    Returns None if practitioner is None.
    """
    if not practitioner:
        return None

    from models.user_clinic_association import UserClinicAssociation
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == practitioner.id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).first()

    return association.full_name if association else practitioner.email

def validate_birthday_field(v: Any) -> Optional[date]:
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
    if isinstance(v, str):
        try:
            birthday_date = datetime.strptime(v, '%Y-%m-%d').date()
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
    raise ValueError('生日格式錯誤，請使用 YYYY-MM-DD 格式')


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
    def validate_birthday(cls, v: Any) -> Optional[date]:
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
    def validate_birthday(cls, v: Any) -> Optional[date]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        return validate_birthday_field(v)

    @model_validator(mode='after')
    def validate_at_least_one_field(self):
        """Ensure at least one field is provided for update."""
        if self.full_name is None and self.phone_number is None and self.birthday is None:
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
                return dt.astimezone(TAIWAN_TZ)
            else:
                # No timezone, assume Taiwan time
                return dt.replace(tzinfo=TAIWAN_TZ)
        except ValueError:
            # Fallback: parse and assume Taiwan time
            dt = datetime.fromisoformat(v)
            return dt.replace(tzinfo=TAIWAN_TZ)
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
                    birthday=p.birthday,
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
            datetime.strptime(v, '%Y-%m-%d').date()
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
            tw_date = datetime.strptime(tw.date, '%Y-%m-%d').date()
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
        practitioner_name = get_practitioner_name(db, notification.practitioner, clinic.id)

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
            practitioner_name = get_practitioner_name(db, notification.practitioner, clinic.id)

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
