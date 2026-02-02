from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services.medical_record_template_service import MedicalRecordTemplateService

router = APIRouter(prefix="/medical-record-templates", tags=["medical-record-templates"])

class MedicalRecordTemplateCreate(BaseModel):
    name: str
    fields: List[Dict[str, Any]]
    description: Optional[str] = None

class MedicalRecordTemplateUpdate(BaseModel):
    version: int
    name: Optional[str] = None
    fields: Optional[List[Dict[str, Any]]] = None
    description: Optional[str] = None

class MedicalRecordTemplateResponse(BaseModel):
    id: int
    clinic_id: int
    name: str
    fields: List[Dict[str, Any]]
    description: Optional[str]
    version: int
    created_at: Any
    updated_at: Optional[Any]

    class Config:
        from_attributes = True

class MedicalRecordTemplatesListResponse(BaseModel):
    templates: List[MedicalRecordTemplateResponse]
    total: int

@router.post("", response_model=MedicalRecordTemplateResponse)
def create_template(
    template: MedicalRecordTemplateCreate,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    
    # Only admins can create templates
    if not user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Only admins can create templates")
        
    clinic_id = user.active_clinic_id
    
    return MedicalRecordTemplateService.create_template(
        db=db,
        clinic_id=clinic_id,
        name=template.name,
        fields=template.fields,
        description=template.description,
        created_by_user_id=user.user_id
    )

@router.get("", response_model=MedicalRecordTemplatesListResponse)
def list_templates(
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    templates = MedicalRecordTemplateService.list_templates(
        db=db,
        clinic_id=clinic_id,
        skip=skip,
        limit=limit
    )
    
    # Convert ORM models to response models
    template_responses = [MedicalRecordTemplateResponse.model_validate(t) for t in templates]
    
    return MedicalRecordTemplatesListResponse(
        templates=template_responses,
        total=len(template_responses)
    )

@router.get("/{template_id}", response_model=MedicalRecordTemplateResponse)
def get_template(
    template_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    template = MedicalRecordTemplateService.get_template(db, template_id, clinic_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template

@router.put("/{template_id}", response_model=MedicalRecordTemplateResponse)
def update_template(
    template_id: int,
    update_data: MedicalRecordTemplateUpdate,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    
    # Requirement: Create/Edit/Delete Templates: Admin only
    if not user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Only clinic admins can manage templates")

    clinic_id = user.active_clinic_id
    
    return MedicalRecordTemplateService.update_template(
        db=db,
        template_id=template_id,
        clinic_id=clinic_id,
        version=update_data.version,
        name=update_data.name,
        fields=update_data.fields,
        description=update_data.description,
        updated_by_user_id=user.user_id
    )

@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    
    # Requirement: Create/Edit/Delete Templates: Admin only
    if not user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Only clinic admins can manage templates")

    clinic_id = user.active_clinic_id
    
    return MedicalRecordTemplateService.delete_template(
        db=db,
        template_id=template_id,
        clinic_id=clinic_id,
        deleted_by_user_id=user.user_id
    )
