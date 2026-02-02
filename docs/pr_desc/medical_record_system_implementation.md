# PR: Medical Record System Implementation

## Overview
Complete implementation of the medical record system with customizable templates, photo management, and automated cleanup. This PR delivers a production-ready solution for clinics to manage patient medical records with flexible data collection and photo documentation.

## Changes

### Backend

#### Medical Record Templates API (`backend/src/api/clinic/medical_record_templates.py`)
- **New Endpoints**:
  - `GET /api/clinic/medical-record-templates` - List all templates for clinic
  - `POST /api/clinic/medical-record-templates` - Create new template
  - `GET /api/clinic/medical-record-templates/{id}` - Get template details
  - `PUT /api/clinic/medical-record-templates/{id}` - Update template
  - `DELETE /api/clinic/medical-record-templates/{id}` - Soft delete template
- **Features**:
  - Dynamic field definitions with validation rules
  - Display order management
  - Soft delete with 30-day retention
  - Clinic-scoped access control

#### Medical Records API (`backend/src/api/clinic/medical_records.py`)
- **New Endpoints**:
  - `GET /api/clinic/patients/{patient_id}/medical-records` - List patient records
  - `POST /api/clinic/patients/{patient_id}/medical-records` - Create record
  - `GET /api/clinic/medical-records/{id}` - Get record details
  - `PUT /api/clinic/medical-records/{id}` - Update record
  - `DELETE /api/clinic/medical-records/{id}` - Soft delete record
- **Features**:
  - Template-based record creation
  - Dynamic field data storage (JSONB)
  - Photo attachment support
  - Atomic record lifecycle (staged photos committed on save)

#### Patient Photos API (`backend/src/api/clinic/patient_photos.py`)
- **New Endpoints**:
  - `GET /api/clinic/patients/{patient_id}/photos` - List patient photos
  - `POST /api/clinic/patients/{patient_id}/photos` - Upload photo
  - `GET /api/clinic/patient-photos/{id}` - Get photo details
  - `PUT /api/clinic/patient-photos/{id}` - Update photo description
  - `DELETE /api/clinic/patient-photos/{id}` - Soft delete photo
- **Features**:
  - S3 upload with presigned URLs
  - Staged upload support (`is_pending` flag)
  - Photo-record linking
  - Soft delete with S3 cleanup

#### Services

**Medical Record Service** (`backend/src/services/medical_record_service.py`)
- Template CRUD operations with validation
- Record CRUD operations with dynamic field validation
- Photo linking and atomic commit logic
- Soft delete with cascade to photos

**Patient Photo Service** (`backend/src/services/patient_photo_service.py`)
- Photo upload with S3 integration
- Photo metadata management
- Staged upload workflow
- Soft delete with S3 cleanup

**Cleanup Service** (`backend/src/services/cleanup_service.py`)
- Hard delete soft-deleted records after 30 days
- Clean up abandoned staged photos (is_pending=true) after 30 days
- S3 garbage collection for unreferenced objects (31-day safety margin)
- Comprehensive logging and error handling

**Cleanup Scheduler** (`backend/src/services/cleanup_scheduler.py`)
- **NEW**: Automated daily cleanup at 3 AM Taiwan time
- Runs cleanup tasks using APScheduler
- Integrated into application startup/shutdown lifecycle
- Graceful error handling with fresh DB sessions per run
- **Thread pool execution**: Blocking operations run in separate thread to prevent freezing the FastAPI event loop

#### Database Models

**MedicalRecordTemplate** (`backend/src/models/medical_record_template.py`)
- Template metadata (name, description, display_order)
- Dynamic field definitions (JSONB)
- Soft delete support
- Clinic association

**MedicalRecord** (`backend/src/models/medical_record.py`)
- Record metadata (template_id, patient_id, created_by)
- Dynamic field data (JSONB)
- Photo associations (many-to-many)
- Soft delete support

**PatientPhoto** (`backend/src/models/patient_photo.py`)
- Photo metadata (s3_key, description, uploaded_by)
- Staged upload support (is_pending flag)
- Record associations (many-to-many)
- Soft delete support

#### Scripts

**Manual Cleanup Script** (`backend/scripts/run_cleanup.py`)
- Updated with documentation noting automatic scheduling
- Preserved for manual/emergency operations
- Useful for testing and one-time maintenance

### Frontend

#### Template Management

**Settings Page** (`frontend/src/pages/settings/SettingsMedicalRecordTemplatesPage.tsx`)
- List all templates with display order
- Create/edit/delete templates
- Drag-and-drop reordering
- Empty state with call-to-action

**Template Editor Modal** (`frontend/src/components/MedicalRecordTemplateEditorModal.tsx`)
- Dynamic field builder with 5 field types:
  - Text (single line)
  - Textarea (multi-line)
  - Number (with min/max validation)
  - Select (dropdown with options)
  - Checkbox (boolean)
- Field validation rules (required, min/max)
- Drag-and-drop field reordering
- Real-time preview

#### Record Management

**Medical Records Section** (`frontend/src/components/PatientMedicalRecordsSection.tsx`)
- List all records for patient
- Create new records from templates
- View/edit/delete records
- Integrated photo gallery
- Empty state with template selection

**Medical Record Modal** (`frontend/src/components/MedicalRecordModal.tsx`)
- Dynamic form rendering based on template
- Field validation with error messages
- Photo selector integration
- Three modes: create, edit, view
- Atomic save (commits staged photos)

**Photo Selector** (`frontend/src/components/MedicalRecordPhotoSelector.tsx`)
- Select existing unlinked photos
- Upload new photos with staging
- Visual grid with thumbnails and checkboxes
- Parallel uploads with progress tracking
- Detailed error feedback per file
- Drag-and-drop upload zone with hover states

#### Photo Gallery

**Patient Photo Gallery** (`frontend/src/components/PatientPhotoGallery.tsx`)
- Responsive grid layout (2/3/4 columns)
- Photo thumbnails with descriptions
- Edit/delete actions
- Drag-and-drop upload zone
- Empty state with upload prompt
- Lightbox integration

**Photo Lightbox** (`frontend/src/components/PhotoLightbox.tsx`)
- Full-screen photo viewing
- Keyboard navigation (arrow keys, escape)
- Photo metadata display
- Edit/delete actions
- Smooth transitions

**Photo Edit Modal** (`frontend/src/components/PhotoEditModal.tsx`)
- Update photo description
- Simple form with validation
- Optimistic updates

#### API Integration

**API Service** (`frontend/src/services/api.ts`)
- Medical record template endpoints
- Medical record endpoints
- Patient photo endpoints
- Type-safe request/response handling

**React Query Hooks** (`frontend/src/hooks/`)
- `useMedicalRecordTemplates.ts` - Template CRUD operations
- `useMedicalRecords.ts` - Record CRUD operations
- `usePatientPhotos.ts` - Photo CRUD operations
- Optimistic updates and cache invalidation
- Error handling and loading states

#### Type Definitions

**Medical Record Types** (`frontend/src/types/medicalRecord.ts`)
- Template field definitions
- Record data structures
- Photo metadata
- API request/response types

### Documentation

**Design Document** (`docs/design_doc/medical_record_system.md`)
- Complete system architecture
- Database schema design
- API specifications
- Frontend component hierarchy
- Implementation phases (all completed)
- Photo lifecycle management
- Cleanup strategy

## Key Features

### 1. Flexible Template System
- Clinics can create custom templates for different record types
- 5 field types with validation rules
- Drag-and-drop field ordering
- Reusable across multiple patients

### 2. Photo Management
- Upload photos to patient gallery
- Link photos to specific records
- Staged upload workflow (atomic commits)
- Drag-and-drop interface
- Lightbox viewing with keyboard navigation

### 3. Atomic Record Lifecycle
- Photos staged during record creation (`is_pending=true`)
- Photos committed when record is saved (`is_pending=false`)
- Abandoned staged photos cleaned up after 30 days
- Prevents orphaned photos in S3

### 4. Automated Cleanup
- **NEW**: Daily scheduler runs at 3 AM Taiwan time
- Hard deletes soft-deleted records after 30 days
- Cleans up abandoned staged photos after 30 days
- S3 garbage collection with 31-day safety margin
- Integrated into application lifecycle
- Manual script preserved for emergency operations
- **Performance optimized**: Blocking operations run in thread pool to prevent API freezing

### 5. Soft Delete with Retention
- All deletes are soft (30-day retention)
- Allows recovery of accidentally deleted data
- Automatic hard delete after retention period
- S3 cleanup coordinated with database cleanup

## Technical Highlights

### Backend
- JSONB for flexible field storage
- Presigned S3 URLs for secure uploads
- APScheduler for automated cleanup
- Thread pool execution for blocking operations (prevents event loop blocking)
- Comprehensive error handling
- Type-safe Pydantic models
- Clinic-scoped access control

### Frontend
- React Query for data management
- Optimistic updates for better UX
- Drag-and-drop with visual feedback
- Parallel file uploads with progress
- Responsive grid layouts
- Keyboard navigation support
- Type-safe TypeScript throughout

### Database
- Efficient JSONB indexing
- Many-to-many photo-record relationships
- Soft delete with retention tracking
- Foreign key constraints with cascade

## Testing

### Backend Tests
- Integration tests for all API endpoints
- Service layer unit tests
- Cleanup logic validation
- Photo lifecycle testing
- ✅ All tests passing

### Frontend Tests
- Component unit tests
- React Query hook tests
- Type checking with TypeScript
- ✅ All tests passing

## Migration Notes

### Critical Performance Fixes
**Issue**: Two schedulers had blocking synchronous calls (SQL queries and S3 network requests) in async functions running on the main event loop, which would freeze the entire FastAPI application during operations.

**Affected Schedulers**:
1. `CleanupScheduler` - S3 garbage collection and database cleanup operations
2. `LineMessageCleanupService` - Database DELETE operations

**Fix**: Refactored both to use `asyncio.to_thread()` to offload blocking operations to a thread pool, ensuring the API remains responsive during cleanup operations.

**Other Schedulers**: Reviewed all 10 schedulers in the system - the remaining 8 are properly implemented with either async operations or fast synchronous queries that don't block the event loop.

### Database Migrations
- New tables: `medical_record_templates`, `medical_records`, `patient_photos`
- Junction table: `medical_record_photos`
- All migrations tested and reversible

### Deployment Considerations
1. **S3 Bucket**: Ensure `clinic_assets/` prefix exists
2. **Scheduler**: Cleanup scheduler starts automatically with application
3. **Manual Cleanup**: Script available at `backend/scripts/run_cleanup.py` for emergency use
4. **Retention Period**: Default 30 days (configurable in cleanup service)
5. **Timezone**: Scheduler uses Taiwan timezone (UTC+8)

## Breaking Changes
None - this is a new feature with no impact on existing functionality.

## Future Enhancements
- [ ] Export records to PDF
- [ ] Record templates sharing between clinics
- [ ] Photo annotations and markup
- [ ] Bulk photo operations
- [ ] Record versioning and audit trail
- [ ] Advanced search and filtering

## Related Issues
Implements medical record system as specified in design document.

## Checklist
- [x] Backend API implementation
- [x] Frontend UI implementation
- [x] Database migrations
- [x] Photo upload and management
- [x] Template editor
- [x] Record CRUD operations
- [x] Soft delete with retention
- [x] Automated cleanup scheduler
- [x] Manual cleanup script
- [x] Integration tests
- [x] Type checking
- [x] Documentation
- [x] All tests passing
