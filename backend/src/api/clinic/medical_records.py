from typing import List, Optional, Dict, Any, Literal
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_authenticated, require_practitioner_or_admin, UserContext, ensure_clinic_access
from services.medical_record_service import MedicalRecordService
from utils.file_storage import save_upload_file, delete_file

router = APIRouter()

# --- Workspace Data Schemas (Strict Validation) ---

class DrawingPath(BaseModel):
    """Vector drawing path data."""
    type: Literal['drawing'] = 'drawing'
    tool: Literal['pen', 'eraser', 'highlighter']
    color: str
    width: float = Field(gt=0)
    points: List[List[float]]  # Array of [x, y, pressure?] coordinates

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
    layers: List[DrawingPath | MediaLayer]
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

@router.post("/patients/{patient_id}/medical-records", response_model=MedicalRecordResponse, status_code=status.HTTP_201_CREATED, summary="Create a medical record")
async def create_record(
    patient_id: int,
    record_data: MedicalRecordCreate,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """Create a new medical record for a patient from a template."""
    clinic_id = ensure_clinic_access(current_user)
    
    # Validate patient_id in body matches path (optional but good practice)
    if record_data.patient_id != patient_id:
        raise HTTPException(status_code=400, detail="病患 ID 不符")
        
    try:
        record = MedicalRecordService.create_record(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id,
            template_id=record_data.template_id
        )
        
        response = MedicalRecordResponse.model_validate(record)
        if record.template:
            response.template_name = record.template.name
        return response
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/medical-records/{record_id}", response_model=MedicalRecordResponse, summary="Get a medical record")
async def get_record(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    """Get full details of a medical record."""
    clinic_id = ensure_clinic_access(current_user)
    record = MedicalRecordService.get_record_by_id(db, record_id, clinic_id)
    
    if not record:
        raise HTTPException(status_code=404, detail="找不到病歷記錄")
        
    response = MedicalRecordResponse.model_validate(record)
    if record.template:
        response.template_name = record.template.name
    return response

@router.patch("/medical-records/{record_id}", response_model=MedicalRecordResponse, summary="Update a medical record")
async def update_record(
    record_id: int,
    record_data: MedicalRecordUpdate,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """Update medical record data (autosave)."""
    clinic_id = ensure_clinic_access(current_user)
    
    # Convert Pydantic model to dict for service layer
    update_dict = record_data.model_dump(exclude_unset=True)
    if 'workspace_data' in update_dict and record_data.workspace_data is not None:
        # Convert WorkspaceData Pydantic model to dict
        update_dict['workspace_data'] = record_data.workspace_data.model_dump()
    
    try:
        result = MedicalRecordService.update_record(
            db=db,
            record_id=record_id,
            clinic_id=clinic_id,
            update_data=update_dict
        )
    except ValueError as e:
        if "CONCURRENCY_ERROR" in str(e):
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    
    if not result:
        raise HTTPException(status_code=404, detail="找不到病歷記錄")
    
    record, removed_media_paths = result
    
    # 2. Trigger physical deletion of removed media files
    for path in removed_media_paths:
        await delete_file(path)
        
    response = MedicalRecordResponse.model_validate(record)
    if record.template:
        response.template_name = record.template.name
    return response

@router.delete("/medical-records/{record_id}", summary="Delete a medical record")
async def delete_record(
    record_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """Delete a medical record."""
    clinic_id = ensure_clinic_access(current_user)
    success = MedicalRecordService.delete_record(db, record_id, clinic_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="找不到病歷記錄")
        
    return {"message": "病歷記錄已刪除"}

@router.post("/medical-records/{record_id}/media", summary="Upload media to medical record")
async def upload_media(
    record_id: int,
    file: UploadFile = File(...),
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
):
    """Upload an image for the clinical workspace."""
    clinic_id = ensure_clinic_access(current_user)
    
    # Check if record exists and user has access
    record = MedicalRecordService.get_record_by_id(db, record_id, clinic_id)
    if not record:
        raise HTTPException(status_code=404, detail="找不到病歷記錄")

    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支援圖片格式")

    # Save file to disk
    try:
        file_path, file_url = await save_upload_file(file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"檔案儲存失敗: {str(e)}")

    # Record in database
    media = MedicalRecordService.add_media(
        db=db,
        record_id=record_id,
        clinic_id=clinic_id,
        url=file_url,
        file_path=file_path,
        file_type="image",
        original_filename=file.filename
    )

    return {
        "id": str(media.id),
        "type": "media",
        "origin": "upload",
        "url": file_url,
        "filename": file.filename
    }
