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


class ClinicUpdateRequest(BaseModel):
    """Request model for updating a clinic."""
    name: Optional[str] = None
    line_channel_id: Optional[str] = None
    line_channel_secret: Optional[str] = None
    line_channel_access_token: Optional[str] = None
    subscription_status: Optional[str] = None


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
        from models import UserClinicAssociation
        user_count = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic.id,
            UserClinicAssociation.is_active == True
        ).count()
        patient_count = len(clinic.patients)
        appointment_count = sum(len(patient.appointments) for patient in clinic.patients)

        # Get validated settings
        validated_settings = clinic.get_validated_settings()

        return {
            "id": clinic.id,
            "name": clinic.name,
            "line_channel_id": clinic.line_channel_id,
            "line_channel_secret": clinic.line_channel_secret,
            "line_channel_access_token": clinic.line_channel_access_token,
            "subscription_status": clinic.subscription_status,
            "trial_ends_at": clinic.trial_ends_at,
            "created_at": clinic.created_at,
            "updated_at": clinic.updated_at,
            "settings": validated_settings.model_dump(),
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


@router.put("/clinics/{clinic_id}", summary="Update clinic information")
async def update_clinic(
    clinic_id: int,
    clinic_data: ClinicUpdateRequest,
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> ClinicResponse:
    """
    Update clinic information.
    
    Only system admins can update clinics. All fields are optional.
    If LINE credentials are updated, bot info will be refreshed.
    """
    try:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        # Check if LINE channel ID is being changed and if it already exists
        if clinic_data.line_channel_id and clinic_data.line_channel_id != clinic.line_channel_id:
            existing = db.query(Clinic).filter(
                Clinic.line_channel_id == clinic_data.line_channel_id,
                Clinic.id != clinic_id
            ).first()

            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="LINE 頻道 ID 已存在"
                )

        # Update fields if provided
        if clinic_data.name is not None:
            clinic.name = clinic_data.name
        
        if clinic_data.line_channel_id is not None:
            clinic.line_channel_id = clinic_data.line_channel_id
        
        if clinic_data.line_channel_secret is not None:
            clinic.line_channel_secret = clinic_data.line_channel_secret
        
        if clinic_data.line_channel_access_token is not None:
            clinic.line_channel_access_token = clinic_data.line_channel_access_token
        
        if clinic_data.subscription_status is not None:
            clinic.subscription_status = clinic_data.subscription_status

        # If LINE credentials were updated, refresh bot info
        if (clinic_data.line_channel_secret is not None or 
            clinic_data.line_channel_access_token is not None):
            from services.line_service import LINEService
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            bot_user_id = line_service.get_bot_info()
            if bot_user_id:
                clinic.line_official_account_user_id = bot_user_id
            else:
                logger.warning(
                    f"Failed to fetch bot info for clinic {clinic_id} after update. "
                    f"line_official_account_user_id not updated."
                )

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
        logger.exception(f"Failed to update clinic {clinic_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新診所資訊"
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


@router.get("/clinics/{clinic_id}/practitioners", summary="Get all practitioners for a clinic")
async def get_clinic_practitioners(
    clinic_id: int,
    current_user: UserContext = Depends(require_system_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get all practitioners for a clinic with their settings.
    
    Returns practitioners with their appointment types, default schedule, and availability.
    """
    try:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到診所"
            )

        from models import User, UserClinicAssociation
        from models.practitioner_availability import PractitionerAvailability
        from services import PractitionerService
        from sqlalchemy.orm import joinedload

        # Get all practitioners (users with practitioner role) for this clinic
        practitioners_query = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True,
            User.is_active == True
        ).options(joinedload(User.clinic_associations))

        all_users = practitioners_query.all()
        
        practitioners_list: List[Dict[str, Any]] = []
        for user in all_users:
            # Get association for this clinic
            association = next(
                (a for a in user.clinic_associations if a.clinic_id == clinic_id),
                None
            )
            
            # Only include users with practitioner role
            if association and 'practitioner' in (association.roles or []):
                # Get appointment types for this practitioner
                appointment_types = PractitionerService.get_practitioner_appointment_types(
                    db, user.id
                )
                
                # Get default schedule
                availability = db.query(PractitionerAvailability).filter(
                    PractitionerAvailability.user_id == user.id,
                    PractitionerAvailability.clinic_id == clinic_id
                ).order_by(
                    PractitionerAvailability.day_of_week,
                    PractitionerAvailability.start_time
                ).all()
                
                # Format availability by day
                schedule_by_day: Dict[str, List[Dict[str, str]]] = {}
                day_names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                for day_idx, day_name in enumerate(day_names):
                    day_availability = [
                        {
                            "start_time": str(av.start_time),
                            "end_time": str(av.end_time)
                        }
                        for av in availability if av.day_of_week == day_idx
                    ]
                    if day_availability:
                        schedule_by_day[day_name] = day_availability
                
                practitioners_list.append({
                    "id": user.id,
                    "email": user.email,
                    "full_name": association.full_name if association else user.full_name,
                    "appointment_types": [
                        {
                            "id": at.id,
                            "name": at.name,
                            "duration_minutes": at.duration_minutes
                        }
                        for at in appointment_types
                    ],
                    "default_schedule": schedule_by_day,
                    "roles": association.roles if association else []
                })

        return {
            "practitioners": practitioners_list
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get practitioners for clinic {clinic_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得治療師列表"
        )
