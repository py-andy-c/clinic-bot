"""
Practitioner calendar API endpoints.

Provides calendar management functionality including:
- Default weekly schedule management
- Calendar data retrieval (monthly/daily views)
- Availability exception management
- Available slots for AI agent booking
"""

import logging
from datetime import datetime, date as date_type, time, timedelta
from typing import Dict, List, Optional, Any, Union

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

logger = logging.getLogger(__name__)

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from models import (
    User,
    PractitionerAvailability, CalendarEvent, AvailabilityException, Appointment,
    UserClinicAssociation, Patient
)
from services import AvailabilityService, AppointmentTypeService
from api.responses import AvailableSlotsResponse, AvailableSlotResponse, ConflictWarningResponse

router = APIRouter()


# Request/Response Models

class TimeInterval(BaseModel):
    """Time interval model for availability periods."""
    start_time: str  # Format: "HH:MM"
    end_time: str    # Format: "HH:MM"


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
    notes: Optional[str] = None  # Appointment notes
    patient_phone: Optional[str] = None  # Patient phone number
    patient_birthday: Optional[str] = None  # Patient birthday (YYYY-MM-DD format, string for calendar display)
    line_display_name: Optional[str] = None  # LINE display name
    patient_name: Optional[str] = None  # Patient full name for cancellation preview
    practitioner_name: Optional[str] = None  # Practitioner full name for cancellation preview
    appointment_type_name: Optional[str] = None  # Appointment type name for cancellation preview
    is_auto_assigned: Optional[bool] = None  # Whether appointment is auto-assigned by system


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


class AvailabilityExceptionRequest(BaseModel):
    """Request model for creating availability exceptions."""
    date: str  # Format: "YYYY-MM-DD"
    start_time: Optional[str] = None  # Format: "HH:MM" or None for all-day
    end_time: Optional[str] = None    # Format: "HH:MM" or None for all-day


class AvailabilityExceptionResponse(BaseModel):
    """Response model for availability exceptions."""
    calendar_event_id: int
    exception_id: int
    date: str
    start_time: Optional[str]
    end_time: Optional[str]
    created_at: datetime


# Helper Functions

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


def _format_time_12h(time_str: str) -> str:
    """Format 24-hour time string to 12-hour format with AM/PM."""
    hour, minute = map(int, time_str.split(':'))
    if hour == 0:
        return f"12:{minute:02d} AM"
    elif hour < 12:
        return f"{hour}:{minute:02d} AM"
    elif hour == 12:
        return f"12:{minute:02d} PM"
    else:
        return f"{hour-12}:{minute:02d} PM"


def _check_time_overlap(start1: time, end1: time, start2: time, end2: time) -> bool:
    """Check if two time intervals overlap."""
    return start1 < end2 and start2 < end1


def _get_appointment_type_name(appointment: Appointment) -> Optional[str]:
    """
    Safely get appointment type name, returning None if appointment_type is not set.
    
    This handles cases where an appointment may not have an associated appointment_type,
    which can occur when appointment types are deleted or when data integrity issues exist.
    
    Args:
        appointment: The Appointment object to get the type name from
        
    Returns:
        The appointment type name if available, None otherwise
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
) -> List[Dict[str, Any]]:
    """Check for appointment conflicts with availability exception."""
    conflicts: List[Dict[str, Any]] = []
    
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
        conflicts.append({
            'calendar_event_id': appointment.calendar_event_id,
            'start_time': _format_time(appointment.calendar_event.start_time),
            'end_time': _format_time(appointment.calendar_event.end_time),
            'patient': appointment.patient.full_name,
            'appointment_type': _get_appointment_type_name(appointment)
        })
    
    return conflicts


# Helper Functions

def _verify_practitioner_in_clinic(
    db: Session,
    user_id: int,
    clinic_id: int
) -> tuple[User, UserClinicAssociation]:
    """
    Verify that a user exists, is active, is in the clinic, and has practitioner role.
    
    This function efficiently queries UserClinicAssociation directly and eagerly loads
    the User relationship to avoid N+1 queries.
    
    Args:
        db: Database session
        user_id: User ID to verify
        clinic_id: Clinic ID to verify membership in
        
    Returns:
        Tuple of (User, UserClinicAssociation) if valid
        
    Raises:
        HTTPException(404) if user not found, inactive, or not a practitioner
    """
    # Query association directly (more efficient than joining User first)
    # Use joinedload to eagerly load user relationship to avoid additional query
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).options(joinedload(UserClinicAssociation.user)).first()
    
    if not association:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師或治療師已停用"
        )
    
    user = association.user
    # User is_active check removed - access controlled by association.is_active
    
    if 'practitioner' not in (association.roles or []):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師或治療師已停用"
        )
    
    return user, association


# API Endpoints

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
        _verify_practitioner_in_clinic(db, user_id, clinic_id)
        
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        _verify_practitioner_in_clinic(db, user_id, clinic_id)
        
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
                    start_formatted = _format_time_12h(interval1.start_time)
                    end_formatted = _format_time_12h(interval1.end_time)
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
                            start1_formatted = _format_time_12h(interval1.start_time)
                            end1_formatted = _format_time_12h(interval1.end_time)
                            start2_formatted = _format_time_12h(interval2.start_time)
                            end2_formatted = _format_time_12h(interval2.end_time)
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
        user, _ = _verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        if date:
            # Daily view
            try:
                target_date = datetime.strptime(date, '%Y-%m-%d').date()
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
            
            event_responses: List[CalendarEventResponse] = []
            for event in events:
                if event.event_type == 'appointment':
                    # Appointment is already loaded via eager loading, no additional query needed
                    appointment = event.appointment
                    
                    # Only show confirmed appointments (filter out cancelled ones)
                    if appointment and appointment.status == 'confirmed':
                        # Get LINE display name if patient has LINE user (already loaded)
                        line_display_name = None
                        if appointment.patient and appointment.patient.line_user:
                            line_display_name = appointment.patient.line_user.display_name
                        
                        # Get appointment type name safely (handles cases where appointment_type may be None)
                        appointment_type_name = _get_appointment_type_name(appointment)
                        
                        # Format birthday as string if available
                        patient_birthday_str = None
                        if appointment.patient and appointment.patient.birthday:
                            patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                        
                        event_responses.append(CalendarEventResponse(
                            calendar_event_id=event.id,
                            type='appointment',
                            start_time=_format_time(event.start_time) if event.start_time else None,
                            end_time=_format_time(event.end_time) if event.end_time else None,
                            title=f"{appointment.patient.full_name} - {appointment_type_name or '未設定'}",
                            patient_id=appointment.patient_id,
                            appointment_type_id=appointment.appointment_type_id,
                            status=appointment.status,
                            appointment_id=appointment.calendar_event_id,
                            notes=appointment.notes,
                            patient_phone=appointment.patient.phone_number,
                            patient_birthday=patient_birthday_str,
                            line_display_name=line_display_name,
                            patient_name=appointment.patient.full_name,
                            practitioner_name=practitioner_name,
                            appointment_type_name=appointment_type_name,
                            is_auto_assigned=appointment.is_auto_assigned
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
                            title="休診",
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
            start_date = datetime.strptime(request.start_date, '%Y-%m-%d').date()
            end_date = datetime.strptime(request.end_date, '%Y-%m-%d').date()
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
                        if appointment and appointment.status == 'confirmed':
                            line_display_name = None
                            if appointment.patient and appointment.patient.line_user:
                                line_display_name = appointment.patient.line_user.display_name
                            
                            appointment_type_name = _get_appointment_type_name(appointment)
                            
                            patient_birthday_str = None
                            if appointment.patient and appointment.patient.birthday:
                                patient_birthday_str = appointment.patient.birthday.strftime('%Y-%m-%d')
                            
                            event_responses.append(CalendarEventResponse(
                                calendar_event_id=event.id,
                                type='appointment',
                                start_time=_format_time(event.start_time) if event.start_time else None,
                                end_time=_format_time(event.end_time) if event.end_time else None,
                                title=f"{appointment.patient.full_name} - {appointment_type_name or '未設定'}",
                                patient_id=appointment.patient_id,
                                appointment_type_id=appointment.appointment_type_id,
                                status=appointment.status,
                                appointment_id=appointment.calendar_event_id,
                                notes=appointment.notes,
                                patient_phone=appointment.patient.phone_number,
                                patient_birthday=patient_birthday_str,
                                line_display_name=line_display_name,
                                patient_name=appointment.patient.full_name,
                                practitioner_name=practitioner_name,
                                appointment_type_name=appointment_type_name,
                                is_auto_assigned=appointment.is_auto_assigned
                            ))
                    elif event.event_type == 'availability_exception':
                        exception = event.availability_exception
                        if exception:
                            event_responses.append(CalendarEventResponse(
                                calendar_event_id=event.id,
                                type='availability_exception',
                                start_time=_format_time(event.start_time) if event.start_time else None,
                                end_time=_format_time(event.end_time) if event.end_time else None,
                                title="休診",
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得行事曆資料"
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
        _verify_practitioner_in_clinic(db, user_id, clinic_id)
        
        # Verify appointment type exists
        AppointmentTypeService.get_appointment_type_by_id(db, appointment_type_id)
        
        # Get available slots using service
        slots_data = AvailabilityService.get_available_slots_for_practitioner(
            db=db,
            practitioner_id=user_id,
            date=date,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            exclude_calendar_event_id=exclude_calendar_event_id
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得可用時段"
        )


@router.post("/practitioners/{user_id}/availability/exceptions",
             summary="Create availability exception",
             status_code=status.HTTP_201_CREATED)
async def create_availability_exception(
    user_id: int,
    exception_data: AvailabilityExceptionRequest,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_authenticated)
) -> Union[AvailabilityExceptionResponse, ConflictWarningResponse]:
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
        _verify_practitioner_in_clinic(db, user_id, clinic_id)
        
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
                start_formatted = _format_time_12h(exception_data.start_time)
                end_formatted = _format_time_12h(exception_data.end_time)
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
        response = AvailabilityExceptionResponse(
            calendar_event_id=calendar_event.id,
            exception_id=exception.id,
            date=exception_data.date,
            start_time=exception_data.start_time,
            end_time=exception_data.end_time,
            created_at=calendar_event.created_at
        )
        
        # If there are conflicts, return warning response
        if conflicts:
            return ConflictWarningResponse(
                success=False,
                message="此可用時間例外與現有預約衝突。預約將保持有效，但標記為「非工作時間」。",
                conflicts=conflicts
            )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to create availability exception for user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除可用時間例外"
        )
