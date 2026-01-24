# pyright: reportMissingTypeStubs=false
"""
Availability & Calendar API endpoints.
"""

import logging
from datetime import datetime, timedelta, date as date_type, time
from typing import Dict, List, Optional, Any, Union

from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from fastapi import status as http_status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from core.database import get_db
from core.constants import MAX_EVENT_NAME_LENGTH
from auth.dependencies import require_authenticated, require_practitioner_or_admin, UserContext, ensure_clinic_access
from models import User, PractitionerAvailability, CalendarEvent, UserClinicAssociation, Appointment, AvailabilityException, Patient, Resource, AppointmentResourceAllocation
from services import AppointmentTypeService
from services.availability_service import AvailabilityService
from services.receipt_service import ReceiptService
from services.resource_service import ResourceService
from utils.datetime_utils import parse_date_string
from utils.practitioner_helpers import verify_practitioner_in_clinic, get_practitioner_display_name_for_appointment
from api.responses import (
    AvailableSlotsResponse, AvailableSlotResponse, ConflictWarningResponse, ConflictDetail,
    SchedulingConflictResponse, BatchSchedulingConflictResponse, AppointmentConflictDetail, ExceptionConflictDetail, DefaultAvailabilityInfo,
    SelectionInsufficientWarning, ResourceConflictWarning
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class TimeInterval(BaseModel):
    """Time interval model for availability periods."""
    start_time: str  # Format: "HH:MM"
    end_time: str    # Format: "HH:MM"


class BatchPractitionerConfig(BaseModel):
    """Configuration for a practitioner in batch conflict checking."""
    user_id: int
    exclude_calendar_event_id: Optional[int] = None


class BatchConflictCheckRequest(BaseModel):
    """Request model for batch conflict checking."""
    practitioners: List[BatchPractitionerConfig] = []
    date: str
    start_time: str
    appointment_type_id: int
    selected_resource_ids: Optional[List[int]] = None

    @field_validator('practitioners')
    @classmethod
    def validate_practitioners(cls, v: List[BatchPractitionerConfig]) -> List[BatchPractitionerConfig]:
        if not v:
            raise ValueError('At least one practitioner must be specified')
        if len(v) > 10:
            raise ValueError('Maximum 10 practitioners allowed per request')
        return v


class BatchConflictCheckResponse(BaseModel):
    """Response model for batch conflict checking."""
    results: List[BatchSchedulingConflictResponse] = []


class DefaultScheduleRequest(BaseModel):
    """Request model for updating default weekly schedule."""
    monday: List[TimeInterval] = []
    tuesday: List[TimeInterval] = []
    wednesday: List[TimeInterval] = []
    thursday: List[TimeInterval] = []
    friday: List[TimeInterval] = []
    saturday: List[TimeInterval] = []
    sunday: List[TimeInterval] = []


class DefaultScheduleResponse(BaseModel):
    """Response model for default weekly schedule."""
    monday: List[TimeInterval]
    tuesday: List[TimeInterval]
    wednesday: List[TimeInterval]
    thursday: List[TimeInterval]
    friday: List[TimeInterval]
    saturday: List[TimeInterval]
    sunday: List[TimeInterval]


class CalendarDayResponse(BaseModel):
    """Response model for calendar day data."""
    date: str  # Format: "YYYY-MM-DD"
    appointment_count: int


class CalendarMonthResponse(BaseModel):
    """Response model for calendar month data."""
    month: str  # Format: "YYYY-MM"
    total_days: int
    page: int
    limit: int
    days: List[CalendarDayResponse]


class CalendarEventResponse(BaseModel):
    """Response model for calendar events."""
    calendar_event_id: int
    type: str  # "appointment" or "availability_exception"
    start_time: Optional[str]  # Format: "HH:MM" or None for all-day
    end_time: Optional[str]    # Format: "HH:MM" or None for all-day
    title: str
    patient_id: Optional[int] = None
    appointment_type_id: Optional[int] = None
    status: Optional[str] = None
    exception_id: Optional[int] = None
    appointment_id: Optional[int] = None  # For appointment cancellation
    notes: Optional[str] = None  # Patient-provided appointment notes
    clinic_notes: Optional[str] = None  # Clinic internal notes (visible only to clinic users)
    patient_phone: Optional[str] = None  # Patient phone number
    patient_birthday: Optional[str] = None  # Patient birthday (YYYY-MM-DD format, string for calendar display)
    line_display_name: Optional[str] = None  # LINE display name
    patient_name: Optional[str] = None  # Patient full name for cancellation preview
    practitioner_name: Optional[str] = None  # Practitioner full name for cancellation preview
    appointment_type_name: Optional[str] = None  # Appointment type name for cancellation preview
    is_auto_assigned: Optional[bool] = None  # Whether appointment is auto-assigned by system
    resource_names: List[str] = []  # Names of allocated resources
    resource_ids: List[int] = []  # IDs of allocated resources
    has_active_receipt: bool = False  # Whether appointment has an active (non-voided) receipt
    has_any_receipt: bool = False  # Whether appointment has any receipt (active or voided)
    receipt_id: Optional[int] = None  # ID of active receipt (null if no active receipt)
    receipt_ids: List[int] = []  # List of all receipt IDs (always included, empty if none)


class CalendarDayDetailResponse(BaseModel):
    """Response model for detailed calendar day data."""
    date: str  # Format: "YYYY-MM-DD"
    default_schedule: List[TimeInterval]
    events: List[CalendarEventResponse]


class BatchCalendarRequest(BaseModel):
    """Request model for batch calendar data."""
    practitioner_ids: List[int]
    start_date: str  # Format: "YYYY-MM-DD"
    end_date: str    # Format: "YYYY-MM-DD"


class BatchCalendarDayResponse(BaseModel):
    """Response model for batch calendar day data per practitioner."""
    user_id: int
    date: str  # Format: "YYYY-MM-DD"
    default_schedule: List[TimeInterval]
    events: List[CalendarEventResponse]


class BatchCalendarResponse(BaseModel):
    """Response model for batch calendar data."""
    results: List[BatchCalendarDayResponse]


class ResourceCalendarDayResponse(BaseModel):
    """Response model for resource calendar day data."""
    resource_id: int
    date: str  # Format: "YYYY-MM-DD"
    events: List[CalendarEventResponse]  # Only appointments (no default schedule or exceptions)


class BatchResourceCalendarRequest(BaseModel):
    """Request model for batch resource calendar data."""
    resource_ids: List[int]
    start_date: str  # Format: "YYYY-MM-DD"
    end_date: str    # Format: "YYYY-MM-DD"


class BatchResourceCalendarResponse(BaseModel):
    """Response model for batch resource calendar data."""
    results: List[ResourceCalendarDayResponse]


class AvailabilityExceptionRequest(BaseModel):
    """Request model for creating availability exceptions."""
    date: str  # Format: "YYYY-MM-DD"
    start_time: Optional[str] = None  # Format: "HH:MM" or None for all-day
    end_time: Optional[str] = None    # Format: "HH:MM" or None for all-day
    force: bool = False  # Force creation even with conflicts


class AvailabilityExceptionResponse(BaseModel):
    """Response model for availability exceptions."""
    calendar_event_id: int
    exception_id: int
    date: str
    start_time: Optional[str]
    end_time: Optional[str]
    created_at: datetime


class BatchAvailableSlotsRequest(BaseModel):
    """Request model for batch available slots query."""
    dates: List[str]  # List of dates in YYYY-MM-DD format
    appointment_type_id: int
    exclude_calendar_event_id: Optional[int] = None  # Calendar event ID to exclude from conflict checking (for appointment editing)


class BatchAvailableSlotsResponse(BaseModel):
    """Response model for batch available slots query."""
    results: List[AvailableSlotsResponse]  # One response per date


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


# ===== Helper Functions =====

def _parse_time(time_str: str) -> time:
    """Parse time string in HH:MM format to time object."""
    hour, minute = map(int, time_str.split(':'))
    return time(hour, minute)


def _format_time(time_obj: time) -> str:
    """Format time object to HH:MM string."""
    return time_obj.strftime('%H:%M')


def _get_day_name(day_of_week: int) -> str:
    """Get day name from day of week number."""
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    return days[day_of_week]


def _get_day_of_week(day_name: str) -> int:
    """Get day of week number from day name."""
    days = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6}
    return days[day_name]


def _get_day_name_chinese(day_name: str) -> str:
    """Get Traditional Chinese day name from English day name."""
    days = {
        'monday': '星期一',
        'tuesday': '星期二',
        'wednesday': '星期三',
        'thursday': '星期四',
        'friday': '星期五',
        'saturday': '星期六',
        'sunday': '星期日'
    }
    return days[day_name]


def _format_time_string(time_str: str) -> str:
    """Format 24-hour time string to 24-hour format (HH:MM)."""
    hour, minute = map(int, time_str.split(':'))
    return f"{hour:02d}:{minute:02d}"


def _check_time_overlap(start1: time, end1: time, start2: time, end2: time) -> bool:
    """Check if two time intervals overlap."""
    return start1 < end2 and start2 < end1


def _get_event_title(event: CalendarEvent, appointment: Optional[Appointment] = None) -> str:
    """
    Get the event title for a calendar event.
    
    If custom_event_name is set, use it. Otherwise, use the default format:
    - For appointments: "{patient_name} - {appointment_type_name}"
    - For availability exceptions: "休診"
    """
    if event.custom_event_name:
        return event.custom_event_name
    
    if event.event_type == 'appointment' and appointment:
        appointment_type_name = _get_appointment_type_name(appointment)
        return f"{appointment.patient.full_name} - {appointment_type_name or '未設定'}"
    elif event.event_type == 'availability_exception':
        return "休診"
    
    # Fallback (should not happen in normal operation)
    logger.warning(f"Unexpected event type or missing appointment for calendar_event_id={event.id}, event_type={event.event_type}")
    return "未知事件"


def _get_appointment_type_name(appointment: Appointment) -> Optional[str]:
    """
    Safely get appointment type name, returning None if appointment_type is not set.
    """
    return appointment.appointment_type.name if appointment.appointment_type else None


def _get_default_schedule_for_day(db: Session, user_id: int, day_of_week: int, clinic_id: int) -> List[TimeInterval]:
    """Get default schedule intervals for a specific day."""
    availability = db.query(PractitionerAvailability).filter(
        PractitionerAvailability.user_id == user_id,
        PractitionerAvailability.clinic_id == clinic_id,
        PractitionerAvailability.day_of_week == day_of_week
    ).order_by(PractitionerAvailability.start_time).all()
    
    return [
        TimeInterval(
            start_time=_format_time(av.start_time),
            end_time=_format_time(av.end_time)
        )
        for av in availability
    ]


def _check_appointment_conflicts(
    db: Session, 
    user_id: int, 
    target_date: date_type, 
    start_time: time, 
    end_time: time,
    clinic_id: int
) -> List[ConflictDetail]:
    """Check for appointment conflicts with availability exception."""
    conflicts: List[ConflictDetail] = []
    
    # Get appointments that overlap with the exception time
    appointments = db.query(Appointment).join(CalendarEvent).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.clinic_id == clinic_id,
        CalendarEvent.event_type == 'appointment',
        CalendarEvent.date == target_date,
        Appointment.status == 'confirmed',
        CalendarEvent.start_time < end_time,
        CalendarEvent.end_time > start_time
    ).all()
    
    for appointment in appointments:
        conflicts.append(ConflictDetail(
            calendar_event_id=appointment.calendar_event_id,
            date=appointment.calendar_event.date.isoformat(),
            start_time=_format_time(appointment.calendar_event.start_time),
            end_time=_format_time(appointment.calendar_event.end_time),
            patient=appointment.patient.full_name,
            appointment_type=_get_appointment_type_name(appointment)
        ))
    
    return conflicts


# ===== API Endpoints =====

@router.get("/practitioners/{user_id}/availability/default", 
           summary="Get practitioner's default weekly schedule")
async def get_default_schedule(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> DefaultScheduleResponse:
    """
    Get practitioner's default weekly schedule.
    
    Returns the practitioner's default working hours for each day of the week.
    Multiple intervals per day are supported (e.g., morning and afternoon sessions).
    """
    try:
        # Check permissions - practitioners can only view their own schedule
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能查看自己的可用時間"
                )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Get schedule for each day
        schedule: Dict[str, List[TimeInterval]] = {}
        for day_of_week in range(7):
            day_name = _get_day_name(day_of_week)
            schedule[day_name] = _get_default_schedule_for_day(db, user_id, day_of_week, clinic_id)
        
        return DefaultScheduleResponse(**schedule)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch default schedule for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得預設排程"
        )


@router.put("/practitioners/{user_id}/availability/default",
           summary="Update practitioner's default weekly schedule")
async def update_default_schedule(
    user_id: int,
    schedule_data: DefaultScheduleRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> Union[DefaultScheduleResponse, ConflictWarningResponse]:
    """
    Update practitioner's default weekly schedule.
    
    Replaces the entire weekly schedule with the provided intervals.
    Multiple intervals per day are supported.
    
    The system will check for conflicts with future appointments and show warnings
    if appointments would be outside the new working hours.
    """
    try:
        # Check permissions - practitioners can only modify their own schedule
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能修改自己的可用時間"
                )
        
        # Get clinic_id for validation
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, is a practitioner, and is in the clinic
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Validate intervals for each day
        for day_name in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
            intervals = getattr(schedule_data, day_name)
            day_of_week = _get_day_of_week(day_name)

            # Check for overlapping intervals within the same day
            for i, interval1 in enumerate(intervals):
                start1 = _parse_time(interval1.start_time)
                end1 = _parse_time(interval1.end_time)
                
                if start1 >= end1:
                    day_chinese = _get_day_name_chinese(day_name)
                    start_formatted = _format_time_string(interval1.start_time)
                    end_formatted = _format_time_string(interval1.end_time)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"無效的時間範圍 {day_chinese}: {start_formatted}-{end_formatted}"
                    )
                
                for j, interval2 in enumerate(intervals):
                    if i != j:
                        start2 = _parse_time(interval2.start_time)
                        end2 = _parse_time(interval2.end_time)
                        
                        if _check_time_overlap(start1, end1, start2, end2):
                            day_chinese = _get_day_name_chinese(day_name)
                            start1_formatted = _format_time_string(interval1.start_time)
                            end1_formatted = _format_time_string(interval1.end_time)
                            start2_formatted = _format_time_string(interval2.start_time)
                            end2_formatted = _format_time_string(interval2.end_time)
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"{day_chinese} 的時段重疊: {start1_formatted}-{end1_formatted} 和 {start2_formatted}-{end2_formatted}"
                            )
        
        # TODO: Implement future appointment conflict checking
        # Skip conflict checking for now to avoid validation errors
        pass
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Clear existing availability for this user
        db.query(PractitionerAvailability).filter(
            PractitionerAvailability.user_id == user_id,
            PractitionerAvailability.clinic_id == clinic_id
        ).delete()
        
        # Create new availability records
        
        for day_name in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
            intervals = getattr(schedule_data, day_name)
            day_of_week = _get_day_of_week(day_name)

            for interval in intervals:
                availability = PractitionerAvailability(
                    user_id=user_id,
                    clinic_id=clinic_id,
                    day_of_week=day_of_week,
                    start_time=_parse_time(interval.start_time),
                    end_time=_parse_time(interval.end_time)
                )
                db.add(availability)
        
        db.commit()
        
        # Return updated schedule
        schedule: Dict[str, List[TimeInterval]] = {}
        for day_of_week in range(7):
            day_name = _get_day_name(day_of_week)
            schedule[day_name] = _get_default_schedule_for_day(db, user_id, day_of_week, clinic_id)
        
        return DefaultScheduleResponse(**schedule)
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to update default schedule for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新預設排程"
        )


@router.get("/practitioners/{user_id}/availability/calendar",
           summary="Get calendar data for practitioner")
async def get_calendar_data(
    user_id: int,
    month: Optional[str] = Query(None, description="Month in YYYY-MM format for monthly view"),
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format for daily view"),
    page: int = Query(1, ge=1, description="Page number for monthly view"),
    limit: int = Query(31, ge=1, le=31, description="Days per page for monthly view"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
):
    """
    Get calendar data for practitioner.
    
    Returns either monthly calendar data (appointment counts per day) or
    detailed daily calendar data (events and default schedule).
    """
    try:
        # Check clinic access first (raises HTTPException if denied)
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner in the same clinic
        # All clinic users can view any practitioner's calendar within their clinic
        user, _ = verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        if date:
            # Daily view
            try:
                target_date = parse_date_string(date)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的日期格式，請使用 YYYY-MM-DD"
                )
            
            # Get default schedule for this day of week
            day_of_week = target_date.weekday()
            default_schedule = _get_default_schedule_for_day(db, user_id, day_of_week, clinic_id)
            
            # Get events for this date with eager loading to avoid N+1 queries
            # Eagerly load all relationships: appointment -> patient -> line_user, appointment_type, and availability_exception
            events = db.query(CalendarEvent).filter(
                CalendarEvent.user_id == user_id,
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.date == target_date
            ).options(
                # Eagerly load appointment with all its relationships
                joinedload(CalendarEvent.appointment).joinedload(Appointment.patient).joinedload(Patient.line_user),
                joinedload(CalendarEvent.appointment).joinedload(Appointment.appointment_type),
                # Eagerly load availability exception
                joinedload(CalendarEvent.availability_exception)
            ).order_by(CalendarEvent.start_time).all()
            
            # Get practitioner association for name
            practitioner_association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == user_id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            ).first()
            practitioner_name = practitioner_association.full_name if practitioner_association else user.email
            
            # Collect appointment IDs for bulk receipt query (optimize N+1 query)
            appointment_ids = [
                event.appointment.calendar_event_id
                for event in events
                if event.event_type == 'appointment' 
                and event.appointment 
                and event.appointment.status == 'confirmed' 
                and not event.appointment.is_auto_assigned
            ]
            
            # Bulk load all receipts for all appointments (optimized)
            all_receipts_map = ReceiptService.get_all_receipts_for_appointments(db, appointment_ids)
            
            # Bulk load all resources for all appointments (optimized)
            all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)
            
            event_responses: List[CalendarEventResponse] = []
            for event in events:
                if event.event_type == 'appointment':
                    # Appointment is already loaded via eager loading, no additional query needed
                    appointment = event.appointment
                    
                    # Only show confirmed appointments (filter out cancelled ones)
                    # CRITICAL: Filter out auto-assigned appointments (practitioners shouldn't see them)
                    if appointment and appointment.status == 'confirmed' and not appointment.is_auto_assigned:
                        # Get LINE display name if patient has LINE user (already loaded)
                        line_display_name = None
                        if appointment.patient and appointment.patient.line_user:
                            line_display_name = appointment.patient.line_user.effective_display_name
                        
                        # Get appointment type name safely (handles cases where appointment_type may be None)
                        appointment_type_name = _get_appointment_type_name(appointment)
                        
                        # Format birthday as string if available
                        patient_birthday_str = None
                        if appointment.patient and appointment.patient.birthday:
                            patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                        
                        # Get receipt status from bulk-loaded map (all receipts)
                        receipts = all_receipts_map.get(appointment.calendar_event_id, [])
                        receipt_fields = ReceiptService.compute_receipt_fields(receipts)
                        
                        # Get resources from bulk-loaded map
                        allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
                        resource_names = [r.name for r in allocated_resources]
                        resource_ids = [r.id for r in allocated_resources]
                        
                        event_responses.append(CalendarEventResponse(
                            calendar_event_id=event.id,
                            type='appointment',
                            start_time=_format_time(event.start_time) if event.start_time else None,
                            end_time=_format_time(event.end_time) if event.end_time else None,
                            title=_get_event_title(event, appointment),
                            patient_id=appointment.patient_id,
                            appointment_type_id=appointment.appointment_type_id,
                            status=appointment.status,
                            appointment_id=appointment.calendar_event_id,
                            notes=appointment.notes,
                            clinic_notes=appointment.clinic_notes,
                            patient_phone=appointment.patient.phone_number,
                            patient_birthday=patient_birthday_str,
                            line_display_name=line_display_name,
                            patient_name=appointment.patient.full_name,
                            practitioner_name=practitioner_name,
                            appointment_type_name=appointment_type_name,
                            is_auto_assigned=appointment.is_auto_assigned,
                            resource_names=resource_names,
                            resource_ids=resource_ids,
                            has_active_receipt=receipt_fields["has_active_receipt"],
                            has_any_receipt=receipt_fields["has_any_receipt"],
                            receipt_id=receipt_fields["receipt_id"],
                            receipt_ids=receipt_fields["receipt_ids"]
                        ))
                elif event.event_type == 'availability_exception':
                    # Exception is already loaded via eager loading, no additional query needed
                    exception = event.availability_exception
                    
                    if exception:
                        event_responses.append(CalendarEventResponse(
                            calendar_event_id=event.id,
                            type='availability_exception',
                            start_time=_format_time(event.start_time) if event.start_time else None,
                            end_time=_format_time(event.end_time) if event.end_time else None,
                            title=_get_event_title(event),
                            exception_id=exception.id
                        ))
            
            return CalendarDayDetailResponse(
                date=date,
                default_schedule=default_schedule,
                events=event_responses
            )
        
        elif month:
            # Monthly view
            try:
                year, month_num = map(int, month.split('-'))
                start_date = date_type(year, month_num, 1)
                
                # Calculate end date
                if month_num == 12:
                    end_date = date_type(year + 1, 1, 1) - timedelta(days=1)
                else:
                    end_date = date_type(year, month_num + 1, 1) - timedelta(days=1)
                
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的月份格式，請使用 YYYY-MM"
                )
            
            clinic_id = ensure_clinic_access(current_user)
            
            # Get appointment counts for each day (only count confirmed appointments)
            appointment_counts = db.query(
                CalendarEvent.date,
                func.count(CalendarEvent.id).label('count')
            ).join(Appointment, CalendarEvent.id == Appointment.calendar_event_id).filter(
                CalendarEvent.user_id == user_id,
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.event_type == 'appointment',
                Appointment.status == 'confirmed',
                CalendarEvent.date >= start_date,
                CalendarEvent.date <= end_date
            ).group_by(CalendarEvent.date).all()
            
            # Create day responses
            days: List[CalendarDayResponse] = []
            for day_date, count in appointment_counts:
                days.append(CalendarDayResponse(
                    date=day_date.strftime('%Y-%m-%d'),
                    appointment_count=count
                ))
            
            return CalendarMonthResponse(
                month=month,
                total_days=len(days),
                page=page,
                limit=limit,
                days=days
            )
        
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="必須提供 'month' 或 'date' 參數"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch calendar data for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得行事曆資料"
        )


@router.post("/practitioners/calendar/batch",
           summary="Get calendar data for multiple practitioners and date range")
async def get_batch_calendar(
    request: BatchCalendarRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> BatchCalendarResponse:
    """
    Get calendar data for multiple practitioners across a date range.
    
    This endpoint efficiently fetches calendar data for multiple practitioners
    in a single request, reducing API calls from N to 1.
    
    Returns daily calendar data (events and default schedules) for each
    practitioner for each day in the date range.
    """
    try:
        # Check clinic access first
        clinic_id = ensure_clinic_access(current_user)
        
        # Parse date range
        try:
            start_date = parse_date_string(request.start_date)
            end_date = parse_date_string(request.end_date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式，請使用 YYYY-MM-DD"
            )
        
        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="開始日期不能晚於結束日期"
            )
        
        # Limit date range to prevent excessive queries
        max_days = 31
        if (end_date - start_date).days > max_days:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"日期範圍不能超過 {max_days} 天"
            )
        
        # Limit number of practitioners
        max_practitioners = 10
        if len(request.practitioner_ids) > max_practitioners:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"一次最多只能查詢 {max_practitioners} 個治療師"
            )
        
        # Verify all practitioners exist and belong to the clinic
        practitioners = db.query(User).join(UserClinicAssociation).filter(
            User.id.in_(request.practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()
        
        if len(practitioners) != len(request.practitioner_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="部分治療師不存在或不在您的診所"
            )
        
        # Get practitioner associations for names
        associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id.in_(request.practitioner_ids),
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).all()
        association_map = {a.user_id: a for a in associations}
        
        # Fetch all events for all practitioners and dates in a single query with eager loading
        events = db.query(CalendarEvent).filter(
            CalendarEvent.user_id.in_(request.practitioner_ids),
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date >= start_date,
            CalendarEvent.date <= end_date
        ).options(
            # Eagerly load all relationships to avoid N+1 queries
            joinedload(CalendarEvent.appointment).joinedload(Appointment.patient).joinedload(Patient.line_user),
            joinedload(CalendarEvent.appointment).joinedload(Appointment.appointment_type),
            joinedload(CalendarEvent.availability_exception)
        ).order_by(CalendarEvent.user_id, CalendarEvent.date, CalendarEvent.start_time).all()
        
        # Group events by practitioner and date
        events_by_practitioner_date: Dict[tuple[int, date_type], List[CalendarEvent]] = {}
        for event in events:
            key = (event.user_id, event.date)
            if key not in events_by_practitioner_date:
                events_by_practitioner_date[key] = []
            events_by_practitioner_date[key].append(event)
        
        # Collect all appointment IDs for bulk receipt query (optimize N+1 query)
        appointment_ids = [
            event.appointment.calendar_event_id
            for event in events
            if event.event_type == 'appointment'
            and event.appointment
            and event.appointment.status == 'confirmed'
            and not event.appointment.is_auto_assigned
        ]
        
        # Bulk load all receipts for all appointments (optimized)
        all_receipts_map = ReceiptService.get_all_receipts_for_appointments(db, appointment_ids)
        
        # Bulk load all resources for all appointments (optimized)
        all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)
        
        # Build response for each practitioner and date
        results: List[BatchCalendarDayResponse] = []
        current_date = start_date
        
        while current_date <= end_date:
            for practitioner_id in request.practitioner_ids:
                # Get default schedule for this day of week
                day_of_week = current_date.weekday()
                default_schedule = _get_default_schedule_for_day(db, practitioner_id, day_of_week, clinic_id)
                
                # Get practitioner name
                association = association_map.get(practitioner_id)
                practitioner_name = association.full_name if association else ""
                
                # Get events for this practitioner and date
                key = (practitioner_id, current_date)
                day_events = events_by_practitioner_date.get(key, [])
                
                # Build event responses
                event_responses: List[CalendarEventResponse] = []
                for event in day_events:
                    if event.event_type == 'appointment':
                        appointment = event.appointment
                        # CRITICAL: Filter out auto-assigned appointments (practitioners shouldn't see them)
                        if appointment and appointment.status == 'confirmed' and not appointment.is_auto_assigned:
                            line_display_name = None
                            if appointment.patient and appointment.patient.line_user:
                                line_display_name = appointment.patient.line_user.effective_display_name
                            
                            appointment_type_name = _get_appointment_type_name(appointment)
                            
                            patient_birthday_str = None
                            if appointment.patient and appointment.patient.birthday:
                                patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                            
                            # Get receipt status from bulk-loaded map (all receipts)
                            receipts = all_receipts_map.get(appointment.calendar_event_id, [])
                            receipt_fields = ReceiptService.compute_receipt_fields(receipts)
                            
                            # Get resources from bulk-loaded map
                            allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
                            resource_names = [r.name for r in allocated_resources]
                            resource_ids = [r.id for r in allocated_resources]
                            
                            event_responses.append(CalendarEventResponse(
                                calendar_event_id=event.id,
                                type='appointment',
                                start_time=_format_time(event.start_time) if event.start_time else None,
                                end_time=_format_time(event.end_time) if event.end_time else None,
                                title=_get_event_title(event, appointment),
                                patient_id=appointment.patient_id,
                                appointment_type_id=appointment.appointment_type_id,
                                status=appointment.status,
                                appointment_id=appointment.calendar_event_id,
                                notes=appointment.notes,
                                clinic_notes=appointment.clinic_notes,
                                patient_phone=appointment.patient.phone_number,
                                patient_birthday=patient_birthday_str,
                                line_display_name=line_display_name,
                                patient_name=appointment.patient.full_name,
                                practitioner_name=practitioner_name,
                                appointment_type_name=appointment_type_name,
                                is_auto_assigned=appointment.is_auto_assigned,
                                resource_names=resource_names,
                                resource_ids=resource_ids,
                                has_active_receipt=receipt_fields["has_active_receipt"],
                                has_any_receipt=receipt_fields["has_any_receipt"],
                                receipt_id=receipt_fields["receipt_id"],
                                receipt_ids=receipt_fields["receipt_ids"]
                            ))
                    elif event.event_type == 'availability_exception':
                        exception = event.availability_exception
                        if exception:
                            event_responses.append(CalendarEventResponse(
                                calendar_event_id=event.id,
                                type='availability_exception',
                                start_time=_format_time(event.start_time) if event.start_time else None,
                                end_time=_format_time(event.end_time) if event.end_time else None,
                                title=_get_event_title(event),
                                exception_id=exception.id
                            ))
                
                results.append(BatchCalendarDayResponse(
                    user_id=practitioner_id,
                    date=current_date.strftime('%Y-%m-%d'),
                    default_schedule=default_schedule,
                    events=event_responses
                ))
            
            current_date += timedelta(days=1)
        
        return BatchCalendarResponse(results=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch batch calendar data: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得行事曆資料"
        )


@router.get("/resources/{resource_id}/availability/calendar",
           summary="Get calendar data for resource")
async def get_resource_calendar_data(
    resource_id: int,
    date: str = Query(..., description="Date in YYYY-MM-DD format for daily view"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
):
    """
    Get calendar data for a resource.
    
    Returns daily calendar data (appointments using this resource).
    Only shows confirmed appointments (excludes canceled appointments).
    """
    try:
        # Check clinic access first
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify resource exists and belongs to clinic
        resource = db.query(Resource).filter(
            Resource.id == resource_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False
        ).first()
        
        if not resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="資源不存在或已被刪除"
            )
        
        # Parse date
        try:
            target_date = parse_date_string(date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式，請使用 YYYY-MM-DD"
            )
        
        # Get appointments using this resource through AppointmentResourceAllocation
        # Only show confirmed appointments (exclude canceled)
        events = db.query(CalendarEvent).join(
            AppointmentResourceAllocation,
            CalendarEvent.id == AppointmentResourceAllocation.appointment_id
        ).join(
            Appointment,
            CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            AppointmentResourceAllocation.resource_id == resource_id,
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == target_date,
            CalendarEvent.event_type == 'appointment',
            Appointment.status == 'confirmed'  # Only confirmed appointments
        ).options(
            # Eagerly load all relationships to avoid N+1 queries
            joinedload(CalendarEvent.appointment).joinedload(Appointment.patient).joinedload(Patient.line_user),
            joinedload(CalendarEvent.appointment).joinedload(Appointment.appointment_type)
        ).order_by(CalendarEvent.start_time).all()
        
        # Collect appointment IDs for bulk receipt query
        appointment_ids = [
            event.appointment.calendar_event_id
            for event in events
            if event.appointment
        ]
        
        # Bulk load all receipts for all appointments
        all_receipts_map = ReceiptService.get_all_receipts_for_appointments(db, appointment_ids)
        
        # Bulk load all resources for all appointments (optimized)
        all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)
        
        event_responses: List[CalendarEventResponse] = []
        for event in events:
            if event.appointment:
                appointment = event.appointment
                
                # Get LINE display name if patient has LINE user
                line_display_name = None
                if appointment.patient and appointment.patient.line_user:
                    line_display_name = appointment.patient.line_user.effective_display_name
                
                # Get appointment type name
                appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "Unknown"
                
                # Format birthday as string if available
                patient_birthday_str = None
                if appointment.patient and appointment.patient.birthday:
                    patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                
                # Get practitioner name
                practitioner_name = None
                if event.user_id:
                    practitioner_name = get_practitioner_display_name_for_appointment(db, appointment, clinic_id)
                
                # Get receipt status from bulk-loaded map
                receipts = all_receipts_map.get(appointment.calendar_event_id, [])
                receipt_fields = ReceiptService.compute_receipt_fields(receipts)
                
                # Get resources from bulk-loaded map
                allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
                resource_names = [r.name for r in allocated_resources]
                resource_ids = [r.id for r in allocated_resources]
                
                event_responses.append(CalendarEventResponse(
                    calendar_event_id=event.id,
                    type='appointment',
                    start_time=_format_time(event.start_time) if event.start_time else None,
                    end_time=_format_time(event.end_time) if event.end_time else None,
                    title=_get_event_title(event, appointment),
                    patient_id=appointment.patient_id,
                    appointment_type_id=appointment.appointment_type_id,
                    status=appointment.status,
                    appointment_id=appointment.calendar_event_id,
                    notes=appointment.notes,
                    clinic_notes=appointment.clinic_notes,
                    patient_phone=appointment.patient.phone_number,
                    patient_birthday=patient_birthday_str,
                    line_display_name=line_display_name,
                    patient_name=appointment.patient.full_name,
                    practitioner_name=practitioner_name,
                    appointment_type_name=appointment_type_name,
                    is_auto_assigned=appointment.is_auto_assigned,
                    resource_names=resource_names,
                    resource_ids=resource_ids,
                    has_active_receipt=receipt_fields["has_active_receipt"],
                    has_any_receipt=receipt_fields["has_any_receipt"],
                    receipt_id=receipt_fields["receipt_id"],
                    receipt_ids=receipt_fields["receipt_ids"]
                ))
        
        return ResourceCalendarDayResponse(
            resource_id=resource_id,
            date=date,
            events=event_responses
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get resource calendar data: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源行事曆資料"
        )


@router.post("/resources/calendar/batch",
           summary="Get calendar data for multiple resources and date range")
async def get_batch_resource_calendar(
    request: BatchResourceCalendarRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> BatchResourceCalendarResponse:
    """
    Get calendar data for multiple resources across a date range.
    
    This endpoint efficiently fetches calendar data for multiple resources
    in a single request, reducing API calls from N to 1.
    
    Returns daily calendar data (appointments) for each resource for each day in the date range.
    Only shows confirmed appointments (excludes canceled appointments).
    """
    try:
        # Check clinic access first
        clinic_id = ensure_clinic_access(current_user)
        
        # Parse date range
        try:
            start_date = parse_date_string(request.start_date)
            end_date = parse_date_string(request.end_date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式，請使用 YYYY-MM-DD"
            )
        
        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="開始日期不能晚於結束日期"
            )
        
        # Limit date range to prevent excessive queries
        max_days = 31
        if (end_date - start_date).days > max_days:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"日期範圍不能超過 {max_days} 天"
            )
        
        # Limit number of resources
        max_resources = 10
        if len(request.resource_ids) > max_resources:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"一次最多只能查詢 {max_resources} 個資源"
            )
        
        # Verify all resources exist and belong to the clinic
        resources = db.query(Resource).filter(
            Resource.id.in_(request.resource_ids),
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False
        ).all()
        
        if len(resources) != len(request.resource_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="部分資源不存在或已被刪除"
            )
        
        # Fetch all events for all resources and dates in a single query with eager loading
        # We need to join AppointmentResourceAllocation to get resource_id
        events_query = db.query(CalendarEvent, AppointmentResourceAllocation.resource_id).join(
            AppointmentResourceAllocation,
            CalendarEvent.id == AppointmentResourceAllocation.appointment_id
        ).join(
            Appointment,
            CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            AppointmentResourceAllocation.resource_id.in_(request.resource_ids),
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date >= start_date,
            CalendarEvent.date <= end_date,
            CalendarEvent.event_type == 'appointment',
            Appointment.status == 'confirmed'  # Only confirmed appointments
        ).options(
            # Eagerly load all relationships to avoid N+1 queries
            joinedload(CalendarEvent.appointment).joinedload(Appointment.patient).joinedload(Patient.line_user),
            joinedload(CalendarEvent.appointment).joinedload(Appointment.appointment_type)
        ).order_by(AppointmentResourceAllocation.resource_id, CalendarEvent.date, CalendarEvent.start_time)
        
        events_with_resource = events_query.all()
        
        # Group events by resource and date
        events_by_resource_date: Dict[tuple[int, date_type], List[CalendarEvent]] = {}
        for event, resource_id in events_with_resource:
            key = (resource_id, event.date)
            if key not in events_by_resource_date:
                events_by_resource_date[key] = []
            events_by_resource_date[key].append(event)
        
        # Collect all appointment IDs for bulk receipt query
        appointment_ids = [
            event.appointment.calendar_event_id
            for event, _ in events_with_resource
            if event.appointment
        ]
        
        # Bulk load all receipts for all appointments
        all_receipts_map = ReceiptService.get_all_receipts_for_appointments(db, appointment_ids)
        
        # Bulk load all resources for all appointments (optimized)
        all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)
        
        # Build response for each resource and date
        results: List[ResourceCalendarDayResponse] = []
        current_date = start_date
        while current_date <= end_date:
            for resource_id in request.resource_ids:
                key = (resource_id, current_date)
                day_events = events_by_resource_date.get(key, [])
                
                event_responses: List[CalendarEventResponse] = []
                for event in day_events:
                    if event.appointment:
                        appointment = event.appointment
                        
                        # Get LINE display name
                        line_display_name = None
                        if appointment.patient and appointment.patient.line_user:
                            line_display_name = appointment.patient.line_user.effective_display_name
                        
                        # Get appointment type name
                        appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "Unknown"
                        
                        # Format birthday
                        patient_birthday_str = None
                        if appointment.patient and appointment.patient.birthday:
                            patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                        
                        # Get practitioner name
                        practitioner_name = None
                        if event.user_id:
                            practitioner_name = get_practitioner_display_name_for_appointment(db, appointment, clinic_id)
                        
                        # Get receipt status
                        receipts = all_receipts_map.get(appointment.calendar_event_id, [])
                        receipt_fields = ReceiptService.compute_receipt_fields(receipts)
                        
                        # Get resources from bulk-loaded map
                        allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
                        resource_names = [r.name for r in allocated_resources]
                        resource_ids = [r.id for r in allocated_resources]
                        
                        event_responses.append(CalendarEventResponse(
                            calendar_event_id=event.id,
                            type='appointment',
                            start_time=_format_time(event.start_time) if event.start_time else None,
                            end_time=_format_time(event.end_time) if event.end_time else None,
                            title=_get_event_title(event, appointment),
                            patient_id=appointment.patient_id,
                            appointment_type_id=appointment.appointment_type_id,
                            status=appointment.status,
                            appointment_id=appointment.calendar_event_id,
                            notes=appointment.notes,
                            clinic_notes=appointment.clinic_notes,
                            patient_phone=appointment.patient.phone_number,
                            patient_birthday=patient_birthday_str,
                            line_display_name=line_display_name,
                            patient_name=appointment.patient.full_name,
                            practitioner_name=practitioner_name,
                            appointment_type_name=appointment_type_name,
                            is_auto_assigned=appointment.is_auto_assigned,
                            resource_names=resource_names,
                            resource_ids=resource_ids,
                            has_active_receipt=receipt_fields["has_active_receipt"],
                            has_any_receipt=receipt_fields["has_any_receipt"],
                            receipt_id=receipt_fields["receipt_id"],
                            receipt_ids=receipt_fields["receipt_ids"]
                        ))
                
                results.append(ResourceCalendarDayResponse(
                    resource_id=resource_id,
                    date=current_date.strftime('%Y-%m-%d'),
                    events=event_responses
                ))
            
            current_date += timedelta(days=1)
        
        return BatchResourceCalendarResponse(results=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch batch resource calendar data: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源行事曆資料"
        )


@router.get("/practitioners/{user_id}/availability/slots",
           summary="Get available time slots for booking")
async def get_available_slots(
    user_id: int,
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    appointment_type_id: int = Query(..., description="Appointment type ID"),
    exclude_calendar_event_id: int | None = Query(None, description="Calendar event ID to exclude from conflict checking (for appointment editing)"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> AvailableSlotsResponse:
    """
    Get available time slots for booking.
    
    Returns available time slots for a specific practitioner on a specific date
    for a specific appointment type. Used by AI agent for appointment booking.
    
    Considers:
    - Default weekly schedule
    - Availability exceptions (takes precedence)
    - Existing appointments
    - Appointment type duration
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner in the same clinic
        # All clinic users can view any practitioner's availability in their clinic
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Verify appointment type exists
        AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)
        
        # Get available slots using service
        # Do NOT apply booking restrictions for clinic admin endpoint (admins bypass restrictions)
        slots_data = AvailabilityService.get_available_slots_for_practitioner(
            db=db,
            practitioner_id=user_id,
            date=date,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            exclude_calendar_event_id=exclude_calendar_event_id,
            apply_booking_restrictions=False  # Clinic admins bypass booking restrictions
        )

        # Strip practitioner info for response (not needed since it's always same practitioner)
        available_slots = [
            AvailableSlotResponse(
                start_time=slot['start_time'],
                end_time=slot['end_time']
            )
            for slot in slots_data
        ]

        return AvailableSlotsResponse(available_slots=available_slots)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch available slots for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時段"
        )




@router.post("/practitioners/{user_id}/availability/slots/batch",
           summary="Get available time slots for multiple dates")
async def get_available_slots_batch(
    user_id: int,
    request: BatchAvailableSlotsRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> BatchAvailableSlotsResponse:
    """
    Get available time slots for multiple dates in a single request.
    
    This endpoint efficiently fetches availability for multiple dates,
    reducing API calls from N to 1.
    
    Returns available time slots for a specific practitioner on multiple dates
    for a specific appointment type. Used by appointment creation/editing flows.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner in the same clinic
        # All clinic users can view any practitioner's availability in their clinic
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Use shared service method for batch availability fetching
        # Do NOT apply booking restrictions for clinic admin endpoint (admins bypass restrictions)
        batch_results = AvailabilityService.get_batch_available_slots_for_practitioner(
            db=db,
            practitioner_id=user_id,
            dates=request.dates,
            appointment_type_id=request.appointment_type_id,
            clinic_id=clinic_id,
            exclude_calendar_event_id=request.exclude_calendar_event_id,
            apply_booking_restrictions=False  # Clinic admins bypass booking restrictions
        )
        
        # Convert to response format
        results: List[AvailableSlotsResponse] = []
        for result in batch_results:
            # Strip practitioner info for response (not needed since it's always same practitioner)
            available_slots = [
                AvailableSlotResponse(
                    start_time=slot['start_time'],
                    end_time=slot['end_time']
                )
                for slot in result['slots']
            ]
            # Include date in response for consistency with LIFF endpoint
            results.append(AvailableSlotsResponse(
                date=result['date'],
                available_slots=available_slots
            ))
        
        return BatchAvailableSlotsResponse(results=results)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Unexpected error in batch available slots endpoint: "
            f"user_id={user_id}, dates={request.dates}, "
            f"appointment_type_id={request.appointment_type_id}, "
            f"exclude_calendar_event_id={request.exclude_calendar_event_id}, error={e}"
        )
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時段"
        )


@router.post("/practitioners/{user_id}/availability/exceptions",
             summary="Create availability exception")
async def create_availability_exception(
    user_id: int,
    exception_data: AvailabilityExceptionRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> Response:
    """
    Create availability exception for practitioner.
    
    Creates a period of unavailability that overrides the default schedule.
    Multiple exceptions per day are allowed, and overlapping exceptions are permitted.
    
    If the exception conflicts with existing appointments, a warning is returned
    but the exception is still created. Appointments remain valid but marked as "outside hours".
    """
    try:
        # Check permissions - practitioners can only create their own exceptions
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能建立自己的可用時間例外"
                )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify user exists, is active, and is a practitioner
        verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        try:
            target_date = datetime.strptime(exception_data.date, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的日期格式，請使用 YYYY-MM-DD"
            )
        
        # Validate time range
        if exception_data.start_time and exception_data.end_time:
            start_time = _parse_time(exception_data.start_time)
            end_time = _parse_time(exception_data.end_time)
            
            if start_time >= end_time:
                start_formatted = _format_time_string(exception_data.start_time)
                end_formatted = _format_time_string(exception_data.end_time)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"開始時間必須早於結束時間: {start_formatted} - {end_formatted}"
                )
        elif exception_data.start_time or exception_data.end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="全天事件必須同時提供或同時省略 start_time 和 end_time"
            )
        
        clinic_id = ensure_clinic_access(current_user)

        # Check for appointment conflicts
        conflicts = []
        if exception_data.start_time and exception_data.end_time:
            conflicts = _check_appointment_conflicts(
                db, user_id, target_date,
                _parse_time(exception_data.start_time),
                _parse_time(exception_data.end_time),
                clinic_id
            )

        # If conflicts exist and force=False, return warning without creating
        if conflicts and not exception_data.force:
            return Response(
                content=ConflictWarningResponse(
                    success=False,
                    message="此可用時間例外與現有預約衝突。確定要繼續嗎？",
                    conflicts=conflicts
                ).model_dump_json(),
                status_code=status.HTTP_409_CONFLICT,
                media_type="application/json"
            )

        # If force=True, re-check conflicts to prevent race conditions
        if exception_data.force:
            # These should not be None since force creation only happens after initial conflict check
            assert exception_data.start_time is not None and exception_data.end_time is not None
            current_conflicts = _check_appointment_conflicts(
                db, user_id, target_date,
                _parse_time(exception_data.start_time),
                _parse_time(exception_data.end_time),
                clinic_id
            )
            conflicts = current_conflicts  # Update with latest conflicts

        # Create calendar event
        calendar_event = CalendarEvent(
            user_id=user_id,
            clinic_id=clinic_id,
            event_type='availability_exception',
            date=target_date,
            start_time=_parse_time(exception_data.start_time) if exception_data.start_time else None,
            end_time=_parse_time(exception_data.end_time) if exception_data.end_time else None
        )
        db.add(calendar_event)
        db.flush()  # Get the ID

        # Create availability exception
        exception = AvailabilityException(
            calendar_event_id=calendar_event.id
        )
        db.add(exception)
        db.commit()

        # Return response
        response_data = AvailabilityExceptionResponse(
            calendar_event_id=calendar_event.id,
            exception_id=exception.id,
            date=exception_data.date,
            start_time=exception_data.start_time,
            end_time=exception_data.end_time,
            created_at=calendar_event.created_at
        )

        # If there are conflicts (force=True case), return success with warning
        if conflicts:
            return Response(
                content=ConflictWarningResponse(
                    success=True,
                    message="休診時段已建立，但與現有預約衝突。預約將保持有效，但標記為「非工作時間」。",
                    warning=True,
                    conflicts=conflicts,
                    calendar_event_id=calendar_event.id,
                    exception_id=exception.id,
                    date=exception_data.date,
                    start_time=exception_data.start_time,
                    end_time=exception_data.end_time,
                    created_at=calendar_event.created_at
                ).model_dump_json(),
                status_code=status.HTTP_200_OK,  # Success with warning
                media_type="application/json"
            )

        # No conflicts - return success with 201
        return Response(
            content=response_data.model_dump_json(),
            status_code=status.HTTP_201_CREATED,
            media_type="application/json"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to create availability exception for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立可用時間例外"
        )


@router.delete("/practitioners/{user_id}/availability/exceptions/{exception_id}",
              summary="Delete availability exception",
              status_code=status.HTTP_204_NO_CONTENT)
async def delete_availability_exception(
    user_id: int,
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
):
    """
    Delete availability exception.
    
    Removes an availability exception. The associated calendar event is also deleted.
    """
    try:
        # Check permissions - practitioners can only delete their own exceptions
        if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
            if current_user.user_id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您只能刪除自己的可用時間例外"
                )
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Find the exception
        exception = db.query(AvailabilityException).join(CalendarEvent).filter(
            AvailabilityException.id == exception_id,
            CalendarEvent.user_id == user_id,
            CalendarEvent.clinic_id == clinic_id
        ).first()
        
        if not exception:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到可用時間例外"
            )
        
        # Delete the calendar event first, then the exception
        calendar_event = exception.calendar_event
        db.delete(exception)
        db.delete(calendar_event)
        db.commit()
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to delete availability exception {exception_id} for user {user_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除可用時間例外"
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
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此事件"
            )
        
        # Check permissions
        is_admin = current_user.has_role('admin')
        if not is_admin:
            # Practitioners can only edit their own events
            if calendar_event.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
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
        db.rollback()
        logger.exception(f"Failed to update event name: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新事件名稱失敗"
        )


@router.post("/practitioners/availability/conflicts/batch", response_model=BatchConflictCheckResponse)
async def check_batch_scheduling_conflicts(
    request: BatchConflictCheckRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_practitioner_or_admin)
) -> BatchConflictCheckResponse:
    """
    Check scheduling conflicts for multiple practitioners at once.

    This endpoint optimizes conflict checking by batching database queries
    and processing conflicts in-memory, reducing API calls from N to ~2 total.

    Returns conflict information for each practitioner in priority order:
    1. Appointment conflicts
    2. Availability exception conflicts
    3. Outside default availability
    4. Resource conflicts

    Used by the practitioner selection modal to efficiently check conflicts
    for multiple practitioners when date/time is selected.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Parse date
        requested_date = parse_date_string(request.date)

        # Parse start_time
        try:
            hour, minute = map(int, request.start_time.split(':'))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError("Invalid time range")
            start_time_obj = time(hour, minute)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的時間格式（請使用 HH:MM）"
            )

        # Verify all practitioners exist and are active in the clinic
        practitioner_ids = [p.user_id for p in request.practitioners]
        for practitioner_id in practitioner_ids:
            verify_practitioner_in_clinic(db, practitioner_id, clinic_id)

        # Check batch conflicts
        conflict_results = AvailabilityService.check_batch_scheduling_conflicts(
            db=db,
            practitioners=[{"user_id": p.user_id, "exclude_calendar_event_id": p.exclude_calendar_event_id}
                          for p in request.practitioners],
            date=requested_date,
            start_time=start_time_obj,
            appointment_type_id=request.appointment_type_id,
            clinic_id=clinic_id,
            selected_resource_ids=request.selected_resource_ids
        )

        # Convert dict results to proper response objects
        results: List[BatchSchedulingConflictResponse] = []
        for result in conflict_results:
            results.append(BatchSchedulingConflictResponse(**result))

        return BatchConflictCheckResponse(results=results)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to check batch scheduling conflicts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="檢查衝突失敗，請稍後再試"
        )

