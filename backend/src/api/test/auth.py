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
from sqlalchemy import text
from pydantic import BaseModel
from typing import Dict, Any

from core.database import get_db, engine
from services.jwt_service import jwt_service, TokenPayload
from models import User, UserClinicAssociation, Clinic
from models.clinic import ClinicSettings
from models.refresh_token import RefreshToken

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
    user_type: str = "clinic_user"  # Only "clinic_user" supported (system_admin removed)
    roles: list[str] = ["admin", "practitioner"]  # Roles for clinic user


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
    
    Only supports clinic_user type (system_admin removed for E2E tests).
    Roles can be specified to test role-based access control.
    """
    if request.user_type != "clinic_user":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user_type. Only 'clinic_user' is supported for E2E tests"
        )

    # Validate roles
    valid_roles = ["admin", "practitioner"]
    invalid_roles = [r for r in request.roles if r not in valid_roles]
    if invalid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid roles: {invalid_roles}. Valid roles: {valid_roles}"
        )

    # Check if user exists, if not create them
    user = db.query(User).filter(User.email == request.email).first()
    
    # Verify user is a clinic user (has associations)
    if user:
        has_associations = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id
        ).first() is not None
        
        if not has_associations:
            # User exists but is not a clinic user - recreate as clinic user
            user = None
    
    if not user:
        # Create a new clinic user
        now = datetime.now(timezone.utc)
        
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
        
        # Create usepr
        user = User(
            email=request.email,
            google_subject_id=f"test_{request.email.replace('@', '_').replace('.', '_')}",
            created_at=now,
            updated_at=now
        )
        db.add(user)
        db.flush()
        
        # Create clinic association with specified roles
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=request.roles,  # Use provided roles
            full_name=request.email.split('@')[0].title(),
            is_active=True,
            created_at=now,
            updated_at=now
        )
        db.add(association)
        db.commit()
        db.refresh(user)
        db.refresh(association)
    else:
        # User exists - update roles if they've changed
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id
        ).first()
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="User exists but has no clinic association"
            )
        
        if set(association.roles or []) != set(request.roles):
            # Update roles to match request
            association.roles = request.roles
            db.commit()
            db.refresh(association)
    
    # Use association data directly instead of querying again (avoids potential database hang)
    # This is safe because we just created/refreshed the association above
    active_clinic_id = association.clinic_id
    clinic_roles = association.roles or []
    clinic_name = association.full_name or user.email
    
    token_payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_id=user.id,
        user_type="clinic_user",  # Always clinic_user for E2E tests
        email=user.email,
        roles=clinic_roles,  # Use roles from association
        active_clinic_id=active_clinic_id,
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
            "full_name": clinic_name,
            "user_type": token_payload.user_type,
            "roles": token_payload.roles
        }
    }


@router.post("/cleanup-connections", summary="Clean up idle database connections (E2E only)")
async def cleanup_connections(
    _e2e_mode: bool = Depends(require_e2e_mode),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Clean up idle database connections for E2E tests.
    
    This endpoint helps prevent connection pool exhaustion by:
    1. Terminating idle connections that have been waiting in transaction
    2. Closing idle connections from the pool
    
    Security: Only available when E2E_TEST_MODE=true (enforced by require_e2e_mode dependency).
    This endpoint is automatically called by the global setup hook before test suite runs.
    """
    try:
        # Terminate idle in transaction sessions (stuck connections)
        result = db.execute(text("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND state = 'idle in transaction'
              AND state_change < now() - interval '10 seconds'
              AND pid != pg_backend_pid()
        """))
        # Get rowcount from result (SQLAlchemy Result object)
        terminated_count: int = getattr(result, 'rowcount', 0) or 0
        
        # Disconnect idle connections from the pool
        engine.dispose()
        
        return {
            "status": "success",
            "terminated_connections": terminated_count,
            "message": "Connection cleanup completed"
        }
    except Exception as e:
        logger.error(f"Failed to cleanup connections: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Connection cleanup failed: {str(e)}"
        )

