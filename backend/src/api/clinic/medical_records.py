from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services.medical_record_service import MedicalRecordService
from services.patient_photo_service import PatientPhotoService
from .patient_photos import PatientPhotoResponse

router = APIRouter(prefix="/medical-records", tags=["medical-records"])

def get_photo_service():
    return PatientPhotoService()

class MedicalRecordCreate(BaseModel):
    patient_id: int
    template_id: int
    values: Dict[str, Any]
    photo_ids: Optional[List[int]] = None
    appointment_id: Optional[int] = None

class MedicalRecordUpdate(BaseModel):
    version: int
    values: Optional[Dict[str, Any]] = None
    photo_ids: Optional[List[int]] = None
    appointment_id: Optional[int] = None

class MedicalRecordResponse(BaseModel):
    id: int
    clinic_id: int
    patient_id: int
    template_id: int
    template_name: str
    template_snapshot: Dict[str, Any]
    values: Dict[str, Any]
    appointment_id: Optional[int]
    version: int
    created_at: Any
    updated_at: Any
    photos: List[PatientPhotoResponse] = []

    class Config:
        from_attributes = True

def _enrich_record_with_photos(
    record: Any, # SQLAlchemy model
    photo_service: PatientPhotoService
) -> MedicalRecordResponse:
    # Convert to Pydantic model
    response = MedicalRecordResponse.model_validate(record)
    
    # Process photos
    photo_responses: List[PatientPhotoResponse] = []
    if hasattr(record, 'photos'):
        for photo in record.photos:
            # Skip deleted photos if they happen to be in the relationship (should be filtered by DB usually but safe to check)
            if getattr(photo, 'is_deleted', False):
                continue
                
            p_res = PatientPhotoResponse.model_validate(photo)
            p_res.url = photo_service.get_photo_url(photo.storage_key)
            if photo.thumbnail_key:
                p_res.thumbnail_url = photo_service.get_photo_url(photo.thumbnail_key)
            photo_responses.append(p_res)
    
    response.photos = photo_responses
    return response

@router.post("", response_model=MedicalRecordResponse)
def create_record(
    record: MedicalRecordCreate,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    created_record = MedicalRecordService.create_record(
        db=db,
        clinic_id=clinic_id,
        patient_id=record.patient_id,
        template_id=record.template_id,
        values=record.values,
        photo_ids=record.photo_ids,
        appointment_id=record.appointment_id,
        created_by_user_id=user.user_id
    )
    
    return _enrich_record_with_photos(created_record, photo_service)

@router.get("", response_model=List[MedicalRecordResponse])
def list_records(
    patient_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    return MedicalRecordService.list_patient_records(
        db=db,
        clinic_id=clinic_id,
        patient_id=patient_id,
        skip=skip,
        limit=limit
    )

@router.get("/{record_id}", response_model=MedicalRecordResponse)
def get_record(
    record_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    assert user.active_clinic_id is not None
    record = MedicalRecordService.get_record(db, record_id, user.active_clinic_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return _enrich_record_with_photos(record, photo_service)

@router.put("/{record_id}", response_model=MedicalRecordResponse)
def update_record(
    record_id: int,
    update_data: MedicalRecordUpdate,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    assert user.active_clinic_id is not None
    updated_record = MedicalRecordService.update_record(
        db=db,
        record_id=record_id,
        clinic_id=user.active_clinic_id,
        version=update_data.version,
        values=update_data.values,
        photo_ids=update_data.photo_ids,
        appointment_id=update_data.appointment_id,
        updated_by_user_id=user.user_id
    )
    return _enrich_record_with_photos(updated_record, photo_service)

@router.delete("/{record_id}")
def delete_record(
    record_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    success = MedicalRecordService.delete_record(
        db=db,
        record_id=record_id,
        clinic_id=clinic_id,
        deleted_by_user_id=user.user_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"status": "success"}

@router.post("/{record_id}/restore", response_model=MedicalRecordResponse)
def restore_record(
    record_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    record = MedicalRecordService.restore_record(
        db=db,
        record_id=record_id,
        clinic_id=clinic_id
    )
    if not record:
        raise HTTPException(status_code=404, detail="Record not found or not deleted")
    return _enrich_record_with_photos(record, photo_service)

@router.delete("/{record_id}/hard")
def hard_delete_record(
    record_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    success = MedicalRecordService.hard_delete_record(
        db=db,
        record_id=record_id,
        clinic_id=clinic_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"status": "success"}
