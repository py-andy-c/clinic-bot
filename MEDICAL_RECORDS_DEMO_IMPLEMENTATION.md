# Medical Records Demo Implementation Documentation

## Overview

This document details the implementation of a medical records demo page that combines structured form fields with free-form drawing/annotation capabilities. The demo serves as an MVP to validate the concept and user experience before building the production version.

**Demo Page**: `/demo/drawing` (public route, no authentication required)

## Features Implemented

### 1. Structured Form Fields
- **Chief Complaint (主訴)**: Textarea for patient's primary complaint
- **Vital Signs (生命徵象)**: Blood pressure (血壓), Pulse (脈搏), Temperature (體溫)
- **Assessment (評估)**: Textarea for medical assessment
- **Treatment Plan (治療計畫)**: Textarea for treatment plan
- **Notes (備註)**: Textarea for additional notes

All form fields support Chinese text input and are fully integrated into PDF export.

### 2. Free-Form Drawing/Annotation
- **Drawing Tools**:
  - Pen (筆): Freehand drawing
  - Circle (圓形): Draw circles
  - Rectangle (矩形): Draw rectangles
  - Arrow (箭頭): Draw arrows
  - Text (文字): Add text annotations
  - Eraser (橡皮擦): Erase drawings
- **Color Picker**: Custom color selection with presets
- **Brush Size**: Adjustable stroke width (1-20px)
- **Undo/Redo**: Full history support

### 3. Background Image/PDF Support
- **Image Upload**: Upload photos/images as background for annotation
- **PDF Import**: Upload PDF files and annotate on individual pages
- **Page Navigation**: Navigate between PDF pages
- **Default Anatomy Diagram**: Simple human anatomy diagram (人體解剖圖) loaded by default

### 4. State Persistence (Demo)
- **Auto-save**: Debounced auto-save to `localStorage` (1 second delay)
- **Auto-load**: Restores all state on page load:
  - Form data
  - Drawing lines and shapes
  - Background image/PDF
  - Canvas size
  - PDF page number
- **Manual Save**: Button to force immediate save

### 5. PDF Export
- **Combined Export**: Exports both form data and drawing canvas into a single PDF
- **Chinese Font Support**: Uses `pdfmake` with embedded Noto Sans TC font
- **Multi-page Support**: Automatically creates new pages for long form content
- **Image Embedding**: Drawing canvas exported as embedded image

## Technical Implementation

### Technology Stack

#### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **React Router** for routing
- **TailwindCSS** for styling
- **react-konva** (v18.2.10) + **konva** (v9.2.0) for drawing canvas
- **react-pdf** + **pdfjs-dist** for PDF rendering
- **pdfmake** for PDF generation with Chinese font support

#### Dependencies
```json
{
  "react-konva": "^18.2.10",
  "konva": "^9.2.0",
  "react-pdf": "^10.2.0",
  "pdfjs-dist": "^5.4.296",
  "pdfmake": "latest",
  "@types/pdfmake": "latest"
}
```

### Architecture Decisions

#### 1. Drawing Library: react-konva

**Choice**: `react-konva` over alternatives (Fabric.js, Paper.js, native Canvas API)

**Rationale**:
- React-friendly declarative API
- Good touch/stylus support for iPad
- Active maintenance and community
- Works well with React state management
- Supports all required drawing primitives (lines, shapes, text, images)

**Alternatives Considered**:
- **Fabric.js**: More complex API, less React-native
- **Paper.js**: Vector-focused, overkill for simple annotations
- **Native Canvas**: Too low-level, requires manual state management

#### 2. PDF Generation: pdfmake

**Choice**: `pdfmake` over `pdf-lib`

**Rationale**:
- **Better Chinese font support**: `pdfmake` has proven support for Chinese characters
- **Simpler API**: Declarative document definition vs. imperative drawing
- **Font embedding**: Easier font registration and embedding
- **Image support**: Native support for data URLs

**Issues with pdf-lib**:
- Standard fonts (Helvetica) don't support Chinese characters
- Required `@pdf-lib/fontkit` for custom fonts
- Complex font file validation and embedding
- Font file download issues (GitHub raw links returning HTML)
- Would require image fallback for Chinese text (not acceptable per requirements)

**pdfmake Benefits**:
- Direct Chinese font embedding via base64
- Simpler document structure
- Better error handling
- Active community with Chinese font examples

#### 3. PDF Rendering: react-pdf + pdfjs-dist

**Choice**: `react-pdf` for displaying PDFs in the browser

**Rationale**:
- React component-based API
- Renders PDF pages as canvas images
- Good for annotation workflows
- Handles page navigation

**Implementation Details**:
- PDF.js worker served from `/pdf.worker.min.mjs` (local file to avoid CORS)
- Worker file copied from `node_modules/react-pdf/node_modules/pdfjs-dist/build/`
- Backend serves worker file directly from `frontend/dist/`

#### 4. State Persistence: localStorage (Demo Only)

**Choice**: Browser `localStorage` for demo persistence

**Rationale**:
- Simple implementation for demo
- No backend required
- Works immediately
- Good for testing user experience

**Production Considerations**:
- `localStorage` is client-side only, limited storage (~5-10MB)
- Not suitable for production (see Production Recommendations)

### Key Implementation Details

#### 1. Touch Event Handling (iPad Support)

**Problem**: Unwanted screen scrolling when drawing on touch devices

**Solution**: Multi-layered approach
```typescript
// CSS
touchAction: 'none'

// Konva event handlers
e.evt.preventDefault()

// Explicit touch listeners
container.addEventListener('touchstart', preventScroll, { passive: false, capture: true })
```

**Why Multiple Approaches**:
- CSS `touch-action` provides baseline prevention
- Konva's `preventDefault()` handles canvas-specific events
- Explicit listeners with `passive: false` ensure events are caught early
- `capture: true` ensures we catch events before they bubble

#### 2. Chinese Font Support

**Implementation**:
1. Download Noto Sans TC (Traditional Chinese) font from Google Fonts
2. Store in `frontend/public/fonts/NotoSansTC-Regular.ttf`
3. Load font file, convert to base64
4. Register with pdfmake:
```typescript
pdfMake.vfs['NotoSansTC-Regular.ttf'] = fontBase64;
pdfMake.fonts = {
  NotoSansTC: {
    normal: 'NotoSansTC-Regular.ttf',
    bold: 'NotoSansTC-Regular.ttf',
    // ...
  }
};
```

**Font File**:
- Size: ~2.6MB (OpenType format)
- Source: `https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf`
- Format: OTF (works with pdfmake)

#### 3. PDF Export Structure

**Document Definition**:
```typescript
{
  content: [
    // Title
    { text: '病歷記錄', fontSize: 20, bold: true },
    // Form fields (labels + values)
    { text: '主訴:', fontSize: 12, bold: true },
    { text: formData.chiefComplaint, fontSize: 11 },
    // ... more fields
    // Drawing section
    { text: '繪圖/註解', fontSize: 12, bold: true },
    { image: drawingImageDataUrl, width: 500 }
  ],
  defaultStyle: { font: 'NotoSansTC' },
  pageSize: 'A4',
  pageMargins: [40, 60, 40, 60]
}
```

**Image Format**:
- Canvas exported as data URL: `data:image/png;base64,...`
- pdfmake accepts full data URL (not just base64 string)
- Pixel ratio of 2 for better quality

#### 4. Default Anatomy Diagram

**Implementation**:
- SVG-based human figure diagram
- Created programmatically (no external file needed)
- Includes Chinese labels for body parts
- Loaded automatically when no background image exists
- Saved with state (persists across sessions)

**SVG Structure**:
- Head (circle)
- Neck, torso, arms, legs (lines and rectangles)
- Labels: 頭部, 軀幹, 左臂, 右臂, 左腿, 右腿

## Issues Encountered and Solutions

### 1. PDF.js Worker CORS Issues

**Problem**: PDF.js worker loaded from CDN (unpkg.com) blocked by CORS when served via ngrok

**Solution**:
1. Copy worker file to `frontend/public/pdf.worker.min.mjs`
2. Update worker path: `pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`
3. Update backend to serve static files from `frontend/dist/`

**Lesson**: Always serve PDF.js worker from same origin to avoid CORS issues

### 2. PDF.js Version Mismatch

**Problem**: `Error: The API version "5.4.296" does not match the Worker version "5.4.449"`

**Solution**: Use the exact worker file from the `pdfjs-dist` version that `react-pdf` depends on:
```bash
cp node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```

**Lesson**: Always use the worker file from the exact `pdfjs-dist` version in your dependency tree

### 3. pdf-lib Chinese Font Issues

**Problem**: 
- Standard fonts don't support Chinese
- Font file downloads returned HTML instead of TTF
- Complex font embedding with fontkit

**Solution**: Switched to `pdfmake` which has better Chinese font support

**Lesson**: Choose libraries based on actual requirements (Chinese support was critical)

### 4. pdfmake vfs_fonts Import Error

**Problem**: `Cannot read properties of undefined (reading 'vfs')`

**Root Cause**: `vfs_fonts.js` exports `vfs` directly, not wrapped in an object

**Solution**:
```typescript
// vfs_fonts.js exports: module.exports = vfs;
// So pdfFonts IS the vfs object
(pdfMake as any).vfs = pdfFonts as any;
```

**Lesson**: Check actual module export structure, not assumed structure

### 5. pdfmake Image Format Error

**Problem**: `Invalid image: File 'iVBORw0KGgo...'`

**Root Cause**: pdfmake expects full data URL, not just base64 string

**Solution**: Pass full data URL from `canvas.toDataURL()`:
```typescript
// Correct
image: stage.toDataURL({ pixelRatio: 2 })

// Wrong
image: dataURL.split(',')[1] // Just base64 part
```

**Lesson**: Always check library documentation for exact format requirements

### 6. React Konva Peer Dependency

**Problem**: `react-konva` requires React 18, but project had React 19

**Solution**: Install compatible version with legacy peer deps:
```bash
npm install 'react-konva@^18.2.10' 'konva@^9.2.0' --legacy-peer-deps
```

**Lesson**: Use `--legacy-peer-deps` when dependency versions don't match exactly

### 7. Touch Scrolling on iPad

**Problem**: Screen scrolls when trying to draw

**Solution**: Multi-layered prevention (CSS + event handlers + capture phase)

**Lesson**: Touch events require aggressive prevention strategies on mobile devices

## Design Choices and Rationale

### 1. Combined Form + Drawing Approach

**Decision**: Mix structured form fields with free-form drawing canvas

**Rationale**:
- Matches clinic workflow (structured data + visual annotations)
- Allows both typed and drawn content
- More flexible than pure drawing or pure forms
- Better for PDF export (searchable text + visual annotations)

**Alternative Considered**: Separate pages for forms and drawing
- **Rejected**: Would require navigation, less intuitive workflow

### 2. Default Anatomy Diagram

**Decision**: Load simple human figure diagram by default

**Rationale**:
- Provides immediate value (users can annotate right away)
- Matches clinic use case (annotating on body diagrams)
- Can be replaced with custom images/PDFs
- Reduces blank canvas confusion

**Alternative Considered**: Blank canvas by default
- **Rejected**: Less useful, requires users to upload something first

### 3. State Persistence Strategy

**Decision**: localStorage for demo, with clear path to production

**Rationale**:
- Fast to implement
- Works without backend
- Good for demo/validation
- Clear migration path (see Production Recommendations)

**Production**: Will use backend API + database

### 4. Chinese-First UI

**Decision**: All UI text in Traditional Chinese

**Rationale**:
- Primary user base is Chinese-speaking
- Better user experience for target audience
- Matches existing app language preference
- PDF exports also in Chinese

## Production Implementation Recommendations

### 1. Backend Architecture

#### Database Schema

```sql
-- Medical record templates (clinic-customizable)
CREATE TABLE medical_record_templates (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id),
    name VARCHAR(255) NOT NULL,
    schema JSONB NOT NULL,  -- Form field definitions
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Medical records (per appointment)
CREATE TABLE medical_records (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id),
    template_id INTEGER REFERENCES medical_record_templates(id),
    form_data JSONB NOT NULL,  -- Form field values
    drawing_data JSONB NOT NULL,  -- Drawing lines, shapes, etc.
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Patient files (uploaded images/PDFs)
CREATE TABLE patient_files (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL,  -- 'image/jpeg', 'application/pdf', etc.
    s3_key VARCHAR(500) NOT NULL,  -- S3 object key
    file_size INTEGER NOT NULL,
    uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Link medical records to patient files (for background images)
CREATE TABLE medical_record_files (
    id SERIAL PRIMARY KEY,
    medical_record_id INTEGER NOT NULL REFERENCES medical_records(id),
    patient_file_id INTEGER REFERENCES patient_files(id),
    is_background BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### Storage Strategy

**Form Data & Drawing Data**: PostgreSQL JSONB columns
- **Pros**: 
  - Queryable (can search form data)
  - Versioned (can track changes)
  - Structured (validated against template schema)
- **Cons**: 
  - Limited size (1GB per row max, but should be fine for drawings)

**Binary Files (Images/PDFs)**: AWS S3
- **Pros**:
  - Scalable
  - Cost-effective
  - CDN integration
- **Implementation**:
  - Upload to S3 on file upload
  - Store S3 key in `patient_files` table
  - Generate presigned URLs for frontend access
  - Use S3 lifecycle policies for archival

#### API Endpoints

```python
# Medical Records
POST   /api/medical-records                    # Create new record
GET    /api/medical-records/{id}               # Get record
PUT    /api/medical-records/{id}               # Update record
DELETE /api/medical-records/{id}               # Delete record
GET    /api/appointments/{id}/medical-record   # Get record for appointment

# Patient Files
POST   /api/patients/{id}/files                # Upload file
GET    /api/patients/{id}/files                # List files
DELETE /api/patient-files/{id}                 # Delete file
GET    /api/patient-files/{id}/download        # Get presigned S3 URL

# Templates
GET    /api/clinics/{id}/medical-record-templates
POST   /api/clinics/{id}/medical-record-templates
PUT    /api/medical-record-templates/{id}
DELETE /api/medical-record-templates/{id}
```

### 2. State Management

**Current (Demo)**: localStorage
**Production**: 
- **Real-time**: WebSocket or Server-Sent Events for auto-save
- **Optimistic Updates**: Update UI immediately, sync in background
- **Conflict Resolution**: Last-write-wins or merge strategies
- **Offline Support**: Service Worker + IndexedDB for offline editing

### 3. Drawing Data Format

**Current Format** (localStorage):
```typescript
{
  lines: Array<{
    tool: 'pen' | 'eraser',
    points: number[],
    color: string,
    strokeWidth: number
  }>,
  shapes: Array<{
    id: string,
    type: 'circle' | 'rect' | 'arrow' | 'text',
    x: number,
    y: number,
    // ... other properties
  }>
}
```

**Production Format** (JSONB):
- Same structure, stored in PostgreSQL
- Add version field for conflict resolution
- Add metadata (created_at, updated_at per drawing element if needed)

### 4. PDF Generation

**Current**: Client-side with pdfmake
**Production Options**:

**Option A: Client-side (Current)**
- **Pros**: No server load, instant generation
- **Cons**: Large font file download, browser memory limits
- **Recommendation**: Keep for small records, use server-side for large/complex

**Option B: Server-side**
- **Library**: `pdfmake` (Node.js) or `reportlab` (Python)
- **Pros**: 
  - Consistent fonts (server has font files)
  - Can handle large/complex documents
  - Better error handling
- **Cons**: 
  - Server load
  - Requires async API call
- **Recommendation**: Use for production, especially for large records

**Implementation**:
```python
# Backend endpoint
POST /api/medical-records/{id}/export-pdf

# Generate PDF server-side using pdfmake Node.js or reportlab Python
# Return PDF as binary response
```

### 5. Font Management

**Current**: Single font file in `public/fonts/`
**Production**:
- Store font files in S3 or CDN
- Load fonts on-demand
- Cache fonts in browser
- Support multiple font weights (Regular, Bold, etc.)

### 6. Performance Optimizations

**Drawing Canvas**:
- **Virtualization**: Only render visible portion of large canvases
- **Lazy Loading**: Load background images on-demand
- **Compression**: Compress drawing data before storage
- **Debouncing**: Already implemented (1 second auto-save)

**PDF Rendering**:
- **Lazy Loading**: Load PDF pages on-demand
- **Caching**: Cache rendered PDF pages
- **Progressive Loading**: Show first page immediately

**State Management**:
- **Incremental Saves**: Only save changed portions
- **Compression**: Compress large state objects
- **Pagination**: For large drawing histories

### 7. Security Considerations

**File Uploads**:
- **Validation**: File type, size limits
- **Virus Scanning**: Scan uploaded files
- **Access Control**: Verify user has permission to upload to patient
- **S3 Policies**: Restrict S3 bucket access

**Medical Records**:
- **Access Control**: Verify user can view/edit record
- **Audit Logging**: Log all access and modifications
- **Encryption**: Encrypt sensitive data at rest
- **HIPAA Compliance**: Ensure compliance with medical data regulations

**PDF Export**:
- **Access Control**: Verify user can export record
- **Watermarking**: Add user/clinic watermark
- **Expiration**: Set expiration on presigned URLs

### 8. Error Handling

**Current**: Basic try-catch with console logging
**Production**:
- **Error Tracking**: Sentry or similar
- **User-Friendly Messages**: Translate all error messages
- **Retry Logic**: Automatic retry for network failures
- **Offline Handling**: Queue operations when offline

### 9. Testing Strategy

**Unit Tests**:
- Drawing tool functions
- State save/load logic
- PDF generation logic
- Form validation

**Integration Tests**:
- Full drawing workflow
- PDF export end-to-end
- State persistence
- File upload/download

**E2E Tests**:
- Complete medical record creation
- Annotation on anatomy diagram
- PDF export and verification
- Multi-device testing (iPad, desktop, mobile)

### 10. Migration from Demo

**Data Migration**:
- Demo uses localStorage (client-side only)
- Production will need manual data entry or import tool
- No automatic migration path (by design - demo is for validation)

**Code Migration**:
- Extract drawing canvas into reusable component
- Extract PDF export into service/utility
- Extract form fields into configurable component based on template
- Keep UI/UX patterns, replace persistence layer

## Known Limitations (Demo)

1. **localStorage Size**: Limited to ~5-10MB, may fill up with large drawings
2. **No Multi-user**: No conflict resolution, single user only
3. **No Versioning**: Can't view history of changes
4. **No Templates**: Fixed form structure (not clinic-customizable)
5. **Client-side PDF**: Large font file, browser memory limits
6. **No File Management**: Can't delete or organize uploaded files
7. **No Permissions**: No access control (demo is public)
8. **No Audit Trail**: No logging of who changed what

## Lessons Learned

### What Worked Well

1. **pdfmake for Chinese**: Much better than pdf-lib for Chinese text
2. **react-konva**: Excellent for touch-based drawing
3. **SVG for Default Diagram**: Easy to generate programmatically
4. **Combined Form + Drawing**: Good user experience
5. **Auto-save**: Users appreciate not losing work

### What Could Be Improved

1. **Font Loading**: Should load fonts asynchronously, show loading state
2. **Error Messages**: More user-friendly error messages needed
3. **Performance**: Large drawings can be slow, need optimization
4. **Mobile UX**: Some UI elements too small on mobile
5. **PDF Quality**: Could improve image quality/resolution

### Recommendations for Production

1. **Start with Server-side PDF**: More reliable, better error handling
2. **Implement Templates Early**: Core feature, affects data model
3. **Plan for Offline**: Medical records may need offline access
4. **Invest in Testing**: Medical data requires high reliability
5. **Consider Real-time Collaboration**: Multiple practitioners may edit same record

## File Structure

```
frontend/
├── src/
│   ├── pages/
│   │   └── DrawingDemoPage.tsx      # Main demo page
│   └── ...
├── public/
│   ├── fonts/
│   │   └── NotoSansTC-Regular.ttf   # Chinese font for PDF
│   └── pdf.worker.min.mjs            # PDF.js worker
└── ...
```

## Dependencies

```json
{
  "react-konva": "^18.2.10",
  "konva": "^9.2.0",
  "react-pdf": "^10.2.0",
  "pdfjs-dist": "^5.4.296",
  "pdfmake": "latest",
  "@types/pdfmake": "latest"
}
```

## Conclusion

This demo successfully validates the concept of combining structured medical record forms with free-form drawing/annotation capabilities. The implementation provides a solid foundation for production development, with clear migration paths and identified areas for improvement.

Key takeaways:
- **pdfmake** is the right choice for Chinese PDF generation
- **react-konva** works well for touch-based drawing
- **Combined approach** (forms + drawing) provides good UX
- **State persistence** needs backend for production
- **Chinese font support** is critical and well-handled

The demo is ready for user testing and feedback before production implementation.
