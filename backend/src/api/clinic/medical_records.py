"""
Medical Record API endpoints.
"""

import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services import MedicalRecordService
from api.responses import (
    MedicalRecordResponse,
    MedicalRecordListResponse,
    MedicalRecordListItem,
    MedicalRecordMediaResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


class MedicalRecordCreateRequest(BaseModel):
    """Request model for creating a medical record."""
    patient_id: int
    template_id: int


class MedicalRecordUpdateRequest(BaseModel):
    """Request model for updating a medical record (PATCH)."""
    header_values: Optional[Dict[str, Any]] = None
    workspace_data: Optional[Dict[str, Any]] = None


@router.get("/patients/{patient_id}/medical-records", response_model=MedicalRecordListResponse)
async def list_patient_records(
    patient_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordListResponse:
    """List all medical records for a specific patient."""
    clinic_id = ensure_clinic_access(current_user)
    records = MedicalRecordService.list_records_for_patient(db, patient_id, clinic_id)
    return MedicalRecordListResponse(records=[
        MedicalRecordListItem(
            id=r.id,
            patient_id=r.patient_id,
            template_id=r.template_id,
            template_name=r.template.name,
            created_at=r.created_at,
            updated_at=r.updated_at
        ) for r in records
    ])


@router.get("/medical-records/{record_id}", response_model=MedicalRecordResponse)
async def get_medical_record(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordResponse:
    """Get a specific medical record with all data and media."""
    clinic_id = ensure_clinic_access(current_user)
    r = MedicalRecordService.get_record(db, record_id, clinic_id)
    return MedicalRecordResponse(
        id=r.id,
        patient_id=r.patient_id,
        clinic_id=r.clinic_id,
        template_id=r.template_id,
        header_structure=r.header_structure,
        header_values=r.header_values,
        workspace_data=r.workspace_data,
        created_at=r.created_at,
        updated_at=r.updated_at,
        media=[
            MedicalRecordMediaResponse(
                id=m.id,
                record_id=m.record_id,
                s3_key=m.s3_key,
                file_type=m.file_type,
                created_at=m.created_at
            ) for m in r.media
        ]
    )


@router.post("/medical-records", response_model=MedicalRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_medical_record(
    request: MedicalRecordCreateRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordResponse:
    """Create a new medical record for a patient."""
    clinic_id = ensure_clinic_access(current_user)
    r = MedicalRecordService.create_record(
        db, request.patient_id, clinic_id, request.template_id
    )
    # Re-fetch or manually construct response to include relationships if needed
    # (though medial is empty on creation)
    return MedicalRecordResponse(
        id=r.id,
        patient_id=r.patient_id,
        clinic_id=r.clinic_id,
        template_id=r.template_id,
        header_structure=r.header_structure,
        header_values=r.header_values,
        workspace_data=r.workspace_data,
        created_at=r.created_at,
        updated_at=r.updated_at,
        media=[]
    )


@router.patch("/medical-records/{record_id}", response_model=MedicalRecordResponse)
async def update_medical_record(
    record_id: int,
    request: MedicalRecordUpdateRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordResponse:
    """Update a medical record (autosave)."""
    clinic_id = ensure_clinic_access(current_user)
    r = MedicalRecordService.update_record(
        db, record_id, clinic_id,
        header_values=request.header_values,
        workspace_data=request.workspace_data
    )
    return MedicalRecordResponse(
        id=r.id,
        patient_id=r.patient_id,
        clinic_id=r.clinic_id,
        template_id=r.template_id,
        header_structure=r.header_structure,
        header_values=r.header_values,
        workspace_data=r.workspace_data,
        created_at=r.created_at,
        updated_at=r.updated_at,
        media=[
            MedicalRecordMediaResponse(
                id=m.id,
                record_id=m.record_id,
                s3_key=m.s3_key,
                file_type=m.file_type,
                created_at=m.created_at
            ) for m in r.media
        ]
    )


@router.delete("/medical-records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_medical_record(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    """Delete a medical record."""
    clinic_id = ensure_clinic_access(current_user)
    MedicalRecordService.delete_record(db, record_id, clinic_id)
    return None
