# PR Description: S3 Migration, Python 3.12 SDK Fixes, and Medical Record Stability

## Summary
This PR migrates the medical record image storage from the local filesystem to AWS S3, resolves critical compatibility issues with `aioboto3` on Python 3.12, and implements robust validation for heterogeneous workspace data using Pydantic Discriminated Unions. 

Crucially, this update also addresses production-grade performance and stability concerns: eliminating UI flickering during autosaves via ID-based image caching, ensuring data integrity during "Undo/Redo" operations, and guaranteeing "last-gasp" saves when users close their browser tabs.

## Key Changes

### 1. Performance & UI Stability
- **ID-Based Image Caching**: Refactored `ClinicalWorkspace.tsx` to use persistent `layer.id` as the cache key for images instead of ephemeral S3 presigned URLs. This prevents the UI from flickering every time the backend refreshes the S3 signatures during an autosave.
- **Canvas CORS**: Added `crossOrigin = "anonymous"` to image loading logic in `ClinicalWorkspace.tsx` to support cross-origin canvas operations with S3.

### 2. Backend: S3 Storage & Security
- **SDK Refactor**: Updated `save_s3_file` in `backend/src/utils/file_storage.py` to use `put_object` instead of `upload_fileobj`. This fixes a `TypeError` on Python 3.12 caused by `aioboto3` passing coroutines directly to `asyncio.wait`.
- **Presigned URLs**: Implemented `generate_presigned_url` to provide secure, temporary access to S3 objects.
- **Robust Key Extraction**: Added `_extract_s3_key` in `backend/src/api/clinic/medical_records.py` with support for `S3_CUSTOM_DOMAIN` and a domain whitelist (`S3_ALLOWED_DOMAINS`) to prevent unauthorized key extraction.
- **Upload Size Limits**: Enforced a 10MB limit (configurable via `MAX_UPLOAD_SIZE_MB`) in both frontend and backend.

### 3. Data Integrity & Resilience
- **Deferred Cleanup for Undo/Redo**: Audited `MedicalRecordService.update_record` to remove immediate physical file deletion for removed layers. Physical cleanup is now deferred until the entire record is deleted, ensuring that "Undo" followed by an autosave does not permanently break "Redo" functionality.
- **Beacon/Keepalive Saves**: Verified and optimized `apiService.updateMedicalRecord` to use the native `fetch` API with the `keepalive` flag for saves triggered by `onbeforeunload`. Added a 64KB size check to comply with browser limitations for background requests.
- **Optimistic Locking**: Enforced version-based concurrency control to prevent overwriting changes from other sessions.

### 4. Backend: Pydantic Validation
- **Discriminated Unions**: Implemented `Annotated` with `Field(discriminator='type')` for `WorkspaceData`. This allows the backend to correctly distinguish and validate `DrawingPath` vs `MediaLayer` objects within the same list.
- **Strict Typing**: Added type hints and `cast` operations to satisfy Pyright type checking.

### 5. Code Refinement & Maintenance
- **API Service Consolidation**: Moved image upload logic from `ClinicalWorkspace.tsx` to `apiService.uploadMedicalRecordMedia` to maintain architectural consistency and centralize header management.
- **Dead Code Removal**: Cleaned up a redundant cleanup loop in the `update_medical_record` endpoint, as file deletion is now correctly handled at the service layer during record deletion.
- **Documentation**: Added technical comments to the image pre-loading logic in the frontend to explain the exclusion of state from the dependency array (to prevent infinite loops).

### 6. Configuration & DevOps
- **Environment**: Updated `backend/env.example` with S3 and security configuration keys (`S3_ALLOWED_DOMAINS`, `MAX_UPLOAD_SIZE_MB`).
- **React Router v7 Migration**: Enabled all v7 `future` flags in `main.tsx`.

## Verification Results
- **End-to-End Test**: Verified Image Upload -> Save Workspace -> Reload Canvas -> Render correctly with S3 URLs without flickering.
- **Persistence Test**: Confirmed "last-gasp" saves work when closing the tab with unsaved changes (within 64KB limit).
- **Undo/Redo Test**: Verified that undoing an image upload followed by an autosave does not delete the physical file from S3.
- **API Consistency**: Verified that `apiService.uploadMedicalRecordMedia` correctly handles `multipart/form-data` and returns the expected media metadata.
- **Type Checking**: `Pyright` passes for all modified files.
- **Unit/Integration Tests**: `pytest` passes with 100% success rate on relevant modules.
