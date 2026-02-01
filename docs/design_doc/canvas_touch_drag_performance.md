# Design Document: Canvas Touch Drag Performance Optimization (Revised)

**Author**: AI Assistant\
**Date**: 2026-02-01\
**Status**: Completed\
**Related PR**: TBD

***

## 1. Problem Statement

### Observed Behavior

When dragging objects on the canvas (shapes, images, text, drawings), users experience noticeable lag on touch devices. The dragged object visibly trails behind the finger movement.

### Affected Platforms

* **iPhone** (Safari, Chrome) ❌ Lag observed
* **iPad** (Safari, Chrome) ❌ Lag observed
* **Desktop Mac** (M1, Retina + 4K monitors) ✓ Smooth

### Impact

The lag degrades the user experience for medical professionals annotating records on tablets—a primary use case for the clinical workspace.

***

## 2. Technical Analysis

### Current Architecture

The `ClinicalWorkspace.tsx` component uses [Konva](https://konvajs.org/) (via `react-konva`) with the following layer structure:

```
Stage
├── Layer (name="background", listening=false)  ← Static background
└── Layer (name="content")                      ← ALL interactive objects
    ├── Images, Shapes, Text, Drawings
    ├── Transformers
    └── Active drawing overlays
```

### Root Causes Identified

#### 1. High Pixel Ratio on Retina Displays (Primary)

iOS devices have pixel ratios of 2x–3x. Konva automatically scales the internal canvas to match.

* A 900×1100 logical canvas becomes **2700×3300 pixels** on a 3x device.
* Every drag movement triggers a redraw of this massive canvas.
* **Solution**: Cap `pixelRatio` to 2.0 for touch devices.

#### 2. Redraw Complexity (Primary)

Every time an object moves, Konva clears the *entire* layer and redraws *every* object on it.
* If there are 50 drawings and 1 large image, dragging a small text box forces the heavy image and all drawings to redraw 60 times per second.
* **Solution**: Move the "active" object to a dedicated `dragLayer` during the drag operation.

***

## 3. Proposed Solutions (As Built)

### Solution A: Pixel Ratio Capping

**Effort**: Low | **Impact**: High

```tsx
// At the top of ClinicalWorkspace.tsx
if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
  Konva.pixelRatio = Math.min(window.devicePixelRatio, 2.0);
}
```

### Solution B: Drag Layer Isolation (Imperative Lifecycle)

**Effort**: Medium | **Impact**: Extreme

1.  **Add a `dragLayer`**: A dedicated layer sitting above the `contentLayer`.
2.  **Imperative Transition**:
    *   **On Drag Start**: Move the node from `contentLayer` to `dragLayer`.
    *   **On Drag End**: Move the node back to `contentLayer`.
3.  **Performance Benefit**: During drag, only the single moving object is redrawn. The hundreds of background objects remain static on the `contentLayer`.

#### Refinement 1: Z-Index Preservation

When moving a node back to the `contentLayer`, its original Z-index must be restored, otherwise it will jump to the top.

```tsx
// On Drag Start
indexRef.current = node.zIndex();
node.moveTo(dragLayer);

// On Drag End
node.moveTo(contentLayer);
node.zIndex(indexRef.current);
```

#### Refinement 2: Transformer Sync

A node's `Transformer` must follow it to the `dragLayer`.
* If the Transformer stays in the `contentLayer` while the node moves, it will fail to track the node's position and anchors will become detached.

#### Refinement 3: Hit-Detection Optimization

* **On Drag Start**: Set `contentLayer.listening(false)`.
* **Why**: Prevents Konva from checking every background object for overlaps during move events, further reducing CPU load.

#### Refinement 4: Context-based Ref Management

Implemented a `WorkspaceContext` to provide `dragLayerRef` and `contentLayerRef` to all selectable components.

***

### Solution C: Synchronous Clamping (Optional Improvement)

**Effort**: Medium | **Impact**: Medium

The implementation currently uses `onDragMove` for clamping. While functional, future optimization could move this to Konva's synchronous `dragBoundFunc` to avoid React's event loop entirely.

***

## 4. Final Configuration

| Priority | Feature | Effort | Impact | Status |
|----------|---------|--------|--------|--------|
| 1 | **Pixel Ratio Cap (2.0)** | Low | High | ✅ Done |
| 2 | **Layer Isolation + Index Sync** | Medium | Extreme | ✅ Done |
| 3 | **Transformer Sync on Drag** | Medium | High | ✅ Done |
| 4 | **Disable Listening during Drag** | Low | Low-Medium | ✅ Done |

***

## 5. Success Criteria (Verified)

| Metric | Target | Result |
|--------|--------|--------|
| Perceived drag lag on iPad | Imperceptible | ✅ Verified |
| Redraw Complexity per Drag Frame | $O(1)$ (1 object) | ✅ Verified |
| Visual Sharpness | 2x (Balanced) | ✅ Verified |
| Z-Index Stability | No jumping | ✅ Verified |

***

## 6. References

* [Konva Performance: Layer Management](https://konvajs.org/docs/performance/Layer_Management.html)
* [Konva Performance: Pixel Ratio](https://konvajs.org/docs/performance/All_Performance_Tips.html#use-konvapixelratio-1-on-retina-devices)
