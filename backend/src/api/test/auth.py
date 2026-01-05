"""
Test authentication endpoints for E2E testing.

Provides test-only authentication that bypasses OAuth flow.
Only available when E2E_TEST_MODE=true.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from services.jwt_service import jwt_service, TokenPayload
from models import User, UserClinicAssociation, Clinic

router = APIRouter()


class TestLoginRequest(BaseModel):
    email: str


class TestLoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: Dict[str, Any]


def require_e2e_mode():
    """Dependency that ensures E2E test mode is enabled."""
    import os
    if os.getenv("E2E_TEST_MODE") != "true":
        raise HTTPException(
            status_code=403,
            detail="This endpoint is only available in E2E test mode"
        )
    return True


@router.post("/login", response_model=TestLoginResponse, dependencies=[Depends(require_e2e_mode)])
async def test_login(
    request: TestLoginRequest,
    db: Session = Depends(get_db)
):
    """
    Test-only login endpoint that bypasses OAuth.

    Creates or retrieves a test user and returns JWT tokens directly.
    Only available when E2E_TEST_MODE=true.
    """
    # For E2E tests, we'll use a simple approach - find or create a test user
    # In a real implementation, you might want to seed specific test users

    # Try to find existing user by email
    user = db.query(User).filter(User.email == request.email).first()

    if not user:
        # Create a test user if it doesn't exist
        # Find or create a test clinic
        clinic = db.query(Clinic).filter(Clinic.line_channel_id == "test_channel").first()
        if not clinic:
            clinic = Clinic(
                name="Test Clinic",
                line_channel_id="test_channel",
                settings={}
            )
            db.add(clinic)
            db.commit()
            db.refresh(clinic)

        # Create test user
        user = User(
            email=request.email,
            name="Test User",
            line_user_id=f"test_{request.email.replace('@', '_').replace('.', '_')}"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Create association
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=["admin"],
            full_name="Test User",
            is_active=True
        )
        db.add(association)
        db.commit()

    # Get user's association for name and clinic info
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id,
        UserClinicAssociation.is_active == True
    ).first()

    if not association:
        # This shouldn't happen for properly set up test users, but handle it
        raise HTTPException(status_code=500, detail="Test user has no active clinic association")

    user_name = association.full_name
    clinic_id = association.clinic_id

    # Generate tokens using jwt_service
    import secrets
    payload = TokenPayload(
        sub=user.google_subject_id or f"test_sub_{user.id}",
        user_id=user.id,
        email=user.email,
        user_type="clinic_user",
        roles=["admin"],  # Test user is admin
        name=user_name,
        active_clinic_id=clinic_id
    )
    access_token = jwt_service.create_access_token(payload)
    refresh_token = secrets.token_urlsafe(64)

    return TestLoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user={
            "id": user.id,
            "email": user.email,
            "name": user_name
        }
    )
