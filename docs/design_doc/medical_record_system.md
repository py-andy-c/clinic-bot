# Medical Record System - Technical Design

## Overview

This document outlines the technical implementation for the Medical Record System (Clinic CRM). The system follows a "Split" model: a structured header for standardized data and an infinite "Clinical Workspace" for drawing, image injection, and annotations.

***

## Key Business Logic

### 1. The "Split" Architecture

Each medical record is composed of two primary sections:

* **Structured Header**: Form fields (text, dropdown, etc.) defined by a template.
* **Clinical Workspace**: A vertically infinite canvas for free-form interaction.

### 2. Template-Driven Customization

Clinic admins define the "schema" of clinical notes.

* A template defines which fields appear in the header.
* A template can pre-load a background diagram (e.g., anatomy) into the workspace.

### 3. Record Lifecycle

* Records are always editable by the practitioner or admin.
* Every record is tied to a Patient and a Clinic.

### 4. Template Change Strategy

To ensure historical data integrity:

* **Snapshotting**: When a medical record is created, the system copies both the template's `header_fields` AND its `base_layers` (background diagrams) into the record itself.
* **Integrity**: If a template is later edited or deleted by an admin, existing records remain unaffected. They rely exclusively on their internal snapshot for both structured data and workspace diagrams.
* **Template Deletion**: Admins can soft-delete templates. Deleted templates will no longer appear in the "Create Record" menu but will remain in the database to support existing historical records.

***

## Backend Technical Design

### Database Schema

#### `MedicalRecordTemplate`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | Integer (PK) | Unique ID |
| `clinic_id` | Integer (FK) | Tied to Clinic |
| `name` | String | Template name (e.g., "First Visit", "Acupuncture") |
| `header_fields` | JSONB | Array of field definitions: `{id, type, label, options[]}` |
| `workspace_config` | JSONB | `{base_layers: MediaLayer[]}` (The "Base Layers" pre-configured by admin) |
| `is_active` | Boolean | Soft delete / toggle |

#### `MedicalRecord`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | Integer (PK) | Unique ID |
| `patient_id` | Integer (FK) | Tied to Patient |
| `clinic_id` | Integer (FK) | Tied to Clinic |
| `template_id` | Integer (FK) | Reference to the template used (for analytics) |
| `header_structure` | JSONB | **\[Snapshot]** A copy of the template's `header_fields` at the time of creation |
| `header_values` | JSONB | Data for structured fields: `{field_id: value}` |
| `workspace_data` | JSONB | Vector drawing paths and media placements |
| `created_at` | DateTime | Auto-timestamp |
| `updated_at` | DateTime | Updated on every save (Last Edited At) |

***

## JSON Schema Specifications

### 1. Header Structure (`MedicalRecordTemplate.header_fields` & `MedicalRecord.header_structure`)

An array of objects defining the structured form.

```typescript
type HeaderField = {
  id: string; // UUID generated on the frontend during template creation
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'number';
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[]; // Used for select, checkbox, and radio
  unit?: string; // Optional (e.g., "kg", "mmHg")
};

// Example:
// [
//   { "id": "f1", "type": "text", "label": "Blood Pressure", "required": true, "unit": "mmHg" },
//   { "id": "f2", "type": "select", "label": "Severity", "required": false, "options": ["Low", "Mid", "High"] }
// ]
```

### 2. Header Values (`MedicalRecord.header_values`)

A flat object mapping field IDs to their user-input values.

```typescript
type HeaderValues = {
  [fieldId: string]: string | string[] | number | boolean;
};

// Example:
// {
//   "f1": "120/80",
//   "f2": "High"
// }
```

### 3. Workspace Config (`MedicalRecordTemplate.workspace_config`)

Settings and pre-filled content for the Clinical Workspace.

```typescript
type WorkspaceConfig = {
  // Array of "Base Layers" pre-configured by the admin (anatomy diagrams, etc.)
  base_layers: MediaLayer[];
  backgroundImageUrl?: string; // Optional static background
  canvas_width?: number; // Fixed or responsive behavior
  allow_practitioner_uploads: boolean; // Default true
};
```

### 4. Workspace Data (`MedicalRecord.workspace_data`)

Vector paths and media layers for the drawing engine.

```typescript
type DrawingPath = {
  type: 'drawing';
  tool: 'pen' | 'eraser' | 'highlighter';
  color: string;
  width: number;
  points: [number, number, number?][]; // Array of [x, y, pressure?] coordinates
};

type MediaLayer = {
  type: 'media';
  id: string; // Unique ID for this media instance
  origin: 'template' | 'upload'; // Distinguish between admin-set and practitioner-uploaded
  url: string; // S3 URL
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type WorkspaceData = {
  version: number; // Schema version for future migrations
  layers: (DrawingPath | MediaLayer)[];
  viewport?: { zoom: number; scroll_top: number };
  canvas_height: number; // For the "Growing Document" feel
  canvas_width?: number; // Optional width for the "Growing Document" feel
  background_image_url?: string;
};
```

#### `MedicalRecordMedia`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | Integer (PK) | Unique ID |
| `record_id` | Integer (FK) | Tied to Record |
| `s3_key` | String | Storage reference |
| `file_type` | String | image/png, image/jpeg, etc. |

### API Endpoints

#### Templates ✅ IMPLEMENTED

* `GET /api/clinic/medical-record-templates`: List templates (with `include_inactive` param).
* `POST /api/clinic/medical-record-templates`: Create template (Admin only).
* `GET /api/clinic/medical-record-templates/{id}`: Get template.
* `PUT /api/clinic/medical-record-templates/{id}`: Update template (Admin only).
* `DELETE /api/clinic/medical-record-templates/{id}`: Deactivate (soft-delete) template (Admin only).

**Implementation Details**:
- Service: `MedicalRecordTemplateService` in `backend/src/services/medical_record_template_service.py`
- Router: `backend/src/api/clinic/medical_record_templates.py`
- Strict Pydantic validation for `HeaderField`, `WorkspaceConfig`

#### Records ✅ IMPLEMENTED

* `GET /api/clinic/patients/{patient_id}/medical-records`: List history for a patient (chronological, newest first).
* `POST /api/clinic/patients/{patient_id}/medical-records`: Create new record from template (snapshots header_fields and base_layers).
* `GET /api/clinic/medical-records/{id}`: Get full record details.
* `PATCH /api/clinic/medical-records/{id}`: Update record (autosave with strict validation).
* `DELETE /api/clinic/medical-records/{id}`: Delete record (hard delete).

**Implementation Details**:
- Service: `MedicalRecordService` in `backend/src/services/medical_record_service.py`
- Router: `backend/src/api/clinic/medical_records.py`
- Strict Pydantic validation for `WorkspaceData`, `DrawingPath`, `MediaLayer`
- Clinic isolation enforced via `ensure_clinic_access()`

#### Media Upload ✅ IMPLEMENTED

* `POST /api/clinic/medical-records/{id}/media`: Upload workspace image.
  - Handles S3 upload with local storage fallback.
  - **Memory Efficiency**: Uses `upload_fileobj` streaming for S3 to avoid reading large files into memory.
  - Creates `MedicalRecordMedia` entry for tracking.
  - Returns URL and original filename.

***

## Frontend Technical Design

### State Management Strategy

#### Server State (React Query) ✅ IMPLEMENTED

* `useMedicalRecordTemplates()`: Fetch templates for a clinic (Phase 1).
* `useMedicalRecordTemplateMutations()`: Create, update, delete templates (Phase 1).
* `usePatientMedicalRecords(patientId)`: Fetch history timeline (Phase 2).
* `useMedicalRecord(recordId)`: Fetch specific record data (Phase 2).
* `useCreateMedicalRecord()`: Create new record with cache invalidation (Phase 2).
* `useUpdateMedicalRecord()`: Update record with cache invalidation (Phase 2).
* `useDeleteMedicalRecord()`: Delete record with cache invalidation (Phase 2).

**Implementation Details**:
- Hooks: `frontend/src/hooks/queries/useMedicalRecordTemplates.ts`, `useMedicalRecords.ts`
- Query keys properly structured for cache management
- Automatic cache invalidation on mutations

#### Client State ✅ IMPLEMENTED

* **`ClinicalWorkspace` State**: Managed via React `useState` and `useCallback` for canvas rendering performance.
  * **Sync Logic**:
    * Debounced PATCH requests (3s) for autosave using `useUpdateMedicalRecord`.
    * **Sync Status Indicator**: UI feedback showing "Saving..." or "All changes saved".
    * **Session Safety**: Integrated with `UnsavedChangesContext` to prevent data loss.

### Component Architecture

#### Phase 2 Components ✅ IMPLEMENTED

* **`PatientMedicalRecordsSection`**: Displays list of medical records in Patient Detail Page.
  - Shows template name, creation date, last updated date
  - View button navigates to Medical Record Editor
  - Delete button with confirmation
  - Empty state with helpful messaging
  - Location: `frontend/src/components/patient/PatientMedicalRecordsSection.tsx`

* **`CreateMedicalRecordModal`**: Modal for creating new medical records.
  - Template selection interface
  - Shows active templates only
  - Displays field count for each template
  - Helpful message when no templates exist
  - Location: `frontend/src/components/patient/CreateMedicalRecordModal.tsx`

#### Phase 3 Components ✅ IMPLEMENTED

* **`MedicalRecordEditorPage`**: Main editor page for medical records.
  - Route: `/admin/clinic/patients/:patientId/medical-records/:recordId`
  - Displays record metadata (ID, creation time, last saved)
  - Contains structured header and workspace sections
  - Shows save status indicator
  - Location: `frontend/src/pages/MedicalRecordEditorPage.tsx`

* **`MedicalRecordHeader`**: Generic form renderer for structured header fields.
  - Renders all field types: text, textarea, number, date, select, checkbox, radio
  - React Hook Form integration for state management
  - Auto-save on blur and after 3 seconds of inactivity
  - Field validation with error messages
  - Displays units where applicable
  - Location: `frontend/src/components/medical-records/MedicalRecordHeader.tsx`

#### Phase 4 Components ✅ IMPLEMENTED

* **`ClinicalWorkspace`**: The drawing engine.
  * **`Toolbox`**: Pen, Highlighter, Eraser, Image Upload, Undo/Redo.
  * **`CanvasLayer`**: Custom HTML5 Canvas implementation for vector drawing.
  * **`MediaOverlay`**: Renders uploaded images and template background layers.

* **Implementation Details: The Canvas (Phase 4)** ✅:
  - Custom Canvas Wrapper using the HTML5 Canvas API.
  - **Responsive Width**: Canvas width adjusts dynamically to the container size, respecting the template's max width.
  - **Undo/Redo**: Full support for undoing and redoing drawing/media operations.
  - **Data Format**: Strict Pydantic schemas already defined.
  - **Autosave**: Debounced PATCH requests to the backend every 3 seconds if changes are detected.
  - **Image Caching**: Pre-loading images to prevent flickering during canvas re-renders.

***

## Critical Technical Implementation Notes

To ensure consistency with the established system architecture and data integrity:

1. **Service Layer Pattern** ✅: All business logic (DB queries, snapshotting, permission checks) resides in `MedicalRecordService`. API routers only handle request parsing, dependency injection, and response formatting.

2. **Snapshotting Logic** ✅: During the `POST /api/clinic/patients/{patient_id}/medical-records` call, the system performs a **deep copy** of:
   - Template's `header_fields` → Record's `header_structure`
   - Template's `workspace_config['base_layers']` → Record's `workspace_data['layers']`
   
   This ensures that even if a template is edited or deleted later, the historical record remains intact with its original structure and background diagrams.

3. **Strict Validation** ✅: All `JSONB` configurations are validated using strict Pydantic models at the API layer:
   - `WorkspaceData`: Top-level workspace structure with version, layers, canvas_height
   - `DrawingPath`: Validates drawing strokes (pen/eraser/highlighter) with color, width, points
   - `MediaLayer`: Validates image layers with position, size, rotation, origin
   - `ViewportState`: Validates zoom and scroll position
   
   These models prevent schema drift and corrupted data from entering the database.

4. **Role Permissions** ✅: 
   - Only **Admins** can manage Templates (create, update, delete)
   - Both **Admins and Practitioners** can create and manage individual Medical Records
   - Implemented via `require_admin` and `require_practitioner_or_admin` decorators

***

## Implementation Roadmap

### Phase 1: Foundation (Backend & Templates) ✅ COMPLETED

* \[x] Database migrations for `MedicalRecordTemplate` and `MedicalRecord`.
  - Migration: `05378856698e_add_medical_record_system_models.py`
  - Models: `MedicalRecordTemplate`, `MedicalRecord`, `MedicalRecordMedia`
* \[x] CRUD APIs for Template management in Clinic Settings.
  - Endpoint: `/api/clinic/medical-record-templates`
  - Service: `MedicalRecordTemplateService`
  - Strict Pydantic validation for `header_fields` and `workspace_config`
* \[x] Frontend: Template Builder UI in Settings.
  - Page: `SettingsMedicalRecordTemplatesPage.tsx`
  - React Query hooks: `useMedicalRecordTemplates`, `useMedicalRecordTemplateMutations`

### Phase 2: Record Management ✅ COMPLETED

* \[x] Backend: Record CRUD APIs.
  - Endpoints: `/api/clinic/patients/{patient_id}/medical-records`, `/api/clinic/medical-records/{id}`
  - Service: `MedicalRecordService`
  - **Template Snapshotting**: Both `header_fields` AND `base_layers` are copied into records
  - **Strict Validation**: Pydantic models for `WorkspaceData`, `DrawingPath`, `MediaLayer`
  - Integration tests: 11 tests covering CRUD, snapshotting, permissions, and cross-clinic isolation
* \[x] Frontend: "Medical Records" tab in Patient Detail Page.
  - Component: `PatientMedicalRecordsSection.tsx`
  - Displays chronological list with template name, creation/update dates
  - View button (placeholder for Phase 4 editor)
  - Delete functionality with confirmation
* \[x] Create Record modal (Template selection).
  - Component: `CreateMedicalRecordModal.tsx`
  - Template selection with field count display
  - React Query hooks: `useMedicalRecords` with proper cache invalidation

**Completed in Phase 4**:
- Clinical Workspace with canvas drawing tools (Pen, Highlighter, Eraser)
- Media upload endpoint (`POST /api/clinic/medical-records/{id}/media`) with S3 support
- Image injection and annotation features
- Undo/Redo and Template protection logic

### Phase 3: The Structured Header ✅ COMPLETED

* \[x] Generic form renderer for `header_fields` using `react-hook-form`.
  - Component: `MedicalRecordHeader.tsx`
  - Supports all field types: text, textarea, number, date, select, checkbox, radio
  - Field validation based on `required` flag
  - Displays field units (e.g., "°C", "mmHg") where applicable
  - Checkbox arrays properly handled (React Hook Form creates arrays automatically)
* \[x] Medical Record Editor page with routing.
  - Page: `MedicalRecordEditorPage.tsx`
  - Route: `/admin/clinic/patients/:patientId/medical-records/:recordId`
  - Integrated with Patient Detail page navigation
  - Initializes "Last Saved" indicator with `record.updated_at` on load
* \[x] Autosave functionality.
  - Debounced updates (3 seconds) to reduce API calls
  - Save on blur for immediate feedback
  - Uses `useUpdateMedicalRecord` mutation with proper cache invalidation
* \[x] Unsaved changes warning.
  - Integrated with `UnsavedChangesContext` to warn users before navigation
  - Tracks dirty state from React Hook Form
  - Clears warning after successful save
  - Cleans up on component unmount
* \[x] Backend tests for header value updates.
  - Test updating header_values independently of workspace_data
  - Test field type preservation (string, number, arrays)
  - Test checkbox array handling (multiple selections)
  - 14 total integration tests (11 from Phase 2 + 3 new)

**Technical Implementation**:
- Form state managed with React Hook Form
- Auto-save on blur and after 3 seconds of inactivity
- Proper error handling with modal alerts (consistent with existing patterns)
- All field types render correctly with appropriate input controls
- Dirty state properly tracked and communicated to parent component

### Phase 4: The Clinical Workspace (MVP Canvas) ✅ COMPLETED

* \[x] Implement Medical Record Editor page with routing.
* \[x] Implement `CanvasLayer` with pen, highlighter, and eraser tools.
* \[x] Support for Template Background Image (base_layers rendering).
* \[x] Image upload injection into the workspace.
* \[x] Vector data serialization to JSON.
* \[x] Autosave with 3s debouncing and sync status indicator.
* \[x] S3 integration with local fallback for media storage.
* \[x] Undo/Redo functionality for canvas operations.
* \[x] Template protection logic (preventing deletion of base layers).

**Technical Notes**:
- Use HTML5 Canvas API for drawing
- Hybrid storage utility (`file_storage.py`) supports S3 and local storage
- Debounced autosave (3s) to `PATCH /api/clinic/medical-records/{id}`
- Image caching to prevent canvas flickering during re-renders

### Phase 5: Polishing & Optimization (Partially Complete)

* \[x] Undo/Redo functionality for canvas operations.
* \[ ] Tablet optimization (Touch events, Apple Pencil support).
* \[ ] Pressure sensitivity for variable-width strokes.
* \[ ] UI/UX polish for medical record history list.
* \[ ] Export to PDF functionality.
* \[ ] Orphaned media cleanup job (S3 assets no longer referenced).

### Future Enhancements & Deferred Tasks

The following items were identified during development but deferred to ensure a stable MVP:

1.  **Tablet & Pencil Optimization**: While the canvas works on touch devices, specialized support for Apple Pencil (pressure, tilt) and palm rejection is deferred.
2.  **Advanced PDF Export**: Native PDF generation with proper branding and layout for clinical records.
3.  **Point Simplification**: Implementation of Ramer-Douglas-Peucker for optimizing very large drawing payloads.
4.  **Image Compression**: Client-side pre-compression of images before upload to S3.
5.  **Soft Deletion for Records**: Moving from hard deletion to `deleted_at` audit trails.
6.  **Workspace Version Migration**: Logic to upgrade `workspace_data` if the JSON schema changes in future versions.

- **Canvas Serialization**: For very long records, the vector JSON might grow large. We will implement **point-simplification algorithms** (e.g., Ramer-Douglas-Peucker) on the client side before saving.
- **Pressure Sensitivity**: To achieve a "Premium" feel, the drawing engine will capture and store pressure data from Apple Pencil/Tablets to allow for variable-width strokes.
- **Image Compression**: Use client-side compression (e.g., `browser-image-compression`) before uploading workspace media.
- **Orphaned Media**: (Future) Implement a background cleanup job to identify and remove S3 assets that are no longer referenced in any `MedicalRecord`.
