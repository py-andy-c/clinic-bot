# PR Description: Canvas Stability and Text Editing Fixes

## Summary

This Pull Request addresses a series of stability issues discovered in the `ClinicalWorkspace` component, specifically focusing on the text editing workflow and coordinate mapping logic. These fixes ensure a smoother user experience when creating and editing text layers on the medical record canvas.

## Issues & Problems

### 1. DOM Race Condition (`NotFoundError`)

**Problem:** A `NotFoundError` was triggered when closing the text editor. This occurred because both the `blur` event handler and the React `useEffect` cleanup were attempting to remove the dynamic `<textarea>` from the DOM simultaneously. If one finished before the other, the second call failed, causing an application crash.

### 2. Text Insertion Failure

**Problem:** Users were unable to insert new text boxes. This was caused by two technical regressions:

* **Missing Coordinate Helper:** The `getRelativePointerPosition` utility, which maps screen clicks to the logical 1000-unit canvas coordinates (accounting for scaling and gutter offsets), was accidentally removed during a previous cleanup.
* **Component Lifecycle Reset:** The rendering logic was using a component-inside-a-component pattern (`RenderLayer` defined inside `ClinicalWorkspace`), which caused all layers to unmount and remount on every state change, effectively killing the text editing state immediately upon creation.

## Changes

### Robust DOM Management

* Replaced `document.body.removeChild()` with the more modern and robust `element.remove()`.
* Added `try-catch` blocks around DOM removal logic to gracefully handle edge cases where an element may have already been removed by a concurrent process.
* Ensured careful cleanup of `textareaRef.current` to prevent stale memory references.

### Coordinate Logic Restoration

* Restored the `getRelativePointerPosition` polyfill for the Konva Stage. This ensures that clicks are correctly translated into the canvas's logical coordinate system regardless of viewport scaling or the 40px "gutter" buffer.

### Rendering Architecture Optimization

* Refactored the `RenderLayer` component into a standard helper function (`renderLayer`). This prevents React from treating it as a new component type on every render, thus maintaining component state and avoiding unnecessary unmounting/remounting of canvas elements.

## Testing Performed

* **Unit Tests:** Successfully ran the complete frontend test suite (`./run_frontend_tests.sh`). All 12 tests, including those specifically for `ClinicalWorkspace` and text editing, passed.
* **TypeScript Verification:** Confirmed zero type errors using `npx tsc --noEmit`.
* **Manual Verification:** Verified that text boxes can be created at the exact click position and that editing/saving works without triggering console errors.
