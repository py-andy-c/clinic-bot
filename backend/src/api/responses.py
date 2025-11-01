"""
Shared response models for API endpoints.

This module contains Pydantic response models that are shared across
multiple API endpoints to ensure consistency and reduce duplication.
"""

from datetime import datetime
from typing import List, Optional, Dict, Any

from pydantic import BaseModel


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
    clinic_id: int
    name: str
    duration_minutes: int


class AppointmentTypeListResponse(BaseModel):
    """Response model for listing appointment types."""
    appointment_types: List[AppointmentTypeResponse]


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


class AppointmentListItem(BaseModel):
    """Response model for appointment list item."""
    id: int
    patient_id: int
    patient_name: str
    practitioner_name: str
    appointment_type_name: str
    start_time: str
    end_time: str
    status: str
    notes: Optional[str]


class AppointmentListResponse(BaseModel):
    """Response model for listing appointments."""
    appointments: List[AppointmentListItem]


# Clinic-specific response models (extend shared ones)

class ClinicPatientResponse(PatientResponse):
    """Response model for patient information in clinic context (includes line_user_id)."""
    line_user_id: Optional[str]


class ClinicPatientListResponse(BaseModel):
    """Response model for listing patients in clinic context."""
    patients: List[ClinicPatientResponse]


class ClinicAppointmentTypeResponse(AppointmentTypeResponse):
    """Response model for appointment type in clinic context (includes clinic_id)."""
    clinic_id: int


class ClinicAppointmentResponse(BaseModel):
    """Response model for clinic appointment information."""
    appointment_id: int
    calendar_event_id: int
    patient_name: str
    patient_phone: Optional[str]
    practitioner_name: str
    appointment_type_name: str
    start_time: datetime
    end_time: datetime
    status: str
    notes: Optional[str]
    created_at: datetime


class ClinicAppointmentsResponse(BaseModel):
    """Response model for listing clinic appointments."""
    appointments: List[ClinicAppointmentResponse]


class PractitionerAvailabilityResponse(BaseModel):
    """Response model for practitioner availability."""
    id: int
    user_id: int
    day_of_week: int
    day_name: str
    day_name_zh: str
    start_time: str
    end_time: str
    created_at: datetime
    updated_at: datetime


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
    available_slots: List[AvailableSlotResponse]


class DefaultScheduleResponse(BaseModel):
    """Response model for practitioner's default schedule."""
    monday: List[Dict[str, Any]] = []
    tuesday: List[Dict[str, Any]] = []
    wednesday: List[Dict[str, Any]] = []
    thursday: List[Dict[str, Any]] = []
    friday: List[Dict[str, Any]] = []
    saturday: List[Dict[str, Any]] = []
    sunday: List[Dict[str, Any]] = []


class AvailabilityExceptionRequest(BaseModel):
    """Request model for availability exception."""
    date: str
    start_time: str
    end_time: str
    reason: Optional[str] = None


class AvailabilityExceptionResponse(BaseModel):
    """Response model for availability exception."""
    id: int
    user_id: int
    date: str
    start_time: str
    end_time: str
    reason: Optional[str]
    created_at: datetime


class ConflictWarningResponse(BaseModel):
    """Response model for conflict warning."""
    success: bool
    message: str
    conflicts: List[Dict[str, Any]]
