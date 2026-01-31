import logging
from urllib.parse import urlparse, unquote
from typing import List, Optional, Dict, Any, Literal, Union, Annotated, cast
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import S3_BUCKET, S3_CUSTOM_DOMAIN, S3_ALLOWED_DOMAINS, MAX_UPLOAD_SIZE_MB
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from services.medical_record_service import MedicalRecordService
from services.pdf_service import PDFService
from utils.file_storage import save_upload_file, delete_file, generate_presigned_url

logger = logging.getLogger(__name__)

router = APIRouter()

from api.clinic.medical_record_schemas import DrawingPath, MediaLayer, ShapeLayer, TextLayer, AnyLayer

class ViewportState(BaseModel):
    """Viewport state for the canvas."""
    zoom: float = Field(gt=0, default=1.0)
    x: float = 0.0
    y: float = 0.0
    scroll_top: float = Field(ge=0, default=0.0)

class WorkspaceData(BaseModel):
    """Complete workspace data structure."""
    version: int = Field(ge=1)
    layers: List[AnyLayer]
    canvas_width: float = Field(gt=0, default=1000.0)
    canvas_height: float = Field(gt=0)
    background_image_url: Optional[str] = None
    viewport: Optional[ViewportState] = None
    local_version: Optional[int] = Field(default=None, description="Internal tracking for sync acknowledgment")

    model_config = ConfigDict(extra='allow')

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
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class MedicalRecordResponse(MedicalRecordListItemResponse):
    header_structure: List[Dict[str, Any]]
    header_values: Dict[str, Any]
    workspace_data: WorkspaceData

from models.medical_record import MedicalRecord

def _extract_s3_key(url: str) -> Optional[str]:
    """Robustly extract S3 key from a URL, stripping existing signatures."""
    if not url:
        return None
        
    # If it's already just a key (no protocol), return it
    if not url.startswith(('http://', 'https://')):
        return url
        
    try:
        parsed = urlparse(url)
        path = unquote(parsed.path) # Decode %2F etc.
        
        # Remove leading slash for processing
        clean_path = path[1:] if path.startswith('/') else path
        
        # 1. Handle Custom Domains (CloudFront, etc.)
        if S3_CUSTOM_DOMAIN and parsed.netloc == S3_CUSTOM_DOMAIN:
            return clean_path

        # 2. Handle standard S3 URLs (Virtual-host style and Path-style)
        # Virtual-host: bucket.s3.region.amazonaws.com/key
        # Path-style: s3.region.amazonaws.com/bucket/key
        if "amazonaws.com" in parsed.netloc:
            # If it's path-style and starts with bucket name
            if S3_BUCKET and clean_path.startswith(f"{S3_BUCKET}/"):
                return clean_path[len(S3_BUCKET)+1:]
            # Otherwise, the path is the key
            return clean_path
            
        # 3. Handle local static URLs: /static/uploads/medical_records/key
        if "/static/" in path:
            return path.split("/static/")[-1]
            
        # 4. Handle S3_ENDPOINT_URL style: endpoint/bucket/key
        if S3_BUCKET and clean_path.startswith(f"{S3_BUCKET}/"):
            return clean_path[len(S3_BUCKET)+1:]
            
        # 5. Domain Whitelist for extraction
        # If it's an absolute URL with a domain we don't recognize as S3 or local,
        # then it's likely an external URL (e.g., example.com in tests) and we shouldn't re-sign it.
        is_internal = any(x in parsed.netloc for x in S3_ALLOWED_DOMAINS)
        if S3_CUSTOM_DOMAIN:
            is_internal = is_internal or (parsed.netloc == S3_CUSTOM_DOMAIN)
            
        if not is_internal:
             return None

        # Fallback: just return the clean path if it's considered internal
        return clean_path
    except Exception as e:
        logger.error(f"Failed to extract S3 key from URL {url}: {e}")
        return None

async def _to_record_response(record: MedicalRecord, db: Session) -> MedicalRecordResponse:
    """Helper to convert MedicalRecord model to MedicalRecordResponse with template_name and signed URLs."""
    response = MedicalRecordResponse.model_validate(record)
    
    # Sign background image URL if present
    if response.workspace_data.background_image_url:
        s3_key = _extract_s3_key(response.workspace_data.background_image_url)
        if s3_key:
            response.workspace_data.background_image_url = await generate_presigned_url(s3_key)

    # Sign media layer URLs
    for layer in response.workspace_data.layers:
        if isinstance(layer, MediaLayer):
            url = layer.url
            if url:
                s3_key = _extract_s3_key(url)
                if s3_key:
                    layer.url = await generate_presigned_url(s3_key)
        elif isinstance(layer, dict):
            # This case handles if Pydantic didn't fully convert to MediaLayer model
            # though with the discriminator it should have.
            layer_dict = cast(Dict[str, Any], layer)
            if layer_dict.get('type') == 'media':
                url = cast(Optional[str], layer_dict.get('url'))
                if url:
                    s3_key = _extract_s3_key(url)
                    if s3_key:
                        layer_dict['url'] = await generate_presigned_url(s3_key)

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
        
    return await _to_record_response(record, db)

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
        
    return await _to_record_response(record, db)

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
        record, _ = MedicalRecordService.update_record(
            db, 
            record_id=record_id,
            clinic_id=clinic_id,
            update_data=record_in.model_dump(exclude_unset=True)
        )
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
        
    return await _to_record_response(record, db)

@router.post("/medical-records/{record_id}/media")
async def upload_record_media(
    record_id: int,
    file: UploadFile = File(...),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Upload an image to be used in a medical record."""
    clinic_id = ensure_clinic_access(current_user)
    
    # Check file size
    if file.size and file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413, 
            detail=f"檔案太大了 (最大限制: {MAX_UPLOAD_SIZE_MB}MB)"
        )
    
    # 1. Save file to storage
    file_path, file_url = await save_upload_file(file)
    
    # 2. Register media in DB
    media = MedicalRecordService.add_media(
        db,
        record_id=record_id,
        clinic_id=clinic_id,
        url=file_url,
        file_path=file_path,
        file_type=file.content_type or "image/png",
        original_filename=file.filename
    )
    
    # 3. Generate a signed URL for immediate use in the frontend
    signed_url = await generate_presigned_url(file_path)
    
    return {
        "id": str(media.id),
        "url": signed_url, 
        "filename": file.filename or "unknown.png"
    }

@router.delete("/medical-records/{record_id}")
async def delete_medical_record(
    record_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """Delete a medical record and its associated physical files."""
    clinic_id = ensure_clinic_access(current_user)
    
    removed_paths = MedicalRecordService.delete_record(db, record_id, clinic_id)
    if removed_paths is None:
        raise HTTPException(status_code=404, detail="Medical record not found")
    
    # Cleanup physical files
    for path in removed_paths:
        try:
            await delete_file(path)
        except Exception as e:
            logger.error(f"Failed to delete media file {path} during record deletion: {e}")
        
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
        
    # Prepare data for PDF (includes signing URLs so PDF generator can fetch them)
    record_response = await _to_record_response(record, db)
    record_data = record_response.model_dump()
    
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
