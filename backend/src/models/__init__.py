# Package initialization
# Import all models to ensure relationships are properly established
from .clinic import Clinic
from .user import User
from .user_clinic_association import UserClinicAssociation
from .signup_token import SignupToken
from .refresh_token import RefreshToken
from .patient import Patient
from .line_user import LineUser
from .appointment import Appointment
from .appointment_type import AppointmentType
from .practitioner_availability import PractitionerAvailability
from .calendar_event import CalendarEvent
from .availability_exception import AvailabilityException
from .practitioner_appointment_types import PractitionerAppointmentTypes
from .line_user_ai_opt_out import LineUserAiOptOut
from .line_message import LineMessage
from .availability_notification import AvailabilityNotification

__all__ = [
    "Clinic",
    "User",
    "UserClinicAssociation",
    "SignupToken",
    "RefreshToken",
    "Patient",
    "LineUser",
    "Appointment",
    "AppointmentType",
    "PractitionerAvailability",
    "CalendarEvent",
    "AvailabilityException",
    "PractitionerAppointmentTypes",
    "LineUserAiOptOut",
    "LineMessage",
    "AvailabilityNotification",
]
