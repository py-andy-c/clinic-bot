# PR: Canvas Tablet & Mobile UX Improvements

## Context & Problem Statement

The previous drawing experience on tablet and mobile devices was degraded by the browser's default touch handling. When a user attempted to draw with a finger or an Apple Pencil, the browser often interpreted the movement as a page scroll or a "pull-to-refresh" gesture. This resulted in:

* Interrupted drawing strokes.
* Unintended page jumps or scrolling while trying to annotate.
* "Jittery" feedback where the canvas and the page compete for touch control.
* An "every other stroke" glitch where rapid drawing caused strokes to be skipped due to synthetic mouse event interference.

## Summary

This PR significantly improves the drawing and annotation experience for medical professionals using iPads and mobile devices. It implements a native-feeling "Pencil for drawing, Fingers for scrolling" model and neutralizes browser event interference for high-speed sketching.

## Changes

### 1. Unified Touch Handling & Event Neutralization

* Applied `touch-action: none` to the canvas container to prevent browser default gestures from interfering with drawing.
* Implemented `e.evt.preventDefault()` on all touch events. This stops the browser from generating synthetic mouse events, which was the root cause of the missing strokes during rapid drawing.

### 2. Industry Standard Navigation (Two-Finger Scroll)

* Implemented a manual navigation system that distinguishes between drawing and scrolling:
  * **Single-Pointer (1 Finger or Apple Pencil)**: Dedicated to drawing strokes.
  * **Multi-Pointer (2+ Fingers)**: Handled as a navigation gesture.
* **Smart Scroll Target**: The system automatically detects and scrolls the closest scrollable parent (looking for `.scroll-container` or overflow-auto containers) before falling back to the main window.

### 3. Robust Palm Rejection & Pencil Priority

* **Pencil Priority**: The system now prioritizes `pen` input. Even if a palm is touching the screen, the Apple Pencil maintains priority and drawing operation continues uninterrupted.
* **Pointer ID Filtering**: Implemented tracking of `activePointerId` to ensure `mousemove` events are only processed for the specific pointer that initiated the stroke. This prevents "line jumping" caused by overlapping palm touches.
* **Stroke Cancellation**: Multi-touch detection during *finger* drawing now immediately finalizes the stroke to prevent accidental "smudges" while attempting to scroll.

### 4. UI Polish for Tablets

* Disabled blue selection highlights on long-press (`user-select: none`).
* Disabled the iOS system context menu on the drawing area (`-webkit-touch-callout: none`).

## Design Constraints & Exclusions (Intentional)

### 1. Fixed Scaled Model (No Zooming)

* **Decision**: Pinch-to-zoom is explicitly disabled.
* **Rationale**: The clinical workspace is designed as a fixed 1:1 "paper" document. Maintaining a stable, unscaled view ensures that annotations accurately represent the medical record without coordinate drift or scaling artifacts during data entry.

### 2. Linear Manual Scrolling (No Momentum)

* **Decision**: Manual two-finger scrolling uses 1:1 linear movement without inertia/momentum polyfills.
* **Rationale**: To favor simplicity and maximum reliability. In clinical settings, precise control over document positioning is prioritized over "flick" physics which can be unpredictable.

## Verification Results

### Automated Tests

* Ran `frontend/run_frontend_tests.sh`.
* **Result**: 12/12 tests passed successfully.
* **TypeScript**: All type checks passed.

### Manual UX Checklist

* \[x] Single finger draws fluidly without triggering page scroll.
* \[x] Apple Pencil draws reliably even with palm resting on screen.
* \[x] Two fingers scroll the whole page smoothly.
* \[x] Rapid "flick" strokes are recorded without being skipped.
* \[x] Long-press does not trigger blue selection or system menus.
