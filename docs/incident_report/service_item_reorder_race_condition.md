# Incident Report: Service Item Reordering Not Preserved

**Date:** 2026-02-09
**Reporter:** Clinic user 羅士倫 (透視物理治療所 桃園青埔)
**Status:** Resolved
**Investigator:** Antigravity (AI Assistant)

## Summary

The user reported that service item reordering changes were sometimes not preserved after saving and reloading the page. Investigation revealed a race condition in the frontend drag-and-drop logic that caused the final state update to be missed by the save handler, resulting in the changes not being sent to the backend despite appearing correct in the UI before reload.

## Root Cause Analysis

1. **Frontend Race Condition:**
   * The `handleMoveServiceItem` function, responsible for updating the local state during drag operations, was defined as an `async` function.
   * It contained an `await queryClient.cancelQueries(...)` call.
   * When a drag operation finished, the `onDragEnd` handler (calling `handleSaveItemOrder`) fired immediately.
   * Due to the `await` in `handleMoveServiceItem`, the final state update (`queryClient.setQueryData`) was deferred to the event loop's microtask queue.
   * Determining the order of execution: `handleSaveItemOrder` (triggered by `dragEnd`) often executed *before* the suspended `handleMoveServiceItem` resumed and updated the cache.
   * Consequently, `handleSaveItemOrder` read the *previous* (stale) state from the cache, found no changes (`hasChanged = false`), and skipped sending the update payload to the backend.
   * The user saw the UI update (optimistic update applied late), believing it was saved, but the backend was never notified.

2. **Database State:**
   * Inspection of the production database showed duplicate `display_order` values (e.g., multiple items with `display_order: 0`), confirming that previous reordering attempts had failed to persist unique orders.

## Solution

* Refactored `handleMoveServiceItem` and `handleMoveGroup` in `frontend/src/pages/settings/SettingsServiceItemsPage.tsx` to be synchronous.
* Changed `queryClient.cancelQueries` to a fire-and-forget call (no `await`), ensuring it does not block the execution flow.
* This ensures that `queryClient.setQueryData` updates the cache synchronously during the drag event.
* When `onDragEnd` triggers `handleSaveItemOrder`, the cache is now guaranteed to hold the latest state, ensuring the correct reordered list is sent to the backend.

## verification

* The logic flaw (race condition) was identified in the code.
* The fix removes the source of the delay (`await`).
* Database inspection confirmed the symptoms (duplicate orders). The fix allows the next reorder action to properly update and persist unique `display_order` values.
