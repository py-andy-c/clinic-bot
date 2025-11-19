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
    phone_number: str
    birthday: Optional[date] = None  # Python date object (serialized to YYYY-MM-DD in JSON)
    created_at: datetime


class PatientCreateResponse(BaseModel):
    """Response model for patient creation."""
    patient_id: int
    full_name: str
    phone_number: str
    birthday: Optional[date] = None
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
    """Response model for patient information in clinic context (includes line_user_id and display_name)."""
    line_user_id: Optional[str]
    line_user_display_name: Optional[str]
    # birthday is inherited from PatientResponse


class ClinicPatientListResponse(BaseModel):
    """Response model for listing patients in clinic context."""
    patients: List[ClinicPatientResponse]


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


class ConflictWarningResponse(BaseModel):
    """Response model for conflict warning."""
    success: bool
    message: str
    conflicts: List[Dict[str, Any]]


class AppointmentTypeDeletionErrorResponse(BaseModel):
    """Response model for appointment type deletion error."""
    error: str
    message: str
    appointment_types: List[Dict[str, Any]]  # List of {id, name, practitioners: [str]}
