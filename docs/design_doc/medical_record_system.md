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

#### Media Upload (Deferred to Phase 4)

* `POST /api/clinic/medical-records/{id}/media`: Upload workspace image.
  - Will handle S3 upload and return URL
  - Will create `MedicalRecordMedia` entry for tracking

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

#### Client State (Zustand) - Deferred to Phase 4

* **`WorkspaceStore`**: Will be managed via Zustand for canvas state.
  * **Sync Logic** (Phase 4):
    * Debounced PATCH requests (5s) for autosave using `useUpdateMedicalRecord`.
    * **Sync Status Indicator**: UI feedback showing "Saving..." or "All changes saved".
    * **Session Safety**: Implement `beforeunload` to prevent data loss if the user closes the tab during a sync.

### Component Architecture

#### Phase 2 Components ✅ IMPLEMENTED

* **`PatientMedicalRecordsSection`**: Displays list of medical records in Patient Detail Page.
  - Shows template name, creation date, last updated date
  - View button (placeholder for Phase 4)
  - Delete button with confirmation
  - Empty state with helpful messaging
  - Location: `frontend/src/components/patient/PatientMedicalRecordsSection.tsx`

* **`CreateMedicalRecordModal`**: Modal for creating new medical records.
  - Template selection interface
  - Shows active templates only
  - Displays field count for each template
  - Helpful message when no templates exist
  - Location: `frontend/src/components/patient/CreateMedicalRecordModal.tsx`

#### Phase 3 & 4 Components (To Be Implemented)

* **`MedicalRecordEditor`** (Container - Phase 4):
  - Route: `/admin/clinic/patients/:patientId/medical-records/:recordId`
  - Will contain both structured header and clinical workspace

* **`RecordHeader`** (Phase 3): Renders the dynamic form based on `header_fields`.
  - Uses React Hook Form for state management
  - Supports all field types: text, textarea, number, date, select, checkbox, radio
  - Field validation based on `required` flag
  - Displays units where applicable

* **`ClinicalWorkspace`** (Phase 4): The drawing engine.
  * **`Toolbox`**: Pen, Highlighter, Eraser, Image Upload, Undo/Redo.
  * **`CanvasLayer`**: The actual `<canvas>` or drawing surface.
  * **`MediaOverlay`**: Renders injected images as draggable/resizable elements (future) or static background layers (MVP).

### Implementation Details: The Canvas (Phase 4)

For the MVP, we will use a **Custom Canvas Wrapper** using the HTML5 Canvas API to ensure maximum performance on tablets.

* **Data Format** ✅: Strict Pydantic schemas already defined:
  - `DrawingPath`: `{ type: 'drawing', tool: 'pen'|'eraser'|'highlighter', color: string, width: number, points: [[x,y,pressure?]...] }`
  - `MediaLayer`: `{ type: 'media', id: string, origin: 'template'|'upload', url: string, x, y, width, height, rotation }`
  - `WorkspaceData`: `{ version: 1, layers: (DrawingPath|MediaLayer)[], canvas_height: number, viewport?: {...} }`

* **Autosave**: Debounced PATCH requests to the backend every 5 seconds if changes are detected.
  - Use `useUpdateMedicalRecord` mutation
  - Show sync status indicator ("Saving..." / "All changes saved")
  - Implement `beforeunload` handler to prevent data loss

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

**Deferred to Phase 4**:
- Medical Record Editor page (routing: `/admin/clinic/patients/:patientId/medical-records/:recordId`)
- Currently "View" button shows alert: "病歷編輯功能即將推出"

### Phase 3: The Structured Header

* \[ ] Generic form renderer for `header_fields` using `react-hook-form`.
* \[ ] Support for Text, Textarea, Number, Date, Select, Checkbox, and Radio fields.
* \[ ] Field validation based on `required` flag.
* \[ ] Display field units (e.g., "°C", "mmHg") where applicable.

**Technical Notes**:
- Form state should be managed with React Hook Form
- Autosave functionality using `useUpdateMedicalRecord` mutation
- Debounced updates (5 seconds) to reduce API calls

### Phase 4: The Clinical Workspace (MVP Canvas)

* \[ ] Implement Medical Record Editor page with routing.
* \[ ] Implement `CanvasLayer` with pen, highlighter, and eraser tools.
* \[ ] Support for Template Background Image (base_layers rendering).
* \[ ] Image upload injection into the workspace.
* \[ ] Vector data serialization to JSON (already validated by Pydantic schemas).
* \[ ] Autosave with debouncing and sync status indicator.
* \[ ] `beforeunload` handler to prevent data loss.

**Technical Notes**:
- Use HTML5 Canvas API for drawing
- Store paths as `DrawingPath` objects (already defined in API schemas)
- Media layers as `MediaLayer` objects (already defined in API schemas)
- Implement point simplification (Ramer-Douglas-Peucker) for large drawings
- Client-side image compression before upload

### Phase 5: Polishing & Optimization

* \[ ] Tablet optimization (Touch events, Apple Pencil support).
* \[ ] Pressure sensitivity for variable-width strokes.
* \[ ] UI/UX polish for medical record history list.
* \[ ] Undo/Redo functionality for canvas operations.
* \[ ] Export to PDF functionality.
* \[ ] Orphaned media cleanup job (S3 assets no longer referenced).

### Future Enhancements (Post-MVP)

* **Soft Deletion for Records**: Implement `deleted_at` timestamp for audit trails instead of hard deletion.
* **Workspace Version Migration**: Add logic to upgrade older workspace_data versions on-the-fly when schema changes.
* **Large Payload Optimization**: 
  - Monitor workspace_data JSONB size
  - Consider JSON compression for payloads exceeding several megabytes
  - Move binary data to S3/OSS if needed, storing only URLs in JSON
* **Audit Trails**: Track all changes to medical records for compliance.
* **Advanced Export**: Export records to PDF with proper formatting.

- **Canvas Serialization**: For very long records, the vector JSON might grow large. We will implement **point-simplification algorithms** (e.g., Ramer-Douglas-Peucker) on the client side before saving.
- **Pressure Sensitivity**: To achieve a "Premium" feel, the drawing engine will capture and store pressure data from Apple Pencil/Tablets to allow for variable-width strokes.
- **Image Compression**: Use client-side compression (e.g., `browser-image-compression`) before uploading workspace media.
- **Orphaned Media**: (Future) Implement a background cleanup job to identify and remove S3 assets that are no longer referenced in any `MedicalRecord`.
