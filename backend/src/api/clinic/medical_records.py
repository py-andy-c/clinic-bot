from typing import List, Dict, Any, Optional, TYPE_CHECKING
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from datetime import datetime

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services.medical_record_service import MedicalRecordService, RecordVersionConflictError, MISSING
from services.patient_photo_service import PatientPhotoService
from models.user_clinic_association import UserClinicAssociation
from utils.datetime_utils import ensure_taiwan
from api.clinic.patient_photos import PatientPhotoResponse

if TYPE_CHECKING:
    from models.medical_record import MedicalRecord
    from models.patient_photo import PatientPhoto

router = APIRouter(tags=["medical-records"])

def get_photo_service():
    return PatientPhotoService()

class MedicalRecordCreate(BaseModel):
    template_id: int
    values: Dict[str, Any]
    photo_ids: Optional[List[int]] = None
    appointment_id: Optional[int] = None

class MedicalRecordUpdate(BaseModel):
    version: int
    values: Optional[Dict[str, Any]] = None
    photo_ids: Optional[List[int]] = None
    appointment_id: Optional[int] = None

class AppointmentInfo(BaseModel):
    """Appointment information for medical record display"""
    id: int
    start_time: str
    end_time: str
    appointment_type_name: Optional[str] = None

class MedicalRecordResponse(BaseModel):
    id: int
    clinic_id: int
    patient_id: int
    template_id: int
    template_name: str
    template_snapshot: Dict[str, Any]
    values: Dict[str, Any]
    appointment_id: Optional[int]
    patient_last_edited_at: Optional[datetime] = None
    is_submitted: bool = False
    version: int
    is_deleted: bool
    deleted_at: Optional[Any]
    created_at: Any
    updated_at: Any
    created_by_user_id: Optional[int] = None
    updated_by_user_id: Optional[int] = None
    is_patient_form: bool
    photos: List[PatientPhotoResponse] = Field(default_factory=list)  # type: ignore[reportUnknownVariableType]
    
    # Enriched fields (populated manually by _enrich_record_with_photos)
    appointment: Optional[AppointmentInfo] = None
    created_by_user_name: Optional[str] = None
    updated_by_user_name: Optional[str] = None

    class Config:
        from_attributes = True

class MedicalRecordsListResponse(BaseModel):
    records: List[MedicalRecordResponse]
    total: int

def _batch_fetch_user_names(db: Session, clinic_id: int, user_ids: List[int]) -> Dict[int, str]:
    """Batch fetch user names for the given user IDs in the clinic context."""
    if not user_ids:
        return {}
    
    user_assocs = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.user_id.in_(user_ids)
    ).all()
    
    return {assoc.user_id: assoc.full_name for assoc in user_assocs}

def _enrich_record_with_photos(
    record: "MedicalRecord",  # SQLAlchemy model with proper typing
    photo_service: PatientPhotoService,
    user_names_map: Dict[int, str]  # Pre-fetched user names
) -> MedicalRecordResponse:
    # Manually construct response dict to avoid Pydantic trying to validate SQLAlchemy relationships
    response_data: Dict[str, Any] = {
        'id': record.id,
        'clinic_id': record.clinic_id,
        'patient_id': record.patient_id,
        'template_id': record.template_id,
        'template_name': record.template_name,
        'template_snapshot': record.template_snapshot,
        'values': record.values,
        'appointment_id': record.appointment_id,
        'patient_last_edited_at': record.patient_last_edited_at,
        'is_submitted': record.is_submitted,
        'version': record.version,
        'is_deleted': record.is_deleted,
        'deleted_at': record.deleted_at,
        'created_at': record.created_at,
        'updated_at': record.updated_at,
        'created_by_user_id': record.created_by_user_id,
        'updated_by_user_id': record.updated_by_user_id,
        'is_patient_form': record.template.is_patient_form if record.template else False,
    }
    
    # Process photos
    photo_responses: List[PatientPhotoResponse] = []
    if hasattr(record, 'photos') and record.photos:
        photos_list: List["PatientPhoto"] = list(record.photos)
        for photo in photos_list:
            # Skip deleted photos if they happen to be in the relationship (should be filtered by DB usually but safe to check)
            if getattr(photo, 'is_deleted', False):
                continue
                
            p_res: PatientPhotoResponse = PatientPhotoResponse.model_validate(photo)
            p_res.url = photo_service.get_photo_url(photo.storage_key)
            if photo.thumbnail_key:
                p_res.thumbnail_url = photo_service.get_photo_url(photo.thumbnail_key)
            photo_responses.append(p_res)
    
    response_data['photos'] = photo_responses
    
    # Add appointment details if linked
    if record.appointment_id and hasattr(record, 'appointment') and record.appointment:
        appointment = record.appointment
        calendar_event = getattr(appointment, 'calendar_event', None)
        
        if calendar_event and calendar_event.date and calendar_event.start_time and calendar_event.end_time:
            # Combine date and time to create datetime objects, then ensure Taiwan timezone
            start_datetime = ensure_taiwan(datetime.combine(calendar_event.date, calendar_event.start_time))
            end_datetime = ensure_taiwan(datetime.combine(calendar_event.date, calendar_event.end_time))
            
            response_data['appointment'] = AppointmentInfo(
                id=appointment.calendar_event_id,
                start_time=start_datetime.isoformat() if start_datetime else "",
                end_time=end_datetime.isoformat() if end_datetime else "",
                appointment_type_name=appointment.appointment_type.name if hasattr(appointment, 'appointment_type') and appointment.appointment_type else None,
            )
    
    # Populate user names from pre-fetched map
    if record.created_by_user_id:
        response_data['created_by_user_name'] = user_names_map.get(record.created_by_user_id)
    
    if record.updated_by_user_id:
        response_data['updated_by_user_name'] = user_names_map.get(record.updated_by_user_id)
    
    return MedicalRecordResponse.model_validate(response_data)

@router.post("/patients/{patient_id}/medical-records", response_model=MedicalRecordResponse)
def create_record(
    patient_id: int,
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
        patient_id=patient_id,  # Use patient_id from path
        template_id=record.template_id,
        values=record.values,
        photo_ids=record.photo_ids,
        appointment_id=record.appointment_id,
        created_by_user_id=user.user_id
    )
    
    # Batch fetch user names
    user_ids = [uid for uid in [created_record.created_by_user_id, created_record.updated_by_user_id] if uid]
    user_names_map = _batch_fetch_user_names(db, clinic_id, user_ids)
    
    return _enrich_record_with_photos(created_record, photo_service, user_names_map)

class SendPatientFormRequest(BaseModel):
    template_id: int
    appointment_id: Optional[int] = None
    message_override: Optional[str] = None

@router.post("/patients/{patient_id}/medical-records/send-form", response_model=MedicalRecordResponse)
def send_patient_form(
    patient_id: int,
    request: SendPatientFormRequest,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    if user.user_id is None:
        raise HTTPException(status_code=400, detail="User ID required")
    clinic_id = user.active_clinic_id
    
    record = MedicalRecordService.send_patient_form(
        db=db,
        clinic_id=clinic_id,
        patient_id=patient_id,
        template_id=request.template_id,
        created_by_user_id=user.user_id,
        appointment_id=request.appointment_id,
        message_override=request.message_override
    )
    
    # Batch fetch user names
    user_ids = [uid for uid in [record.created_by_user_id, record.updated_by_user_id] if uid]
    user_names_map = _batch_fetch_user_names(db, clinic_id, user_ids)
    
    return _enrich_record_with_photos(record, photo_service, user_names_map)

@router.get("/patients/{patient_id}/medical-records", response_model=MedicalRecordsListResponse)
def list_records(
    patient_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service),
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
    status: Optional[str] = None
):
    """
    List medical records for a patient.
    
    Query Parameters:
        status: Filter by record status - 'active', 'deleted', or 'all'
               Takes precedence over include_deleted if provided
        include_deleted: Legacy parameter for backward compatibility
    """
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    # Validate status parameter if provided
    if status is not None and status not in ['active', 'deleted', 'all']:
        raise HTTPException(status_code=400, detail="Invalid status. Must be 'active', 'deleted', or 'all'")
    
    # Get total count
    total = MedicalRecordService.count_patient_records(
        db=db,
        clinic_id=clinic_id,
        patient_id=patient_id,
        include_deleted=include_deleted,
        status=status
    )
    
    # Get records
    records = MedicalRecordService.list_patient_records(
        db=db,
        clinic_id=clinic_id,
        patient_id=patient_id,
        skip=skip,
        limit=limit,
        include_deleted=include_deleted,
        status=status
    )
    
    # Batch fetch user names for all records
    user_ids: set[int] = set()
    for record in records:
        if record.created_by_user_id:
            user_ids.add(record.created_by_user_id)
        if record.updated_by_user_id:
            user_ids.add(record.updated_by_user_id)
    user_names_map = _batch_fetch_user_names(db, clinic_id, list(user_ids))
    
    enriched_records = [_enrich_record_with_photos(record, photo_service, user_names_map) for record in records]
    
    return MedicalRecordsListResponse(
        records=enriched_records,
        total=total
    )

@router.get("/medical-records/{record_id}", response_model=MedicalRecordResponse)
def get_record(
    record_id: int,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    record = MedicalRecordService.get_record(db, record_id, clinic_id)
    if not record:
        raise HTTPException(
            status_code=404, 
            detail={"error_code": "RECORD_NOT_FOUND", "message": "Record not found"}
        )
    
    # Batch fetch user names
    user_ids = [uid for uid in [record.created_by_user_id, record.updated_by_user_id] if uid]
    user_names_map = _batch_fetch_user_names(db, clinic_id, user_ids)
    
    return _enrich_record_with_photos(record, photo_service, user_names_map)

@router.put("/medical-records/{record_id}", response_model=MedicalRecordResponse)
def update_record(
    record_id: int,
    update_data: MedicalRecordUpdate,
    user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    photo_service: PatientPhotoService = Depends(get_photo_service)
):
    ensure_clinic_access(user)
    if user.active_clinic_id is None:
        raise HTTPException(status_code=400, detail="Clinic context required")
    clinic_id = user.active_clinic_id
    
    try:
        # Prepare arguments, using MISSING for fields not explicitly provided in the JSON body
        # This allows us to distinguish between "field not provided" (no change) and 
        # "field provided as null" (clear the association)
        values = update_data.values if 'values' in update_data.model_fields_set else MISSING
        photo_ids = update_data.photo_ids if 'photo_ids' in update_data.model_fields_set else MISSING
        appointment_id = update_data.appointment_id if 'appointment_id' in update_data.model_fields_set else MISSING

        updated_record = MedicalRecordService.update_record(
            db=db,
            record_id=record_id,
            clinic_id=clinic_id,
            version=update_data.version,
            values=values,
            photo_ids=photo_ids,
            appointment_id=appointment_id,
            updated_by_user_id=user.user_id
        )
        
        # Batch fetch user names
        user_ids = [uid for uid in [updated_record.created_by_user_id, updated_record.updated_by_user_id] if uid]
        user_names_map = _batch_fetch_user_names(db, clinic_id, user_ids)
        
        return _enrich_record_with_photos(updated_record, photo_service, user_names_map)
    except RecordVersionConflictError as e:
        # Batch fetch user names for conflict response
        user_ids = [uid for uid in [e.current_record.created_by_user_id, e.current_record.updated_by_user_id] if uid]
        user_names_map = _batch_fetch_user_names(db, clinic_id, user_ids)
        
        # Return 409 with the current record state for UI conflict resolution
        current_record_response = _enrich_record_with_photos(e.current_record, photo_service, user_names_map)
        
        # Convert to dict with JSON-serializable values
        current_record_dict = current_record_response.model_dump(mode='json')
        
        raise HTTPException(
            status_code=409,
            detail={
                "message": e.message,
                "current_record": current_record_dict,
                "updated_by_user_name": e.updated_by_user_name
            }
        )

@router.delete("/medical-records/{record_id}")
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
        raise HTTPException(
            status_code=404, 
            detail={"error_code": "RECORD_NOT_FOUND", "message": "Record not found"}
        )
    return {"status": "success"}

@router.post("/medical-records/{record_id}/restore", response_model=MedicalRecordResponse)
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
        raise HTTPException(
            status_code=404, 
            detail={"error_code": "RECORD_NOT_FOUND", "message": "Record not found or not deleted"}
        )
    
    # Batch fetch user names
    user_ids = [uid for uid in [record.created_by_user_id, record.updated_by_user_id] if uid]
    user_names_map = _batch_fetch_user_names(db, clinic_id, user_ids)
    
    return _enrich_record_with_photos(record, photo_service, user_names_map)

@router.delete("/medical-records/{record_id}/hard")
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
        raise HTTPException(
            status_code=404, 
            detail={"error_code": "RECORD_NOT_FOUND", "message": "Record not found"}
        )
    return {"status": "success"}
