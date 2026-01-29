# pyright: reportMissingTypeStubs=false
"""
Clinic management API endpoints.

Main router aggregator for clinic-specific operations.
All domain-specific endpoints have been extracted to sub-modules in api/clinic/.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from models import Clinic
from models.clinic import ChatSettings as ChatSettingsModel
from services.clinic_agent import ClinicAgentService

logger = logging.getLogger(__name__)

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


# ===== Chat Test Endpoint =====

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
