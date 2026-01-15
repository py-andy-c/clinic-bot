"""
Shared response models for API endpoints.

This module contains Pydantic response models that are shared across
multiple API endpoints to ensure consistency and reduce duplication.
"""

from datetime import datetime, date
from typing import List, Optional, Dict, Any

from pydantic import BaseModel


class PatientResponse(BaseModel):
    """Response model for patient information."""
    id: int
    full_name: str
    phone_number: Optional[str] = None  # Optional for clinic-created patients
    birthday: Optional[date] = None  # Python date object (serialized to YYYY-MM-DD in JSON)
    gender: Optional[str] = None  # Patient gender (生理性別): 'male', 'female', 'other', or None
    notes: Optional[str] = None  # Optional notes/remarks about the patient (備注)
    created_at: datetime
    future_appointments_count: Optional[int] = None  # Number of future appointments for this patient
    max_future_appointments: Optional[int] = None  # Maximum allowed future appointments for this clinic
    assigned_practitioners: Optional[List[Dict[str, Any]]] = None  # Assigned practitioners with id, full_name, and is_active


class PatientCreateResponse(BaseModel):
    """Response model for patient creation."""
    patient_id: int
    full_name: str
    phone_number: Optional[str] = None  # Optional for clinic-created patients
    birthday: Optional[date] = None
    gender: Optional[str] = None  # Patient gender (生理性別): 'male', 'female', 'other', or None
    notes: Optional[str] = None  # Optional notes/remarks about the patient (備注)
    created_at: datetime


class PatientListResponse(BaseModel):
    """Response model for listing patients."""
    patients: List[PatientResponse]


class AppointmentTypeResponse(BaseModel):
    """Response model for appointment type."""
    id: int
    clinic_id: int
    name: str
    duration_minutes: int
    receipt_name: Optional[str] = None
    allow_patient_booking: bool = True  # DEPRECATED: Use allow_new_patient_booking and allow_existing_patient_booking
    allow_new_patient_booking: bool = True
    allow_existing_patient_booking: bool = True
    allow_patient_practitioner_selection: bool = True
    description: Optional[str] = None
    scheduling_buffer_minutes: int = 0
    service_type_group_id: Optional[int] = None
    display_order: int = 0
    # Message customization fields
    send_patient_confirmation: bool = True
    send_clinic_confirmation: bool = True
    send_reminder: bool = True
    patient_confirmation_message: str
    clinic_confirmation_message: str
    reminder_message: str
    # Notes customization fields
    require_notes: bool = False
    notes_instructions: Optional[str] = None


class AppointmentTypeListResponse(BaseModel):
    """Response model for listing appointment types."""
    appointment_types: List[AppointmentTypeResponse]
    appointment_type_instructions: Optional[str] = None


class ServiceTypeGroupResponse(BaseModel):
    """Response model for service type group."""
    id: int
    clinic_id: int
    name: str
    display_order: int
    created_at: datetime
    updated_at: datetime


class ServiceTypeGroupListResponse(BaseModel):
    """Response model for list of service type groups."""
    groups: List[ServiceTypeGroupResponse]


class PractitionerResponse(BaseModel):
    """Response model for practitioner information."""
    id: int
    full_name: str
    offered_types: List[int]


class PractitionerListResponse(BaseModel):
    """Response model for listing practitioners."""
    practitioners: List[PractitionerResponse]


class AvailabilitySlot(BaseModel):
    """Response model for availability slot."""
    start_time: str
    end_time: str
    practitioner_id: int
    practitioner_name: str
    is_recommended: Optional[bool] = None  # True if slot is recommended for compact scheduling


class AvailabilityResponse(BaseModel):
    """Response model for availability query."""
    date: str
    slots: List[AvailabilitySlot]


class AppointmentResponse(BaseModel):
    """Response model for appointment creation."""
    appointment_id: int
    calendar_event_id: int
    patient_name: str
    practitioner_name: str
    appointment_type_name: str
    start_time: datetime
    end_time: datetime
    status: str
    notes: Optional[str]
    clinic_notes: Optional[str] = None
    practitioner_id: int
    is_auto_assigned: Optional[bool] = False


class AppointmentListItem(BaseModel):
    """Response model for appointment list item."""
    id: int  # calendar_event_id (kept for backward compatibility)
    calendar_event_id: int  # Explicit field for clarity
    patient_id: int
    patient_name: str
    practitioner_id: Optional[int] = None  # None for auto-assigned appointments when user is not admin
    practitioner_name: str
    appointment_type_id: int
    appointment_type_name: str
    event_name: str  # Effective calendar event name (custom_event_name or default format)
    start_time: str
    end_time: str
    status: str
    notes: Optional[str]
    clinic_notes: Optional[str] = None
    line_display_name: Optional[str] = None
    originally_auto_assigned: bool = False
    is_auto_assigned: bool = False
    resource_names: List[str] = []  # Names of allocated resources
    resource_ids: List[int] = []  # IDs of allocated resources
    has_active_receipt: bool = False  # Whether appointment has an active (non-voided) receipt
    has_any_receipt: bool = False  # Whether appointment has any receipt (active or voided)
    receipt_id: Optional[int] = None  # ID of active receipt (null if no active receipt)
    receipt_ids: List[int] = []  # List of all receipt IDs (always included, empty if none)
    pending_time_confirmation: bool = False  # Whether appointment is waiting for time confirmation from multiple slot selection


class AppointmentListResponse(BaseModel):
    """Response model for listing appointments."""
    appointments: List[AppointmentListItem]


# Clinic-specific response models (extend shared ones)

class ClinicPatientResponse(PatientResponse):
    """Response model for patient information in clinic context (includes line_user_id and display_name)."""
    line_user_id: Optional[str]
    line_user_display_name: Optional[str]
    line_user_picture_url: Optional[str] = None
    is_deleted: Optional[bool] = False  # Indicates if patient was soft-deleted by LINE user
    assigned_practitioner_ids: Optional[List[int]] = None  # List of assigned practitioner (user) IDs
    # birthday is inherited from PatientResponse


class ClinicPatientListResponse(BaseModel):
    """Response model for listing patients in clinic context."""
    patients: List[ClinicPatientResponse]
    total: int
    page: int
    page_size: int


class AvailableSlotResponse(BaseModel):
    """Response model for available time slot."""
    start_time: str
    end_time: str


class PractitionerAppointmentTypesResponse(BaseModel):
    """Response model for practitioner's appointment types."""
    practitioner_id: int
    appointment_types: List[AppointmentTypeResponse]


class PractitionerStatusResponse(BaseModel):
    """Response model for practitioner's configuration status."""
    has_appointment_types: bool
    has_availability: bool
    appointment_types_count: int


class AvailableSlotsResponse(BaseModel):
    """Response model for available slots query."""
    date: Optional[str] = None  # Date in YYYY-MM-DD format (included in batch responses)
    available_slots: List[AvailableSlotResponse]


class ConflictDetail(BaseModel):
    """Detail model for appointment conflicts."""
    calendar_event_id: int
    start_time: str
    end_time: str
    patient: str
    appointment_type: Optional[str]


class ConflictWarningResponse(BaseModel):
    """Response model for conflict warning."""
    success: bool
    message: str
    conflicts: List[ConflictDetail]


class AppointmentTypeReference(BaseModel):
    """Reference model for appointment type in deletion errors."""
    id: int
    name: str
    practitioners: List[str]
    is_blocked: Optional[bool] = None
    has_warnings: Optional[bool] = None
    future_appointment_count: Optional[int] = None
    past_appointment_count: Optional[int] = None


class AppointmentTypeDeletionErrorResponse(BaseModel):
    """Response model for appointment type deletion error."""
    error: str
    message: str
    appointment_types: List[AppointmentTypeReference]


class MemberResponse(BaseModel):
    """Response model for team member information."""
    id: int
    email: str
    full_name: str
    roles: List[str]
    is_active: bool
    created_at: datetime
    patient_booking_allowed: Optional[bool] = None  # Only set for practitioners, available to all users for read-only access
    step_size_minutes: Optional[int] = None  # Only set for practitioners if they have an override


class MemberListResponse(BaseModel):
    """Response model for listing clinic members."""
    members: List[MemberResponse]


# Dashboard response models
class MonthInfo(BaseModel):
    """Month information for dashboard metrics."""
    year: int
    month: int  # 1-12
    display_name: str  # e.g., "2024年1月"
    is_current: bool


class MonthlyPatientStat(BaseModel):
    """Patient statistics for a specific month."""
    month: MonthInfo
    count: int


class MonthlyAppointmentStat(BaseModel):
    """Non-cancelled appointments for a specific month."""
    month: MonthInfo
    count: int


class MonthlyCancellationStat(BaseModel):
    """Cancellation breakdown for a specific month."""
    month: MonthInfo
    canceled_by_clinic_count: int
    canceled_by_clinic_percentage: float
    canceled_by_patient_count: int
    canceled_by_patient_percentage: float
    total_canceled_count: int
    total_cancellation_rate: float


class MonthlyAppointmentTypeStat(BaseModel):
    """Appointment type statistics for a specific month."""
    month: MonthInfo
    appointment_type_id: int
    appointment_type_name: str
    count: int  # Non-cancelled only
    percentage: float
    is_deleted: bool = False  # True if appointment type is soft-deleted


class MonthlyPractitionerStat(BaseModel):
    """Practitioner statistics for a specific month."""
    month: MonthInfo
    user_id: int
    practitioner_name: str
    count: int  # Non-cancelled only
    percentage: float
    is_active: bool = True  # True if practitioner association is active


class MonthlyMessageStat(BaseModel):
    """Message statistics for a specific month."""
    month: MonthInfo
    recipient_type: Optional[str]  # 'patient', 'practitioner', 'admin', None for AI replies
    event_type: Optional[str]  # Event type code, None for AI replies
    event_display_name: str  # Display name for the event (e.g., "預約確認")
    trigger_source: Optional[str]  # 'clinic_triggered', 'patient_triggered', 'system_triggered', None for AI replies
    count: int


class ClinicDashboardMetricsResponse(BaseModel):
    """Response model for clinic dashboard metrics."""
    months: List[MonthInfo]  # Past 3 months + current month
    active_patients_by_month: List[MonthlyPatientStat]
    new_patients_by_month: List[MonthlyPatientStat]
    appointments_by_month: List[MonthlyAppointmentStat]
    cancellation_rate_by_month: List[MonthlyCancellationStat]
    appointment_type_stats_by_month: List[MonthlyAppointmentTypeStat]
    practitioner_stats_by_month: List[MonthlyPractitionerStat]
    paid_messages_by_month: List[MonthlyMessageStat]
    ai_reply_messages_by_month: List[MonthlyMessageStat]


# Business Insights Response Models
class BusinessInsightsSummaryResponse(BaseModel):
    """Summary statistics for business insights."""
    total_revenue: float
    valid_receipt_count: int
    service_item_count: int
    active_patients: int
    average_transaction_amount: float
    total_clinic_share: float
    receipt_item_count: int


class RevenueTrendPointResponse(BaseModel):
    """Single point in revenue trend chart."""
    date: str  # YYYY-MM-DD format
    total: float
    by_service: Optional[Dict[str, float]] = None  # Key: service_item_id or "custom:name", Value: revenue
    by_practitioner: Optional[Dict[str, float]] = None  # Key: practitioner_id or "null", Value: revenue


class ServiceItemBreakdownResponse(BaseModel):
    """Breakdown by service item."""
    service_item_id: Optional[int]
    service_item_name: str
    receipt_name: str
    is_custom: bool
    total_revenue: float
    item_count: int
    percentage: float


class PractitionerBreakdownResponse(BaseModel):
    """Breakdown by practitioner."""
    practitioner_id: Optional[int]
    practitioner_name: str
    total_revenue: float
    item_count: int
    percentage: float


class GroupBreakdownResponse(BaseModel):
    """Breakdown by service type group."""
    service_type_group_id: Optional[int]
    group_name: str
    total_revenue: float
    item_count: int
    percentage: float


class BusinessInsightsResponse(BaseModel):
    """Response model for business insights dashboard."""
    summary: BusinessInsightsSummaryResponse
    revenue_trend: List[RevenueTrendPointResponse]
    by_service: List[ServiceItemBreakdownResponse]
    by_practitioner: List[PractitionerBreakdownResponse]
    by_group: Optional[List[GroupBreakdownResponse]] = None


# Revenue Distribution Response Models
class RevenueDistributionSummaryResponse(BaseModel):
    """Summary statistics for revenue distribution."""
    total_revenue: float
    total_clinic_share: float
    receipt_item_count: int


class RevenueDistributionItemResponse(BaseModel):
    """Single receipt item in revenue distribution table."""
    receipt_id: int
    receipt_number: str
    date: str  # YYYY-MM-DD format
    patient_name: str
    service_item_id: Optional[int]
    service_item_name: str
    receipt_name: str
    is_custom: bool
    quantity: int
    practitioner_id: Optional[int]
    practitioner_name: Optional[str]
    billing_scenario: str
    amount: float
    revenue_share: float
    appointment_id: Optional[int]  # calendar_event_id


class RevenueDistributionResponse(BaseModel):
    """Response model for revenue distribution dashboard."""
    summary: RevenueDistributionSummaryResponse
    items: List[RevenueDistributionItemResponse]
    total: int  # Total number of items (for pagination)
    page: int
    page_size: int


# Conflict Detection Response Models
class AppointmentConflictDetail(BaseModel):
    """Detail model for appointment conflict."""
    appointment_id: int
    patient_name: str
    start_time: str  # HH:MM format
    end_time: str  # HH:MM format
    appointment_type: str


class ExceptionConflictDetail(BaseModel):
    """Detail model for availability exception conflict."""
    exception_id: int
    start_time: str  # HH:MM format
    end_time: str  # HH:MM format
    reason: Optional[str] = None


class ResourceConflictDetail(BaseModel):
    """Detail model for resource conflict."""
    resource_type_id: int
    resource_type_name: str
    required_quantity: int
    total_resources: int
    allocated_count: int


class DefaultAvailabilityInfo(BaseModel):
    """Information about default availability."""
    is_within_hours: bool
    normal_hours: Optional[str] = None  # e.g., "週一 09:00-18:00"


class SchedulingConflictResponse(BaseModel):
    """Response model for scheduling conflict detection."""
    has_conflict: bool
    conflict_type: Optional[str] = None  # "appointment" | "exception" | "availability" | "resource" | null
    appointment_conflict: Optional[AppointmentConflictDetail] = None
    exception_conflict: Optional[ExceptionConflictDetail] = None
    resource_conflicts: Optional[List[ResourceConflictDetail]] = None
    default_availability: DefaultAvailabilityInfo


class BatchSchedulingConflictResponse(BaseModel):
    """Response model for batch scheduling conflict detection."""
    practitioner_id: int
    has_conflict: bool
    conflict_type: Optional[str] = None  # "appointment" | "exception" | "availability" | "resource" | null
    appointment_conflict: Optional[AppointmentConflictDetail] = None
    exception_conflict: Optional[ExceptionConflictDetail] = None
    resource_conflicts: Optional[List[ResourceConflictDetail]] = None
    default_availability: DefaultAvailabilityInfo
