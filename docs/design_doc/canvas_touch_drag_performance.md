# Design Document: Canvas Touch Drag Performance Optimization (Revised)

**Author**: AI Assistant\
**Date**: 2026-02-01\
**Status**: Proposed\
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
* Every redraw renders 9x more pixels than the logical size.
* This exceeds the 16.6ms frame budget on mobile GPUs.

#### 2. Full Layer Redraw on Every Drag Frame (Primary)

When any object is dragged, Konva fires `dragmove` events ~60 times/second. Currently, each event triggers a redraw of the **entire content layer**, including all other shapes, paths, and images.

***

## 3. Proposed Solutions & Technical Refinements

### Solution A: Cap Pixel Ratio for Touch Devices

**Effort**: Low | **Impact**: High

Limit the internal canvas resolution on mobile devices while maintaining visual quality.

```typescript
// Critical: Set at module level or useLayoutEffect BEFORE Stage mounts
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  Konva.pixelRatio = Math.min(window.devicePixelRatio, 2.0); // Balanced cap
}
```

* **Technical Note**: A cap of `2.0` is recommended over `1.5` to maintain the "Retina quality" expectation of medical records while still providing a 2x-3x speedup on 3x devices.

***

### Solution B: Drag Layer Isolation (Standard)

**Effort**: Medium | **Impact**: Extreme

Add a dedicated `dragLayer` to isolate movement. Only the dragged element and its transformer will redraw during movement.

#### Refinement 1: Z-Index Preservation

When moving a node between layers, its original index in the child list is lost.

* **On Drag Start**: Capture `originalIndex = node.index()`.
* **On Drag End**: `node.moveTo(contentLayer)` followed by `node.setIndex(originalIndex)`.

#### Refinement 2: Transformer Synchronization

A node's `Transformer` must follow it to the `dragLayer`.

* If the Transformer stays in the `contentLayer` while the node moves, it will fail to track the node's position and anchors will become detached.

#### Refinement 3: Hit-Detection Optimization

* **On Drag Start**: Set `contentLayer.listening(false)`.
* **Why**: Prevents Konva from checking every background object for overlaps during move events, further reducing CPU load.

#### Refinement 4: Context-based Ref Management

To avoid prop-drilling `dragLayerRef` and `contentLayerRef`, implement a `WorkspaceContext`.

```tsx
const WorkspaceContext = createContext<{
  dragLayer: Konva.Layer | null;
  contentLayer: Konva.Layer | null;
}>(...);
```

***

### Solution C: Use `dragBoundFunc` for Clamping (Optional Improvement)

**Effort**: Medium | **Impact**: Medium

Replace `onDragMove` clamping with Konva's synchronous `dragBoundFunc`.

* **Benefit**: Evaluated inside Konva's render loop, avoiding React's event system overhead.
* **Challenge**: Requires careful absolute-to-relative coordinate mapping.

***

## 4. Recommendation

**Implement Solutions A and B together.**

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | **Pixel Ratio Cap (2.0)** | Low | High |
| 2 | **Layer Isolation + Index Sync** | Medium | Extreme |
| 3 | **Transformer Sync on Drag** | Medium | High |
| 4 | **Disable Listening during Drag** | Low | Low-Medium |

***

## 5. Implementation Plan

### Phase 1: Global Config & Context

1. Configure `Konva.pixelRatio = 2.0` at the top of `ClinicalWorkspace.tsx`.
2. Create `WorkspaceContext` and wrap the `Stage` children.
3. Add `<Layer ref={dragLayerRef} name="drag" />` as the top-most layer.

### Phase 2: Component Refactor

1. Update `UrlImage`, `SelectableLine`, `SelectableText`, and `SelectableShape`.
2. **On Drag Start**:
   * Save local index `indexRef.current = node.index()`.
   * `node.moveTo(dragLayer)`.
   * `trRef.current?.moveTo(dragLayer)`.
   * `contentLayer.listening(false)`.
3. **On Drag End**:
   * `node.moveTo(contentLayer)`.
   * `node.setIndex(indexRef.current)`.
   * `trRef.current?.moveTo(contentLayer)`.
   * `contentLayer.listening(true)`.

***

## 6. Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Perceived drag lag on iPad | Noticeable | Imperceptible |
| Redraw Complexity per Drag Frame | $O(N)$ (All objects) | $O(1)$ (1 object) |
| Visual Sharpness | 3x (on iPhone 13+) | 2x (Balanced) |

***

## 7. References

* [Konva Performance: Layer Management](https://konvajs.org/docs/performance/Layer_Management.html)
* [Konva Performance: Pixel Ratio](https://konvajs.org/docs/performance/All_Performance_Tips.html#use-konvapixelratio-1-on-retina-devices)
