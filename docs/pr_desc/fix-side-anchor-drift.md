# PR Description: Fix Transformer Side-Anchor Drift and Flaky Behavior

## Summary

Fixed a critical bug in the canvas transformation logic where dragging side handles (middle-right, middle-left, top-center, bottom-center) beyond canvas boundaries caused the opposite edge to drift. Also resolved an issue where scaling side handles caused "flaky" or oscillating behavior due to a feedback loop between Konva's internal scale calculations and our manual scale resets.

## The Bug

When a user dragged the right-mid handle of a shape beyond the right boundary of the canvas, the left edge of the shape would begin to move rightward. This was counter-intuitive and violated the core expectation that side-anchor resizing should keep the opposite edge anchored.

## Root Cause Analysis

1. **Position Drift**: Konva's `Transformer` internally modifies both the node's position ($x, y$) and scale simultaneously during a transform. Our clamping logic was reading the modified $x, y$ values *after* Konva had already shifted them, failing to preserve the absolute "fixed" edge.
2. **Flaky Oscillation**: My initial fix attempt used Konva's `scaleX/scaleY` values to calculate new dimensions from a start state. However, because we reset scale to $1$ every frame, Konva would recalculate a new scale relative to the *modified* width/height in the next frame. This created a divergent feedback loop, causing the shape to flicker or track incorrectly.

## The Solution: Pointer-Based Edge Calculation

Introduced a new robust handling mechanism for side anchors:

1. **New Helper: `handleSideAnchorTransform`**: This function bypasses Konva's internal scale values entirely.
2. **Pointer-to-Edge Mapping**: It reads the stage's relative pointer position and maps it directly to the dragged edge (e.g., Pointer $X \rightarrow$ Right Edge).
3. **Fixed Opposite Edge**: It uses a `_transformStartState` (captured at `onTransformStart`). Crucially, it now correctly handles center-origined shapes like **Ellipses** by calculating the absolute fixed edge coordinate at start, ensuring the opposite side remains strictly anchored.
4. **Boundary Clamping**: Clamping is applied to the pointer-derived coordinates before calculating the final width/height, ensuring smooth and predictable behavior at the canvas edges.
5. **Eager Scale Reset**: We standardized on an "eager" scale reset during the transform event, which eliminates redundant calculations in the transform end handler and prevents the Konva scale-calculation feedback loop.

## Changes

* **`handleSideAnchorTransform`**: Added as a shared utility for precise side-anchor manipulation.
* **`SelectableShape`**: Updated to use pointer-based logic for side handles while retaining scale-based clamping for corner handles (where both edges move).
* **`SelectableText`**: Updated to use pointer-based logic for its horizontal resizing handles (`middle-left`, `middle-right`).

## Verification Results

* \[x] Dragging `middle-right` handle to the right edge no longer moves the left edge.
* \[x] Moving mouse in all directions while handle is at the boundary no longer causes drift.
* \[x] Side handles track the mouse accurately without oscillation or lag.
* \[x] Ellipse (center-based) transforms correctly using the same pointer logic now that center-origin coordinates are handled.
* \[x] Code compiles and Typescript checks pass.
