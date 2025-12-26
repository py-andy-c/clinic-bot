# pyright: reportMissingTypeStubs=false
"""
Appointment Management API endpoints.
"""

import logging
import re
from datetime import datetime, time
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi import status as http_status
from pydantic import BaseModel, Field, model_validator, field_validator
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.constants import MAX_EVENT_NAME_LENGTH
from auth.dependencies import require_authenticated, require_practitioner_or_admin, require_admin_role, UserContext, ensure_clinic_access
from models import User, Clinic, AppointmentType, CalendarEvent, Appointment, Patient, ResourceType, Resource, AppointmentResourceRequirement, AppointmentResourceAllocation, UserClinicAssociation
from services import AppointmentService, AppointmentTypeService
from services.availability_service import AvailabilityService
from services.notification_service import NotificationService
from services.receipt_service import ReceiptService
from services.resource_service import ResourceService
from utils.datetime_utils import datetime_validator, parse_date_string, parse_datetime_to_taiwan, TAIWAN_TZ
from utils.practitioner_helpers import get_practitioner_display_name_for_appointment
from api.responses import (
    AppointmentListItem,
    AppointmentConflictDetail, ExceptionConflictDetail, ResourceConflictDetail, DefaultAvailabilityInfo
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class ResourceResponse(BaseModel):
    """Response model for resource."""
    id: int
    resource_type_id: int
    clinic_id: int
    name: str
    description: Optional[str]
    is_deleted: bool
    created_at: datetime
    updated_at: datetime


class ResourceAllocationResponse(BaseModel):
    """Response model for resource allocation."""
    resources: List[ResourceResponse]


class ResourceAvailabilityResponse(BaseModel):
    """Response model for resource availability."""
    requirements: List[Dict[str, Any]]
    suggested_allocation: List[Dict[str, Any]]
    conflicts: List[Dict[str, Any]]


@router.get("/appointments/resource-availability", summary="Get resource availability for a time slot")
async def get_resource_availability(
    appointment_type_id: int = Query(...),
    practitioner_id: int = Query(...),
    date: str = Query(..., description="YYYY-MM-DD"),
    start_time: str = Query(..., description="HH:MM"),
    end_time: str = Query(..., description="HH:MM"),
    exclude_calendar_event_id: Optional[int] = Query(None),
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ResourceAvailabilityResponse:
    """Get resource availability and suggested allocation for a time slot."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Parse date and time
        try:
            parsed_date = parse_date_string(date)
        except ValueError:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式（請使用 YYYY-MM-DD）"
            )
        
        try:
            start_hour, start_min = map(int, start_time.split(':'))
            end_hour, end_min = map(int, end_time.split(':'))
            start_time_obj = time(start_hour, start_min)
            end_time_obj = time(end_hour, end_min)
        except ValueError:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="無效的時間格式（請使用 HH:MM）"
            )
        
        start_datetime = datetime.combine(parsed_date, start_time_obj)
        end_datetime = datetime.combine(parsed_date, end_time_obj)
        
        # Get resource availability
        availability = ResourceService.get_resource_availability_for_slot(
            db=db,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            start_time=start_datetime,
            end_time=end_datetime,
            exclude_calendar_event_id=exclude_calendar_event_id
        )
        
        return ResourceAvailabilityResponse(**availability)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get resource availability: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源可用性"
        )


@router.delete("/appointments/{appointment_id}", summary="Cancel appointment by clinic admin or practitioner")
async def cancel_clinic_appointment(
    appointment_id: int,
    note: str | None = None,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Cancel an appointment by clinic admin or practitioner.

    Practitioners can only cancel their own appointments.
    Admins can cancel any appointment in their clinic.
    
    Updates appointment status to 'canceled_by_clinic'
    and sends LINE notification to patient.
    """
    try:
        # Check permissions before calling service
        # Practitioners can only cancel their own appointments; admins can cancel any in their clinic
        if not current_user.has_role('admin'):
            clinic_id = ensure_clinic_access(current_user)
            
            # For practitioners, verify they own this appointment and it's not auto-assigned
            appointment = db.query(Appointment).join(
                CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
            ).filter(
                Appointment.calendar_event_id == appointment_id,
                CalendarEvent.clinic_id == clinic_id
            ).first()
            
            if not appointment:
                # Appointment doesn't exist - let service handle 404
                # We don't check permissions here because the service layer will return 404
                # for non-existent appointments, which is the appropriate response
                pass
            else:
                # Permission checks only apply if the appointment exists
                # If it doesn't exist, the service layer will handle the 404 response
                calendar_event = appointment.calendar_event
                # Check if practitioner owns the appointment
                if calendar_event.user_id != current_user.user_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="您只能取消自己的預約"
                    )
                # Non-admin practitioners cannot cancel auto-assigned appointments
                # (even if they are the assigned practitioner, they shouldn't know about it)
                if appointment.is_auto_assigned:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="您無法取消系統自動指派的預約"
                    )
        
        # Cancel appointment using service
        # Note: Permission validation is already done above (practitioners can only cancel their own, admins can cancel any)
        # The service method handles sending notifications to both practitioner and patient
        result = AppointmentService.cancel_appointment(
            db=db,
            appointment_id=appointment_id,
            cancelled_by='clinic',
            return_details=True,
            note=note
        )

        already_cancelled = result.get('already_cancelled', False)

        db.commit()

        # Return appropriate message based on whether it was already cancelled
        if already_cancelled:
            return {
                "success": True,
                "message": "預約已被取消",
                "appointment_id": appointment_id
            }
        else:
            return {
                "success": True,
                "message": "預約已取消，已通知患者",
                "appointment_id": appointment_id
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to cancel appointment {appointment_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="取消預約失敗"
        )


# ===== Appointment Management (Create, Edit, Reassign) =====

# parse_datetime_field_validator removed - use datetime_validator from utils.datetime_utils instead
# This function is now replaced by the centralized datetime_validator utility


class ClinicAppointmentCreateRequest(BaseModel):
    """Request model for creating appointment on behalf of patient."""
    patient_id: int
    appointment_type_id: int
    start_time: datetime
    practitioner_id: int  # Required - clinic users must select a practitioner
    clinic_notes: Optional[str] = None
    selected_resource_ids: Optional[List[int]] = None  # Optional resource IDs selected by frontend

    @field_validator('clinic_notes')
    @classmethod
    def validate_clinic_notes(cls, v: Optional[str]) -> Optional[str]:
        """Validate clinic_notes field if provided."""
        if v is None:
            return None
        # Trim whitespace, allow empty strings
        v = v.strip() if v else ''
        # Limit length to 1000 characters (matches database column and frontend maxLength)
        if len(v) > 1000:
            raise ValueError('診所備注長度過長（最多1000字元）')
        return v

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return datetime_validator('start_time')(cls, values)


class AppointmentEditRequest(BaseModel):
    """Request model for editing appointment."""
    appointment_type_id: Optional[int] = None  # None = keep current
    practitioner_id: Optional[int] = None  # None = keep current
    start_time: Optional[datetime] = None  # None = keep current
    clinic_notes: Optional[str] = None  # If provided, updates appointment.clinic_notes. If None, preserves current clinic notes.
    notification_note: Optional[str] = None  # Optional note to include in edit notification (does not update appointment.notes)
    selected_resource_ids: Optional[List[int]] = None  # Optional resource IDs selected by frontend

    @field_validator('clinic_notes')
    @classmethod
    def validate_clinic_notes(cls, v: Optional[str]) -> Optional[str]:
        """Validate clinic_notes field if provided."""
        if v is None:
            return None
        # Trim whitespace, allow empty strings
        v = v.strip() if v else ''
        # Limit length to 1000 characters (matches database column and frontend maxLength)
        if len(v) > 1000:
            raise ValueError('診所備注長度過長（最多1000字元）')
        return v

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return datetime_validator('start_time')(cls, values)


class UpdateEventNameRequest(BaseModel):
    """Request model for updating calendar event name."""
    event_name: Optional[str] = None  # None or empty string means use default format
    
    @field_validator('event_name')
    @classmethod
    def validate_event_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if v == "":
                return None  # Empty string means use default
            if len(v) > MAX_EVENT_NAME_LENGTH:
                raise ValueError(f'事件名稱過長（最多 {MAX_EVENT_NAME_LENGTH} 字元）')
        return v


class AppointmentEditPreviewRequest(BaseModel):
    """Request model for previewing edit notification."""
    new_practitioner_id: Optional[int] = None
    new_start_time: Optional[datetime] = None
    note: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def parse_datetime_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Parse datetime strings before validation, converting to Taiwan timezone."""
        return datetime_validator('new_start_time')(cls, values)


@router.post("/appointments", summary="Create appointment on behalf of patient")
async def create_clinic_appointment(
    request: ClinicAppointmentCreateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Create an appointment on behalf of an existing patient.
    
    Admin and practitioners can create appointments for any patient.
    Read-only users cannot create appointments.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if user is read-only
        if current_user.has_role('read-only'):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限建立預約"
            )
        
        # Create appointment (no LINE user validation for clinic users)
        # The AppointmentService.create_appointment() method already handles sending
        # LINE notifications to patients, so we don't need to send them here.
        result = AppointmentService.create_appointment(
            db=db,
            clinic_id=clinic_id,
            patient_id=request.patient_id,
            appointment_type_id=request.appointment_type_id,
            start_time=request.start_time,
            practitioner_id=request.practitioner_id,
            notes=None,  # Clinic users cannot set patient notes
            clinic_notes=request.clinic_notes,
            line_user_id=None,  # No LINE validation for clinic users
            selected_resource_ids=request.selected_resource_ids
        )
        
        return {
            "success": True,
            "appointment_id": result['appointment_id'],
            "message": "預約已建立"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create appointment: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立預約失敗"
        )


# ===== Recurring Appointments =====

class CheckRecurringConflictsRequest(BaseModel):
    """Request model for checking conflicts in recurring appointments."""
    practitioner_id: int
    appointment_type_id: int
    occurrences: List[str]  # List of ISO datetime strings

    @field_validator('occurrences')
    @classmethod
    def validate_occurrences(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('至少需要一個預約時段')
        if len(v) > 50:
            raise ValueError('最多只能檢查50個預約時段')
        return v


class OccurrenceConflictStatus(BaseModel):
    """Conflict status for a single occurrence.
    
    Uses the same format as SchedulingConflictResponse for consistency.
    Additional fields for duplicate detection within the occurrence list.
    """
    start_time: str  # ISO datetime
    has_conflict: bool
    conflict_type: Optional[str] = None  # "appointment" | "exception" | "availability" | "resource" | "duplicate" | null
    appointment_conflict: Optional["AppointmentConflictDetail"] = None
    exception_conflict: Optional["ExceptionConflictDetail"] = None
    resource_conflicts: Optional[List["ResourceConflictDetail"]] = None
    default_availability: "DefaultAvailabilityInfo"
    # Additional fields for duplicate detection
    is_duplicate: bool = False
    duplicate_index: Optional[int] = None


class ConflictCheckResult(BaseModel):
    """Result of conflict checking for recurring appointments."""
    occurrences: List[OccurrenceConflictStatus]


@router.post("/appointments/check-recurring-conflicts", summary="Check conflicts for recurring appointments")
async def check_recurring_conflicts(
    request: CheckRecurringConflictsRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Check for conflicts in a list of appointment occurrences.
    
    Returns conflict status for each occurrence, including:
    - Past appointment conflicts (highest priority)
    - Availability conflicts
    - Existing appointment conflicts
    - Duplicate occurrences within the list
    - Booking restriction violations (for patients, not clinic admins)
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Parse occurrences
        parsed_occurrences: List[datetime] = []
        for occ_str in request.occurrences:
            try:
                dt = parse_datetime_to_taiwan(occ_str)
                parsed_occurrences.append(dt)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"無效的日期時間格式: {occ_str}"
                )
        
        # Check for duplicates within the list
        duplicate_indices: Dict[int, Optional[int]] = {}
        for i, dt1 in enumerate(parsed_occurrences):
            for j, dt2 in enumerate(parsed_occurrences):
                if i != j and dt1 == dt2:
                    duplicate_indices[i] = j
                    break
        
        # Check conflicts for each occurrence using the same service method as single conflict endpoint
        # This ensures consistent conflict detection format across single and recurring appointments
        results: List[OccurrenceConflictStatus] = []
        
        for idx, dt in enumerate(parsed_occurrences):
            date_key = dt.date()
            start_time_obj = dt.time()
            
            # Check if duplicate
            is_duplicate = idx in duplicate_indices
            duplicate_idx = duplicate_indices.get(idx)
            
            if is_duplicate:
                # For duplicates, create a conflict response with duplicate type
                results.append(OccurrenceConflictStatus(
                    start_time=request.occurrences[idx],
                    has_conflict=True,
                    conflict_type="duplicate",
                    appointment_conflict=None,
                    exception_conflict=None,
                    resource_conflicts=None,
                    default_availability=DefaultAvailabilityInfo(
                        is_within_hours=True,  # Default for duplicates
                        normal_hours=None
                    ),
                    is_duplicate=True,
                    duplicate_index=duplicate_idx
                ))
            else:
                # Use the same service method as single conflict endpoint for consistency
                # check_past_appointment=True for clinic users (this endpoint is clinic-only)
                conflict_data = AvailabilityService.check_scheduling_conflicts(
                    db=db,
                    practitioner_id=request.practitioner_id,
                    date=date_key,
                    start_time=start_time_obj,
                    appointment_type_id=request.appointment_type_id,
                    clinic_id=clinic_id,
                    exclude_calendar_event_id=None,
                    check_past_appointment=True
                )
                
                # Convert to response models (types already imported at top level)
                appointment_conflict = None
                if conflict_data.get("appointment_conflict"):
                    ac = conflict_data["appointment_conflict"]
                    appointment_conflict = AppointmentConflictDetail(
                        appointment_id=ac["appointment_id"],
                        patient_name=ac["patient_name"],
                        start_time=ac["start_time"],
                        end_time=ac["end_time"],
                        appointment_type=ac["appointment_type"]
                    )
                
                exception_conflict = None
                if conflict_data.get("exception_conflict"):
                    ec = conflict_data["exception_conflict"]
                    exception_conflict = ExceptionConflictDetail(
                        exception_id=ec["exception_id"],
                        start_time=ec["start_time"],
                        end_time=ec["end_time"],
                        reason=ec.get("reason")
                    )
                
                resource_conflicts = None
                if conflict_data.get("resource_conflicts"):
                    resource_conflicts = [
                        ResourceConflictDetail(
                            resource_type_id=rc["resource_type_id"],
                            resource_type_name=rc["resource_type_name"],
                            required_quantity=rc["required_quantity"],
                            total_resources=rc["total_resources"],
                            allocated_count=rc["allocated_count"]
                        )
                        for rc in conflict_data["resource_conflicts"]
                    ]
                
                default_availability = DefaultAvailabilityInfo(
                    is_within_hours=conflict_data["default_availability"]["is_within_hours"],
                    normal_hours=conflict_data["default_availability"].get("normal_hours")
                )
                
                results.append(OccurrenceConflictStatus(
                    start_time=request.occurrences[idx],
                    has_conflict=conflict_data["has_conflict"],
                    conflict_type=conflict_data.get("conflict_type"),
                    appointment_conflict=appointment_conflict,
                    exception_conflict=exception_conflict,
                    resource_conflicts=resource_conflicts,
                    default_availability=default_availability,
                    is_duplicate=False,
                    duplicate_index=None
                ))
        
        return ConflictCheckResult(occurrences=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to check recurring conflicts: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="檢查衝突失敗"
        )


class OccurrenceRequest(BaseModel):
    """Single occurrence in recurring appointment request."""
    start_time: str  # ISO datetime
    selected_resource_ids: Optional[List[int]] = None  # Optional resource IDs for this occurrence


class RecurringAppointmentCreateRequest(BaseModel):
    """Request model for creating recurring appointments."""
    patient_id: int
    appointment_type_id: int
    practitioner_id: int
    clinic_notes: Optional[str] = None
    occurrences: List[OccurrenceRequest]  # List of specific date/time occurrences (max 50)

    @field_validator('occurrences')
    @classmethod
    def validate_occurrences(cls, v: List[OccurrenceRequest]) -> List[OccurrenceRequest]:
        if not v:
            raise ValueError('至少需要一個預約時段')
        if len(v) > 50:
            raise ValueError('最多只能建立50個預約')
        return v

    @field_validator('clinic_notes')
    @classmethod
    def validate_clinic_notes(cls, v: Optional[str]) -> Optional[str]:
        """Validate clinic_notes field if provided."""
        if v is None:
            return None
        v = v.strip() if v else ''
        if len(v) > 1000:
            raise ValueError('診所備注長度過長（最多1000字元）')
        return v


class FailedOccurrence(BaseModel):
    """Details of a failed occurrence."""
    start_time: str  # ISO datetime
    error_code: str  # "conflict", "booking_restriction", "past_date", "max_window", etc.
    error_message: str  # Human-readable error message


class RecurringAppointmentCreateResponse(BaseModel):
    """Response model for recurring appointment creation."""
    success: bool
    created_count: int
    failed_count: int
    created_appointments: List[Dict[str, Any]]
    failed_occurrences: List[FailedOccurrence]


@router.post("/appointments/recurring", summary="Create recurring appointments")
async def create_recurring_appointments(
    request: RecurringAppointmentCreateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Create multiple recurring appointments for a patient.
    
    Each occurrence is created in a separate transaction to allow partial success.
    Clinic notes are replicated to all successfully created appointments.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if user is read-only
        if current_user.has_role('read-only'):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限建立預約"
            )
        
        # Parse occurrences
        parsed_occurrences: List[datetime] = []
        for occ in request.occurrences:
            try:
                from utils.datetime_utils import parse_datetime_to_taiwan
                dt = parse_datetime_to_taiwan(occ.start_time)
                parsed_occurrences.append(dt)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"無效的日期時間格式: {occ.start_time}"
                )
        
        # Create appointments one by one (separate transactions)
        created_appointments: List[Dict[str, Any]] = []
        failed_occurrences: List[FailedOccurrence] = []
        
        # Determine if we should skip individual notifications
        # We'll skip notifications during creation and handle them after based on actual count
        # This prevents duplicate notifications
        skip_individual_notifications = True  # Always skip during creation, handle after
        
        for occ in request.occurrences:
            try:
                from utils.datetime_utils import parse_datetime_to_taiwan as parse_dt
                start_time = parse_dt(occ.start_time)
                
                # Create appointment using existing service
                # Skip notifications if we're creating multiple appointments (will send consolidated)
                result = AppointmentService.create_appointment(
                    db=db,
                    clinic_id=clinic_id,
                    patient_id=request.patient_id,
                    appointment_type_id=request.appointment_type_id,
                    start_time=start_time,
                    practitioner_id=request.practitioner_id,
                    notes=None,  # Clinic users cannot set patient notes
                    clinic_notes=request.clinic_notes,
                    line_user_id=None,  # No LINE validation for clinic users
                    skip_notifications=skip_individual_notifications,
                    selected_resource_ids=occ.selected_resource_ids  # Per-occurrence resource selection
                )
                
                created_appointments.append({
                    "appointment_id": result['appointment_id'],
                    "start_time": result['start_time'].isoformat() if isinstance(result['start_time'], datetime) else str(result['start_time']),
                    "end_time": result['end_time'].isoformat() if isinstance(result['end_time'], datetime) else str(result['end_time'])
                })
                
            except HTTPException as e:
                # Extract error code from detail message
                error_code = "unknown"
                error_message = e.detail
                
                if "時段不可用" in error_message or "衝突" in error_message:
                    error_code = "conflict"
                elif "提前" in error_message:
                    error_code = "booking_restriction"
                elif "過去" in error_message:
                    error_code = "past_date"
                elif "範圍" in error_message or "天內" in error_message:
                    error_code = "max_window"
                
                failed_occurrences.append(FailedOccurrence(
                    start_time=occ.start_time,
                    error_code=error_code,
                    error_message=error_message
                ))
            except Exception as e:
                logger.exception(f"Failed to create occurrence {occ.start_time}: {e}")
                failed_occurrences.append(FailedOccurrence(
                    start_time=occ.start_time,
                    error_code="unknown",
                    error_message="建立預約失敗"
                ))
        
        # Send notifications based on count
        # If only 1 appointment created, send normal individual notification
        # If > 1 appointment created, send consolidated notifications
        if created_appointments:
            if len(created_appointments) == 1:
                # Single appointment - send normal individual notification
                # Re-fetch the appointment to send notification
                try:
                    appointment_id = created_appointments[0]['appointment_id']
                    appointment = db.query(Appointment).join(
                        CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
                    ).filter(
                        Appointment.calendar_event_id == appointment_id,
                        CalendarEvent.clinic_id == clinic_id
                    ).first()
                    
                    if appointment:
                        from services.notification_service import NotificationService
                        from utils.practitioner_helpers import get_practitioner_name_for_notification
                        from models.user_clinic_association import UserClinicAssociation
                        
                        clinic = db.query(Clinic).get(clinic_id)
                        if not clinic:
                            logger.warning(f"Clinic {clinic_id} not found, skipping notifications")
                        else:
                            practitioner = db.query(User).get(request.practitioner_id)
                            
                            # Send practitioner notification
                            if practitioner:
                                association = db.query(UserClinicAssociation).filter(
                                    UserClinicAssociation.user_id == practitioner.id,
                                    UserClinicAssociation.clinic_id == clinic_id,
                                    UserClinicAssociation.is_active == True
                                ).first()
                                if association:
                                    NotificationService.send_practitioner_appointment_notification(
                                        db, association, appointment, clinic
                                    )
                            
                            # Send patient notification
                            if appointment.patient and appointment.patient.line_user:
                                practitioner_name = get_practitioner_name_for_notification(
                                    db=db,
                                    practitioner_id=request.practitioner_id,
                                    clinic_id=clinic_id,
                                    was_auto_assigned=False,
                                    practitioner=practitioner
                                )
                                NotificationService.send_appointment_confirmation(
                                    db, appointment, practitioner_name, clinic, trigger_source='clinic_triggered'
                                )
                except Exception as e:
                    logger.exception(f"Failed to send individual notification: {e}")
                    # Don't fail the request if notification fails
            else:
                # Multiple appointments - send consolidated notifications
                try:
                    # Get patient
                    patient = db.query(Patient).filter(
                        Patient.id == request.patient_id,
                        Patient.clinic_id == clinic_id
                    ).first()
                    
                    clinic = db.query(Clinic).get(clinic_id)
                    
                    if clinic and clinic.line_channel_secret and clinic.line_channel_access_token:
                        from services.line_service import LINEService
                        from utils.practitioner_helpers import get_practitioner_name_for_notification
                        from utils.datetime_utils import format_datetime
                        from models.user_clinic_association import UserClinicAssociation
                        
                        practitioner = db.query(User).get(request.practitioner_id)
                        practitioner_name = get_practitioner_name_for_notification(
                            db=db,
                            practitioner_id=request.practitioner_id,
                            clinic_id=clinic_id,
                            was_auto_assigned=False,
                            practitioner=practitioner
                        )
                        
                        # Get appointment type name
                        appointment_type_obj = AppointmentTypeService.get_appointment_type_by_id(
                            db, request.appointment_type_id, clinic_id=clinic_id
                        )
                        appointment_type_name = appointment_type_obj.name if appointment_type_obj else "預約"
                        
                        # Create consolidated notification message for patient
                        if patient and patient.line_user:
                            date_range = ""
                            dates = sorted([appt['start_time'] for appt in created_appointments])
                            first_date = dates[0][:10]  # Extract date part
                            last_date = dates[-1][:10]
                            if first_date != last_date:
                                date_range = f"預約時間：{first_date} 至 {last_date}\n"
                            
                            # Format appointment times
                            appointment_list = created_appointments[:10]
                            from utils.datetime_utils import parse_datetime_to_taiwan as parse_dt
                            appointment_text = "\n".join([
                                f"• {format_datetime(parse_dt(appt['start_time']))}" 
                                for appt in appointment_list
                            ])
                            
                            if len(created_appointments) > 10:
                                appointment_text += f"\n... 還有 {len(created_appointments) - 10} 個"
                            
                            # Get practitioner name with title for external display
                            from utils.practitioner_helpers import get_practitioner_display_name_with_title
                            if practitioner:
                                practitioner_display_name = get_practitioner_display_name_with_title(
                                    db, practitioner.id, clinic_id
                                )
                            else:
                                practitioner_display_name = practitioner_name
                            
                            message = f"{patient.full_name}，已為您建立 {len(created_appointments)} 個預約：\n\n"
                            message += date_range
                            message += appointment_text
                            message += f"\n\n【{appointment_type_name}】{practitioner_display_name}"
                            message += "\n\n期待為您服務！"
                            
                            # Send notification using LINE service directly
                            line_service = LINEService(
                                channel_secret=clinic.line_channel_secret,
                                channel_access_token=clinic.line_channel_access_token
                            )
                            labels = {
                                'recipient_type': 'patient',
                                'event_type': 'appointment_confirmation',
                                'trigger_source': 'clinic_triggered',
                                'appointment_context': 'recurring_appointments'
                            }
                            line_service.send_text_message(
                                patient.line_user.line_user_id,
                                message,
                                db=db,
                                clinic_id=clinic_id,
                                labels=labels
                            )
                            
                            logger.info(
                                f"Sent consolidated appointment confirmation to patient {patient.id} "
                                f"for {len(created_appointments)} appointments"
                            )
                        
                        # Send consolidated notification for practitioner
                        if practitioner:
                            association = db.query(UserClinicAssociation).filter(
                                UserClinicAssociation.user_id == practitioner.id,
                                UserClinicAssociation.clinic_id == clinic_id,
                                UserClinicAssociation.is_active == True
                            ).first()
                            
                            if association and association.line_user_id:
                                # Format appointment times for practitioner
                                appointment_list = created_appointments[:10]
                                from utils.datetime_utils import parse_datetime_to_taiwan as parse_dt
                                appointment_text = "\n".join([
                                    f"• {format_datetime(parse_dt(appt['start_time']))}" 
                                    for appt in appointment_list
                                ])
                                
                                if len(created_appointments) > 10:
                                    appointment_text += f"\n... 還有 {len(created_appointments) - 10} 個"
                                
                                practitioner_message = f"📅 新預約通知（{len(created_appointments)} 個）\n\n"
                                practitioner_message += f"病患：{patient.full_name if patient else '未知'}\n"
                                practitioner_message += f"類型：{appointment_type_name}\n\n"
                                practitioner_message += appointment_text
                                
                                line_service = LINEService(
                                    channel_secret=clinic.line_channel_secret,
                                    channel_access_token=clinic.line_channel_access_token
                                )
                                labels = {
                                    'recipient_type': 'practitioner',
                                    'event_type': 'new_appointment_notification',
                                    'trigger_source': 'clinic_triggered',
                                    'appointment_context': 'recurring_appointments'
                                }
                                line_service.send_text_message(
                                    association.line_user_id,
                                    practitioner_message,
                                    db=db,
                                    clinic_id=clinic_id,
                                    labels=labels
                                )
                                
                                logger.info(
                                    f"Sent consolidated appointment notification to practitioner {practitioner.id} "
                                    f"for {len(created_appointments)} appointments"
                                )
                except Exception as e:
                    logger.exception(f"Failed to send consolidated notification: {e}")
                    # Don't fail the request if notification fails
        
        return RecurringAppointmentCreateResponse(
            success=len(failed_occurrences) == 0,
            created_count=len(created_appointments),
            failed_count=len(failed_occurrences),
            created_appointments=created_appointments,
            failed_occurrences=failed_occurrences
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create recurring appointments: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立預約失敗"
        )


@router.post("/appointments/{appointment_id}/edit-preview", summary="Preview edit notification")
async def preview_edit_notification(
    appointment_id: int,
    request: AppointmentEditPreviewRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Preview edit notification message before confirming edit.
    
    Also validates conflicts and returns whether notification will be sent.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get appointment
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Check if appointment is cancelled
        if appointment.status in ['canceled_by_patient', 'canceled_by_clinic']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="此預約已取消，無法編輯"
            )
        
        # Check permissions before preview
        calendar_event = appointment.calendar_event
        is_admin = current_user.has_role('admin')
        if not is_admin:
            # Practitioners can only preview their own appointments
            if calendar_event.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能預覽自己的預約"
                )
            # Non-admin practitioners cannot preview auto-assigned appointments
            # (even if they are the assigned practitioner, they shouldn't know about it)
            if appointment.is_auto_assigned:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您無法預覽系統自動指派的預約"
                )
        
        # Check conflicts (after permission check)
        # Allow override for clinic users (skip availability interval checks)
        is_valid, _, conflicts = AppointmentService.check_appointment_edit_conflicts(
            db, appointment_id, request.new_practitioner_id, request.new_start_time,
            appointment.appointment_type_id, clinic_id, allow_override=True
        )
        
        # Determine if notification will be sent using centralized logic
        from utils.datetime_utils import TAIWAN_TZ
        old_start_time_for_preview = datetime.combine(calendar_event.date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
        old_practitioner_id_for_preview = calendar_event.user_id
        new_start_time = request.new_start_time if request.new_start_time else old_start_time_for_preview
        new_practitioner_id = request.new_practitioner_id if request.new_practitioner_id else old_practitioner_id_for_preview
        
        # Calculate if time actually changed for the notification requirements check
        time_actually_changed = (new_start_time != old_start_time_for_preview)
        
        notification_requirements = AppointmentService.get_notification_requirements(
            old_appointment=appointment,
            new_practitioner_id=new_practitioner_id,
            new_start_time=new_start_time,
            originally_auto_assigned=appointment.is_auto_assigned,
            time_actually_changed=time_actually_changed
        )
        will_send_notification = notification_requirements["will_send_notification"]
        
        # Generate preview message if notification will be sent
        preview_message: Optional[str] = None
        if will_send_notification:
            old_practitioner = None
            if not appointment.is_auto_assigned:
                old_practitioner = db.query(User).get(calendar_event.user_id)
            
            new_practitioner = None
            if request.new_practitioner_id:
                new_practitioner = db.query(User).get(request.new_practitioner_id)
            
            preview_message = NotificationService.generate_edit_preview(
                db=db,
                appointment=appointment,
                old_practitioner=old_practitioner,
                new_practitioner=new_practitioner,
                old_start_time=old_start_time_for_preview,
                new_start_time=new_start_time,
                note=request.note
            )
        
        return {
            "preview_message": preview_message,
            "old_appointment_details": {
                "practitioner_id": calendar_event.user_id,
                "start_time": old_start_time_for_preview.isoformat(),
                "is_auto_assigned": appointment.is_auto_assigned
            },
            "new_appointment_details": {
                "practitioner_id": request.new_practitioner_id if request.new_practitioner_id else calendar_event.user_id,
                "start_time": new_start_time.isoformat()
            },
            "conflicts": conflicts,
            "is_valid": is_valid,
            "will_send_notification": will_send_notification
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to preview edit notification: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="預覽失敗"
        )


@router.put("/appointments/{appointment_id}", summary="Edit appointment")
async def edit_clinic_appointment(
    appointment_id: int,
    request: AppointmentEditRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """
    Edit an appointment (time and/or practitioner).
    
    Admin can edit any appointment.
    Practitioners can only edit their own appointments.
    Read-only users cannot edit.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if user is read-only
        if current_user.has_role('read-only'):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您沒有權限調整預約"
            )
        
        # Get appointment before edit (for notification and permission check)
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Check permissions (before any other operations)
        calendar_event = appointment.calendar_event
        is_admin = current_user.has_role('admin')
        if not is_admin:
            # Practitioners can only edit their own appointments
            if calendar_event.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能編輯自己的預約"
                )
            # Non-admin practitioners cannot edit auto-assigned appointments
            # (even if they are the assigned practitioner, they shouldn't know about it)
            if appointment.is_auto_assigned:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您無法編輯系統自動指派的預約"
                )
        
        # Ensure user_id is available (should always be true with require_practitioner_or_admin)
        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="未授權"
            )
        
        # Edit appointment (service handles business logic, notifications, and permissions)
        # Pass pre-fetched appointment to avoid duplicate query (already fetched for authorization check)
        # Clinic users cannot update patient notes, only clinic notes
        result = AppointmentService.update_appointment(
            db=db,
            appointment_id=appointment_id,
            new_appointment_type_id=request.appointment_type_id,
            new_practitioner_id=request.practitioner_id,
            new_start_time=request.start_time,
            new_notes=None,  # Clinic users cannot update patient notes
            new_clinic_notes=request.clinic_notes,
            apply_booking_constraints=False,  # Clinic edits bypass constraints
            allow_auto_assignment=False,  # Clinic edits don't support auto-assignment
            reassigned_by_user_id=current_user.user_id,
            notification_note=request.notification_note,
            success_message='預約已更新',
            appointment=appointment,  # Pass pre-fetched appointment to avoid duplicate query
            selected_resource_ids=request.selected_resource_ids
        )
        
        # Commit the transaction to ensure changes are visible to subsequent requests
        db.commit()
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to edit appointment: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="調整預約失敗"
        )


@router.get("/appointments/{appointment_id}", summary="Get appointment details", response_model=AppointmentListItem)
async def get_appointment_details(
    appointment_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> AppointmentListItem:
    """
    Get appointment details by calendar_event_id.

    Available to all clinic members (including read-only users).
    Note: The appointment_id parameter is actually the calendar_event_id.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        is_admin = current_user.has_role('admin')
        hide_auto_assigned_practitioner_id = not is_admin

        # Get appointment with relationships
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).options(
            joinedload(Appointment.patient).joinedload(Patient.line_user),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )

        # Format appointment data using the same logic as list_appointments_for_patient
        calendar_event = appointment.calendar_event
        if not calendar_event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到預約事件"
            )

        # Get practitioner name
        practitioner_name = get_practitioner_display_name_for_appointment(
            db, appointment, clinic_id
        )

        # Get effective event name
        event_name = calendar_event.custom_event_name
        if not event_name:
            event_name = f"{appointment.patient.full_name} - {appointment.appointment_type.name if appointment.appointment_type else '未知'}"

        # Format datetime
        event_date = calendar_event.date
        start_datetime = None
        end_datetime = None
        if calendar_event.start_time:
            start_datetime = datetime.combine(event_date, calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
        if calendar_event.end_time:
            end_datetime = datetime.combine(event_date, calendar_event.end_time).replace(tzinfo=TAIWAN_TZ)

        # Get receipt info
        receipt = ReceiptService.get_receipt_for_appointment(db, appointment_id)
        has_active_receipt = receipt is not None and not receipt.is_voided
        has_any_receipt = receipt is not None
        receipt_id = receipt.id if receipt and not receipt.is_voided else None
        receipt_ids = [receipt.id] if receipt else []

        # Get resource info
        allocated_resources = ResourceService.get_all_resources_for_appointments(db, [appointment_id]).get(appointment_id, [])
        resource_names = [r.name for r in allocated_resources]
        resource_ids = [r.id for r in allocated_resources]

        # Handle practitioner_id visibility for auto-assigned appointments
        practitioner_id = calendar_event.user_id
        if hide_auto_assigned_practitioner_id and appointment.is_auto_assigned:
            practitioner_id = None

        return AppointmentListItem(
            id=appointment.calendar_event_id,
            calendar_event_id=appointment.calendar_event_id,
            patient_id=appointment.patient_id,
            patient_name=appointment.patient.full_name,
            practitioner_id=practitioner_id,
            practitioner_name=practitioner_name,
            appointment_type_id=appointment.appointment_type_id,
            appointment_type_name=appointment.appointment_type.name if appointment.appointment_type else "未知",
            event_name=event_name,
            start_time=start_datetime.isoformat() if start_datetime else "",
            end_time=end_datetime.isoformat() if end_datetime else "",
            status=appointment.status,
            notes=appointment.notes,
            clinic_notes=appointment.clinic_notes,
            line_display_name=appointment.patient.line_user.display_name if appointment.patient.line_user else None,
            originally_auto_assigned=appointment.is_auto_assigned,
            is_auto_assigned=appointment.is_auto_assigned,
            resource_names=resource_names,
            resource_ids=resource_ids,
            has_active_receipt=has_active_receipt,
            has_any_receipt=has_any_receipt,
            receipt_id=receipt_id,
            receipt_ids=receipt_ids
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting appointment {appointment_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預約詳情"
        )


@router.put("/calendar-events/{calendar_event_id}/event-name", summary="Update calendar event name")
async def update_calendar_event_name(
    calendar_event_id: int,
    request: UpdateEventNameRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update the custom event name for a calendar event (appointment or availability exception).
    
    Admin can edit any event.
    Practitioners can only edit their own events.
    Read-only users cannot edit.
    
    If event_name is null or empty, the default format will be used:
    - For appointments: "{patient_name} - {appointment_type_name}"
    - For availability exceptions: "休診"
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if user is read-only
        if current_user.has_role('read-only'):
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="您沒有權限編輯事件名稱"
            )
        
        # Get calendar event
        calendar_event = db.query(CalendarEvent).filter(
            CalendarEvent.id == calendar_event_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not calendar_event:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="找不到此事件"
            )
        
        # Check permissions
        is_admin = current_user.has_role('admin')
        if not is_admin:
            # Practitioners can only edit their own events
            if calendar_event.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=http_status.HTTP_403_FORBIDDEN,
                    detail="您只能編輯自己的事件"
                )
        
        # Update custom_event_name
        calendar_event.custom_event_name = request.event_name
        db.commit()
        db.refresh(calendar_event)
        
        logger.info(
            f"Updated custom_event_name for calendar_event_id={calendar_event_id}, "
            f"clinic_id={clinic_id}, new_name={request.event_name}"
        )
        
        return {
            "success": True,
            "message": "事件名稱已更新",
            "calendar_event_id": calendar_event_id,
            "event_name": request.event_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update event name: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新事件名稱失敗"
        )

@router.get("/appointments/{appointment_id}/resources", summary="Get resources allocated to an appointment")
async def get_appointment_resources(
    appointment_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ResourceAllocationResponse:
    """Get all resources allocated to an appointment."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment exists and belongs to clinic
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        allocations = db.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == appointment_id
        ).all()
        
        resource_ids = [alloc.resource_id for alloc in allocations]
        resources = db.query(Resource).filter(
            Resource.id.in_(resource_ids),
            Resource.clinic_id == clinic_id
        ).all()
        
        return ResourceAllocationResponse(
            resources=[
                ResourceResponse(
                    id=r.id,
                    resource_type_id=r.resource_type_id,
                    clinic_id=r.clinic_id,
                    name=r.name,
                    description=r.description,
                    is_deleted=r.is_deleted,
                    created_at=r.created_at,
                    updated_at=r.updated_at
                )
                for r in resources
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get appointment resources: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預約資源"
        )


@router.put("/appointments/{appointment_id}/resources", summary="Update resource allocation for an appointment")
async def update_appointment_resources(
    appointment_id: int,
    resource_ids: List[int],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Manually update resource allocation for an appointment."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment exists and belongs to clinic
        appointment = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            Appointment.calendar_event_id == appointment_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約不存在"
            )
        
        # Get appointment type to validate resource requirements
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment.appointment_type_id
        ).first()
        
        if appointment_type and appointment_type.resource_requirements:
            # Validate that provided resources match requirements
            # Get required resource types and quantities
            requirements = db.query(AppointmentResourceRequirement).filter(
                AppointmentResourceRequirement.appointment_type_id == appointment.appointment_type_id
            ).all()
            
            # Group provided resources by type
            provided_resources = db.query(Resource).filter(
                Resource.id.in_(resource_ids),
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).all()
            
            resource_type_counts: Dict[int, int] = {}
            for resource in provided_resources:
                resource_type_counts[resource.resource_type_id] = resource_type_counts.get(resource.resource_type_id, 0) + 1
            
            # Check if requirements are met
            for req in requirements:
                provided_count = resource_type_counts.get(req.resource_type_id, 0)
                if provided_count < req.quantity:
                    resource_type = db.query(ResourceType).filter(
                        ResourceType.id == req.resource_type_id
                    ).first()
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail=f"資源不足：需要 {req.quantity} 個 {resource_type.name if resource_type else '資源'}，但只提供了 {provided_count} 個"
                    )
                elif provided_count > req.quantity:
                    # Allow more than required (manual override)
                    pass
        
        # Delete old allocations
        db.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == appointment_id
        ).delete()
        
        # Create new allocations
        calendar_event = db.query(CalendarEvent).filter(
            CalendarEvent.id == appointment_id
        ).first()
        
        if calendar_event and calendar_event.start_time and calendar_event.end_time:
            # Validate and create allocations
            for resource_id in resource_ids:
                resource = db.query(Resource).filter(
                    Resource.id == resource_id,
                    Resource.clinic_id == clinic_id,
                    Resource.is_deleted == False
                ).first()
                
                if not resource:
                    continue  # Skip invalid resources
                
                allocation = AppointmentResourceAllocation(
                    appointment_id=appointment_id,
                    resource_id=resource_id
                )
                db.add(allocation)
        
        db.commit()
        
        return {"success": True, "message": "資源分配已更新"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update appointment resources: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新資源分配"
        )