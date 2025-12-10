# Medical Records Feature - Implementation Options

## Requirements Summary

1. **File Uploads** under patient profile (photos, PDFs, x-rays, 診斷證明)
2. **Medical Records per Appointment** - template-based, customizable per clinic
3. **Text-based records** with:
   - Free text fields
   - Form elements (inputs, dropdowns, checkboxes, etc.)
   - Photo attachments
   - Basic drawing/annotation capabilities
4. **Current workflow**: Notability on iPad with Apple Pencil - upload PDF template, write/draw on it
5. **Willing to switch** from iPad to other devices, from writing to typing, but want to keep basic drawing

---

## Option 1: Custom Web-Based Solution (Recommended for MVP)

### Architecture Overview

**Frontend:**
- **Drawing/Annotation**: `react-konva` or `@excalidraw/excalidraw`
- **Form Builder**: Custom React component with `react-hook-form` + JSON schema
- **File Upload**: Direct upload to cloud storage (S3/Cloudinary)
- **PDF Viewing**: `react-pdf` or `pdfjs-dist` for viewing PDFs
- **PDF Annotation**: Custom canvas overlay or `pdf-annotator-react`

**Backend:**
- **File Storage**: AWS S3 or Cloudinary
- **Database Models**:
  - `medical_record_template` - JSON schema for clinic-specific templates
  - `medical_record` - Stores record data (JSON) linked to appointment
  - `patient_file` - Stores file metadata (S3/Cloudinary URLs) linked to patient
  - `medical_record_file` - Links files to specific medical records

### Implementation Details

#### 1. Drawing/Annotation Component

**Option 1A: Excalidraw (Recommended for simplicity)**
```typescript
// Pros:
- Built with React, seamless integration
- Hand-drawn aesthetic (similar to Notability)
- Good mobile/touch support
- Open source, actively maintained
- Can export to PNG/SVG

// Cons:
- Less customizable than Konva
- Primarily for diagrams, not PDF annotation
- May need customization for medical use case
```

**Option 1B: react-konva (Recommended for flexibility)**
```typescript
// Pros:
- Highly customizable
- Excellent performance
- Good touch/mobile support
- Can overlay on images/PDFs
- Full control over drawing tools

// Cons:
- More code required
- Need to build UI controls (brush, eraser, etc.)
- Steeper learning curve
```

**Option 1C: PDF.js + Custom Canvas Overlay**
```typescript
// Pros:
- Native PDF rendering
- Can draw directly on PDF pages
- Export annotated PDFs
- Matches current workflow (PDF template)

// Cons:
- More complex implementation
- Need to handle PDF coordinate system
- Exporting annotated PDFs requires PDF manipulation library
```

#### 2. Medical Record Template System

**JSON Schema Approach:**
```json
{
  "fields": [
    {
      "id": "chief_complaint",
      "type": "textarea",
      "label": "主訴",
      "required": true
    },
    {
      "id": "vital_signs",
      "type": "group",
      "label": "生命徵象",
      "fields": [
        {"id": "bp", "type": "text", "label": "血壓"},
        {"id": "pulse", "type": "number", "label": "脈搏"}
      ]
    },
    {
      "id": "assessment",
      "type": "drawing",
      "label": "評估圖",
      "canvasWidth": 800,
      "canvasHeight": 600
    },
    {
      "id": "attachments",
      "type": "file",
      "label": "附件",
      "accept": ["image/*", "application/pdf"],
      "multiple": true
    }
  ]
}
```

#### 3. File Storage

**Option A: AWS S3 (Recommended)**
- Scalable, cost-effective
- Direct client uploads via pre-signed URLs
- Good for large files (x-rays, PDFs)
- Requires AWS setup

**Option B: Cloudinary**
- Automatic image optimization
- CDN delivery
- Built-in transformations
- More expensive, vendor lock-in

**Option C: PostgreSQL bytea (Not recommended)**
- Simple but poor performance for large files
- Database bloat issues

### Pros
✅ Full control over features and UX
✅ No vendor lock-in
✅ Can match current Notability workflow (PDF templates)
✅ Cost-effective (S3 storage is cheap)
✅ HIPAA compliance under your control
✅ Can iterate based on clinic feedback

### Cons
❌ Significant development time (2-3 months)
❌ Drawing experience may not match iPad/Apple Pencil quality
❌ Need to build form builder UI for clinics
❌ PDF annotation is complex
❌ Mobile drawing experience may be suboptimal

### Estimated Development Time
- **Phase 1 (MVP)**: 6-8 weeks
  - File upload system (patient profile)
  - Basic medical record CRUD
  - Simple form template (hardcoded)
  - Basic drawing on blank canvas
  
- **Phase 2**: 4-6 weeks
  - Template builder UI
  - PDF template support
  - PDF annotation
  - Image annotation
  
- **Phase 3**: 2-4 weeks
  - Mobile optimization
  - Advanced drawing tools
  - Export/print functionality

---

## Option 2: Hybrid Solution - Third-Party Drawing + Custom Forms

### Architecture

**Drawing/Annotation:**
- **Excalidraw** or **tldraw** embedded as drawing component
- Export drawings as images/SVG
- Embed in medical record form

**Forms:**
- Custom React form builder
- Store drawing exports as file attachments

**File Storage:**
- S3 or Cloudinary

### Pros
✅ Faster development (leverage existing drawing libraries)
✅ Good drawing UX (Excalidraw is polished)
✅ Focus development on form builder
✅ Can still support PDF templates (as images)

### Cons
❌ Drawing is separate from form (not inline)
❌ Less seamless than integrated solution
❌ May need to export/import drawings
❌ PDF annotation still requires custom work

### Estimated Development Time
- **Phase 1 (MVP)**: 4-6 weeks
- **Phase 2**: 3-4 weeks (template builder)
- **Total**: ~8-10 weeks

---

## Option 3: Third-Party Medical Record Integration

### Options

**A. White-Label EMR APIs**
- MDVision, Firely FHIR Server
- Full EMR functionality
- API integration

**B. PDF Annotation Services**
- VeryPDF JavaScript PDF Annotator
- HIPAA-compliant
- Embedded in your app

### Pros
✅ Fastest to market
✅ Professional medical record features
✅ HIPAA compliance handled
✅ Less development burden

### Cons
❌ High cost (monthly fees per clinic/user)
❌ Vendor lock-in
❌ Less customization
❌ May not match current workflow
❌ Integration complexity
❌ May not support drawing on PDFs

### Estimated Development Time
- Integration: 2-4 weeks
- Customization: Ongoing

---

## Option 4: Progressive Enhancement Approach (Recommended Strategy)

### Phase 1: File Uploads + Basic Records (4 weeks)
- Patient profile file uploads
- Simple medical record with text fields only
- File attachments to records
- **No drawing yet** - validate the core workflow

### Phase 2: Template System (3 weeks)
- JSON-based template builder
- Clinic admins can create custom forms
- Support common field types

### Phase 3: Image Annotation (3 weeks)
- Add drawing canvas for images
- Use `react-konva` for annotation
- Upload images, draw on them
- Export annotated images

### Phase 4: PDF Support (4 weeks)
- PDF viewing with `react-pdf`
- PDF annotation overlay
- Export annotated PDFs
- Support PDF templates

### Phase 5: Mobile Optimization (2 weeks)
- Touch gesture improvements
- Responsive drawing tools
- Mobile-specific UI

### Total Timeline: ~16 weeks (4 months)

---

## Recommendations

### For MVP (Minimum Viable Product)

**Recommended: Option 1 (Custom Solution) - Phase 1 + Phase 2**

1. **Start Simple:**
   - File uploads to S3 (patient profile)
   - Basic medical record with text fields
   - Simple template system (JSON schema)
   - File attachments to records

2. **Add Drawing Later:**
   - Start with image annotation (easier than PDF)
   - Use `react-konva` for flexibility
   - Add PDF support in Phase 2

3. **Progressive Enhancement:**
   - Get clinics using text-based records first
   - Gather feedback on drawing needs
   - Iterate based on actual usage

### Technical Stack Recommendation

**Frontend:**
- `react-konva` - Drawing/annotation
- `react-hook-form` - Form handling
- `react-pdf` - PDF viewing
- `@aws-sdk/client-s3` - S3 uploads
- `zod` - Schema validation (already in project)

**Backend:**
- `boto3` - S3 integration
- `python-multipart` - File uploads (FastAPI)
- JSON columns in PostgreSQL for flexible templates

**Database Schema:**
```python
class MedicalRecordTemplate(Base):
    clinic_id: int
    name: str
    schema: JSON  # Form field definitions
    created_at: datetime

class MedicalRecord(Base):
    appointment_id: int
    template_id: int
    data: JSON  # Form field values
    created_by_user_id: int
    created_at: datetime

class PatientFile(Base):
    patient_id: int
    file_name: str
    file_type: str
    s3_key: str
    file_size: int
    uploaded_by_user_id: int
    created_at: datetime

class MedicalRecordFile(Base):
    medical_record_id: int
    patient_file_id: int  # Reference to PatientFile
```

### Drawing Experience Considerations

**Web Drawing Limitations:**
- Touch/stylus support varies by device
- Pressure sensitivity not available in web
- May not match iPad/Apple Pencil experience
- Browser compatibility issues

**Mitigation Strategies:**
1. **Start with simple drawing tools** (pen, highlighter, shapes)
2. **Optimize for tablet devices** (iPad, Android tablets)
3. **Consider Progressive Web App (PWA)** for better mobile experience
4. **Provide fallback**: Allow uploading annotated PDFs from Notability initially
5. **Gather user feedback** early to understand actual drawing needs

### Questions to Clarify

1. **Drawing Priority**: How critical is drawing vs. text input? Can we start text-only?
2. **PDF Templates**: Do clinics need to upload their own PDF templates, or can we provide standard ones?
3. **Mobile Usage**: What percentage of users will use mobile/tablet vs. desktop?
4. **Drawing Complexity**: Simple annotations (circles, arrows) or detailed sketches?
5. **Export Needs**: Do clinics need to export/print records? What format?
6. **Compliance**: Any specific HIPAA/Taiwan medical record regulations to consider?

---

## Cost Comparison

### Option 1 (Custom Solution)
- **Development**: 16 weeks @ developer rate
- **Storage**: S3 ~$0.023/GB/month (very cheap)
- **Ongoing**: Maintenance, feature additions

### Option 2 (Hybrid)
- **Development**: 8-10 weeks
- **Storage**: Same as Option 1
- **Third-party**: Excalidraw is free/open source

### Option 3 (Third-Party)
- **Development**: 2-4 weeks integration
- **Monthly fees**: $50-200+ per clinic/user
- **Vendor lock-in**: High switching cost

---

## Final Recommendation

**Start with Option 1 (Custom) - Phased Approach:**

1. **Phase 1 (4 weeks)**: File uploads + basic text records
2. **Phase 2 (3 weeks)**: Template builder
3. **Phase 3 (3 weeks)**: Image annotation with react-konva
4. **Phase 4 (4 weeks)**: PDF support (if needed)
5. **Phase 5 (2 weeks)**: Mobile optimization

**Rationale:**
- Full control and customization
- Cost-effective long-term
- Can match current workflow
- Progressive enhancement reduces risk
- Can always integrate third-party later if needed

**Alternative Quick Start:**
If clinics need drawing immediately, consider:
- Phase 1: File uploads + text records
- Allow clinics to upload annotated PDFs from Notability as attachments
- Add web-based drawing in Phase 2 based on feedback

This validates the core workflow while deferring the complex drawing implementation.
