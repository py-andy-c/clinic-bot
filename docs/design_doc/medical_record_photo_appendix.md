# Design Document: Clinical Photos Management (Appendix & Gallery)

**Status**: ✅ **IMPLEMENTED** (Phase 1: Medical Record Appendix)

**Implementation Date**: February 3, 2026

---

## 1. Goal

The primary objective is to professionalize medical documentation within the system by transforming how clinical photos are managed. This involves two major shifts:

1. **Medical Record Page**: Treat photos as a formal, indexed "Appendix" rather than a loose collection of attachments. ✅ **COMPLETED**
2. **Patient Detail Page**: Provide a centralized, high-performance "Gallery" for a patient's entire clinical history. ⏳ **FUTURE PHASE**

## 2. User Experience (UX)

### 2.1 Medical Record Editor & View ✅ **IMPLEMENTED**

* **Formal Appendix Layout**: Photos displayed in a vertical list format (two columns on desktop) with images maintaining original aspect ratio (max 300px width, 400px height). ✅
* **Progressive Loading**: Thumbnails load first for fast initial display, then full-resolution images load in background. ✅
* **Professional Document Style**: Clean layout with descriptions above images, no overlays, X button on top-right corner for removal. ✅
* **Full-Screen Image Viewer**: Clicking on any photo opens a full-screen lightbox viewer with keyboard navigation (arrow keys to navigate, Escape to close). ✅
* **Automatic Description Suggestion**: During photo upload, the system counts existing photos and suggests a description: **「附圖 X」**. ✅
* **Proactive Annotation (Upload Flow)**: ✅
  1. User clicks "附錄" (Appendix) upload button. ✅
  2. User selects **one** file (Frontend explicitly disables `multiple` selection to ensure robust indexing). ✅
  3. A **Preview & Annotation Modal** appears where the user can see the image and its suggested description. ✅
  4. The user can accept the default (`附圖 X`) or edit it before confirming upload. ✅
  5. Pressing Enter in the input field confirms the upload (intuitive UX). ✅
* **Description Editing**: ✅
  1. Pencil icon appears next to each photo description (always visible, gray by default, blue on hover). ✅
  2. Clicking pencil icon enables inline editing of the description. ✅
  3. Pressing Enter or clicking outside saves the edit (triggers unsaved changes detection). ✅
  4. Pressing Escape cancels the edit. ✅
  5. Description changes are tracked and saved to backend when user clicks main "儲存變更" button. ✅
* **Removal Confirmation**: Clicking the X button shows a custom modal confirmation before removing the photo. ✅
* **Staged Synchronization**: Photos uploaded to a medical record are initially marked as `is_pending = true`. They are only fully committed/linked when the user clicks the main **"Save"** button for the medical record. This ensures the Appendix remains perfectly in sync with the record's text content. ✅
* **Unsaved Changes Detection**: Photo selection changes AND description edits trigger the unsaved changes warning system, preventing accidental data loss. ✅

### 2.2 Patient Detail Page (Overview) ⏳ **FUTURE PHASE**

* **Recent Media Ribbon**: A small section showing the **last 6 photos** (by upload time) for the patient.
* **Navigation**: A "View All" link in the section header leads to the Dedicated Gallery Page.

### 2.3 Dedicated Gallery Page (Full Clinical History) ⏳ **FUTURE PHASE**

* **Dedicated URL**: `/admin/clinic/patients/:id/gallery`.
* **Timeline View**: Photos are grouped by **Upload Date** (Descending) at the frontend level.
* **Performance**: Uses pagination parameters (`skip`, `limit`) and returns a `total_count` from the backend to support high-performance viewing.

## 3. Design Choices & Rationale

### 3.1 Stable Ordering Strategy ✅ **IMPLEMENTED**

* **Primary Sort**: `created_at DESC` (Upload Time).
* **Secondary Sort**: `id DESC`.
* **Rationale**: Using a composite sort key ensures a stable and predictable UI order, especially when multiple photos are uploaded in rapid succession and might share identical timestamps.
* **Implementation**: `order_by(PatientPhoto.created_at.desc(), PatientPhoto.id.desc())` in `patient_photo_service.py`

### 3.2 Simplified Scope (No Batch Upload) ✅ **IMPLEMENTED**

* **Decision**: Medical record context supports only **single-file uploads**.
* **Rationale**: This eliminates complexity in the "Auto-suggest" indexing logic and ensures that every clinical photo is intentionally reviewed and labeled by the practitioner during the annotation step.
* **Implementation**: Removed `multiple` attribute from file input in `MedicalRecordPhotoSelector.tsx`

### 3.3 Backend Metadata ✅ **IMPLEMENTED**

* The `list_photos` API returns an object structure: `{ items: List[Photo], total: int }`.
* **Implementation**: 
  - Service layer returns `Tuple[List[PatientPhoto], int]`
  - API layer returns `PatientPhotosListResponse` model with `items` and `total` fields
  - Frontend hooks handle paginated response structure

## 4. Implementation Plan

### 4.1 Backend (Python/FastAPI) ✅ **COMPLETED**

* **Service (`patient_photo_service.py`)**: ✅
  * Updated `list_photos` to return a `(items, total_count)` tuple
  * Implemented stable `order_by(PatientPhoto.created_at.desc(), PatientPhoto.id.desc())`
  * Added `count_record_photos()` method for auto-suggestion of photo descriptions
* **API (`patient_photos.py`)**: ✅
  * Updated response schema to `PatientPhotosListResponse` with `items` and `total` fields
  * Added GET `/count` endpoint for counting photos linked to a medical record
* **Tests**: ✅
  * Created `backend/tests/unit/test_patient_photo_service.py` - comprehensive unit tests
  * Created `backend/tests/integration/test_patient_photos_api.py` - comprehensive API tests
  * Updated existing tests in `test_medical_record_features.py` and `test_medical_records_security.py`
  * All tests passing ✅

### 4.2 Frontend (React/TypeScript) ✅ **COMPLETED**

* **Types (`types/medicalRecord.ts`)**: ✅
  * Added `PatientPhotosListResponse` interface
* **API Service (`services/api.ts`)**: ✅
  * Updated `listPatientPhotos()` to return paginated response
  * Added `countRecordPhotos()` method
* **Hooks (`hooks/usePatientPhotos.ts`)**: ✅
  * Updated `usePatientPhotos` to handle new paginated response structure
  * Added `useCountRecordPhotos` hook for auto-suggestion
* **Components**: ✅
  * **`MedicalRecordPhotoSelector.tsx`**: Complete refactor
    - Removed "unlinked photos" collection logic
    - Enforced single-file upload (removed `multiple` attribute)
    - Added photo annotation modal with preview
    - Auto-suggests description as "附圖 X" using `visiblePhotos.length`
    - Changed label from "附加照片" to "附錄"
    - Simplified state management (single file instead of batch)
    - **Vertical list layout** with full-width images
    - **Progressive loading**: Thumbnails first, then full images
    - **Professional document style**: Descriptions above, buttons below, no overlays
    - **Original aspect ratio**: Images maintain natural proportions (max-width: 800px)
    - Enter key handling for quick upload confirmation
  * **`PatientPhotoGallery.tsx`**: Updated to handle paginated response
* **Routing**: ⏳ Gallery page routing deferred to future phase
* **Tests**: ✅ All frontend tests passing

### 4.3 Future Phases ⏳

* **Patient Detail Page - Recent Media Ribbon**: Not yet implemented
* **Dedicated Gallery Page**: Not yet implemented
  - URL: `/admin/clinic/patients/:id/gallery`
  - Timeline view with date grouping
  - Full pagination support

## 5. Success Metrics

* **Clinical Accuracy**: Medical records follow a standard "Appendix" format. ✅ **ACHIEVED**
* **Efficiency**: Indexing is handled automatically but remains customizable. ✅ **ACHIEVED**
* **Performance**: The Patient Detail page load time is optimized via the `limit=6` ribbon and paginated full gallery. ⏳ **PENDING** (Gallery page not yet implemented)

---

## 6. Implementation Summary

### Files Modified (11)
1. `backend/src/services/patient_photo_service.py` - Pagination and counting logic
2. `backend/src/api/clinic/patient_photos.py` - API response structure and count endpoint
3. `backend/tests/integration/test_medical_record_features.py` - Updated for paginated response
4. `backend/tests/integration/test_medical_records_security.py` - Updated for paginated response
5. `frontend/src/types/medicalRecord.ts` - Added paginated response type
6. `frontend/src/services/api.ts` - Updated API methods, added updatePatientPhoto
7. `frontend/src/hooks/usePatientPhotos.ts` - Added count hook and update mutation
8. `frontend/src/components/MedicalRecordPhotoSelector.tsx` - Complete refactor to appendix pattern with editing
9. `frontend/src/components/PatientPhotoGallery.tsx` - Updated for paginated response
10. `frontend/src/pages/MedicalRecordPage.tsx` - Added photo update tracking and save integration
11. `docs/design_doc/medical_record_photo_appendix.md` - Updated documentation

### Files Created (2)
1. `backend/tests/unit/test_patient_photo_service.py` - Comprehensive unit tests
2. `backend/tests/integration/test_patient_photos_api.py` - Comprehensive API integration tests

### Test Coverage
- ✅ All backend tests passing (unit + integration)
- ✅ All frontend tests passing
- ✅ Comprehensive test coverage for new functionality:
  - Pagination logic
  - Stable ordering
  - Photo counting
  - API endpoints
  - Filtering behavior

### Key Changes
1. **Backend**: Changed from `List[PatientPhoto]` to `Tuple[List[PatientPhoto], int]` for pagination support
2. **Frontend**: Transformed from grid layout with overlays to vertical list with professional document styling
3. **UX**: Changed from "附加照片" (attached photos) to "附錄" (appendix) terminology
4. **Layout**: Two-column vertical list on desktop (single column on mobile) with images maintaining original aspect ratio (max 300px width, 400px height)
5. **Progressive Loading**: Thumbnails load first for fast display, then full images load in background
6. **Professional Style**: Descriptions above images, X button on top-right corner, no overlays
7. **Auto-suggestion**: Implemented "附圖 X" description based on existing photo count
8. **Enter Key**: Pressing Enter in annotation modal confirms upload
9. **Description Editing**: Inline editing with pencil icon, integrated with unsaved changes detection
10. **Removal Confirmation**: Custom modal confirmation before removing photos
11. **Save Integration**: Photo description edits are tracked and saved to backend when user clicks "儲存變更"
12. **Full-Screen Viewer**: Clicking images opens PhotoLightbox component with keyboard navigation (reused from patient gallery)

### Next Steps (Future Phases)
1. Implement Patient Detail Page "Recent Media Ribbon" (last 6 photos)
2. Implement Dedicated Gallery Page at `/admin/clinic/patients/:id/gallery`
3. Add timeline view with date grouping for full clinical history
