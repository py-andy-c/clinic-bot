import logging
from typing import List, Optional, Dict, Any, Literal, Union
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services.medical_record_service import MedicalRecordService
from services.pdf_service import PDFService
from utils.file_storage import save_upload_file, delete_file

logger = logging.getLogger(__name__)

router = APIRouter()

# --- Workspace Data Schemas (Strict Validation) ---

class DrawingPath(BaseModel):
    """Vector drawing path data."""
    type: Literal['drawing'] = 'drawing'
    tool: Literal['pen', 'eraser', 'highlighter']
    color: str
    width: float = Field(gt=0)
    points: List[List[float]]  # Array of [x, y, pressure?] coordinates

    @field_validator('points')
    @classmethod
    def validate_points(cls, v: List[List[float]]) -> List[List[float]]:
        for point in v:
            if not (2 <= len(point) <= 3):
                raise ValueError("Each point must have 2 or 3 coordinates [x, y, pressure?]")
        return v

class MediaLayer(BaseModel):
    """Media layer (image) in the workspace."""
    type: Literal['media'] = 'media'
    id: str
    origin: Literal['template', 'upload']
    url: str
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: float = 0.0

class ViewportState(BaseModel):
    """Viewport state for the canvas."""
    zoom: float = Field(gt=0, default=1.0)
    scroll_top: float = Field(ge=0, default=0.0)

class WorkspaceData(BaseModel):
    """Complete workspace data structure."""
    version: int = Field(ge=1)
    layers: List[Union[DrawingPath, MediaLayer]]
    canvas_width: float = Field(gt=0, default=1000.0)
    canvas_height: float = Field(gt=0)
    background_image_url: Optional[str] = None
    viewport: Optional[ViewportState] = None

# --- Record Schemas ---

class MedicalRecordBase(BaseModel):
    patient_id: int
    template_id: int

class MedicalRecordCreate(MedicalRecordBase):
    pass

class MedicalRecordUpdate(BaseModel):
    header_values: Optional[Dict[str, Any]] = None
    workspace_data: Optional[WorkspaceData] = None
    version: Optional[int] = None

class MedicalRecordListItemResponse(BaseModel):
    id: int
    patient_id: int
    template_id: Optional[int]
    template_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class MedicalRecordResponse(MedicalRecordListItemResponse):
    header_structure: List[Dict[str, Any]]
    header_values: Dict[str, Any]
    workspace_data: WorkspaceData

from models.medical_record import MedicalRecord

def _to_record_response(record: MedicalRecord, db: Session) -> MedicalRecordResponse:
    """Helper to convert MedicalRecord model to MedicalRecordResponse with template_name."""
    response = MedicalRecordResponse.model_validate(record)
    if record.template:
        response.template_name = record.template.name
    elif record.template_id:
        from models.medical_record_template import MedicalRecordTemplate
        template = db.query(MedicalRecordTemplate).filter(MedicalRecordTemplate.id == record.template_id).first()
        if template:
            response.template_name = template.name
    return response

# --- Endpoints ---

@router.get("/patients/{patient_id}/medical-records", response_model=List[MedicalRecordListItemResponse], summary="List patient medical records")
async def list_patient_records(
    patient_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> List[MedicalRecordListItemResponse]:
    """List all medical records for a specific patient."""
    clinic_id = ensure_clinic_access(current_user)
    records = MedicalRecordService.list_records_for_patient(db, patient_id, clinic_id)
    
    # We want to include template name in the list
    response: List[MedicalRecordListItemResponse] = []
    for r in records:
        item = MedicalRecordListItemResponse.model_validate(r)
        if r.template:
            item.template_name = r.template.name
        response.append(item)
        
    return response

@router.post("/patients/{patient_id}/medical-records", response_model=MedicalRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_medical_record(
    patient_id: int,
    record_in: MedicalRecordCreate,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordResponse:
    """Create a new medical record for a patient."""
    clinic_id = ensure_clinic_access(current_user)
    
    # Verify patient exists and belongs to clinic
    # (Simplified for now, assume patient service handles it or DB constraint)
    
    record = MedicalRecordService.create_record(
        db, 
        patient_id=patient_id,
        clinic_id=clinic_id,
        template_id=record_in.template_id
    )
    
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")
        
    return _to_record_response(record, db)

@router.get("/medical-records/{record_id}", response_model=MedicalRecordResponse)
async def get_medical_record(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordResponse:
    """Get a specific medical record."""
    clinic_id = ensure_clinic_access(current_user)
    record = MedicalRecordService.get_record_by_id(db, record_id, clinic_id)
    
    if not record:
        raise HTTPException(status_code=404, detail="Medical record not found")
        
    return _to_record_response(record, db)

@router.patch("/medical-records/{record_id}", response_model=MedicalRecordResponse)
async def update_medical_record(
    record_id: int,
    record_in: MedicalRecordUpdate,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MedicalRecordResponse:
    """Update a medical record (autosave)."""
    clinic_id = ensure_clinic_access(current_user)
    
    try:
        record, removed_paths = MedicalRecordService.update_record(
            db, 
            record_id=record_id,
            clinic_id=clinic_id,
            update_data=record_in.model_dump(exclude_unset=True)
        )
        
        # Cleanup physical files for removed media
        for path in removed_paths:
            try:
                await delete_file(path)
            except Exception as e:
                logger.error(f"Failed to delete removed media file {path}: {e}")
                
    except ValueError as e:
        logger.error(f"Error updating medical record: {e}")
        if "CONCURRENCY_ERROR" in str(e):
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Unexpected error updating medical record: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
        
    if not record:
        raise HTTPException(status_code=404, detail="Medical record not found")
        
    return _to_record_response(record, db)

@router.post("/medical-records/{record_id}/media")
async def upload_record_media(
    record_id: int,
    file: UploadFile = File(...),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """Upload an image to be used in a medical record."""
    clinic_id = ensure_clinic_access(current_user)
    
    # 1. Save file to storage
    file_path, file_url = await save_upload_file(file)
    
    # 2. Register media in DB
    MedicalRecordService.add_media(
        db,
        record_id=record_id,
        clinic_id=clinic_id,
        url=file_url,
        file_path=file_path,
        file_type=file.content_type or "image/png",
        original_filename=file.filename
    )
    
    return {"url": file_url, "filename": file.filename or "unknown.png"}

@router.delete("/medical-records/{record_id}")
async def delete_medical_record(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """Delete a medical record."""
    clinic_id = ensure_clinic_access(current_user)
    
    success = MedicalRecordService.delete_record(db, record_id, clinic_id)
    if not success:
        raise HTTPException(status_code=404, detail="Medical record not found")
        
    return {"message": "病歷記錄已刪除"}

@router.get("/medical-records/{record_id}/pdf")
async def export_record_pdf(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Response:
    """Generate and return a PDF for the medical record."""
    clinic_id = ensure_clinic_access(current_user)
    
    record = MedicalRecordService.get_record_by_id(db, record_id, clinic_id)
    if not record:
        raise HTTPException(status_code=404, detail="Medical record not found")
        
    # Prepare data for PDF
    record_data = MedicalRecordResponse.model_validate(record).model_dump()
    
    # Generate PDF
    pdf_service = PDFService()
    pdf_content = pdf_service.generate_medical_record_pdf(record_data)
    
    filename = f"medical_record_{record_id}_{datetime.now().strftime('%Y%m%d')}.pdf"
    
    return Response(
        content=pdf_content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )
