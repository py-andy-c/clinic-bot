from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_admin_role, require_authenticated, UserContext, ensure_clinic_access
from models import MedicalRecordTemplate


router = APIRouter()

# --- Schemas ---

class HeaderField(BaseModel):
    id: str
    type: str  # 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'number' | 'date'
    label: str
    placeholder: Optional[str] = None
    required: bool = False
    options: Optional[List[str]] = None
    unit: Optional[str] = None

class MedicalRecordTemplateBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    header_fields: list[HeaderField] = []
    workspace_config: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

class MedicalRecordTemplateCreate(MedicalRecordTemplateBase):
    pass

class MedicalRecordTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    header_fields: Optional[List[HeaderField]] = None
    workspace_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

class MedicalRecordTemplateResponse(MedicalRecordTemplateBase):
    id: int
    clinic_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# --- Endpoints ---

@router.get("/medical-record-templates", response_model=List[MedicalRecordTemplateResponse], summary="List medical record templates")
async def list_templates(
    include_inactive: bool = False,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    """
    List all medical record templates for the clinic.
    By default, only active templates are returned.
    """
    clinic_id = ensure_clinic_access(current_user)
    query = db.query(MedicalRecordTemplate).filter(
        MedicalRecordTemplate.clinic_id == clinic_id
    )
    
    if not include_inactive:
        query = query.filter(MedicalRecordTemplate.is_active == True)
        
    templates = query.order_by(MedicalRecordTemplate.created_at.desc()).all()
    return templates

@router.post("/medical-record-templates", response_model=MedicalRecordTemplateResponse, status_code=status.HTTP_201_CREATED, summary="Create a medical record template")
async def create_template(
    template_data: MedicalRecordTemplateCreate,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Create a new medical record template. Only admins can create templates."""
    clinic_id = ensure_clinic_access(current_user)
    
    new_template = MedicalRecordTemplate(
        clinic_id=clinic_id,
        name=template_data.name,
        header_fields=[f.model_dump() for f in template_data.header_fields],
        workspace_config=template_data.workspace_config,
        is_active=template_data.is_active
    )
    
    db.add(new_template)
    db.commit()
    db.refresh(new_template)
    return new_template

@router.get("/medical-record-templates/{template_id}", response_model=MedicalRecordTemplateResponse, summary="Get a medical record template")
async def get_template(
    template_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    """Get a specific medical record template by ID."""
    clinic_id = ensure_clinic_access(current_user)
    template = db.query(MedicalRecordTemplate).filter(
        MedicalRecordTemplate.id == template_id,
        MedicalRecordTemplate.clinic_id == clinic_id
    ).first()
    
    if not template:
        raise HTTPException(status_code=404, detail="找不到範本")
    
    return template

@router.put("/medical-record-templates/{template_id}", response_model=MedicalRecordTemplateResponse, summary="Update a medical record template")
async def update_template(
    template_id: int,
    template_data: MedicalRecordTemplateUpdate,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Update an existing medical record template. Only admins can update templates."""
    clinic_id = ensure_clinic_access(current_user)
    template = db.query(MedicalRecordTemplate).filter(
        MedicalRecordTemplate.id == template_id,
        MedicalRecordTemplate.clinic_id == clinic_id
    ).first()
    
    if not template:
        raise HTTPException(status_code=404, detail="找不到範本")
    
    update_dict = template_data.model_dump(exclude_unset=True)
    if "header_fields" in update_dict:
        update_dict["header_fields"] = [f.model_dump() for f in template_data.header_fields] if template_data.header_fields else []
        
    for key, value in update_dict.items():
        setattr(template, key, value)
    
    db.commit()
    db.refresh(template)
    return template

@router.delete("/medical-record-templates/{template_id}", summary="Delete a medical record template")
async def delete_template(
    template_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Soft-delete a medical record template by setting is_active=False.
    Only admins can delete templates.
    """
    clinic_id = ensure_clinic_access(current_user)
    template = db.query(MedicalRecordTemplate).filter(
        MedicalRecordTemplate.id == template_id,
        MedicalRecordTemplate.clinic_id == clinic_id
    ).first()
    
    if not template:
        raise HTTPException(status_code=404, detail="找不到範本")
    
    # Soft delete
    template.is_active = False
    db.commit()
    return {"message": "範本已停用 (虛擬刪除)"}
