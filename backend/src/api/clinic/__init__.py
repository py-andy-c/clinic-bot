# pyright: reportMissingTypeStubs=false
"""
Clinic API modules.

This package contains refactored clinic API endpoints organized by domain.
"""

# Import the main router from clinic_main.py
# Now that clinic.py has been renamed to clinic_main.py, we can use a simple import
from api.clinic_main import router, ClinicAgentService

# Re-export routers for backward compatibility
from api.clinic.service_groups import router as service_groups_router
from api.clinic.follow_ups import router as follow_ups_router
from api.clinic.line_users import router as line_users_router
from api.clinic.dashboard import router as dashboard_router
from api.clinic.patients import router as patients_router
from api.clinic.members import router as members_router
from api.clinic.settings import router as settings_router
from api.clinic.availability import router as availability_router
from api.clinic.practitioners import router as practitioners_router
from api.clinic.appointments import router as appointments_router
from api.clinic.resources import router as resources_router
from api.clinic.previews import router as previews_router
from api.clinic.medical_record_templates import router as medical_record_templates_router
from api.clinic.medical_records import router as medical_records_router

__all__ = [
    'router',
    'ClinicAgentService',
    'service_groups_router',
    'follow_ups_router',
    'line_users_router',
    'dashboard_router',
    'patients_router',
    'members_router',
    'settings_router',
    'availability_router',
    'practitioners_router',
    'appointments_router',
    'resources_router',
    'previews_router',
    'medical_record_templates_router',
    'medical_records_router',
]

