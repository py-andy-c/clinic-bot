# Medical Record System - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for adding a medical record system to the clinic management platform. The system enables clinics to create structured medical records for patients using customizable templates, with support for photo attachments.

**Key Goals**:

1. Allow clinic admins to create reusable medical record templates with common form elements
2. Allow clinic users to create medical records for patients, optionally linked to appointments
3. Support photo uploads both within medical records and as a standalone patient gallery
4. Good user experience across desktop, mobile, and tablet

**V0 Scope** (Simplest First):

This design focuses on the simplest possible implementation (V0). The following features are explicitly **NOT included in V0** and are deferred to future versions:

* ❌ Auto-save (local or server)
* ❌ Local draft backup / crash recovery
* ❌ Soft locks or editing indicators

**V0 Approach**: Manual save with **Optimistic Locking** (version check). Soft-delete for medical records to prevent data loss.

**Non-Goals** (for initial release):

* Medical-grade encryption/security (beyond standard HTTPS and auth)
* Offline editing capabilities
* Real-time concurrent editing (like Google Docs)
* HIPAA/GDPR compliance features (future enhancement)

***

## Core Principles & Business Philosophy

The design of the Medical Record System is guided by three high-level principles to ensure clinical safety, technical reliability, and operational simplicity:

### 1. Data Integrity & Historical Veracity

Medical records must represent a "truthful" snapshot of a patient's condition at a specific point in time.

* **Snapshotting**: We store a full copy of the template structure inside every medical record. If a clinic admin changes a template next month, this month's records remain perfectly readable and structurally unchanged.
* **Optimistic Locking**: We prevent "lost updates" by requiring a version check on every save. This ensures that no clinician accidentally overwrites someone else's critical observations.

### 2. Atomic Record Lifecycle (Tied Assets)

A medical record and its attached photos are treated as a single, indivisible clinical unit.

* **Stage & Commit**: Photos uploaded during a record session are "staged" (hidden) until the record is saved. This prevents the gallery from being cluttered with abandoned or partial uploads.
* **Unified Fate**: If a record moves to the Trash, its photos go with it. If a record is restored, its photos return. If a record is hard-deleted, its photos are purged. This ensures that the patient's "General Gallery" only contains intended, standalone clinical media.

### 3. Patient-Centric & Clinic-Isolated

The system is built to minimize the risk of data leakage or accidental mis-association.

* **Clinic Isolation**: All data (including the S3 storage bucket keys) is strictly partitioned by `clinic_id` using a content-hash deduplication strategy that never leaks hashes across clinic boundaries.
* **Unified Safety Net**: A 30-day "Trash" retention policy applies to all clinical data, providing a consistent safety net across all patient files while automating regulatory-compliant data purge via background jobs.

***

## Key Business Logic

### 1. Medical Record Templates

**Purpose**: Allow clinic admins to create reusable templates that define the structure of medical records.

**Template Elements** (supported field types):

* **Text**: Single-line text input
* **TextArea**: Multi-line text input
* **Number**: Numeric input
* **Date**: Date picker
* **Dropdown**: Single selection from predefined options
* **Radio**: Single selection from options (displayed as radio buttons)
* **Checkbox**: Multiple selection from options (displayed as checkboxes)

**Template Structure**:

* Each template has a name and optional description
* Templates contain ordered fields (elements)
* Each field has: label, type, required flag, options (for dropdown/radio/checkbox), and placeholder
* Templates are clinic-specific and can be soft-deleted

**Permissions**:

* **Create/Edit/Delete Templates**: Admin only
* **View Templates**: All clinic members

**Optimistic Locking**:

* Templates use a `version` column for optimistic locking to prevent concurrent edit conflicts.

**Template Field IDs**:

* Backend generates a logical UUIDv4 for each field upon template creation or update
* This ensures consistent addressing of fields in the JSON structure

**Rationale**: Templates provide consistency across medical records and reduce data entry time. Starting with common form elements covers most use cases without over-engineering.

### 2. Medical Records

**Purpose**: Allow clinic users to create medical records for patients using templates.

**Core Rules**:

* Each medical record belongs to exactly one patient
* Each medical record uses exactly one template (at creation time)
* Each medical record can optionally be linked to an appointment
* Template changes DO NOT affect existing records (record stores snapshot of template structure)
* Records store the template structure and values together for data integrity

**Appointment Linking**:

* When creating a record, user can optionally select an appointment for that patient
* All upcoming and past appointments are suggested for linking (allows preparation)
* One appointment can have multiple medical records (e.g., consultation + treatment)
* Records without appointments are allowed (for historical data entry, standalone notes)

**Permissions**:

* **Create Records**: All clinic members
* **Edit Records**: All clinic members
* **View Records**: All clinic members
* **Delete Records**: All clinic members
* **Restore/Hard-Delete Records**: All clinic members (V0 simplicity)

**Deletion & Retention (V0)**:

* **Soft Delete**: Records are excluded from default views but remain in the database.

* **Retention Policy**: Soft-deleted records are kept for **30 days**.

* **Auto-Cleanup**: A background job (daily) permanently deletes records older than 30 days.

* **Recovery**: Users can view "Recently Deleted" records for a patient and restore them.

* **Hard Delete**: Users can manually choose to "Delete Permanently" before the 30-day window expires. This action is irreversible. Associated photos are also permanently deleted (metadata removed, S3 file purged if no other active references exist).

**Permission Note**: All clinic members have permission to perform both soft and hard deletes in V0.

**Save Behavior (V0)**:

* Manual save only (user clicks "儲存" button)
* **Optimistic Locking**: Basic conflict detection on save (version check)
* **Navigation Guard**: Frontend warns user before leaving page with unsaved changes.
* No auto-save, no local draft backup.

**Rationale**: Linking to appointments provides context. Storing template snapshots ensures data integrity. **Optimistic locking** and **soft deletion** are implemented in V0 to prevent data loss and accidental overwrites in a multi-user environment.

### 3. Patient Photo Gallery

**Purpose**: Store and manage photos for patients, with optional association to medical records.

**Core Rules**:

* Photos not associated with any record appear in a general patient gallery view.
* **Tied Lifecycle (Stage & Commit)**:
  * **Staging**: Photos uploaded *within* a medical record context start as "hidden" (they do not appear in the general gallery).
  * **Committing**: When the medical record is saved, the associated photos are officially linked and made "active."
  * **Tied Deletion**: If a parent record is soft-deleted, its photos are also soft-deleted and hidden. They are only restored or permanently deleted **alongside** the record.
  * **Abandonment**: If a user uploads photos but fails to save the record, the photos stay "hidden/deleted" and are automatically purged by the 30-day background cleanup job.
* Each photo can have an optional description (text caption).
* Photos can be uploaded directly to gallery or within a medical record.
* **UX Note (Linking)**: When existing gallery photos are linked to a record, the UI shows a warning: *"此照片將與此病歷建立關聯，其生命週期將與此病歷同步 (照片將從公開收藏中隱藏)。"* (This photo will be linked to this record; its lifecycle will be synchronized).

**Photo Management**:

* **One-to-Many Model**: Each database photo record belongs to exactly one patient and optionally one medical record. If a photo needs to be referenced in multiple records, the user can upload it again; storage efficiency is maintainted via content-hash deduplication in S3.
* **Supported formats**: JPEG, PNG, HEIC (converted to JPEG primarily on client-side)
* **Client-side Processing (Required)**:
  * **Max User Selection**: 20MB (prevents errors on high-res originals)
  * **Target Dimensions**: Max 2048px on longest side
  * **Target Format/Quality**: JPEG at 0.8 (80%) quality
* **Server-side Limit**: 5MB hard limit for the final processed upload.
* **Thumbnails**: Generated automatically (300px width) for list views.
* **Original photos**: Preserved (post-compression) for full-resolution clinical viewing.

**Photo Deletion & Deduplication**:

* **Logic**: Photos associated with a record are managed as a single unit with that record.
* **Soft Delete**: When a record/photo is deleted, `is_deleted` is set to `true`.
* **Garbage Collection (S3)**: Physical deletion of S3 files is decoupled. A daily background job identifies files in S3 that have zero database records (active OR deleted) referencing their `content_hash`.
* **Safety Window**: Purging only occurs after a **31-day** grace period. This ensures that the physical file is never removed while a restorable DB record (active or in Trash) still references it.
* **Abandoned Uploads**: Photos uploaded but never "committed" (never linked to a saved record) stay in the `is_pending = true` state and are automatically removed by the 31-day cleanup job.

**Rationale**: While standalone clinical photos can exist, photos attached to a record form an inseparable part of that record's context. The "Stage & Commit" model ensures the gallery remains clean while guaranteeing that no clinical evidence is lost if a record is restored.

***

## Backend Technical Design

### API Endpoints

#### Template Management

##### `GET /clinic/medical-record-templates`

* **Description**: List all medical record templates for the clinic
* **Query Parameters**: `page`, `pageSize`, `include_deleted` (boolean, default false)
* **Response**: `{ data: { templates: MedicalRecordTemplate[], total: number } }`
* **Errors**: 500

##### `POST /clinic/medical-record-templates`

* **Description**: Create a new medical record template
* **Request Body**: `{ name: string, description?: string, fields: TemplateField[] }`
* **Response**: `{ data: MedicalRecordTemplate }`
* **Errors**: 400, 403, 500

##### `PUT /clinic/medical-record-templates/:id`

* **Description**: Update a medical record template
* **Request Body**: `{ name?: string, description?: string, fields?: TemplateField[], version: number }`
* **Response**: `{ data: MedicalRecordTemplate }`
* **Note**: Backend must preserve logical field `id`s for existing fields during update. The Frontend MUST return existing UUIDs for persistent fields to maintain data integrity for historical records.
* **Errors**: 400, 403, 404, 409 (version conflict), 500

##### `DELETE /clinic/medical-record-templates/:id`

* **Description**: Soft-delete a medical record template
* **Response**: `{ data: { success: true } }`
* **Errors**: 403, 404, 500

#### Medical Record Management

##### `GET /clinic/patients/:patientId/medical-records`

* **Description**: List all medical records for a patient
* **Query Parameters**: `page`, `pageSize`, `appointment_id` (filter by appointment)
* **Response**: `{ data: { records: MedicalRecord[], total: number } }`
* **Errors**: 404, 500

##### `POST /clinic/patients/:patientId/medical-records`

* **Description**: Create a new medical record for a patient.
* **Request Body**: `{ template_id: number, appointment_id?: number, values: Record<string, any>, photo_ids?: number[] }`
* **Lifecycle Note**: This action "commits" the photos in `photo_ids`, setting their `is_pending` flag to `false` and linking them to this record.
* **Response**: `{ data: MedicalRecord }`
* **Errors**: 400, 403, 404, 500

##### `GET /clinic/medical-records/:id`

* **Description**: Get a single medical record with full details
* **Response**: `{ data: MedicalRecord }`
* **Errors**: 404, 500

##### `PUT /clinic/medical-records/:id`

* **Description**: Update a medical record.
* **Request Body**: `{ values?: Record<string, any>, version: number, appointment_id?: number | null, photo_ids?: number[] }`
* **Lifecycle Note**: Updates the record and its photo associations. Any new photos in `photo_ids` are "committed" (`is_pending = false`).
* **Response**: `{ data: MedicalRecord }`
* **Errors**: 400, 403, 404, 409 (version conflict - returns `{ data: MedicalRecord }` with latest state for UI feedback), 500

##### `DELETE /clinic/medical-records/:id`

* **Description**: Soft-delete a medical record.
* **Response**: `{ data: { success: true, message: "Record and associated photos moved to trash" } }`
* **Note**: Associated photos are also marked `is_deleted = true`. They remain linked but are hidden from all gallery views.
* **Errors**: 403, 404, 500

##### `POST /clinic/medical-records/:id/restore`

* **Description**: Restore a soft-deleted medical record.
* **Note**: Restores the record and all its associated photos (`is_deleted = false`).
* **Response**: `{ data: MedicalRecord }`
* **Errors**: 403, 404, 500

##### `DELETE /clinic/medical-records/:id/hard`

* **Description**: Permanently delete a medical record and all attached photo records.
* **Response**: `{ data: { success: true, deleted_photo_count: number } }`
* **Note**: S3 files are purged by the GC job if no database records (active or deleted) reference the file hash, after the 31-day safety window.
* **Errors**: 403, 404, 500

#### Photo Management

##### `GET /clinic/patients/:patientId/photos`

* **Description**: List photos for a patient.
* **Query Parameters**: `page`, `pageSize`, `medical_record_id` (optional filter), `unlinked_only` (default excludes photos linked to any record, active or deleted)
* **Response**: `{ data: { photos: PatientPhoto[], total: number } }`
* **Note**: The backend must filter out photos associated with medical records where `is_deleted = true`.
* **Errors**: 404, 500

##### `POST /clinic/patients/:patientId/photos`

* **Description**: Upload a photo for a patient
* **Request Body**: `multipart/form-data` with `file`, `description?`, `medical_record_id?`
* **Lifecycle Note**:
  * If `medical_record_id` is provided: The photo is created with `is_pending = true` (Staged). It only becomes "Active" (`is_pending = false`) when the record is saved.
  * If `medical_record_id` is NOT provided: The photo is created with `is_pending = false` (Active immediately in Gallery).
* **Response**: `{ data: PatientPhoto }`
* **Errors**: 400 (invalid file), 403, 404, 413 (file too large), 500

##### `PUT /clinic/photos/:id`

* **Description**: Update photo metadata (description, medical record association)
* **Request Body**: `{ description?: string, medical_record_id?: number | null }`
* **Response**: `{ data: PatientPhoto }`
* **Errors**: 400, 403, 404, 500

##### `DELETE /clinic/photos/:id`

* **Description**: Soft-delete a photo for a patient
* **Response**: `{ data: { success: true } }`
* **Errors**: 403, 404, 500

##### `GET /clinic/photos/:id/file`

* **Description**: Get the actual photo file
* **Query Parameters**: `thumbnail` (boolean, default false)
* **Response**: Binary file data
* **Errors**: 404, 500

### Database Schema

#### Medical Record Templates Table

```sql
CREATE TABLE medical_record_templates (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    fields JSONB NOT NULL,  -- Array of TemplateField objects
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by_user_id INTEGER REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE,
    updated_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_medical_record_templates_clinic ON medical_record_templates(clinic_id);
CREATE INDEX idx_medical_record_templates_deleted ON medical_record_templates(clinic_id, is_deleted);
```

**TemplateField JSONB Structure**:

```json
{
  "id": "uuid",
  "label": "Field Label",
  "type": "text|textarea|number|date|dropdown|radio|checkbox",
  "required": false,
  "placeholder": "Optional placeholder",
  "options": ["Option 1", "Option 2"],  // for dropdown/radio/checkbox
  "order": 0
}
```

#### Medical Records Table

```sql
CREATE TABLE medical_records (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER REFERENCES clinics(id) NOT NULL,
    patient_id INTEGER REFERENCES patients(id) NOT NULL,
    template_id INTEGER REFERENCES medical_record_templates(id) NOT NULL, -- Lineage tracking
    template_name VARCHAR(255) NOT NULL, -- Denormalized for list views
    appointment_id INTEGER REFERENCES appointments(id),
    template_snapshot JSONB NOT NULL,  -- Snapshot for historical integrity
    values JSONB NOT NULL,             -- Field values keyed by field logical ID
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by_user_id INTEGER REFERENCES users(id),
    updated_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_medical_records_clinic ON medical_records(clinic_id);
CREATE INDEX idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX idx_medical_records_appointment ON medical_records(appointment_id);
CREATE INDEX idx_medical_records_created ON medical_records(created_at);
CREATE INDEX idx_medical_records_deleted ON medical_records(clinic_id, patient_id, is_deleted);
CREATE INDEX idx_medical_records_updated ON medical_records(clinic_id, updated_at);
```

#### Patient Photos Table

```sql
CREATE TABLE patient_photos (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id),
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    medical_record_id INTEGER REFERENCES medical_records(id) ON DELETE CASCADE, -- Tied lifecycle
    filename VARCHAR(255) NOT NULL,         -- Original filename
    storage_key VARCHAR(512) NOT NULL,      -- File storage path/key
    thumbnail_key VARCHAR(512),             -- Thumbnail storage path/key
    content_hash VARCHAR(64),               -- SHA-256 hash for deduplication
    content_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL,
    description TEXT,
    is_pending BOOLEAN DEFAULT TRUE,        -- TRUE while "Staged" (uploaded but record not saved)
    is_deleted BOOLEAN DEFAULT FALSE,       -- TRUE if moved to Trash
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    uploaded_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_patient_photos_clinic ON patient_photos(clinic_id);
CREATE INDEX idx_patient_photos_patient ON patient_photos(patient_id);
CREATE INDEX idx_patient_photos_patient_record ON patient_photos(patient_id, medical_record_id);
CREATE INDEX idx_patient_photos_medical_record ON patient_photos(medical_record_id);
CREATE INDEX idx_patient_photos_created ON patient_photos(created_at);
CREATE INDEX idx_patient_photos_deleted ON patient_photos(clinic_id, is_deleted);
CREATE INDEX idx_patient_photos_dedup ON patient_photos(clinic_id, content_hash);
```

### File Storage Strategy

**Storage Backend**: AWS S3 (already configured)

**S3 Bucket Structure**:

```
{bucket}/clinic_assets/{clinic_id}/{content_hash}.jpg
{bucket}/clinic_assets/{clinic_id}/{content_hash}_thumb.jpg
```

**Note**: Files are stored at the **Clinic Level**, not Patient Level. This enables correct deduplication (shared assets between patients) and avoids data integrity issues if a patient is deleted but their file is still used by another patient.

**Upload Flow**:

1. Client uploads file to backend API
2. Backend validates file type and size
3. Backend compresses/resizes image
4. Backend uploads to S3
5. Backend stores metadata in database
6. Returns photo URL to client

**Garbage Collection & Consistency**:

* **S3 Garbage Collector**: A daily job scans for `content_hash` entries in S3 that are no longer referenced by any active database records and purges them after a 24-hour margin.
* **Integrity Check**: Periodic job to identify DB records missing S3 files (failed uploads) to flag for user retry or cleanup.

**Deduplication**:

To save storage space when clinics upload the same image repeatedly (e.g., anatomy diagrams):

* On upload, compute SHA-256 hash of processed image content
* Check if file with same hash already exists for this clinic
* If exists: reuse existing S3 file, create new DB record pointing to same `storage_key`
* If not exists: upload new file to S3

**Upload Flow with Deduplication**:

```

1. Client uploads file
2. Backend processes image (compress, resize)
3. Compute SHA-256 hash of processed image
4. Query: SELECT storage\_key FROM patient\_photos
   WHERE clinic\_id = ? AND content\_hash = ? LIMIT 1
5. If found: reuse storage\_key (skip S3 upload)
6. If not found: upload to S3, use hash as filename
7. Create DB record with storage\_key and content\_hash

```

**Deletion with Deduplication & Cleanup**:

1. **Stage & Commit**:
   * Photos uploaded within a record are created as `is_pending = true`.
   * Saving the record flips them to `is_pending = false`.
2. **Soft Delete Record**: Folds record and linked photos into `is_deleted = true`.
3. **Restore Record**: Folds record and linked photos into `is_deleted = false`.
4. **Auto-Cleanup (30-day Retention)**: A background job permanently removes `medical_records` and `patient_photos` where `is_deleted = true` and `deleted_at < (NOW() - 30 days)`.
5. **S3 Garbage Collector (GC)**:
   * A daily job scans for `content_hash` entries in S3 that are no longer referenced by any database records (active OR deleted).
   * Purging only occurs after a 31-day safety margin.

**Image Processing & Transformation**:

* **Client-Side First**:
  * Conversion to JPEG + Resize (max 2048px long side).
  * Quality set to 0.8 to balance clinical detail and file size.
* **Backend Fallback**: Server provides fallback processing using `Pillow` and `libheif`.
* **Thumbnails**: Generate 300px width (aspect ratio preserved) for gallery performance.
* **Storage Safety**: Backend rejects any processed upload exceeding 5MB.

### Business Logic Implementation

**MedicalRecordTemplateService** (`backend/src/services/medical_record_template_service.py`):

* `create_template()`: Create template with field validation
* `update_template()`: Update template (existing records unaffected)
* `delete_template()`: Soft delete template
* `list_templates()`: List active templates for clinic
* `get_template()`: Get single template

**MedicalRecordService** (`backend/src/services/medical_record_service.py`):

* `create_record()`: Create record with template snapshot, validate values
* `update_record()`: Update record values
* `delete_record()`: Soft delete record (set `is_deleted = true`)
* `restore_record()`: Restore record (set `is_deleted = false`)
* `hard_delete_record()`: Permanently remove from database
* `cleanup_deleted_records()`: Background task to remove records deleted > 30 days ago
* `list_records_for_patient()`: List records for a patient (filtered by `is_deleted` status)
* `get_record()`: Get single record with full details

**PatientPhotoService** (`backend/src/services/patient_photo_service.py`):

* `upload_photo()`: Handle file upload, create thumbnail, store metadata
* `update_photo()`: Update description or medical record association
* `delete_photo()`: Soft-delete photo record. Trigger S3 cleanup only if no other active references exist for the hash.
* `list_photos_for_patient()`: List photos for a patient (with pagination)
* `get_photo_file()`: Return file stream for download/display

**Image Processing & Transformation**:

* Supported formats: JPEG, PNG, HEIC
* Client-side optimization (Recommended): Resize and convert HEIC to JPEG on the client before upload to save bandwidth.
* Backend fallback: Use `Pillow` and `libheif` for server-side processing.
* Thumbnails: Generate 300px width (aspect ratio preserved) for gallery performance.

***

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)

* **React Query Hooks**:
  * `useMedicalRecordTemplates()` - List templates
  * `useMedicalRecordTemplate(id)` - Single template
  * `usePatientMedicalRecords(patientId)` - Patient's records
  * `useMedicalRecord(id)` - Single record with full details
  * `usePatientPhotos(patientId)` - Patient's photos
* **Query Keys**:
  * `['medical-record-templates', clinicId]`
  * `['medical-record-template', clinicId, templateId]`
  * `['patient-medical-records', clinicId, patientId]`
  * `['medical-record', clinicId, recordId]`
  * `['patient-photos', clinicId, patientId]`
  * `['patient-photo', clinicId, photoId]`
* **Cache Strategy**:
  * `staleTime`: 5 minutes (templates rarely change)
  * `staleTime`: 1 minute (records/photos may change more frequently)
  * Invalidation triggers: CRUD operations

#### Client State (UI State)

* **Local Component State**:
  * Template editor: Form fields, field builder state
  * Record editor: Form values, validation state
  * Photo gallery: Selected photos, upload progress, lightbox state

#### Form State

* **React Hook Form**: For template builder and record editor
  * Dynamic form generation based on template fields
  * Field-level validation based on template rules

### Component Architecture

#### Component Hierarchy

```

PatientDetailPage (existing)
└── PatientMedicalRecordsSection (NEW)
├── MedicalRecordsList
│   └── MedicalRecordCard[] (summary view)
├── MedicalRecordModal (view/edit)
│   ├── MedicalRecordForm (dynamic form based on template)
│   └── PhotoAttachments
├── RecentlyDeletedRecordsModal (NEW)
│   └── DeletedRecordItem[] (with "Restore" and "Hard Delete" buttons)
└── CreateMedicalRecordModal
├── TemplateSelector
├── AppointmentSelector (optional)
└── MedicalRecordForm

PatientDetailPage (existing)
└── PatientPhotoGallerySection (NEW)
├── PhotoGrid
│   └── PhotoThumbnail\[]
├── PhotoUploader
├── PhotoLightbox
└── PhotoEditModal (description, record association)

SettingsPage (existing)
└── MedicalRecordTemplatesSection (NEW)
├── TemplatesList
│   └── TemplateCard\[]
├── TemplateEditorModal
│   ├── TemplateBasicInfo (name, description)
│   └── FieldBuilder
│       ├── FieldList (drag-reorder)
│       └── FieldEditor (type-specific options)
└── DeleteTemplateConfirmModal

AppointmentModal (existing, enhanced)
└── LinkedMedicalRecordsSection (NEW)
├── MedicalRecordCard\[] (linked records)
├── OpenRecordButton (view/edit in modal)
└── CreateRecordButton (create new linked to this appointment)

```

#### New Components

##### Settings Page Components

* **MedicalRecordTemplatesSection**: Container for template management
* **TemplatesList**: List of templates with create/edit/delete actions
* **TemplateEditorModal**: Full template editor with field builder
* **FieldBuilder**: Interactive field list with add/edit/reorder/delete

##### Patient Detail Page Components

* **PatientMedicalRecordsSection**: Container for patient's medical records
* **MedicalRecordsList**: Scrollable list of record cards
* **MedicalRecordModal**: View/edit a full medical record
* **MedicalRecordForm**: Dynamic form generated from template snapshot
* **CreateMedicalRecordModal**: Create new record with template selection
* **RecentlyDeletedRecordsModal**: Shows list of records deleted in the last 30 days, allowing restoration or permanent deletion.
* **DeletedRecordItem**: Item in the trash list showing record date, template name, and "Restore" / "Delete Permanently" actions.

##### Photo Gallery Components

* **PatientPhotoGallerySection**: Container for photo gallery
* **PhotoGrid**: Grid layout of photo thumbnails
* **PhotoThumbnail**: Single photo with hover actions
* **PhotoUploader**: Drag-drop or click to upload photos
* **PhotoLightbox**: Full-screen photo viewer with navigation
* **PhotoEditModal**: Edit photo description and record association

##### Appointment Modal Integration

* **LinkedMedicalRecordsSection**: Section in appointment modal showing linked records
* **MedicalRecordCard**: Compact card showing record summary (template name, date, preview of values)
* **OpenRecordButton**: Opens record in view/edit modal
* **CreateRecordButton**: Opens create record modal, pre-linked to this appointment

### User Interaction Flows

#### Flow 1: Create Medical Record Template (Admin)

1. Admin navigates to Settings → Medical Record Templates
2. Clicks "新增模板" (Add Template)
3. Template Editor modal opens
4. Enters template name and optional description
5. Clicks "新增欄位" (Add Field) to add fields
6. For each field:
   * Selects field type (text, dropdown, etc.)
   * Enters field label
   * Configures options (for dropdown/radio/checkbox)
   * Sets required flag
7. Reorders fields via drag-and-drop
8. Clicks "儲存" (Save)
9. Template created, appears in list

#### Flow 2: Create Medical Record (Practitioner)

1. Practitioner views patient detail page
2. Scrolls to Medical Records section
3. Clicks "新增病歷" (Add Record)
4. Create Record modal opens
5. Selects a template from dropdown
6. (Optional) Links to an appointment from dropdown
7. Fills in form fields based on template
8. (Optional) Selects existing photos from gallery or uploads new ones (linked atomically on save)
9. Clicks "儲存"
10. Record created, photo associations saved, appears in records list

#### Flow 3: Upload Photos

1. User views patient detail page
2. Scrolls to Photo Gallery section
3. Clicks "上傳照片" or drags files to upload area
4. Progress indicator shows upload status
5. After upload, photos appear in gallery
6. User clicks photo to view in lightbox
7. User can add description via edit modal
8. User can associate photo with medical record

#### Flow 4: View/Create Records from Appointment Modal

1. User clicks on an appointment (from calendar or patient page)
2. Appointment modal opens, showing appointment details
3. Scrolls down to "病歷記錄" (Medical Records) section
4. If records exist: sees list of linked record cards (template name, date, preview)
   * Clicks card to open record in view/edit modal
5. If no records: sees "尚無病歷記錄" (No records yet)
6. Clicks "新增病歷" to create new record pre-linked to this appointment
7. Template selector → fill form → save
8. New record appears in appointment's records list

#### Flow 5: Edit Medical Record with Conflict

1. User A and User B both open the same medical record for editing
2. User A clicks "儲存" → Success, version increments from 1 to 2
3. User B clicks "儲存" (still sending version 1)
4. Backend returns `409 Conflict`
5. Frontend shows conflict dialog: "此病歷已被 \[User A] 在 \[時間] 更新" (Backend returns the latest record in the 409 response, which includes the curator's name and `updated_at` timestamp).
6. User B chooses to:
   * **Reload**: Discards local changes and fetches latest data from server.
   * **Force Save**: Client fetches the latest version number from the server (while keeping User B's local form values) and re-submits. This effectively overwrites User A's changes.
   * **Design Decision**: After technical review, "Force Save" is retained for V0 to provide a pragmatic resolution path for clinicians when their local data is the intended source of truth.
   * *Note*: This ensures the user is aware of the conflict but provides a path to resolve it without re-typing if their changes are the source of truth.

#### Flow 6: Delete and Restore Medical Record

1. Practitioner clicks "Delete" on a Medical Record Card.
2. Confirmation dialog appears: "此病歷將移至回收桶，30天後自動刪除。確定刪除？"
3. User confirms; record disappears from the main list.
4. User realizes it was a mistake and clicks "查看最近刪除" (View recently deleted) at the bottom of the section.
5. Recently Deleted Records Modal opens.
6. User finds the record and clicks "還原" (Restore).
7. Record returns to the main Medical Records list.
8. (Optional) Alternatively, user clicks "永久刪除" in the modal to bypass the 30-day window. Confirmation: "此操作無法復原，確定永久刪除？"

### Edge Cases and Error Handling

#### Edge Cases

* **Template Deleted After Record Creation**: Record continues to function with snapshot
* **Large Photo Upload**: Client-side resize before upload (max 2048px dimension)
* **Concurrent Photo Uploads**: Queue uploads, show individual progress
* **Empty Medical Record**: Allow saving with no values (template may have all optional fields)
* **Photo Association Changed**: Update record's photo list automatically
* **Unsaved Changes (Navigation Guard)**: The frontend must warn the user before they navigate away or close the tab if there are unsaved changes (using `beforeunload` event and router guards).
* **HEIC Conversion**: Preferred on client-side for performance; server-side fallback provided.

#### Error Scenarios

* **File Too Large (413)**: Show error message with size limit
* **Invalid File Type (400)**: Show supported formats message
* **Permission Denied (403)**: Show appropriate message, hide action buttons for unauthorized users
* **Network Error**: Show retry option

### Responsive Design

**Desktop (>1024px)**:

* Side-by-side layout for record form and photos
* Template builder with full field options visible
* Photo gallery in grid (4-5 columns)

**Tablet (768px-1024px)**:

* Stacked layout for record form and photos
* Template builder with collapsible field options
* Photo gallery in grid (3 columns)

**Mobile (<768px)**:

* Full-width stacked layout
* Simplified template builder (fewer visible options)
* Photo gallery in grid (2 columns)
* Swipe navigation in lightbox

***

## Integration Points

### Backend Integration

* **Dependencies**: PatientService (validation), AppointmentService (linking), AuthService (permissions)
* **Database relationships**: FK to patients, appointments, users
* **File storage**: AWS S3

### Frontend Integration

* **PatientDetailPage**: Add MedicalRecordsSection and PhotoGallerySection
* **SettingsPage**: Add MedicalRecordTemplatesSection
* **Shared components**: BaseModal, LoadingSpinner, ErrorMessage, etc.
* **Shared hooks**: React Query hooks (useQuery, useMutation), useAuth, useModal

***

## Security Considerations

* **Authentication**: All endpoints require authenticated clinic user
* **Authorization**:
  * Template CRUD: Admin only for create/edit/delete
  * Record CRUD: All clinic members
  * Photo CRUD: All clinic members
* **Clinic isolation**: All queries filter by `clinic_id`
* **Input validation**:
  * File type validation (whitelist approach)
  * File size limits: 20MB for client selection, 5MB for server body (hard limit)
  * JSON structure validation for template fields and record values
* **XSS prevention**: React escapes content, sanitize HTML if needed

***

## Implementation Plan (V0)

### Phase 1: Core Infrastructure (Week 1-2)

* [x] Database migrations for all 3 tables
* [x] Backend models and basic CRUD services (Include `libheif-dev`, `libde265-dev` dependencies)
* [x] File upload/download endpoints
* [x] Basic API endpoints

### Phase 2: Template System (Week 2-3) ✅ **COMPLETE**

* [x] Template CRUD API endpoints
* [x] Template editor frontend (Settings page)
* [x] Field builder component
* [x] Template list and management
* [x] API response format (wrapped with total count)
* [x] Field ID preservation (hidden input for UUID stability)
* [x] Unsaved changes detection and confirmation
* [x] Options cleanup for non-select field types
* [x] Pagination support with accurate total count

### Phase 3: Medical Records (Week 3-4) ✅ **COMPLETE**

**Backend:**
* [x] Medical record CRUD API endpoints
* [x] Duplicate photo ID handling in create_record
* [x] API route structure: `/patients/{patient_id}/medical-records`
* [x] API response format: `{ records, total }` with pagination
* [x] Trash logic with `include_deleted` parameter
* [x] Template snapshot includes `{"name": ..., "fields": ...}`
* [x] Optimistic locking with enriched 409 conflict response

**Frontend:**
* [x] Medical record types and API methods
* [x] React Query hooks for medical records (useMedicalRecords)
* [x] Dynamic form generation from template (MedicalRecordDynamicForm)
* [x] Medical records section in PatientDetailPage (PatientMedicalRecordsSection)
* [x] Create/edit/view record modals (MedicalRecordModal)
* [x] Version conflict handling UI (409 conflict with reload option)
* [x] "Recently Deleted" (Trash) management UI with restore/hard-delete actions
* [x] Full CRUD operations with proper error handling
* [x] Unsaved changes detection and confirmation

**P2 Fixes (Data Integrity & UX):**
* [x] Checkbox implementation: Produces clean array format `["val1", "val2"]`
* [x] Required field validation: Dynamic Zod schema enforces required fields
* [x] Appointment linking UI: Dropdown selector for patient appointments
* [x] Validation error display: Shows field-level errors on submit

### Phase 4: Photo Gallery (Week 4-5) ✅ **COMPLETE**

* [x] Photo upload/download API endpoints (Backend already implemented)
* [x] Photo gallery section in PatientDetailPage (PatientPhotoGallery component)
* [x] Upload component with progress (Integrated in PatientPhotoGallery)
* [x] Drag-and-drop upload zone (Visual drop zone with hover states)
* [x] Parallel file uploads (Multiple files upload concurrently)
* [x] Upload error feedback (Shows which specific files failed)
* [x] Lightbox viewer (PhotoLightbox component with keyboard navigation)
* [x] Photo-to-record association (Backend logic implemented)
* [x] Photo edit modal (PhotoEditModal for description updates)
* [x] React Query hooks for photo management (usePatientPhotos)
* [x] Photo API integration (apiService methods)
* [x] **Photo integration in MedicalRecordModal** (MedicalRecordPhotoSelector component)
  - Select existing unlinked photos
  - Upload new photos (staged as `is_pending=true`)
  - Photos committed when record is saved
  - Supports both create and edit modes

**Integration Complete**: Users can now attach photos to medical records during creation/editing, implementing the "Atomic Record Lifecycle" principle.

### Phase 5: Polish & Testing (Week 5-6) ✅ **COMPLETE**

* [x] Responsive design refinements (Gallery uses responsive grid: 2/3/4 columns)
* [x] Performance optimization (S3 GC & List Enrichment)
* [x] Documentation (Design doc updated with all phases)
* [ ] E2E tests for key flows (Deferred - can be added incrementally)

**Testing Note**: E2E tests for medical records and photo gallery can be added incrementally as the feature is used in production. The backend has comprehensive integration tests covering all CRUD operations.

***

## Future Feature Roadmap

After V0 is complete, the following enhancements can be added incrementally based on user feedback:

### V1: Crash Recovery (Low Effort)

**Add:** Local draft auto-save to localStorage

* User edits → localStorage saves every 10 seconds
* If browser crashes, recover draft on next visit
* Prompt: "發現未儲存的草稿，是否恢復？"
* Still manual save to server, but provides safety for long notes

### V2: Conflict Prevention (Medium Effort)

**Add:** Soft lock with editing indicator

* Show "XXX 正在編輯此病歷" when someone has record open
* Lock with heartbeat, expires after 10 min inactivity
* Force acquire option for "forgotten tab" scenario

### V3: Server Auto-Save (Medium Effort)

**Add:** Automatic save to server every 30 seconds

* Requires V2 (soft lock) to prevent conflicts
* Status indicator: "儲存中..." → "已儲存 ✓"
* No manual save button needed

### Other Future Enhancements

* \[ ] Historical Template Versioning (Full Audit Trail)
* \[ ] Record history/audit log (who changed what, when)
* \[ ] S3 presigned URLs for direct client uploads
* \[ ] PDF export of medical records
* \[ ] Template import/export
* \[ ] Rate limiting for photo uploads
* \[ ] Search across medical records
* \[ ] AI-assisted data entry (e.g., OCR from photos)
* \[ ] Integration with external EMR systems
* \[ ] HIPAA/GDPR compliance features
* \[ ] "Draft" or "In-Progress" status for medical records
* \[ ] Standardized RFC 7807 error responses

***

## References

* [Patient Management Design Doc](./patient_management.md)
* [Appointments Design Doc](./appointments.md)
* [Settings Management Design Doc](./settings_management.md)
* \[EMR Form Builder Best Practices (Research)]\(https://314e.com - form design guidelines)
* \[Patient Photo Gallery UX (Research)]\(https://ahrq.gov - patient photos in EHR)

```
```
