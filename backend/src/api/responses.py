"""
Shared response models for API endpoints.

This module contains Pydantic response models that are shared across
multiple API endpoints to ensure consistency and reduce duplication.
"""

from datetime import datetime, date
from typing import List, Optional

from pydantic import BaseModel


class PatientResponse(BaseModel):
    """Response model for patient information."""
    id: int
    full_name: str
    phone_number: Optional[str] = None  # Optional for clinic-created patients
    birthday: Optional[date] = None  # Python date object (serialized to YYYY-MM-DD in JSON)
    notes: Optional[str] = None  # Optional notes/remarks about the patient (備注)
    created_at: datetime
    future_appointments_count: Optional[int] = None  # Number of future appointments for this patient
    max_future_appointments: Optional[int] = None  # Maximum allowed future appointments for this clinic


class PatientCreateResponse(BaseModel):
    """Response model for patient creation."""
    patient_id: int
    full_name: str
    phone_number: Optional[str] = None  # Optional for clinic-created patients
    birthday: Optional[date] = None
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


class AppointmentTypeListResponse(BaseModel):
    """Response model for listing appointment types."""
    appointment_types: List[AppointmentTypeResponse]
    appointment_type_instructions: Optional[str] = None


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
    practitioner_id: int
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
