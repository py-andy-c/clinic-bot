"""
Services package for shared business logic.

This package contains service classes that encapsulate business logic
shared across multiple API endpoints.
"""

from .patient_service import PatientService
from .appointment_service import AppointmentService
from .availability_service import AvailabilityService
from .practitioner_service import PractitionerService
from .appointment_type_service import AppointmentTypeService
from .reminder_service import ReminderService

__all__ = [
    "PatientService",
    "AppointmentService",
    "AvailabilityService",
    "PractitionerService",
    "AppointmentTypeService",
    "ReminderService",
]
