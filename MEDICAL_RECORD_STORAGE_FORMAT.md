# Medical Record Storage Format - Production Design

## Overview

In production, medical record state will be stored in **PostgreSQL database** with **JSONB columns** for drawing data, and **AWS S3** (or Cloudinary) for file storage (images, PDFs).

---

## Database Schema

### MedicalRecord Model

```python
from sqlalchemy import JSONB, ForeignKey, Integer, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Dict, Any, Optional
from datetime import datetime

class MedicalRecord(Base):
    """
    Medical record entity storing patient visit documentation.
    
    Each record is linked to an appointment and can contain:
    - Form field values (text, dropdowns, etc.)
    - Drawing annotations (lines, shapes, text)
    - References to uploaded files (images, PDFs)
    """
    
    __tablename__ = "medical_records"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the medical record."""
    
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.calendar_event_id"),
        nullable=False,
        index=True
    )
    """Reference to the appointment this record documents."""
    
    template_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("medical_record_templates.id"),
        nullable=True
    )
    """Optional reference to the template used (if any)."""
    
    # Drawing/annotation data stored as JSONB
    drawing_data: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict
    )
    """
    JSONB column storing drawing annotations and canvas state.
    
    Structure:
    {
        "lines": [
            {
                "tool": "pen" | "eraser",
                "points": [x1, y1, x2, y2, ...],
                "color": "#000000",
                "strokeWidth": 3
            },
            ...
        ],
        "shapes": [
            {
                "id": "unique-id",
                "type": "circle" | "rect" | "arrow" | "text",
                "x": 100,
                "y": 200,
                "width": 50,        // for rect
                "height": 50,       // for rect
                "radius": 25,       // for circle
                "points": [0, 0],   // for arrow
                "text": "Hello",   // for text
                "color": "#FF0000",
                "strokeWidth": 3
            },
            ...
        ],
        "stageSize": {
            "width": 800,
            "height": 600
        },
        "backgroundType": "image" | "pdf" | null,
        "backgroundFileId": 123,  // Reference to PatientFile if background exists
        "pdfPageNumber": 1,        // If background is PDF
        "pdfNumPages": 5           // If background is PDF
    }
    """
    
    # Form field values (for text-based fields in template)
    form_data: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict
    )
    """
    JSONB column storing form field values.
    
    Structure matches the template schema:
    {
        "chief_complaint": "Patient reports knee pain",
        "vital_signs": {
            "bp": "120/80",
            "pulse": "72"
        },
        "assessment": "Initial assessment notes...",
        ...
    }
    """
    
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False
    )
    """User who created this record."""
    
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"),
        nullable=True
    )
    """User who last updated this record."""
    
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default="now()"
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default="now()",
        onupdate="now()"
    )
    
    # Relationships
    appointment = relationship("Appointment", back_populates="medical_record")
    template = relationship("MedicalRecordTemplate", back_populates="records")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
    
    __table_args__ = (
        Index('idx_medical_records_appointment', 'appointment_id'),
        Index('idx_medical_records_created_at', 'created_at'),
        # GIN index for JSONB queries
        Index('idx_medical_records_drawing_data', 'drawing_data', postgresql_using='gin'),
    )
```

### PatientFile Model (for file storage)

```python
class PatientFile(Base):
    """
    File entity storing metadata for patient-related files.
    
    Actual file content is stored in S3, this table stores metadata and S3 references.
    """
    
    __tablename__ = "patient_files"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id"),
        nullable=False,
        index=True
    )
    """Patient this file belongs to."""
    
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    """Original filename."""
    
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)
    """MIME type: 'image/jpeg', 'application/pdf', etc."""
    
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    """File size in bytes."""
    
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    """S3 object key (path) where file is stored."""
    
    s3_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    """S3 bucket name."""
    
    uploaded_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False
    )
    
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default="now()"
    )
    
    # Relationships
    patient = relationship("Patient", back_populates="files")
    uploaded_by = relationship("User")
    
    __table_args__ = (
        Index('idx_patient_files_patient', 'patient_id'),
        Index('idx_patient_files_created_at', 'created_at'),
    )
```

### MedicalRecordFile Model (linking files to records)

```python
class MedicalRecordFile(Base):
    """
    Junction table linking files to medical records.
    
    Allows multiple files per record (e.g., x-ray images, PDF templates, annotated exports).
    """
    
    __tablename__ = "medical_record_files"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    medical_record_id: Mapped[int] = mapped_column(
        ForeignKey("medical_records.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    patient_file_id: Mapped[int] = mapped_column(
        ForeignKey("patient_files.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    file_role: Mapped[str] = mapped_column(String(50), nullable=False, default="attachment")
    """
    Role of this file in the record:
    - "background": PDF template or image used as drawing background
    - "attachment": Additional file attached to record (x-ray, photo, etc.)
    - "export": Exported/annotated version of the record
    """
    
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default="now()"
    )
    
    # Relationships
    medical_record = relationship("MedicalRecord", back_populates="files")
    patient_file = relationship("PatientFile")
    
    __table_args__ = (
        Index('idx_medical_record_files_record', 'medical_record_id'),
        Index('idx_medical_record_files_file', 'patient_file_id'),
    )
```

---

## Data Format Examples

### Drawing Data Structure

```json
{
  "lines": [
    {
      "tool": "pen",
      "points": [100, 200, 150, 250, 200, 300],
      "color": "#000000",
      "strokeWidth": 3
    },
    {
      "tool": "eraser",
      "points": [300, 400, 350, 450],
      "color": "#FFFFFF",
      "strokeWidth": 10
    }
  ],
  "shapes": [
    {
      "id": "shape-123",
      "type": "circle",
      "x": 100,
      "y": 100,
      "radius": 50,
      "color": "#FF0000",
      "strokeWidth": 2
    },
    {
      "id": "shape-124",
      "type": "rect",
      "x": 200,
      "y": 200,
      "width": 100,
      "height": 80,
      "color": "#00FF00",
      "strokeWidth": 2
    },
    {
      "id": "shape-125",
      "type": "arrow",
      "x": 300,
      "y": 300,
      "points": [50, 50],
      "color": "#0000FF",
      "strokeWidth": 3
    },
    {
      "id": "shape-126",
      "type": "text",
      "x": 400,
      "y": 400,
      "text": "Patient shows improvement",
      "color": "#000000",
      "strokeWidth": 20
    }
  ],
  "stageSize": {
    "width": 800,
    "height": 600
  },
  "backgroundType": "pdf",
  "backgroundFileId": 456,
  "pdfPageNumber": 1,
  "pdfNumPages": 5
}
```

### Form Data Structure

```json
{
  "chief_complaint": "Patient reports persistent knee pain after running",
  "vital_signs": {
    "bp": "120/80",
    "pulse": "72",
    "temperature": "36.5"
  },
  "assessment": "Initial assessment shows possible patellar tendinitis",
  "treatment_plan": "Prescribed rest and physical therapy exercises",
  "notes": "Patient to return in 2 weeks for follow-up"
}
```

---

## Storage Strategy

### 1. Drawing Data → PostgreSQL JSONB

- **Location**: `medical_records.drawing_data` column (JSONB)
- **Size**: Typically 10-100KB per record (depends on drawing complexity)
- **Format**: JSON structure with lines, shapes, canvas size
- **Benefits**:
  - Fast queries with GIN indexes
  - Atomic updates (part of database transaction)
  - Easy to query/search
  - No separate file management

### 2. Images/PDFs → AWS S3

- **Location**: S3 bucket (e.g., `clinic-bot-files/patients/{patient_id}/{file_id}.pdf`)
- **Metadata**: Stored in `patient_files` table
- **References**: `drawing_data.backgroundFileId` points to `patient_files.id`
- **Benefits**:
  - Scalable (no database bloat)
  - Cost-effective (S3 is cheap)
  - Direct CDN delivery possible
  - Large file support

### 3. Form Data → PostgreSQL JSONB

- **Location**: `medical_records.form_data` column (JSONB)
- **Size**: Typically 1-10KB per record
- **Format**: JSON matching template schema
- **Benefits**:
  - Flexible schema (no migrations for new fields)
  - Fast queries with GIN indexes
  - Easy to extend

---

## API Endpoints

### Save Medical Record

```typescript
POST /api/medical-records
{
  "appointment_id": 123,
  "template_id": 45,  // optional
  "drawing_data": {
    "lines": [...],
    "shapes": [...],
    "stageSize": {...},
    "backgroundFileId": 456,  // if background exists
    "pdfPageNumber": 1
  },
  "form_data": {
    "chief_complaint": "...",
    ...
  },
  "background_file": File | null,  // if uploading new background
  "attachment_files": File[]        // additional attachments
}
```

### Load Medical Record

```typescript
GET /api/medical-records/{record_id}

Response:
{
  "id": 789,
  "appointment_id": 123,
  "drawing_data": {...},
  "form_data": {...},
  "background_file": {
    "id": 456,
    "file_name": "template.pdf",
    "s3_url": "https://s3.amazonaws.com/...",
    "file_type": "application/pdf"
  },
  "attachment_files": [
    {
      "id": 457,
      "file_name": "xray.jpg",
      "s3_url": "https://s3.amazonaws.com/...",
      "file_type": "image/jpeg"
    }
  ],
  "created_at": "2025-12-10T10:00:00Z",
  "updated_at": "2025-12-10T11:30:00Z"
}
```

### Auto-save (Draft)

```typescript
PATCH /api/medical-records/{record_id}/draft
{
  "drawing_data": {...},  // partial update
  "form_data": {...}      // partial update
}
```

---

## Migration from Demo (localStorage) to Production

### Current Demo Format (localStorage)

```typescript
interface SavedState {
  lines: DrawingLine[];
  shapes: Shape[];
  stageSize: { width: number; height: number };
  backgroundImageDataUrl: string | null;  // base64 data URL
  pdfFileName: string | null;
  pdfFileDataUrl: string | null;          // base64 data URL
  pdfPageNumber: number;
  pdfNumPages: number | null;
  savedAt: string;
}
```

### Production Format (Database + S3)

**Changes:**
1. **Data URLs → File References**: Instead of storing base64 data URLs, upload files to S3 and store file IDs
2. **localStorage → Database**: Save to PostgreSQL instead of browser storage
3. **Auto-save → API calls**: Replace localStorage.setItem with API PATCH requests
4. **Load → API GET**: Replace localStorage.getItem with API GET requests

**Migration Steps:**
1. Upload background image/PDF to S3 → get `file_id`
2. Store `file_id` in `drawing_data.backgroundFileId` instead of data URL
3. Store drawing data (lines, shapes) in `drawing_data` JSONB column
4. Store form data in `form_data` JSONB column
5. Load files from S3 URLs when rendering

---

## File Upload Flow

### 1. Upload Background Image/PDF

```
Frontend → POST /api/patients/{patient_id}/files
  - Upload file to S3
  - Create PatientFile record
  - Return file_id and S3 URL

Frontend → Store file_id in drawing_data.backgroundFileId
```

### 2. Save Medical Record

```
Frontend → POST /api/medical-records
  - drawing_data includes backgroundFileId
  - Create MedicalRecord with drawing_data JSONB
  - Create MedicalRecordFile links if needed
```

### 3. Load Medical Record

```
Frontend → GET /api/medical-records/{record_id}
  - Load drawing_data from JSONB
  - Load background file metadata
  - Frontend fetches file from S3 URL
  - Render canvas with background + annotations
```

---

## Performance Considerations

### JSONB Indexing

```sql
-- GIN index for fast JSONB queries
CREATE INDEX idx_medical_records_drawing_data 
ON medical_records USING gin (drawing_data);

-- Query example: Find records with specific shape types
SELECT * FROM medical_records 
WHERE drawing_data->'shapes' @> '[{"type": "circle"}]';
```

### File Caching

- S3 URLs can be pre-signed for direct access
- CDN (CloudFront) for faster file delivery
- Browser caching for frequently accessed files

### Size Limits

- **JSONB column**: PostgreSQL supports up to 1GB per JSONB value (practical limit: ~100MB)
- **Typical drawing data**: 10-100KB (very manageable)
- **S3 files**: No practical limit (individual files can be TBs)

---

## Security & Compliance

### Data Privacy

- Files stored in S3 with proper access controls
- Database records linked to appointments (patient data)
- Audit trail via `created_by_user_id` and `updated_by_user_id`
- Timestamps for compliance tracking

### Access Control

- Users can only access records for their clinic
- File access via pre-signed S3 URLs (time-limited)
- Role-based permissions (admin, practitioner, read-only)

---

## Summary

**Storage Format:**
- **Drawing data**: JSONB in PostgreSQL (`medical_records.drawing_data`)
- **Form data**: JSONB in PostgreSQL (`medical_records.form_data`)
- **Files**: S3 with metadata in `patient_files` table
- **Links**: `medical_record_files` junction table

**Key Differences from Demo:**
- ❌ No data URLs in database (too large, inefficient)
- ✅ File references (S3 URLs) instead
- ❌ No localStorage
- ✅ PostgreSQL + S3
- ❌ No auto-save to browser
- ✅ Auto-save to backend API

**Data Size:**
- Drawing data: ~10-100KB per record
- Form data: ~1-10KB per record
- Files: Stored separately in S3 (no database bloat)
