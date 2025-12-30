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
from .line_message import LineMessage
from .line_push_message import LinePushMessage
from .line_ai_reply import LineAiReply
from .availability_notification import AvailabilityNotification
from .practitioner_link_code import PractitionerLinkCode
from .billing_scenario import BillingScenario
from .receipt import Receipt
from .resource_type import ResourceType
from .resource import Resource
from .appointment_resource_requirement import AppointmentResourceRequirement
from .appointment_resource_allocation import AppointmentResourceAllocation
from .service_type_group import ServiceTypeGroup
from .follow_up_message import FollowUpMessage
from .scheduled_line_message import ScheduledLineMessage
from .patient_practitioner_assignment import PatientPractitionerAssignment

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
    "LineMessage",
    "LinePushMessage",
    "LineAiReply",
    "AvailabilityNotification",
    "PractitionerLinkCode",
    "BillingScenario",
    "Receipt",
    "ResourceType",
    "Resource",
    "AppointmentResourceRequirement",
    "AppointmentResourceAllocation",
    "ServiceTypeGroup",
    "FollowUpMessage",
    "ScheduledLineMessage",
    "PatientPractitionerAssignment",
]
