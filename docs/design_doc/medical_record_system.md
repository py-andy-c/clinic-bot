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

* **Snapshotting**: When a medical record is created, the system copies the template's `header_fields` structure into the record itself.
* **Integrity**: If a template is later edited or deleted by an admin, existing records remain unaffected and continue to display the fields and data they were created with.
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
  points: [number, number][]; // Array of [x, y] coordinates
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

#### Templates

* `GET /api/v1/clinics/{clinic_id}/medical-record-templates`: List templates.
* `POST /api/v1/clinics/{clinic_id}/medical-record-templates`: Create template.
* `PUT /api/v1/clinics/{clinic_id}/medical-record-templates/{id}`: Update template.

#### Records

* `GET /api/v1/patients/{patient_id}/medical-records`: List history for a patient.
* `POST /api/v1/patients/{patient_id}/medical-records`: Create new record from template.
* `GET /api/v1/medical-records/{id}`: Get full record details.
* `PATCH /api/v1/medical-records/{id}`: Update record (autosave).
* `POST /api/v1/medical-records/{id}/media`: Upload workspace image.

***

## Frontend Technical Design

### State Management Strategy

#### Server State (React Query)

* `useMedicalRecordTemplates()`: Fetch templates for a clinic.
* `usePatientMedicalRecords(patientId)`: Fetch history timeline.
* `useMedicalRecord(recordId)`: Fetch specific record data.

#### Client State (Zustand)

* `useWorkspaceStore`: Manages the active canvas state (tool selection, color, zoom, undo/redo stack).

### Component Architecture

#### `MedicalRecordEditor` (Container)

* **`RecordHeader`**: Renders the dynamic form based on `header_fields`.
* **`ClinicalWorkspace`**: The drawing engine.
  * **`Toolbox`**: Pen, Highlighter, Eraser, Image Upload, Undo/Redo.
  * **`CanvasLayer`**: The actual `<canvas>` or drawing surface.
  * **`MediaOverlay`**: Renders injected images as draggable/resizable elements (future) or static background layers (MVP).

### Implementation Details: The Canvas

For the MVP, we will use a **Custom Canvas Wrapper** using the HTML5 Canvas API to ensure maximum performance on tablets.

* **Data Format**: Store paths as an array of points: `[{ type: 'pen', color: '#000', width: 2, points: [[x,y], [x,y]...] }]`.
* **Autosave**: Debounced PATCH requests to the backend every 5 seconds if changes are detected.

***

## Implementation Roadmap

### Phase 1: Foundation (Backend & Templates)

* \[ ] Database migrations for `MedicalRecordTemplate` and `MedicalRecord`.
* \[ ] CRUD APIs for Template management in Clinic Settings.
* \[ ] Frontend: Template Builder UI in Settings.

### Phase 2: Record Management

* \[ ] Backend: Record CRUD APIs.
* \[ ] Frontend: "Medical Records" tab in Patient Detail Page.
* \[ ] Create Record modal (Template selection).

### Phase 3: The Structured Header

* \[ ] Generic form renderer for `header_fields` using `react-hook-form`.
* \[ ] Support for Text, Choice, and Date fields.

### Phase 4: The Clinical Workspace (MVP Canvas)

* \[ ] Implement `CanvasLayer` with pen, highlighter, and eraser tools.
* \[ ] Support for Template Background Image.
* \[ ] Image upload injection into the workspace.
* \[ ] Vector data serialization to JSON.

### Phase 5: Polishing & Optimization

* \[ ] Tablet optimization (Touch events, Apple Pencil support).
* \[ ] UI/UX polish for medical record history list.

***

## Performance Considerations

* **Image Compression**: Use client-side compression (e.g., `browser-image-compression`) before uploading workspace media.
