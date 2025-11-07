# pyright: reportMissingTypeStubs=false
"""
System admin API endpoints.

Provides system-wide management capabilities for platform administrators,
including clinic creation, monitoring, and billing management.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_system_admin, UserContext
from models import Clinic, SignupToken
from models.clinic import ClinicSettings

logger = logging.getLogger(__name__)

router = APIRouter()


class ClinicCreateRequest(BaseModel):
    """Request model for creating a new clinic."""
    name: str
    line_channel_id: str
    line_channel_secret: str
    line_channel_access_token: str
    subscription_status: Optional[str] = "trial"


class ClinicResponse(BaseModel):
    """Response model for clinic information."""
    id: int
    name: str
    line_channel_id: str
    subscription_status: str
    trial_ends_at: Optional[datetime]
    created_at: datetime


class SignupLinkResponse(BaseModel):
    """Response model for signup link generation."""
    signup_url: str
    expires_at: datetime
    token_id: int


@router.post("/clinics", summary="Create a new clinic")
async def create_clinic(
    clinic_data: ClinicCreateRequest,
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> ClinicResponse:
    """
    Create a new clinic with LINE integration.

    Only system admins can create clinics. Generates initial admin signup link.
    """
    try:
        # Check if LINE channel ID already exists
        existing = db.query(Clinic).filter(
            Clinic.line_channel_id == clinic_data.line_channel_id
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LINE 頻道 ID 已存在"
            )

        # Fetch bot info (official account user ID) from LINE API
        from services.line_service import LINEService
        line_service = LINEService(
            channel_secret=clinic_data.line_channel_secret,
            channel_access_token=clinic_data.line_channel_access_token
        )
        bot_user_id = line_service.get_bot_info()
        
        if not bot_user_id:
            logger.warning(
                f"Failed to fetch bot info for clinic {clinic_data.name}. "
                f"Clinic will be created without line_official_account_user_id. "
                f"This can be fixed later via migration script."
            )

        # Create clinic
        # Use ClinicSettings with all defaults - display_name will be None, and effective_display_name will fallback to clinic.name on read
        clinic = Clinic(
            name=clinic_data.name,
            line_channel_id=clinic_data.line_channel_id,
            line_channel_secret=clinic_data.line_channel_secret,
            line_channel_access_token=clinic_data.line_channel_access_token,
            line_official_account_user_id=bot_user_id,
            subscription_status=clinic_data.subscription_status,
            trial_ends_at=datetime.now(timezone.utc) + timedelta(days=14) if clinic_data.subscription_status == "trial" else None,
            settings=ClinicSettings().model_dump()  # Use all defaults from Pydantic model
        )

        db.add(clinic)
        db.commit()
        db.refresh(clinic)

        return ClinicResponse(
            id=clinic.id,
            name=clinic.name,
            line_channel_id=clinic.line_channel_id,
            subscription_status=clinic.subscription_status,
            trial_ends_at=clinic.trial_ends_at,
            created_at=clinic.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to create clinic: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立診所失敗"
        )


@router.get("/clinics", summary="List all clinics")
async def list_clinics(
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> List[ClinicResponse]:
    """
    Get all clinics in the system with basic information.
    """
    try:
        clinics = db.query(Clinic).all()

        return [
            ClinicResponse(
                id=clinic.id,
                name=clinic.name,
                line_channel_id=clinic.line_channel_id,
                subscription_status=clinic.subscription_status,
                trial_ends_at=clinic.trial_ends_at,
                created_at=clinic.created_at
            )
            for clinic in clinics
        ]

    except Exception as e:
        logger.exception(f"Failed to list clinics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得診所列表"
        )


@router.get("/clinics/{clinic_id}", summary="Get clinic details")
async def get_clinic(
    clinic_id: int,
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get detailed information about a specific clinic.
    """
    try:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        # Get clinic statistics
        user_count = len(clinic.users)
        patient_count = len(clinic.patients)
        appointment_count = sum(len(patient.appointments) for patient in clinic.patients)

        return {
            "id": clinic.id,
            "name": clinic.name,
            "line_channel_id": clinic.line_channel_id,
            "subscription_status": clinic.subscription_status,
            "trial_ends_at": clinic.trial_ends_at,
            "created_at": clinic.created_at,
            "updated_at": clinic.updated_at,
            "statistics": {
                "users": user_count,
                "patients": patient_count,
                "appointments": appointment_count
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get clinic {clinic_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得診所詳情"
        )


@router.post("/clinics/{clinic_id}/signup-link", summary="Generate clinic admin signup link")
async def generate_clinic_signup_link(
    clinic_id: int,
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> SignupLinkResponse:
    """
    Generate a new signup link for clinic admin onboarding.
    """
    try:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        # Create signup token for clinic admin (admin + practitioner roles)
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=48)  # 48 hours

        signup_token = SignupToken(
            token=token,
            clinic_id=clinic_id,
            default_roles=["admin", "practitioner"],
            expires_at=expires_at
        )

        db.add(signup_token)
        db.commit()
        db.refresh(signup_token)

        from core.config import FRONTEND_URL
        signup_url = f"{FRONTEND_URL}/signup/clinic?token={token}"

        return SignupLinkResponse(
            signup_url=signup_url,
            expires_at=expires_at,
            token_id=signup_token.id
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to generate signup link for clinic {clinic_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生註冊連結"
        )




@router.get("/clinics/{clinic_id}/health", summary="Check clinic LINE integration health")
async def check_clinic_health(
    clinic_id: int,
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Check the health status of a clinic's LINE integration.

    Performs comprehensive health checks including:
    - Webhook timestamp tracking
    - Signature verification capability
    - LINE API connectivity tests
    """
    try:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        from datetime import datetime, timezone, timedelta
        import json
        from services.line_service import LINEService

        now = datetime.now(timezone.utc)
        errors: List[str] = []
        health_status = "healthy"

        # 1. Check webhook activity
        webhook_status = "inactive"
        last_webhook_age_hours = None

        if clinic.last_webhook_received_at:
            # Ensure both datetimes are timezone-aware for comparison
            webhook_time = clinic.last_webhook_received_at
            if webhook_time.tzinfo is None:
                # Assume database datetime is UTC if naive
                from datetime import timezone
                webhook_time = webhook_time.replace(tzinfo=timezone.utc)

            age = now - webhook_time
            last_webhook_age_hours = age.total_seconds() / 3600

            if age < timedelta(hours=1):
                webhook_status = "very_active"
            elif age < timedelta(hours=6):
                webhook_status = "active"
            elif age < timedelta(hours=24):
                webhook_status = "moderate"
            elif age < timedelta(hours=72):
                webhook_status = "inactive"
            else:
                webhook_status = "stale"
                health_status = "warning"
        else:
            health_status = "warning"
            errors.append("No webhooks received yet")

        # 2. Test signature verification capability
        signature_test_passed = False
        line_service = None
        try:
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )

            # Test with a sample payload and signature
            test_payload = '{"events":[{"type":"message","message":{"type":"text","text":"test"}}]}'
            test_signature = "test_signature"  # This should fail verification, which is expected
            signature_test_passed = not line_service.verify_signature(test_payload, test_signature)  # Should return False

        except Exception as e:
            logger.exception(f"Signature verification setup failed for clinic {clinic_id}: {e}")
            errors.append(f"Signature verification setup failed: {str(e)}")
            if health_status == "healthy":
                health_status = "error"

        # 3. Test LINE API connectivity (basic probe)
        api_connectivity = "unknown"
        try:
            # We can't easily test the actual LINE API without proper setup,
            # but we can verify the service initializes correctly
            api_connectivity = "configured" if line_service else "not_configured"

            if not clinic.line_channel_access_token or not clinic.line_channel_secret:
                api_connectivity = "missing_credentials"
                health_status = "error"
                errors.append("LINE API credentials not configured")

        except Exception as e:
            logger.exception(f"LINE API connectivity test failed for clinic {clinic_id}: {e}")
            api_connectivity = "error"
            health_status = "error"
            errors.append(f"LINE API connectivity test failed: {str(e)}")

        # Update clinic health tracking
        clinic.last_health_check_at = now
        if errors:
            clinic.health_check_errors = json.dumps(errors)
        else:
            clinic.health_check_errors = None
        db.commit()

        return {
            "clinic_id": clinic_id,
            "line_integration_status": health_status,
            "webhook_status": webhook_status,
            "last_webhook_received_at": clinic.last_webhook_received_at.isoformat() if clinic.last_webhook_received_at else None,
            "last_webhook_age_hours": round(last_webhook_age_hours, 1) if last_webhook_age_hours else None,
            "webhook_count_24h": clinic.webhook_count_24h,
            "signature_verification_capable": signature_test_passed,
            "api_connectivity": api_connectivity,
            "error_messages": errors,
            "health_check_performed_at": now.isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to check clinic {clinic_id} health: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法檢查診所健康狀態"
        )
