from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services.patient_photo_service import PatientPhotoService

router = APIRouter(prefix="/patient-photos", tags=["patient-photos"])

def get_photo_service():
    return PatientPhotoService()

class PatientPhotoResponse(BaseModel):
    id: int
    clinic_id: int
    patient_id: int
    medical_record_id: Optional[int]
    filename: str
    content_type: str
    size_bytes: int
    description: Optional[str]
    is_pending: bool
    created_at: Any
    
    # URLs for accessing the photo
    url: Optional[str] = None
    thumbnail_url: Optional[str] = None

    class Config:
        from_attributes = True

class PatientPhotosListResponse(BaseModel):
    """Paginated response for patient photos list"""
    items: List[PatientPhotoResponse]
    total: int

@router.post("", response_model=PatientPhotoResponse)
def upload_photo(
    patient_id: int = Form(...),
    description: Optional[str] = Form(None),
    medical_record_id: Optional[int] = Form(None),
    is_pending: Optional[bool] = Form(None),
    file: UploadFile = File(...),
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    photo = photo_service.upload_photo(
        db=db,
        clinic_id=clinic_id,
        patient_id=patient_id,
        file=file,
        uploaded_by_user_id=user.user_id,
        description=description,
        medical_record_id=medical_record_id,
        is_pending=is_pending
    )
    
    # Generate URLs for response
    response = PatientPhotoResponse.model_validate(photo)
    response.url = photo_service.get_photo_url(photo.storage_key)
    if photo.thumbnail_key:
        response.thumbnail_url = photo_service.get_photo_url(photo.thumbnail_key)
        
    return response

@router.get("", response_model=PatientPhotosListResponse)
def list_photos(
    patient_id: int,
    medical_record_id: Optional[int] = None,
    unlinked_only: bool = False,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service),
    skip: int = 0,
    limit: int = 100
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    
    photos, total = photo_service.list_photos(
        db=db,
        clinic_id=user.active_clinic_id,
        patient_id=patient_id,
        medical_record_id=medical_record_id,
        unlinked_only=unlinked_only,
        skip=skip,
        limit=limit
    )
    
    # Augment with URLs
    items: List[PatientPhotoResponse] = []
    for photo in photos:
        response = PatientPhotoResponse.model_validate(photo)
        response.url = photo_service.get_photo_url(photo.storage_key)
        if photo.thumbnail_key:
            response.thumbnail_url = photo_service.get_photo_url(photo.thumbnail_key)
        items.append(response)
        
    return PatientPhotosListResponse(items=items, total=total)

class PatientPhotoUpdate(BaseModel):
    description: Optional[str] = None
    medical_record_id: Optional[int] = None

@router.put("/{photo_id}", response_model=PatientPhotoResponse)
def update_photo(
    photo_id: int,
    update_data: PatientPhotoUpdate,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    photo = photo_service.update_photo(
        db=db,
        photo_id=photo_id,
        clinic_id=clinic_id,
        description=update_data.description,
        medical_record_id=update_data.medical_record_id,
        updated_by_user_id=user.user_id
    )
    
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
        
    response = PatientPhotoResponse.model_validate(photo)
    response.url = photo_service.get_photo_url(photo.storage_key)
    if photo.thumbnail_key:
        response.thumbnail_url = photo_service.get_photo_url(photo.thumbnail_key)
    return response

@router.get("/count", response_model=dict)
def count_record_photos(
    medical_record_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    """Count photos linked to a medical record for auto-suggestion"""
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    
    count = photo_service.count_record_photos(
        db=db,
        clinic_id=user.active_clinic_id,
        medical_record_id=medical_record_id
    )
    
    return {"count": count}

@router.delete("/{photo_id}")
def delete_photo(
    photo_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    success = photo_service.delete_photo(
        db=db,
        photo_id=photo_id,
        clinic_id=clinic_id,
        deleted_by_user_id=user.user_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Photo not found")
    return {"status": "success"}

class AttachPhotosRequest(BaseModel):
    record_id: int
    photo_ids: List[int]

@router.post("/attach", response_model=List[PatientPhotoResponse])
def attach_photos(
    request: AttachPhotosRequest,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    photos = photo_service.attach_photos_to_record(
        db=db,
        record_id=request.record_id,
        photo_ids=request.photo_ids,
        clinic_id=clinic_id
    )
    
    # Augment with URLs
    responses: List[PatientPhotoResponse] = []
    for photo in photos:
        response = PatientPhotoResponse.model_validate(photo)
        response.url = photo_service.get_photo_url(photo.storage_key)
        if photo.thumbnail_key:
            response.thumbnail_url = photo_service.get_photo_url(photo.thumbnail_key)
        responses.append(response)
        
    return responses
