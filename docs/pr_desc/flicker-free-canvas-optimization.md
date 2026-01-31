# PR Description: Flicker-Free Medical Record Canvas Optimization

## 📝 Overview
This PR addresses a critical visual flickering issue in the Medical Record Editor where the canvas content would disappear for 1-2 seconds during autosaving or canvas resizing. The solution involves a multi-layered optimization of the rendering pipeline and state synchronization.

## 🚀 The Issue
Users experienced three distinct types of flickering:
1. **Unmounting Flicker**: The editor page called `refetch()` after every save, causing the entire workspace to unmount/remount due to the React Query loading state.
2. **Resize Flicker**: HTML5 Canvas clears its buffer whenever its dimensions change. Frequent small height adjustments (every 10px) caused constant clearing and re-painting.
3. **Async Paint Flicker**: Using `useEffect` for drawing meant the browser could paint a "blank" frame between the DOM update and the canvas drawing.

## 🛠 The Fix

### 1. Optimistic UI Updates
Modified [useMedicalRecords.ts](file:///Users/andy/clinic-bot/frontend/src/hooks/queries/useMedicalRecords.ts) to use `queryClient.setQueryData` on success. This updates the local cache immediately with the server's response, removing the need for `refetch()` and preventing component unmounting.

### 2. Double Buffering & Chunked Resizing
In [ClinicalWorkspace.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx):
- **Double Buffering & Resource Recycling**: Added a `bufferCanvasRef` and `isBufferValidRef`. Before the canvas is resized, the current pixel data is copied to the buffer. The canvas element is now recycled across resizes rather than being recreated, improving performance on lower-end devices.
- **Synchronous Restoration**: After the resize, the pixels are restored from the buffer to the main canvas inside a `useLayoutEffect`.
- **Height Chunking**: Implemented `HEIGHT_CHUNK_SIZE` (500px). The canvas now only resizes in large increments, drastically reducing the number of destructive buffer-clearing events.
- **Responsive Debounce**: Reduced the height adjustment debounce from 500ms to 300ms to improve responsiveness while maintaining stability.

### 3. Synchronous Rendering Pipeline
Switched from `useEffect` to `useLayoutEffect` for all drawing functions (`renderBackground`, `renderDrawing`). This ensures the canvas is fully painted synchronously with the browser's layout phase, eliminating "white frames."

### 4. Efficient Data Synchronization & Race Condition Prevention
- **Handshake Synchronization**: Introduced `local_version` tracking across both frontend and backend. The frontend sends its local version, and the server acknowledges it in the response. The workspace only overwrites local state with server data if the server has acknowledged the latest local changes, preventing "older save overwriting newer drawing" race conditions.
- **Optimized Image Pre-loading**: Fixed a critical bug where image assets wouldn't refresh if a layer's URL changed but the total number of layers remained the same. Used a URL fingerprint for robust dependency tracking.
- **Redundancy Cleanup**: Removed redundant buffer-to-canvas draws in `useLayoutEffect` that were causing visual "ghosting" when state shifted during resizes.
- **Efficient Comparison**: Replaced expensive full-state `JSON.stringify` with a multi-stage layer comparison logic, significantly reducing CPU usage for complex records with many drawing points.
- **Buffer Lifecycle Management**: Added explicit buffer invalidation and cleanup during the render cycle to prevent stale data leaks.

## 🔍 Key Technical Decisions for Review
I would like the reviewer to specifically look at the following:
- **`useLayoutEffect` Usage**: We opted for `useLayoutEffect` to guarantee that drawing happens *before* the browser paints. This is essential for canvas stability but should be monitored for any performance impact on very slow devices.
- **`HEIGHT_CHUNK_SIZE` Strategy**: We chose 500px as a balance between reducing resize frequency and not over-allocating memory for the canvas. Does this feel like a reasonable default?
- **Optimistic Cache Sync**: We now handle the server-to-local synchronization using version comparison (`initialVersion > serverVersion`). This prevents the "infinite loop" of saves while ensuring data consistency without full page refreshes.

## ✅ Verification
- Ran `npx vitest` for [ClinicalWorkspace.test.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/__tests__/ClinicalWorkspace.test.tsx).
- Verified that all debug logs have been removed for production readiness.
- Manual testing confirms zero flicker during active drawing and background autosaves.
