# PR Description: Fix Medical Record "Saving" Status and Autosave Loop

## Summary
This PR fixes a critical UI bug where the "Saving..." status indicator in the Clinical Workspace would persist indefinitely after an edit. It also resolves a subsequent infinite autosave loop and optimizes the save responsiveness by consolidating debouncing logic.

## Changes

### Backend
- **[medical_records.py](backend/src/api/clinic/medical_records.py)**: Added `version` field to `MedicalRecordListItemResponse` and `MedicalRecordResponse` Pydantic models. This allows the frontend to receive the latest record version after a successful save.

### Frontend
- **[MedicalRecordEditorPage.tsx](frontend/src/pages/MedicalRecordEditorPage.tsx)**:
    - Added explicit `refetch()` after a successful update mutation.
    - This ensures the parent page receives the new `version` from the server and passes it down to the `ClinicalWorkspace` component.
- **[ClinicalWorkspace.tsx](frontend/src/components/medical-records/ClinicalWorkspace.tsx)**:
    - **Loop Prevention**: Implemented `lastUpdateVersionRef` to track the local version of data that was last sent to the parent. The component now ignores server-side data syncs that don't represent new user actions, breaking the infinite autosave loop.
    - **Saving Status Fix**: The "Saving..." indicator now correctly clears when the component detects an increment in `initialVersion` from the parent, signaling that the server has acknowledged the change.
    - **Debounce Consolidation**: Removed the internal 1-second debounce for drawing actions. User changes now trigger the `onUpdate` callback immediately, relying on the parent's 3-second debounce (consistent with other form fields like text and textareas).
    - **State Synchronization**: Refined the `useEffect` for syncing server data to avoid overwriting local draft changes when a save is still in progress.

## Verification Results
- [x] "Saving..." status indicator correctly clears after a save completes.
- [x] Infinite autosave loop is resolved (server updates no longer trigger new client saves).
- [x] Redundant 1-second delay removed; canvas updates now follow the standard 3-second page-level debounce.
- [x] Concurrent edits/refetches correctly handle version increments.
