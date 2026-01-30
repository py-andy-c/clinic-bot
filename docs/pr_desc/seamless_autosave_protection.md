# PR Description: Seamless Autosave & Data Loss Prevention

## Overview
This PR implements a comprehensive, "silent" data protection layer for the Medical Record Editor. The goal is to ensure that practitioners never lose their work, even during abrupt page exits (tab close/refresh) or navigation within the app, while maintaining a seamless user experience without confusing "Unsaved changes" dialogs.

## Key Changes

### 1. Robust Background Saving (External Exits)
- **`keepalive` Support**: Modified [api.ts](file:///Users/andy/clinic-bot/frontend/src/services/api.ts) to support the browser's `keepalive` flag. This allows "last-gasp" requests to complete in the background even after the page is closed.
- **Tab Close Protection**: Added a `beforeunload` listener in [MedicalRecordEditorPage.tsx](file:///Users/andy/clinic-bot/frontend/src/pages/MedicalRecordEditorPage.tsx) that triggers a background save using the `keepalive` flag.

### 2. Seamless Internal Navigation (App Navigation)
- **Flush Mechanism**: Updated [UnsavedChangesContext.tsx](file:///Users/andy/clinic-bot/frontend/src/contexts/UnsavedChangesContext.tsx) to allow pages to register an `onSaveRef`.
- **Navigation Interception**: Modified [ClinicLayout.tsx](file:///Users/andy/clinic-bot/frontend/src/components/ClinicLayout.tsx) to intercept sidebar link clicks and logout actions. If unsaved changes exist in the editor, it now silently "flushes" (waits for save) before proceeding.
- **Back Button Logic**: Updated the "Back" button in [MedicalRecordEditorPage.tsx](file:///Users/andy/clinic-bot/frontend/src/pages/MedicalRecordEditorPage.tsx) to perform an immediate save before navigating.

### 3. UI/UX Polishing
- **Layout Stability**: Fixed a "jitter" issue in [SyncStatus.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/SyncStatus.tsx) by reserving fixed dimensions for the status indicator.
- **Redundant Save Prevention**: Added deep equality checks using `JSON.stringify` in [MedicalRecordEditorPage.tsx](file:///Users/andy/clinic-bot/frontend/src/pages/MedicalRecordEditorPage.tsx) to prevent unnecessary saves on focus/blur events.

### 4. Technical Reliability
- **State Management**: Used React `refs` in the editor to ensure background saves always access the most current data, avoiding closure-related stale state issues during unmounting.
- **Optimistic Locking**: Leveraged the `version` field in the backend schemas and frontend state to prevent race conditions and ensure data integrity during concurrent saves.

## Files Modified
- [api.ts](file:///Users/andy/clinic-bot/frontend/src/services/api.ts): Added `keepalive` support.
- [MedicalRecordEditorPage.tsx](file:///Users/andy/clinic-bot/frontend/src/pages/MedicalRecordEditorPage.tsx): Implemented flush logic, `beforeunload` listener, and UI polishing.
- [ClinicLayout.tsx](file:///Users/andy/clinic-bot/frontend/src/components/ClinicLayout.tsx): Integrated seamless navigation flushing.
- [UnsavedChangesContext.tsx](file:///Users/andy/clinic-bot/frontend/src/contexts/UnsavedChangesContext.tsx): Added `onSaveRef` for navigation blocking.
- [SyncStatus.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/SyncStatus.tsx): Fixed layout jitter.

## Verification
- Verified that closing the tab immediately after an edit still persists the changes in the database.
- Verified that clicking sidebar links waits for the "Saving..." indicator to complete before navigating.
- Verified that the UI no longer shifts when the save status changes.
- Verified that clicking the "Back" button saves immediately.