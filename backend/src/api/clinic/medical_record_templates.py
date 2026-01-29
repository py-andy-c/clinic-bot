"""
Medical Record Template API endpoints.
"""

import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from core.database import get_db
from auth.dependencies import require_authenticated, require_admin, UserContext, ensure_clinic_access
from services import MedicalRecordTemplateService
from api.responses import (
    MedicalRecordTemplateResponse,
    MedicalRecordTemplateListResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


class MedicalRecordTemplateCreateRequest(BaseModel):
    """Request model for creating a medical record template."""
    name: str = Field(..., min_length=1, max_length=255)
    header_fields: List[Dict[str, Any]] = Field(default_factory=list)
    workspace_config: Dict[str, Any] = Field(default_factory=dict)


class MedicalRecordTemplateUpdateRequest(BaseModel):
    """Request model for updating a medical record template."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    header_fields: Optional[List[Dict[str, Any]]] = None
    workspace_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


@router.get("/medical-record-templates", response_model=MedicalRecordTemplateListResponse)
async def list_templates(
    active_only: bool = True,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordTemplateListResponse:
    """List all medical record templates for the clinic."""
    clinic_id = ensure_clinic_access(current_user)
    templates = MedicalRecordTemplateService.list_templates(db, clinic_id, active_only)
    return MedicalRecordTemplateListResponse(templates=[
        MedicalRecordTemplateResponse(
            id=t.id,
            clinic_id=t.clinic_id,
            name=t.name,
            header_fields=t.header_fields,
            workspace_config=t.workspace_config,
            is_active=t.is_active,
            created_at=t.created_at,
            updated_at=t.updated_at
        ) for t in templates
    ])


@router.get("/medical-record-templates/{template_id}", response_model=MedicalRecordTemplateResponse)
async def get_template(
    template_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordTemplateResponse:
    """Get a specific medical record template."""
    clinic_id = ensure_clinic_access(current_user)
    t = MedicalRecordTemplateService.get_template(db, template_id, clinic_id)
    return MedicalRecordTemplateResponse(
        id=t.id,
        clinic_id=t.clinic_id,
        name=t.name,
        header_fields=t.header_fields,
        workspace_config=t.workspace_config,
        is_active=t.is_active,
        created_at=t.created_at,
        updated_at=t.updated_at
    )


@router.post("/medical-record-templates", response_model=MedicalRecordTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    request: MedicalRecordTemplateCreateRequest,
    current_user: UserContext = Depends(require_admin),
    db: Session = Depends(get_db)
) -> MedicalRecordTemplateResponse:
    """Create a new medical record template (Admin only)."""
    clinic_id = ensure_clinic_access(current_user)
    t = MedicalRecordTemplateService.create_template(
        db, clinic_id, request.name, request.header_fields, request.workspace_config
    )
    return MedicalRecordTemplateResponse(
        id=t.id,
        clinic_id=t.clinic_id,
        name=t.name,
        header_fields=t.header_fields,
        workspace_config=t.workspace_config,
        is_active=t.is_active,
        created_at=t.created_at,
        updated_at=t.updated_at
    )


@router.patch("/medical-record-templates/{template_id}", response_model=MedicalRecordTemplateResponse)
async def update_template(
    template_id: int,
    request: MedicalRecordTemplateUpdateRequest,
    current_user: UserContext = Depends(require_admin),
    db: Session = Depends(get_db)
) -> MedicalRecordTemplateResponse:
    """Update a medical record template (Admin only)."""
    clinic_id = ensure_clinic_access(current_user)
    t = MedicalRecordTemplateService.update_template(
        db, template_id, clinic_id,
        name=request.name,
        header_fields=request.header_fields,
        workspace_config=request.workspace_config,
        is_active=request.is_active
    )
    return MedicalRecordTemplateResponse(
        id=t.id,
        clinic_id=t.clinic_id,
        name=t.name,
        header_fields=t.header_fields,
        workspace_config=t.workspace_config,
        is_active=t.is_active,
        created_at=t.created_at,
        updated_at=t.updated_at
    )


@router.delete("/medical-record-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: int,
    current_user: UserContext = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Delete a medical record template (Admin only)."""
    clinic_id = ensure_clinic_access(current_user)
    MedicalRecordTemplateService.delete_template(db, template_id, clinic_id)
    return None
