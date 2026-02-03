# Design Document: Clinical Photos Management (Appendix & Gallery)

## 1. Goal

The primary objective is to professionalize medical documentation within the system by transforming how clinical photos are managed. This involves two major shifts:

1. **Medical Record Page**: Treat photos as a formal, indexed "Appendix" rather than a loose collection of attachments.
2. **Patient Detail Page**: Provide a centralized, high-performance "Gallery" for a patient's entire clinical history.

## 2. User Experience (UX)

### 2.1 Medical Record Editor & View

* **Formal Appendix Layout**: Photos associated with a medical record are displayed at the bottom in a structured grid (Appendix Section).
* **Automatic Description Suggestion**: During photo upload, the system counts existing photos linked to the record and suggests a description: **「附圖 X」**.
* **Proactive Annotation (Upload Flow)**:
  1. User clicks "Upload".
  2. User selects **one** file (Frontend will explicitly disable `multiple` selection to ensure robust indexing).
  3. A **Preview & Annotation Step** appears where the user can see the image and its suggested description.
  4. The user can accept the default (`附圖 X`) or edit it.
* **Staged Synchronization**: Photos uploaded to a medical record (both new and existing) are initially marked as `is_pending = true`. They are only fully committed/linked when the user clicks the main **"Save"** button for the medical record. This ensures the Appendix remains perfectly in sync with the record's text content.

### 2.2 Patient Detail Page (Overview)

* **Recent Media Ribbon**: A small section showing the **last 6 photos** (by upload time) for the patient.
* **Navigation**: A "View All" link in the section header leads to the Dedicated Gallery Page.

### 2.3 Dedicated Gallery Page (Full Clinical History)

* **Dedicated URL**: `/admin/clinic/patients/:id/gallery`.
* **Timeline View**: Photos are grouped by **Upload Date** (Descending) at the frontend level.
* **Performance**: Uses pagination parameters (`skip`, `limit`) and returns a `total_count` from the backend to support high-performance viewing.

## 3. Design Choices & Rationale

### 3.1 Stable Ordering Strategy

* **Primary Sort**: `created_at DESC` (Upload Time).
* **Secondary Sort**: `id DESC`.
* **Rationale**: Using a composite sort key ensures a stable and predictable UI order, especially when multiple photos are uploaded in rapid succession and might share identical timestamps.

### 3.2 Simplified Scope (No Batch Upload)

* **Decision**: Medical record context will support only **single-file uploads**.
* **Rationale**: This eliminates complexity in the "Auto-suggest" indexing logic and ensures that every clinical photo is intentionally reviewed and labeled by the practitioner during the annotation step.

### 3.3 Backend Metadata

* The `list_photos` API will be updated to return an object structure: `{ items: List[Photo], total: int }`. This is essential for the frontend to calculate pagination counts correctly.

## 4. Implementation Plan

### 4.1 Backend (Python/FastAPI)

* **Service (`patient_photo_service.py`)**:
  * Update `list_photos` to return a `(items, total_count)` tuple.
  * Implement stable `order_by(PatientPhoto.created_at.desc(), PatientPhoto.id.desc())`.
* **API (`patient_photos.py`)**:
  * Update response schema to `{ items: List[Photo], total: int }`.

### 4.2 Frontend (React/TypeScript)

* **Hooks**: Update `usePatientPhotos` to handle the new paginated object structure.
* **Components**:
  * `MedicalRecordAppendix`: Refactor `MedicalRecordPhotoSelector` to remove "Unlinked" collection logic and enforce single-file upload.
  * `PhotoUploadAnnotation`: Single-photo label confirmation modal.
  * `GalleryTimeline`: Implementation of date-grouping for the full history view.
* **Routing**: Register `/admin/clinic/patients/:id/gallery` in `App.tsx`.

## 5. Success Metrics

* **Clinical Accuracy**: Medical records follow a standard "Appendix" format.
* **Efficiency**: Indexing is handled automatically but remains customizable.
* **Performance**: The Patient Detail page load time is optimized via the `limit=6` ribbon and paginated full gallery.
