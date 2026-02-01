# PR: Image Upload UX Improvements (Ghost Placeholder)

## Description
This PR addresses a critical UX gap where image uploads to the canvas lacked immediate visual feedback. Previously, users would experience a "freeze" or "no-action" state while an image was being compressed and uploaded. 

We have implemented a **Ghost Placeholder** (industry standard in Figma, Miro, and Canva) that appears immediately upon file selection, providing real-time status updates and progress tracking.

## Key Changes

### 1. Frontend Types & Models
- Added `LoadingLayer` to `WorkspaceData` union in [index.ts](file:///Users/andy/clinic-bot/frontend/src/types/index.ts).
- Defined properties for `LoadingLayer` including `status` (uploading) and `progress` (0-1).

### 2. ClinicalWorkspace Logic
- **Immediate Feedback**: Updated `handleImageUpload` to inject a `LoadingLayer` into the state immediately after file selection.
- **Viewport Centering**: Implemented robust centering logic using `getBoundingClientRect` to ensure the placeholder appears in the user's current viewport, even in nested scroll containers.
- **Progress Tracking**: Added real-time progress updates during the upload phase to give the user a sense of activity.
- **Atomic Replacement**: Once the upload is complete, the `LoadingLayer` is atomically replaced by the actual `MediaLayer`.
- **History Protection**: Modified `updateLayers` to filter out transient `LoadingLayer` objects from the undo/redo stack, preventing "stuck" loading states during undo operations.
- **Safety Filtering**: Updated `saveWorkspace` to filter out transient `LoadingLayer` objects, ensuring they are never persisted to the backend or displayed in PDFs.

### 3. Visual Feedback (Konva Components)
- Implemented `LoadingPlaceholder` component with:
    - **Dashed Border**: Indicates a transient/loading state.
    - **Status Text**: "上傳中..." (Uploading) for consistent feedback.
    - **Progress Bar**: A sleek blue bar that fills as the process completes.
    - **Background Shading**: Subtle gray fill to differentiate from finished images.

### 4. Technical Improvements & Bug Fixes
- **TypeScript Safety**: Resolved compilation errors related to iPad stylus detection (`touchType`) using safe type-casting.
- **State Integrity**: Ensured `loadingId` consistency throughout the upload lifecycle to prevent ghosting or orphaned UI elements.
- **Cleanup**: Removed unused variables and optimized rendering logic for the transient layers.

## Verification Steps
1. Open a medical record in the Clinical Workspace.
2. Click the Image upload button and select a large image file.
3. Observe the dashed "Ghost" placeholder appearing immediately in the center of your visible viewport.
4. Verify that the progress bar fills and the status text is visible.
5. **History Test**: While the image is uploading, try drawing a stroke or moving another object.
6. Hit "Undo" (Cmd+Z). Verify that your action is undone, but the loading placeholder remains (it shouldn't be "undone" into oblivion).
7. Confirm the placeholder is replaced by the actual image once the upload finishes.
8. Hit "Undo" again. Verify that the *entire* image upload is removed, and the canvas returns to its state before the upload started.
9. Refresh the page to ensure the loading placeholder was NOT saved to the database.
