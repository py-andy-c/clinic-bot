# pyright: reportMissingTypeStubs=false
"""
Dashboard and Analytics API endpoints.
"""

import logging
from datetime import datetime
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, cast, String, or_
from sqlalchemy.sql import sqltypes

from core.database import get_db
from auth.dependencies import require_practitioner_or_admin, require_clinic_user, UserContext, ensure_clinic_access
from models import Appointment, CalendarEvent
from services.availability_service import AvailabilityService
from services.resource_service import ResourceService
from services.business_insights_service import BusinessInsightsService, RevenueDistributionService
from utils.datetime_utils import parse_date_string, taiwan_now, TAIWAN_TZ
from api.responses import (
    ClinicDashboardMetricsResponse,
    BusinessInsightsResponse,
    RevenueDistributionResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _parse_service_item_id(service_item_id: Optional[str]) -> Optional[Union[int, str]]:
    """
    Parse service_item_id parameter.

    Can be:
    - None: No filter
    - Integer: Standard service item ID
    - String starting with 'custom:': Custom service item name

    Returns:
        Parsed service item ID (int, str, or None)

    Raises:
        HTTPException: If format is invalid
    """
    if not service_item_id:
        return None
    if service_item_id.startswith('custom:'):
        return service_item_id
    try:
        return int(service_item_id)
    except ValueError:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="無效的服務項目ID格式"
        )


def _parse_practitioner_id(practitioner_id: Optional[Union[int, str]]) -> Optional[Union[int, str]]:
    """
    Parse practitioner_id parameter from query param.

    FastAPI Query parameters come as strings by default, so we need to convert
    numeric strings to int. Can be:
    - None: No filter
    - Integer: Practitioner ID
    - String 'null': Filter for items without practitioners
    - String numeric: Practitioner ID as string (will be converted to int)

    Returns:
        Parsed practitioner ID (int, str 'null', or None)

    Raises:
        HTTPException: If format is invalid
    """
    if practitioner_id is None:
        return None
    if isinstance(practitioner_id, str):
        if practitioner_id == 'null':
            return 'null'
        else:
            # Try to convert string to int (FastAPI Query params are strings by default)
            try:
                return int(practitioner_id)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"無效的治療師ID: {practitioner_id}"
                )
    else:
        # Must be int at this point (type is Optional[Union[int, str]])
        return practitioner_id


class AutoAssignedAppointmentItem(BaseModel):
    """Response model for appointments requiring review (auto-assigned or pending time confirmation)."""
    appointment_id: int
    calendar_event_id: int
    patient_name: str
    patient_id: int
    practitioner_id: int
    practitioner_name: str
    appointment_type_id: int
    appointment_type_name: str
    start_time: str
    end_time: str
    notes: Optional[str] = None
    originally_auto_assigned: bool
    pending_time_confirmation: bool = False
    alternative_time_slots: Optional[List[str]] = None
    resource_names: List[str] = []  # Names of allocated resources
    resource_ids: List[int] = []  # IDs of allocated resources


class AutoAssignedAppointmentsResponse(BaseModel):
    """Response model for listing auto-assigned appointments."""
    appointments: List[AutoAssignedAppointmentItem]


@router.get("/pending-review-appointments", summary="List appointments requiring review")
async def list_pending_review_appointments(
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> AutoAssignedAppointmentsResponse:
    """
    List all upcoming appointments that require clinic review.

    Includes both:
    - Auto-assigned appointments (practitioner not yet assigned)
    - Multiple time slot appointments (time not yet confirmed)

    Clinic admins can view all pending appointments.
    Practitioners can view time confirmation appointments where they are the assigned practitioner.
    Appointments are sorted by date.
    After review/confirmation, appointments will no longer appear in this list.

    Note: Only future appointments are returned as defensive programming.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get current Taiwan time for filtering future appointments
        # All datetime operations use Taiwan timezone
        now = taiwan_now()
        
        # Convert to timezone-naive for PostgreSQL comparison
        # CalendarEvent stores date and time as separate fields (timezone-naive)
        # We need to compare timezone-naive timestamps
        now_naive = now.replace(tzinfo=None)
        
        # Query appointments requiring review for this clinic
        # Show appointments that are either:
        # 1. Still auto-assigned (is_auto_assigned = True) - original logic
        # 2. Pending time confirmation (pending_time_confirmation = True) - new multiple slot logic
        # Additional filters:
        # - Confirmed status
        # - In the future (defensive programming)
        # - Have a start_time (defensive check)
        # Note: CalendarEvent.date and start_time are stored as timezone-naive
        # (they represent Taiwan local time without timezone info)
        appointments = db.query(Appointment).join(
            CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
        ).filter(
            or_(
                Appointment.is_auto_assigned == True,
                Appointment.pending_time_confirmation == True
            ),
            Appointment.status == 'confirmed',
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.start_time.isnot(None),  # Defensive: ensure start_time exists
            # Defensive programming: Filter out past appointments
            # Combine date and start_time for proper datetime comparison
            # PostgreSQL: cast concatenated date+time string to timestamp (timezone-naive)
            # Compare with timezone-naive now_naive
            cast(
                func.concat(
                    cast(CalendarEvent.date, String),
                    ' ',
                    cast(CalendarEvent.start_time, String)
                ),
                sqltypes.TIMESTAMP
            ) > now_naive
        )

        # Apply role-based filtering
        # Admins can see all pending appointments
        # Practitioners can only see time confirmation appointments where they are assigned
        if not current_user.has_role("admin") and current_user.has_role("practitioner"):
            appointments = appointments.filter(
                Appointment.pending_time_confirmation == True,
                CalendarEvent.user_id == current_user.user_id
            )

        appointments = appointments.options(
            joinedload(Appointment.patient),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        ).order_by(CalendarEvent.date, CalendarEvent.start_time).all()
        
        # Get practitioner associations for names
        practitioner_ids = [appt.calendar_event.user_id for appt in appointments if appt.calendar_event and appt.calendar_event.user_id]
        association_lookup = AvailabilityService.get_practitioner_associations_batch(
            db, practitioner_ids, clinic_id
        )
        
        # Bulk load all resources for all appointments (optimized)
        appointment_ids = [appt.calendar_event_id for appt in appointments]
        all_resources_map = ResourceService.get_all_resources_for_appointments(db, appointment_ids)
        
        # Format response
        result: List[AutoAssignedAppointmentItem] = []
        
        for appointment in appointments:
            practitioner = appointment.calendar_event.user
            appointment_type = appointment.appointment_type
            patient = appointment.patient
            
            if not all([practitioner, appointment_type, patient]):
                continue
            
            # Get practitioner name from association
            association = association_lookup.get(practitioner.id)
            practitioner_name = association.full_name if association else practitioner.email
            
            # Format datetime
            event_date = appointment.calendar_event.date
            if appointment.calendar_event.start_time:
                start_datetime = datetime.combine(event_date, appointment.calendar_event.start_time).replace(tzinfo=TAIWAN_TZ)
            else:
                start_datetime = None
            if appointment.calendar_event.end_time:
                end_datetime = datetime.combine(event_date, appointment.calendar_event.end_time).replace(tzinfo=TAIWAN_TZ)
            else:
                end_datetime = None
            
            # Get resources from bulk-loaded map
            allocated_resources = all_resources_map.get(appointment.calendar_event_id, [])
            resource_names = [r.name for r in allocated_resources]
            resource_ids = [r.id for r in allocated_resources]
            
            result.append(AutoAssignedAppointmentItem(
                appointment_id=appointment.calendar_event_id,
                calendar_event_id=appointment.calendar_event_id,
                patient_name=patient.full_name,
                patient_id=patient.id,
                practitioner_id=practitioner.id,
                practitioner_name=practitioner_name,
                appointment_type_id=appointment.appointment_type_id,
                appointment_type_name=appointment_type.name if appointment_type else "未設定",
                start_time=start_datetime.isoformat() if start_datetime else "",
                end_time=end_datetime.isoformat() if end_datetime else "",
                notes=appointment.notes,
                originally_auto_assigned=appointment.originally_auto_assigned,
                pending_time_confirmation=appointment.pending_time_confirmation,
                alternative_time_slots=appointment.alternative_time_slots or None,
                resource_names=resource_names,
                resource_ids=resource_ids
            ))
        
        return AutoAssignedAppointmentsResponse(appointments=result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error listing auto-assigned appointments: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得待審核預約列表"
        )


@router.get("/dashboard/metrics", summary="Get clinic dashboard metrics")
async def get_dashboard_metrics(
    current_user: UserContext = Depends(require_clinic_user),
    db: Session = Depends(get_db)
) -> ClinicDashboardMetricsResponse:
    """
    Get aggregated dashboard metrics for the clinic.

    Returns metrics for past 3 months + current month, including:
    - Patient statistics (active patients, new patients)
    - Appointment statistics (counts, cancellation rates, types, practitioners)
    - Message statistics (paid messages, AI replies)

    Clinic users only.
    """
    try:
        from services.dashboard_service import DashboardService
        from api.responses import MonthInfo
        
        clinic_id = ensure_clinic_access(current_user)
        
        # Get all metrics
        metrics = DashboardService.get_clinic_metrics(db, clinic_id)
        
        # Convert month dicts to MonthInfo objects for Pydantic
        # Convert months list
        metrics['months'] = [MonthInfo(**m) for m in metrics['months']]
        
        # Convert nested month dicts in all metric lists
        for stat in metrics.get('active_patients_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('new_patients_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('appointments_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('cancellation_rate_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('appointment_type_stats_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('practitioner_stats_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('paid_messages_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        for stat in metrics.get('ai_reply_messages_by_month', []):
            if 'month' in stat and isinstance(stat['month'], dict):
                stat['month'] = MonthInfo(**stat['month'])
        
        # Convert to response model
        return ClinicDashboardMetricsResponse(**metrics)
        
    except HTTPException:
        raise
    except Exception as e:
        clinic_id_str = str(getattr(current_user, 'active_clinic_id', 'unknown'))
        logger.exception(f"Error getting dashboard metrics for clinic {clinic_id_str}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得儀表板數據"
        )


@router.get("/dashboard/business-insights", summary="Get business insights data")
async def get_business_insights(
    start_date: str = Query(..., description="Start date in YYYY-MM-DD format"),
    end_date: str = Query(..., description="End date in YYYY-MM-DD format"),
    practitioner_id: Optional[Union[int, str]] = Query(None, description="Optional practitioner ID to filter by, or 'null' to filter for items without practitioners"),
    service_item_id: Optional[str] = Query(None, description="Optional service item ID or 'custom:name' to filter by"),
    service_type_group_id: Optional[Union[int, str]] = Query(None, description="Optional service type group ID to filter by, or '-1' for ungrouped"),
    current_user: UserContext = Depends(require_clinic_user),
    db: Session = Depends(get_db)
):
    """
    Get business insights data for a date range.

    Returns summary statistics, revenue trend, and breakdowns by service item and practitioner.
    Clinic users only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Parse dates
        try:
            start = parse_date_string(start_date)
            end = parse_date_string(end_date)
        except ValueError as e:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=f"無效的日期格式: {str(e)}"
            )

        # Parse service_item_id
        parsed_service_item_id = _parse_service_item_id(service_item_id)

        # Parse practitioner_id
        parsed_practitioner_id = _parse_practitioner_id(practitioner_id)

        # Parse service_type_group_id
        parsed_group_id = None
        if service_type_group_id is not None:
            if isinstance(service_type_group_id, str):
                if service_type_group_id == '-1':
                    parsed_group_id = -1  # -1 means "ungrouped"
                else:
                    parsed_group_id = int(service_type_group_id)
            else:
                parsed_group_id = service_type_group_id
        
        # Get business insights
        insights = BusinessInsightsService.get_business_insights(
            db, clinic_id, start, end, parsed_practitioner_id, parsed_service_item_id, parsed_group_id
        )

        return BusinessInsightsResponse(**insights)
    except HTTPException:
        raise
    except Exception as e:
        clinic_id_str = str(getattr(current_user, 'active_clinic_id', 'unknown'))
        logger.exception(f"Error getting business insights for clinic {clinic_id_str}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得業務洞察數據"
        )


@router.get("/dashboard/revenue-distribution", summary="Get revenue distribution data")
async def get_revenue_distribution(
    start_date: str = Query(..., description="Start date in YYYY-MM-DD format"),
    end_date: str = Query(..., description="End date in YYYY-MM-DD format"),
    practitioner_id: Optional[Union[int, str]] = Query(None, description="Optional practitioner ID to filter by, or 'null' to filter for items without practitioners"),
    service_item_id: Optional[str] = Query(None, description="Optional service item ID or 'custom:name' to filter by"),
    service_type_group_id: Optional[Union[int, str]] = Query(None, description="Optional service type group ID to filter by, or '-1' for ungrouped"),
    show_overwritten_only: bool = Query(False, description="Only show items with overwritten billing scenario"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(200, ge=1, le=500, description="Items per page"),
    sort_by: str = Query('date', description="Column to sort by"),
    sort_order: str = Query('desc', regex='^(asc|desc)$', description="Sort order"),
    current_user: UserContext = Depends(require_clinic_user),
    db: Session = Depends(get_db)
):
    """
    Get revenue distribution data for a date range.

    Returns summary statistics and paginated list of receipt items.
    Clinic users only. Non-admin users can only view their own data.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Parse dates
        try:
            start = parse_date_string(start_date)
            end = parse_date_string(end_date)
        except ValueError as e:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=f"無效的日期格式: {str(e)}"
            )

        # Parse service_item_id
        parsed_service_item_id = _parse_service_item_id(service_item_id)

        # Parse practitioner_id
        parsed_practitioner_id = _parse_practitioner_id(practitioner_id)

        # Parse service_type_group_id
        parsed_group_id = None
        if service_type_group_id is not None:
            if isinstance(service_type_group_id, str):
                if service_type_group_id == '-1':
                    parsed_group_id = -1  # -1 means "ungrouped"
                else:
                    parsed_group_id = int(service_type_group_id)
            else:
                parsed_group_id = service_type_group_id

        # Non-admin users can only view their own data
        if not current_user.has_role("admin"):
            # Force filter to current user's practitioner ID
            parsed_practitioner_id = current_user.user_id

        # Get revenue distribution
        distribution = RevenueDistributionService.get_revenue_distribution(
            db, clinic_id, start, end, parsed_practitioner_id, parsed_service_item_id,
            parsed_group_id, show_overwritten_only, page, page_size, sort_by, sort_order
        )

        return RevenueDistributionResponse(**distribution)
    except HTTPException:
        raise
    except Exception as e:
        clinic_id_str = str(getattr(current_user, 'active_clinic_id', 'unknown'))
        logger.exception(f"Error getting revenue distribution for clinic {clinic_id_str}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得分潤審核數據"
        )

