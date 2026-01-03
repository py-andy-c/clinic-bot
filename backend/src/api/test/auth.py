# pyright: reportMissingTypeStubs=false
"""
Test-only authentication endpoints for E2E testing.

These endpoints are only available when E2E_TEST_MODE=true.
They bypass OAuth and allow direct authentication for testing purposes.
"""

import logging
import os
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any

from core.database import get_db
from core.config import SYSTEM_ADMIN_EMAILS
from services.jwt_service import jwt_service, TokenPayload
from models import User, UserClinicAssociation, Clinic
from models.clinic import ClinicSettings
from models.refresh_token import RefreshToken
from api.auth import get_clinic_user_token_data

logger = logging.getLogger(__name__)

router = APIRouter()


def require_e2e_mode():
    """Dependency to ensure E2E_TEST_MODE is enabled."""
    if not os.getenv("E2E_TEST_MODE") == "true":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only available in E2E test mode"
        )
    return True


class TestLoginRequest(BaseModel):
    """Request model for test login."""
    email: str
    user_type: str = "system_admin"  # "system_admin" or "clinic_user"


@router.post("/login", summary="Test-only login (bypasses OAuth)")
async def test_login(
    request: TestLoginRequest,
    _e2e_mode: bool = Depends(require_e2e_mode),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Test-only endpoint that returns JWT tokens directly (bypasses OAuth).
    
    Only available when E2E_TEST_MODE=true.
    Creates user if they don't exist.
    """
    if request.user_type not in ["system_admin", "clinic_user"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user_type. Must be 'system_admin' or 'clinic_user'"
        )

    # Check if user exists, if not create them
    user = db.query(User).filter(User.email == request.email).first()
    
    # Verify user type matches
    if user:
        has_associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id
        ).first() is not None
        
        if request.user_type == "system_admin" and has_associations:
            user = None
        elif request.user_type == "clinic_user" and not has_associations:
            user = None
    
    if not user:
        # Create a new user
        now = datetime.now(timezone.utc)
        
        if request.user_type == "clinic_user":
            # Need a clinic for clinic users
            clinic = db.query(Clinic).first()
            if not clinic:
                # Create default test clinic with unique channel ID
                # Use timestamp to ensure uniqueness if multiple tests run in parallel
                unique_suffix = str(int(time.time() * 1000))[-8:]  # Last 8 digits of timestamp
                try:
                    clinic = Clinic(
                        name="Test Clinic",
                        line_channel_id=f"test_channel_{unique_suffix}",
                        line_channel_secret="test_secret",
                        line_channel_access_token="test_token",
                        settings=ClinicSettings().model_dump()
                    )
                    db.add(clinic)
                    db.commit()
                    db.refresh(clinic)
                except Exception as e:
                    db.rollback()
                    logger.error(f"Failed to create test clinic: {e}")
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"Failed to create test clinic for E2E testing: {str(e)}"
                    )
            
            # Create user
            user = User(
                email=request.email,
                google_subject_id=f"test_{request.email.replace('@', '_').replace('.', '_')}",
                full_name=request.email.split('@')[0].title(),
                is_active=True,
                created_at=now,
                updated_at=now
            )
            db.add(user)
            db.flush()
            
            # Create clinic association
            association = UserClinicAssociation(
                user_id=user.id,
                clinic_id=clinic.id,
                roles=["admin", "practitioner"],
                full_name=request.email.split('@')[0].title(),
                is_active=True,
                created_at=now,
                updated_at=now
            )
            db.add(association)
            db.commit()
            db.refresh(user)
        else:
            # System admin
            user = User(
                email=request.email,
                google_subject_id=f"test_{request.email.replace('@', '_').replace('.', '_')}",
                created_at=now,
                updated_at=now
            )
            db.add(user)
            db.commit()
            db.refresh(user)

    # Determine user type based on request and actual user state
    has_associations = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id
    ).first() is not None
    
    # System admin if: no associations AND (requested as system_admin OR email in SYSTEM_ADMIN_EMAILS)
    is_system_admin = not has_associations and (
        request.user_type == "system_admin" or request.email in SYSTEM_ADMIN_EMAILS
    )
    
    # Get clinic-specific data for token creation
    clinic_data = get_clinic_user_token_data(user, db)
    
    # Create JWT tokens
    # Get clinic name, defaulting to user email if not available
    clinic_name = clinic_data.get("clinic_name") or user.email
    
    token_payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_id=user.id,
        user_type="system_admin" if is_system_admin else "clinic_user",
        email=user.email,
        roles=[] if is_system_admin else clinic_data["clinic_roles"],
        active_clinic_id=clinic_data["active_clinic_id"],
        name=clinic_name
    )

    token_data = jwt_service.create_token_pair(token_payload)

    # Store refresh token
    refresh_token_hash = token_data["refresh_token_hash"]
    refresh_token_hash_sha256 = token_data.get("refresh_token_hash_sha256")

    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        token_hash_sha256=refresh_token_hash_sha256,
        expires_at=jwt_service.get_token_expiry("refresh"),
        email=None,
        google_subject_id=None,
        name=None
    )
    db.add(refresh_token_record)
    db.commit()

    return {
        "access_token": token_data["access_token"],
        "refresh_token": token_data["refresh_token"],
        "token_type": "bearer",
        "expires_in": jwt_service.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "user_id": user.id,
            "email": user.email,
            "full_name": user.email if is_system_admin else clinic_data.get("clinic_name", user.email),
            "user_type": token_payload.user_type,
            "roles": token_payload.roles
        }
    }

