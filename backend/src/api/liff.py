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
from typing import List, Optional, Dict, Any, cast

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import and_

from core.database import get_db
from core.config import JWT_SECRET_KEY
from models import (
    User, Patient, LineUser, Appointment, AppointmentType,
    Clinic, CalendarEvent, PractitionerAppointmentTypes
)
from auth.dependencies import get_current_line_user

# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class LiffLoginRequest(BaseModel):
    """Request model for LIFF authentication."""
    line_user_id: str
    display_name: str
    liff_access_token: str
    clinic_id: int  # For testing - in production this comes from LIFF app ID


class LiffLoginResponse(BaseModel):
    """Response model for LIFF authentication."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int = 604800  # 7 days
    is_first_time: bool
    display_name: str
    clinic_id: int


class PatientCreateRequest(BaseModel):
    """Request model for creating first patient."""
    full_name: str
    phone_number: Optional[str] = None

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('Name cannot be empty')
        if len(v) > 255:
            raise ValueError('Name too long')
        # Basic XSS prevention
        if '<' in v or '>' in v:
            raise ValueError('Invalid characters in name')
        return v

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.replace('-', '').replace(' ', '').replace('(', '').replace(')', '').replace('+', '').isdigit():
            raise ValueError('Invalid phone number format')
        return v


class PatientResponse(BaseModel):
    """Response model for patient information."""
    id: int
    full_name: str
    phone_number: Optional[str]
    created_at: datetime


class PatientCreateResponse(BaseModel):
    """Response model for patient creation."""
    patient_id: int
    full_name: str
    phone_number: Optional[str]
    created_at: datetime


class PatientListResponse(BaseModel):
    """Response model for listing patients."""
    patients: List[PatientResponse]


class AppointmentTypeResponse(BaseModel):
    """Response model for appointment type."""
    id: int
    name: str
    duration_minutes: int


class PractitionerResponse(BaseModel):
    """Response model for practitioner information."""
    id: int
    full_name: str
    offered_types: List[int]  # List of appointment_type_ids


class AvailabilitySlot(BaseModel):
    """Model for availability time slot."""
    start_time: str  # HH:MM format
    end_time: str    # HH:MM format
    practitioner_id: Optional[int]
    practitioner_name: Optional[str]


class AvailabilityResponse(BaseModel):
    """Response model for availability query."""
    date: str
    slots: List[AvailabilitySlot]


class AppointmentCreateRequest(BaseModel):
    """Request model for creating appointment."""
    patient_id: int
    appointment_type_id: int
    practitioner_id: Optional[int] = None  # null for "不指定"
    start_time: datetime
    notes: Optional[str] = None

    @field_validator('notes')
    @classmethod
    def validate_notes(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 500:
            raise ValueError('Notes too long (max 500 characters)')
        # Basic XSS prevention
        if v and ('<' in v or '>' in v):
            raise ValueError('Invalid characters in notes')
        return v

    @field_validator('start_time')
    @classmethod
    def validate_time(cls, v: datetime) -> datetime:
        from datetime import timezone
        now = datetime.now(timezone.utc)
        # Ensure v is timezone-aware for comparison
        if v.tzinfo is None:
            # If naive, assume it's in UTC
            v = v.replace(tzinfo=timezone.utc)
        else:
            # Convert to UTC for comparison
            v = v.astimezone(timezone.utc)
        # Must be in future
        if v < now:
            raise ValueError('Cannot book appointments in the past')
        # Must be within 90 days
        if v > now + timedelta(days=90):
            raise ValueError('Cannot book more than 90 days in advance')
        return v


class AppointmentResponse(BaseModel):
    """Response model for appointment information."""
    appointment_id: int
    calendar_event_id: int
    patient_name: str
    practitioner_name: str
    appointment_type_name: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str]


class AppointmentListResponse(BaseModel):
    """Response model for listing appointments."""
    appointments: List[Dict[str, Any]]


class AppointmentTypeListResponse(BaseModel):
    """Response model for listing appointment types."""
    appointment_types: List[AppointmentTypeResponse]


class PractitionerListResponse(BaseModel):
    """Response model for listing practitioners."""
    practitioners: List[PractitionerResponse]


# ===== Helper Functions =====

def get_clinic_from_liff_token(liff_access_token: str, db: Session) -> Clinic:
    """
    Extract clinic ID from LIFF access token.

    The LIFF access token contains a client_id field that maps to
    the clinic's line_liff_id.
    """
    # This is a simplified version - in production you'd verify the token
    # with LINE's API to extract the client_id
    # For now, we'll assume we have a way to map tokens to clinics

    # TODO: Implement proper LIFF token verification
    # For MVP, we'll use a simple approach
    raise NotImplementedError("LIFF token to clinic mapping not implemented yet")


def get_clinic_from_line_user(line_user: LineUser, db: Session) -> Clinic:
    """
    Determine clinic from LINE user's context.

    For MVP, we'll need to implement clinic detection logic.
    This could be based on:
    1. LIFF ID mapping (each clinic has unique LIFF app)
    2. Query parameter in LIFF URL
    3. First patient's clinic if they exist
    """
    # Check if LINE user has any patients
    patients = db.query(Patient).filter(
        Patient.line_user_id == line_user.id
    ).all()

    if patients:
        # All patients should be from same clinic for now
        clinic_ids = set(p.clinic_id for p in patients)
        if len(clinic_ids) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Multiple clinic associations not supported yet"
            )
        clinic = db.query(Clinic).get(clinic_ids.pop())
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
            )
        return clinic

    # For first-time users, we'll need clinic context from elsewhere
    # This is a placeholder - in real implementation, clinic would be
    # determined from LIFF app ID or URL parameters
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Clinic context required for first-time registration"
    )


def check_patient_ownership(patient_id: int, line_user: LineUser, clinic: Clinic, db: Session) -> Patient:
    """Verify patient belongs to LINE user and clinic."""
    patient = db.query(Patient).filter(
        Patient.id == patient_id,
        Patient.line_user_id == line_user.id,
        Patient.clinic_id == clinic.id
    ).first()

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient not found or access denied"
        )

    return patient


# ===== API Endpoints =====

@router.post("/auth/liff-login", response_model=LiffLoginResponse)
async def liff_login(
    request: LiffLoginRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate LIFF user and create/update LINE user record.

    This endpoint is called after LIFF authentication succeeds.
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

        # Get clinic from request (for testing) or determine from LIFF app ID
        clinic = db.query(Clinic).get(request.clinic_id)
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
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
            "exp": now + timedelta(hours=1),
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
            detail="Authentication failed"
        )


@router.post("/patients/primary", response_model=PatientCreateResponse)
async def create_primary_patient(
    request: PatientCreateRequest,
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Create the first patient record for a LINE user at a clinic.

    This is called during first-time registration after LIFF authentication.
    The clinic context is determined from existing logic.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Check if patient already exists for this clinic
        existing_patient = db.query(Patient).filter_by(
            line_user_id=line_user.id,
            clinic_id=clinic.id
        ).first()

        if existing_patient:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Patient already exists for this clinic"
            )

        # Create patient
        patient = Patient(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            full_name=request.full_name,
            phone_number=request.phone_number
        )

        db.add(patient)
        db.commit()
        db.refresh(patient)

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
            detail="Failed to create patient"
        )


@router.post("/patients", response_model=PatientCreateResponse)
async def create_additional_patient(
    request: PatientCreateRequest,
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Create additional patient records for a LINE user.

    Allows LINE users to manage appointments for multiple family members.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Create patient (phone_number can be null)
        patient = Patient(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            full_name=request.full_name,
            phone_number=request.phone_number
        )

        db.add(patient)
        db.commit()
        db.refresh(patient)

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Additional patient creation error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create patient"
        )


@router.get("/patients", response_model=PatientListResponse)
async def list_patients(
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    List all patients associated with the LINE user for the current clinic.

    Returns patients sorted by creation time (oldest first).
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Get patients for this LINE user at this clinic
        patients = db.query(Patient).filter_by(
            line_user_id=line_user.id,
            clinic_id=clinic.id
        ).order_by(Patient.created_at).all()

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
    except Exception as e:
        logger.error(f"Patient list error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve patients"
        )


@router.delete("/patients/{patient_id}")
async def delete_patient(
    patient_id: int,
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Delete a patient record.

    Prevents deletion if this is the last patient or if there are future appointments.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Verify patient ownership
        patient = check_patient_ownership(patient_id, line_user, clinic, db)

        # Check for future appointments
        future_appointments = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id == patient_id,
            CalendarEvent.start_time > datetime.now()
        ).count()

        if future_appointments > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete patient with future appointments"
            )

        # Check if this is the last patient
        total_patients = db.query(Patient).filter_by(
            line_user_id=line_user.id,
            clinic_id=clinic.id
        ).count()

        if total_patients <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="至少需保留一位就診人"
            )

        # Soft delete by unlinking from LINE user (preserves appointment history)
        patient.line_user_id = None
        db.commit()

        return {"success": True, "message": "Patient removed"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Patient deletion error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete patient"
        )


@router.get("/appointment-types", response_model=AppointmentTypeListResponse)
async def list_appointment_types(
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    List all appointment types available at the clinic.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Get appointment types for clinic
        appointment_types = db.query(AppointmentType).filter_by(
            clinic_id=clinic.id
        ).all()

        return AppointmentTypeListResponse(
            appointment_types=[
                AppointmentTypeResponse(
                    id=at.id,
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
            detail="Failed to retrieve appointment types"
        )


@router.get("/practitioners", response_model=PractitionerListResponse)
async def list_practitioners(
    appointment_type_id: Optional[int] = Query(None),
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    List practitioners who can offer the specified appointment type.

    If no appointment_type_id provided, returns all practitioners.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Base query for practitioners
        query = db.query(User).filter(
            User.clinic_id == clinic.id,
            User.is_active == True,
            User.roles.contains(['practitioner'])
        )

        if appointment_type_id:
            # Filter by practitioners who offer this appointment type
            query = query.join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
            )

        practitioners = query.all()

        # Get offered types for each practitioner
        result: List[PractitionerResponse] = []
        for practitioner in practitioners:
            offered_types = [
                pat.appointment_type_id
                for pat in practitioner.practitioner_appointment_types
            ]

            result.append(PractitionerResponse(
                id=practitioner.id,
                full_name=practitioner.full_name,
                offered_types=offered_types
            ))

        return PractitionerListResponse(practitioners=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Practitioners list error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve practitioners"
        )


@router.get("/availability", response_model=AvailabilityResponse)
async def get_availability(
    date: str,
    appointment_type_id: int,
    practitioner_id: Optional[int] = Query(None),
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Get available time slots for booking.

    Returns time slots where appointments can be booked for the given date,
    appointment type, and optional practitioner.

    Performance: Results are cached for 10 minutes to handle frequent queries.
    """
    try:
        # Validate date
        try:
            requested_date = datetime.strptime(date, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format (use YYYY-MM-DD)"
            )

        # Validate date range
        today = datetime.now().date()
        max_date = today + timedelta(days=90)

        if requested_date < today:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot book appointments in the past"
            )
        if requested_date > max_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="最多只能預約 90 天內的時段"
            )

        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Get appointment type
        appointment_type = db.query(AppointmentType).filter_by(
            id=appointment_type_id,
            clinic_id=clinic.id
        ).first()

        if not appointment_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment type not found"
            )

        duration_minutes = appointment_type.duration_minutes

        # Get practitioners who offer this type
        if practitioner_id:
            # Specific practitioner requested
            practitioners: List[User] = db.query(User).filter(
                User.id == practitioner_id,
                User.clinic_id == clinic.id,
                User.is_active == True,
                User.roles.contains(['practitioner'])
            ).join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
            ).all()
        else:
            # All practitioners who offer this type
            practitioners: List[User] = db.query(User).filter(
                User.clinic_id == clinic.id,
                User.is_active == True,
                User.roles.contains(['practitioner'])
            ).join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
            ).all()

        if not practitioners:
            # No practitioners offer this type
            return AvailabilityResponse(date=date, slots=[])

        # Calculate available slots
        # This is a simplified implementation - in production, you'd want to:
        # 1. Check practitioner availability schedules
        # 2. Subtract exceptions (time off, holidays)
        # 3. Subtract existing appointments
        # 4. Generate time slots based on clinic operating hours

        # For MVP, return some sample slots
        # TODO: Implement proper availability calculation
        slots: List[AvailabilitySlot] = []

        # Sample: 9 AM to 5 PM in 30-minute increments
        current_time = datetime.combine(requested_date, datetime.strptime("09:00", "%H:%M").time())
        end_time = datetime.combine(requested_date, datetime.strptime("17:00", "%H:%M").time())

        while current_time + timedelta(minutes=duration_minutes) <= end_time:
            slot_end = current_time + timedelta(minutes=duration_minutes)

            # Check if this slot conflicts with existing appointments
            # This is a simplified check - production would be more sophisticated
            conflicts = db.query(CalendarEvent).filter(
                CalendarEvent.user_id.in_([p.id for p in practitioners]),
                CalendarEvent.date == requested_date,
                CalendarEvent.start_time < slot_end.time(),
                CalendarEvent.end_time > current_time.time(),
                CalendarEvent.event_type == 'appointment'
            ).count()

            if conflicts == 0:
                # Slot is available
                if practitioner_id:
                    # Specific practitioner
                    practitioner = practitioners[0]
                    slots.append(AvailabilitySlot(
                        start_time=current_time.strftime("%H:%M"),
                        end_time=slot_end.strftime("%H:%M"),
                        practitioner_id=practitioner.id,
                        practitioner_name=practitioner.full_name
                    ))
                else:
                    # Any practitioner - show multiple options
                    for practitioner in practitioners:
                        slots.append(AvailabilitySlot(
                            start_time=current_time.strftime("%H:%M"),
                            end_time=slot_end.strftime("%H:%M"),
                            practitioner_id=practitioner.id,
                            practitioner_name=practitioner.full_name
                        ))

            current_time += timedelta(minutes=30)  # 30-minute increments

        return AvailabilityResponse(date=date, slots=slots)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Availability query error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve availability"
        )


@router.post("/appointments", response_model=AppointmentResponse)
async def create_appointment(
    request: AppointmentCreateRequest,
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Create a new appointment booking.

    Handles the complex booking logic including practitioner assignment,
    availability checking, and Google Calendar synchronization.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Verify patient ownership
        patient = check_patient_ownership(request.patient_id, line_user, clinic, db)

        # Get appointment type
        appointment_type = db.query(AppointmentType).filter_by(
            id=request.appointment_type_id,
            clinic_id=clinic.id
        ).first()

        if not appointment_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment type not found"
            )

        # Calculate end time
        end_time = request.start_time + timedelta(minutes=appointment_type.duration_minutes)

        # Handle practitioner assignment
        if request.practitioner_id is None:
            # "不指定" - assign to practitioner with least appointments that day
            candidates: List[User] = db.query(User).filter(
                User.clinic_id == clinic.id,
                User.is_active == True,
                User.roles.contains(['practitioner'])
            ).join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == request.appointment_type_id
            ).all()

            # Filter by availability at requested time
            available_candidates: List[User] = []
            for candidate in candidates:
                # Check if candidate is available at this time
                # TODO: Implement proper availability checking
                conflicts = db.query(CalendarEvent).filter(
                    CalendarEvent.user_id == candidate.id,
                    CalendarEvent.date == request.start_time.date(),
                    CalendarEvent.start_time < end_time.time(),
                    CalendarEvent.end_time > request.start_time.time(),
                    CalendarEvent.event_type == 'appointment'
                ).count()

                if conflicts == 0:
                    available_candidates.append(candidate)

            if not available_candidates:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="無可用治療師"
                )

            # Assign to practitioner with least appointments that day
            selected_practitioner = min(
                available_candidates,
                key=lambda p: db.query(CalendarEvent).filter(
                    CalendarEvent.user_id == p.id,
                    CalendarEvent.date == request.start_time.date(),
                    CalendarEvent.event_type == 'appointment'
                ).count()
            )
            practitioner_id = selected_practitioner.id
        else:
            # Specific practitioner requested
            practitioner = db.query(User).filter(
                User.id == request.practitioner_id,
                User.clinic_id == clinic.id,
                User.is_active == True,
                User.roles.contains(['practitioner'])
            ).join(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id == request.appointment_type_id
            ).first()

            if not practitioner:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Practitioner not found or doesn't offer this appointment type"
                )

            # Check availability
            conflicts = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == practitioner.id,
                CalendarEvent.date == request.start_time.date(),
                CalendarEvent.start_time < end_time.time(),
                CalendarEvent.end_time > request.start_time.time(),
                CalendarEvent.event_type == 'appointment'
            ).count()

            if conflicts > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="時段已被預約"
                )

            practitioner_id = practitioner.id

        # Create calendar event first
        calendar_event = CalendarEvent(
            user_id=practitioner_id,
            event_type='appointment',
            date=request.start_time.date(),
            start_time=request.start_time.time(),
            end_time=end_time.time()
        )

        db.add(calendar_event)
        db.flush()  # Get calendar_event.id

        # Create appointment
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=request.patient_id,
            appointment_type_id=request.appointment_type_id,
            status='confirmed',
            notes=request.notes
        )

        db.add(appointment)
        db.commit()

        # Get practitioner for response
        practitioner = db.query(User).get(practitioner_id)
        if not practitioner:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Practitioner not found after creation"
            )
        practitioner = cast(User, practitioner)

        return AppointmentResponse(
            appointment_id=appointment.calendar_event_id,  # Using calendar_event_id as appointment_id
            calendar_event_id=calendar_event.id,
            patient_name=patient.full_name,
            practitioner_name=practitioner.full_name,
            appointment_type_name=appointment_type.name,
            start_time=request.start_time,
            end_time=end_time,
            notes=request.notes
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Appointment creation error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create appointment"
        )


@router.get("/appointments", response_model=AppointmentListResponse)
async def list_appointments(
    upcoming_only: bool = Query(True),
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    List all appointments for the LINE user's patients at this clinic.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Get all patients for this LINE user at this clinic
        patients: List[Patient] = db.query(Patient).filter_by(
            line_user_id=line_user.id,
            clinic_id=clinic.id
        ).all()

        if not patients:
            return AppointmentListResponse(appointments=[])

        patient_ids = [p.id for p in patients]

        # Build query
        query = db.query(Appointment).join(CalendarEvent).filter(
            Appointment.patient_id.in_(patient_ids)
        )

        if upcoming_only:
            # Filter for upcoming appointments: future dates or today with future times
            today = datetime.now().date()
            current_time = datetime.now().time()
            query = query.filter(
                (CalendarEvent.date > today) |
                and_(CalendarEvent.date == today, CalendarEvent.start_time > current_time)
            )

        appointments: List[Appointment] = query.order_by(CalendarEvent.start_time).all()

        # Format response
        result: List[Dict[str, Any]] = []
        for appointment in appointments:
            practitioner = db.query(User).get(appointment.calendar_event.user_id)
            if not practitioner:
                continue  # Skip if practitioner not found
            practitioner = cast(User, practitioner)

            appointment_type = db.query(AppointmentType).get(appointment.appointment_type_id)
            if not appointment_type:
                continue  # Skip if appointment type not found
            appointment_type = cast(AppointmentType, appointment_type)
            patient = db.query(Patient).get(appointment.patient_id)
            if not patient:
                continue  # Skip if patient not found

            # Type cast for Pyright
            patient = cast(Patient, patient)

            result.append({
                "id": appointment.calendar_event_id,
                "patient_id": appointment.patient_id,
                "patient_name": patient.full_name,
                "practitioner_name": practitioner.full_name,
                "appointment_type_name": appointment_type.name,
                "start_time": appointment.calendar_event.start_time,
                "end_time": appointment.calendar_event.end_time,
                "status": appointment.status,
                "notes": appointment.notes
            })

        return AppointmentListResponse(appointments=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Appointments list error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve appointments"
        )


@router.delete("/appointments/{appointment_id}")
async def cancel_appointment(
    appointment_id: int,
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Cancel an appointment.

    Verifies ownership and updates appointment status.
    Google Calendar event deletion handled asynchronously.
    """
    try:
        # Determine clinic
        clinic = get_clinic_from_line_user(line_user, db)

        # Find appointment
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        # Verify ownership through patient
        patient = db.query(Patient).filter(
            Patient.id == appointment.patient_id,
            Patient.line_user_id == line_user.id,
            Patient.clinic_id == clinic.id
        ).first()

        if not patient:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="無權限取消此預約"
            )

        # Update status
        appointment.status = 'canceled_by_patient'
        appointment.canceled_at = datetime.now()

        db.commit()

        return {"success": True, "message": "預約已取消"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Appointment cancellation error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to cancel appointment"
        )
