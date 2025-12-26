# pyright: reportMissingTypeStubs=false
"""
Clinic management API endpoints.

Provides clinic-specific operations for admins and practitioners,
including member management, settings, patients, and appointments.
"""

import logging
import math
import re
import secrets
from datetime import datetime, timedelta, date as date_type, time
from typing import Dict, List, Optional, Any, Union, Literal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi import status as http_status
from pydantic import BaseModel, Field, model_validator, field_validator
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, cast, String
from sqlalchemy.sql import sqltypes
from utils.datetime_utils import datetime_validator, parse_date_string, taiwan_now, parse_datetime_to_taiwan
from utils.practitioner_helpers import verify_practitioner_in_clinic, get_practitioner_display_name_for_appointment
from utils.phone_validator import validate_taiwanese_phone_optional

logger = logging.getLogger(__name__)

from core.database import get_db
from core.config import FRONTEND_URL
from core.constants import MAX_EVENT_NAME_LENGTH, TEMPORARY_ID_THRESHOLD
from auth.dependencies import require_admin_role, require_authenticated, require_practitioner_or_admin, UserContext, ensure_clinic_access
from models import User, SignupToken, Clinic, AppointmentType, PractitionerAvailability, CalendarEvent, UserClinicAssociation, Appointment, AvailabilityException, Patient, LineUser, FollowUpMessage
from models.clinic import ClinicSettings, ChatSettings as ChatSettingsModel
from services import PatientService, AppointmentService, PractitionerService, AppointmentTypeService
from services.availability_service import AvailabilityService
from services.notification_service import NotificationService
from services.receipt_service import ReceiptService
from services.resource_service import ResourceService
from services.clinic_agent import ClinicAgentService
from services.business_insights_service import BusinessInsightsService, RevenueDistributionService
from services.service_type_group_service import ServiceTypeGroupService
from services.line_user_ai_disabled_service import (
    disable_ai_for_line_user,
    enable_ai_for_line_user,
    get_line_users_for_clinic
)
from utils.appointment_type_queries import count_active_appointment_types_for_practitioner
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from utils.patient_validators import validate_gender_field
from api.responses import (
    ClinicPatientResponse, ClinicPatientListResponse,
    AppointmentTypeResponse, PractitionerAppointmentTypesResponse, PractitionerStatusResponse,
    AppointmentTypeDeletionErrorResponse, AppointmentTypeReference,
    MemberResponse, MemberListResponse,
    AvailableSlotsResponse, AvailableSlotResponse, ConflictWarningResponse, ConflictDetail,
    PatientCreateResponse, AppointmentListResponse, AppointmentListItem,
    ClinicDashboardMetricsResponse,
    BusinessInsightsResponse, RevenueDistributionResponse,
    SchedulingConflictResponse, AppointmentConflictDetail, ExceptionConflictDetail, ResourceConflictDetail, DefaultAvailabilityInfo,
    ServiceTypeGroupResponse, ServiceTypeGroupListResponse
)

router = APIRouter()

# Include routers from refactored modules
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

router.include_router(service_groups_router, tags=["service-groups"])
router.include_router(follow_ups_router, tags=["follow-ups"])
router.include_router(line_users_router, tags=["line-users"])
router.include_router(dashboard_router, tags=["dashboard"])
router.include_router(patients_router, tags=["patients"])
router.include_router(members_router, tags=["members"])
router.include_router(settings_router, tags=["settings"])
router.include_router(availability_router, tags=["availability"])
router.include_router(practitioners_router, tags=["practitioners"])
router.include_router(appointments_router, tags=["appointments"])
router.include_router(resources_router, tags=["resources"])
router.include_router(previews_router, tags=["previews"])


# MemberResponse moved to api.responses - use that instead


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


# Member request/response models moved to api.clinic.members




class AppointmentTypeRequest(BaseModel):
    """Request model for appointment type."""
    name: str
    duration_minutes: int

# Settings-related models moved to api.clinic.settings


# Practitioner management models moved to api.clinic.practitioners




# Member management endpoints moved to api.clinic.members


# Member management endpoints moved to api.clinic.members
# Settings endpoints moved to api.clinic.settings
# Practitioner management endpoints moved to api.clinic.practitioners


# Message preview endpoints moved to api.clinic.previews


class ChatTestRequest(BaseModel):
    """Request model for testing chatbot with current settings."""
    message: str
    session_id: Optional[str] = None
    chat_settings: ChatSettingsModel


class ChatTestResponse(BaseModel):
    """Response model for chatbot test."""
    response: str
    session_id: str


@router.post("/chat/test", summary="Test chatbot with current settings")
async def test_chatbot(
    request: ChatTestRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ChatTestResponse:
    """
    Test chatbot with current (unsaved) chat settings.
    
    This endpoint allows clinic users to test how the chatbot will respond
    using their current settings before saving them. The test uses the provided
    chat_settings instead of the clinic's saved settings.
    
    Available to all clinic members (including read-only users).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Validate that chat is enabled in the provided settings
        if not request.chat_settings.chat_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="請先啟用 AI 聊天功能"
            )

        # Require session_id from frontend (must be provided)
        # Frontend always provides just the UUID, backend prepends clinic info
        if not request.session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="session_id 是必需的"
            )
        
        # Always prepend clinic info to create full session_id format
        session_id = f"test-{clinic_id}-{request.session_id}"

        # Process test message using provided chat settings
        # Use chat_settings_override to use unsaved settings from frontend
        response_text = await ClinicAgentService.process_message(
            session_id=session_id,
            message=request.message,
            clinic=clinic,
            chat_settings_override=request.chat_settings
        )

        return ChatTestResponse(
            response=response_text,
            session_id=session_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error testing chatbot: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法處理測試訊息"
        )
# Patient management endpoints moved to api.clinic.patients
# Appointment management endpoints moved to api.clinic.appointments
# Resource management endpoints moved to api.clinic.resources

# Follow-Up Message Management moved to api.clinic.follow_ups
# Service Type Group Management moved to api.clinic.service_groups
