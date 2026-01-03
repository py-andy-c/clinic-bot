"""
Test-only API endpoints for E2E tests.

These endpoints allow direct creation of test data without going through
business logic, making E2E tests faster and more reliable.

WARNING: These endpoints should NEVER be enabled in production!
Only available when E2E_TEST_MODE=true or ENVIRONMENT=test.
"""

import os
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.clinic import Clinic, ClinicSettings
from models.user import User
from models.user_clinic_association import UserClinicAssociation

logger = logging.getLogger(__name__)

router = APIRouter()


def require_test_mode(request: Request):
    """Dependency to ensure test endpoints are only available in test mode."""
    environment = os.getenv("ENVIRONMENT", "development")
    e2e_test_mode = os.getenv("E2E_TEST_MODE", "").lower() == "true"
    
    if environment != "test" and not e2e_test_mode:
        client_host = request.client.host if hasattr(request, 'client') and request.client else None
        logger.warning(
            f"Test endpoint accessed in non-test environment: {environment}, "
            f"client_host={client_host}, path={request.url.path}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Test endpoints are only available in test environments"
        )


# ===== Request/Response Models =====

class CreateClinicRequest(BaseModel):
    """Request to create a test clinic."""
    name: str = Field(..., description="Clinic name")
    line_channel_id: Optional[str] = Field("test_channel", description="LINE channel ID")
    line_channel_secret: Optional[str] = Field("test_secret", description="LINE channel secret")
    line_channel_access_token: Optional[str] = Field("test_token", description="LINE access token")


class CreateClinicResponse(BaseModel):
    """Response for clinic creation."""
    id: int
    name: str
    display_name: str


class CreateUserRequest(BaseModel):
    """Request to create a test user."""
    email: str = Field(..., description="User email")
    google_subject_id: Optional[str] = Field(None, description="Google subject ID (auto-generated if not provided)")


class CreateUserResponse(BaseModel):
    """Response for user creation."""
    id: int
    email: str


class CreateUserClinicAssociationRequest(BaseModel):
    """Request to create a user-clinic association."""
    user_id: int = Field(..., description="User ID")
    clinic_id: int = Field(..., description="Clinic ID")
    roles: List[str] = Field(["admin", "practitioner"], description="User roles for this clinic")
    full_name: Optional[str] = Field(None, description="User's full name (defaults to email prefix)")
    is_active: bool = Field(True, description="Whether the association is active")


class CreateUserClinicAssociationResponse(BaseModel):
    """Response for user-clinic association creation."""
    id: int
    user_id: int
    clinic_id: int
    roles: List[str]
    full_name: str
    is_active: bool


# ===== Test Endpoints =====

@router.post("/clinics", summary="Create a test clinic", response_model=CreateClinicResponse)
async def create_test_clinic(
    request: Request,
    clinic_data: CreateClinicRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_test_mode)
) -> CreateClinicResponse:
    """
    Create a test clinic directly in the database.
    
    This endpoint bypasses business logic and creates a clinic directly,
    making it faster for E2E test setup.
    
    Only available when E2E_TEST_MODE=true or ENVIRONMENT=test.
    """
    # Create clinic with default settings
    clinic = Clinic(
        name=clinic_data.name,
        line_channel_id=clinic_data.line_channel_id or "test_channel",
        line_channel_secret=clinic_data.line_channel_secret or "test_secret",
        line_channel_access_token=clinic_data.line_channel_access_token or "test_token",
        settings=ClinicSettings().model_dump()  # Use all defaults
    )
    db.add(clinic)
    db.commit()
    db.refresh(clinic)
    
    logger.info(f"Created test clinic: {clinic.id} - {clinic.name}")
    
    return CreateClinicResponse(
        id=clinic.id,
        name=clinic.name,
        display_name=clinic.name  # Use name as display_name for now
    )


@router.post("/users", summary="Create a test user", response_model=CreateUserResponse)
async def create_test_user(
    request: Request,
    user_data: CreateUserRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_test_mode)
) -> CreateUserResponse:
    """
    Create a test user directly in the database.
    
    This endpoint creates a User record without clinic associations.
    Use /test/user-clinic-associations to associate the user with clinics.
    
    Only available when E2E_TEST_MODE=true or ENVIRONMENT=test.
    """
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        logger.info(f"User already exists: {existing_user.id} - {existing_user.email}")
        return CreateUserResponse(
            id=existing_user.id,
            email=existing_user.email
        )
    
    # Generate google_subject_id if not provided
    google_subject_id = user_data.google_subject_id
    if not google_subject_id:
        google_subject_id = f"test_{user_data.email.replace('@', '_').replace('.', '_')}"
    
    # Create user
    now = datetime.now(timezone.utc)
    user = User(
        email=user_data.email,
        google_subject_id=google_subject_id,
        created_at=now,
        updated_at=now
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    logger.info(f"Created test user: {user.id} - {user.email}")
    
    return CreateUserResponse(
        id=user.id,
        email=user.email
    )


@router.post("/user-clinic-associations", summary="Create a user-clinic association", response_model=CreateUserClinicAssociationResponse)
async def create_test_user_clinic_association(
    request: Request,
    association_data: CreateUserClinicAssociationRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_test_mode)
) -> CreateUserClinicAssociationResponse:
    """
    Create a user-clinic association directly in the database.
    
    This allows associating a user with multiple clinics for testing
    scenarios like clinic switching.
    
    Only available when E2E_TEST_MODE=true or ENVIRONMENT=test.
    """
    # Verify user exists
    user = db.query(User).filter(User.id == association_data.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with id {association_data.user_id} not found"
        )
    
    # Verify clinic exists
    clinic = db.query(Clinic).filter(Clinic.id == association_data.clinic_id).first()
    if not clinic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Clinic with id {association_data.clinic_id} not found"
        )
    
    # Check if association already exists
    existing = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == association_data.user_id,
        UserClinicAssociation.clinic_id == association_data.clinic_id
    ).first()
    
    if existing:
        logger.info(f"Association already exists: user {association_data.user_id} - clinic {association_data.clinic_id}")
        # Update existing association
        existing.roles = association_data.roles
        existing.full_name = association_data.full_name or user.email.split('@')[0].title()
        existing.is_active = association_data.is_active
        db.commit()
        db.refresh(existing)
        
        return CreateUserClinicAssociationResponse(
            id=existing.id,
            user_id=existing.user_id,
            clinic_id=existing.clinic_id,
            roles=existing.roles or [],
            full_name=existing.full_name,
            is_active=existing.is_active
        )
    
    # Create new association
    now = datetime.now(timezone.utc)
    association = UserClinicAssociation(
        user_id=association_data.user_id,
        clinic_id=association_data.clinic_id,
        roles=association_data.roles,
        full_name=association_data.full_name or user.email.split('@')[0].title(),
        is_active=association_data.is_active,
        created_at=now,
        updated_at=now
    )
    db.add(association)
    db.commit()
    db.refresh(association)
    
    logger.info(f"Created test user-clinic association: user {association_data.user_id} - clinic {association_data.clinic_id}")
    
    return CreateUserClinicAssociationResponse(
        id=association.id,
        user_id=association.user_id,
        clinic_id=association.clinic_id,
        roles=association.roles or [],
        full_name=association.full_name,
        is_active=association.is_active
    )


@router.delete("/clinics/{clinic_id}", summary="Delete a test clinic")
async def delete_test_clinic(
    request: Request,
    clinic_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_test_mode)
) -> Dict[str, str]:
    """
    Delete a test clinic and all its associations.
    
    Only available when E2E_TEST_MODE=true or ENVIRONMENT=test.
    """
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Clinic with id {clinic_id} not found"
        )
    
    # Delete associations first (foreign key constraint)
    db.query(UserClinicAssociation).filter(
        UserClinicAssociation.clinic_id == clinic_id
    ).delete()
    
    # Delete clinic
    db.delete(clinic)
    db.commit()
    
    logger.info(f"Deleted test clinic: {clinic_id}")
    
    return {"message": f"Clinic {clinic_id} deleted successfully"}


@router.delete("/users/{user_id}", summary="Delete a test user")
async def delete_test_user(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_test_mode)
) -> Dict[str, str]:
    """
    Delete a test user and all its associations.
    
    Only available when E2E_TEST_MODE=true or ENVIRONMENT=test.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with id {user_id} not found"
        )
    
    # Delete associations first (foreign key constraint)
    db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user_id
    ).delete()
    
    # Delete user
    db.delete(user)
    db.commit()
    
    logger.info(f"Deleted test user: {user_id}")
    
    return {"message": f"User {user_id} deleted successfully"}

