# Design Doc: Medical Record Canvas UX/UI Improvements

## 1. Executive Summary

The current medical record canvas implementation serves the basic functional needs but lacks the polish, intuitive feel, and standard interactions expected by users familiar with modern note-taking apps (e.g., Notability, GoodNotes). This document proposes a comprehensive overhaul of the canvas's underlying architecture and user experience to achieve a "smooth, intuitive, and professional" standard.

**Key Recommendation:** Migrate from the current custom HTML5 Canvas implementation to **Konva.js (via `react-konva`)**. This will provide robust, industry-standard interaction models (selection, transformation, layering) out-of-the-box, allowing us to focus on clinical features rather than maintaining a low-level graphics engine.

## 2. Current State Analysis

### 2.1 Existing Implementation
- **Tech Stack:** Raw HTML5 `<canvas>` with custom React logic (`ClinicalWorkspace.tsx`).
- **Layering:** Rigid two-canvas system. `backgroundCanvas` (Images) is permanently below `drawingCanvas` (Pen strokes).
- **Interactions:**
  - Manual implementation of hit-testing, selection boxes, and rotation handles.
  - "Weird" feel often stems from non-standard behaviors (e.g., lack of cursor changes, rigid handle sizes, lack of snap-to-grid or aspect ratio locking).
- **Performance:** Redraws entire canvas on every frame/stroke. Optimized with double-buffering but scalable performance is a concern with complex drawings.
- **Missing Features:**
  - True Zoom & Pan (Canvas only scales responsively).
  - Z-Index manipulation (Can't move an image *over* a drawing).
  - Grouping (Can't select multiple items).
  - Tablet Gestures (Pinch-to-zoom, two-finger scroll).

### 2.2 User Feedback ("The Weird Feel")
The "weirdness" likely originates from:
1.  **Disconnect:** Writing feels disconnected from the paper (latency or lack of smoothing).
2.  **Rigidity:** Cannot easily move things around or layer them naturally.
3.  **Non-Standard Controls:** Resizing/Rotating doesn't feel like other apps (e.g., PowerPoint/Google Docs).
4.  **Visuals:** Lack of hover states, active cursors, or visual feedback during interactions.

## 3. UX Research & Best Practices

### 3.1 Target Audience: Practitioners
- **Mental Model:** Paper chart, Clipboard, Google Docs, Notability.
- **Needs:** Speed, reliability, clarity. "Don't make me think."
- **Constraints:** Often using tablets (iPad) or inefficient desktop mice.

### 3.2 Industry Standards (Notability, GoodNotes, Figma)
| Feature | Standard Expectation | Current Implementation |
| :--- | :--- | :--- |
| **Selection** | Tap to select, drag selection box. Visual "Transformer" handles. | Manual, brittle implementation. |
| **Navigation** | Infinite or Large canvas. Pinch-to-zoom, two-finger pan. | Fixed aspect ratio, vertical scroll only. |
| **Layering** | Implicit (newest on top) but adjustable (Send to Back). | Fixed: Drawings always over Images. |
| **Text** | Click-to-type, resizable text boxes. | Not supported (only drawing). |
| **Images** | Drag & drop, aspect-ratio locked resizing, rotation. | Supported, but manual interaction logic. |

## 4. Proposed Improvements

### 4.1 Architecture: Adopt Konva.js (`react-konva`)
Switching to a battle-tested 2D canvas library is the most effective way to solve the "weird" feeling.

*   **Why Konva?**
    *   **React Integration:** `react-konva` allows declarative rendering of canvas shapes (similar to SVG), matching our React codebase perfectly.
    *   **Built-in Transformers:** Provides professional-grade Resize/Rotate handles automatically.
    *   **Performance:** Handles thousands of shapes with layer caching.
    *   **Event Handling:** Robust click, drag, hover, and touch events.
    *   **Z-Index:** Easy `moveUp()`, `moveDown()`, `zIndex` management.

### 4.2 UI/UX Design

#### A. The "Infinite" Workspace (Viewport)
*   **Behavior:** Instead of a fixed-width page that scales, implement a "Viewport" that allows zooming and panning.
*   **Controls:**
    *   **Mouse:** Ctrl+Scroll to Zoom, Space+Drag to Pan (or dedicated Hand tool).
    *   **Touch:** Pinch to Zoom, Two-finger drag to Pan.
*   **Visuals:** clear boundaries for the "printable" area (the A4 page), but infinite gray space around it for scratchpad use.

#### B. Unified Layering System
*   **Single Stage:** Combine drawings and images into a single scene graph.
*   **Ordering:**
    1.  **Background Layer:** Template Image (Locked).
    2.  **Content Layer:** User drawings, images, and text mixed together.
*   **Flexibility:** Users can drag an image *over* a previous note, or highlight *over* an image.

#### C. Enhanced Toolbar
Move to a floating, context-aware toolbar (similar to iOS markup or Notability).

*   **Tools:**
    *   ✋ **Hand:** Navigation (Pan).
    *   🖊️ **Pen:** Variable width (pressure sensitive), smoothing.
    *   🖍️ **Highlighter:** Semi-transparent, draws *behind* ink (multiply blend mode).
    *   ⬜ **Shape/Image:** Insert rectangle, circle, arrow, or upload image.
    *   ✂️ **Select/Lasso:** Box selection or freeform lasso to move/transform multiple objects.
    *   Aa **Text:** (New) Simple text labels.

#### D. Interaction Polish
*   **Cursors:** Change cursor on hover (move, resize-ns, resize-ew, pointer).
*   **Snapping:** (Optional) Snap to 90-degree rotations.
*   **Touch Rejection:** Better palm rejection logic (only Pen draws, finger pans).

## 5. Implementation Plan

## Status Update
- **Phase 1: Basic Canvas Setup & Infinite Scroll** - COMPLETED & REFINED (Multi-layer architecture, logical coordinates, performance optimization)
- **Phase 2: Media Support & UX Refinement** - COMPLETED & REFINED (Z-ordering, viewport-relative placement, point-to-segment hit testing, visual selection feedback)
- **Phase 3: Advanced Interactions & Annotations** - Pending (Planned: Lasso selection, text support, zoom/pan)
- **Phase 4: Optimization & Polish** - In Progress (Refining performance and edge cases)

### Phase 1: Foundation (Konva Migration) ✅
1.  Install `konva`, `react-konva`, `use-image`.
2.  Create `CanvasStage` component to replace `CanvasLayer`.
3.  Migrate `WorkspaceData` model to map to Konva Nodes (`Line`, `Image`, `Text`).
4.  Implement basic Pen drawing using Konva `Line`.

### Phase 2: Professional Interactions ✅
1.  Implement `Transformer` for image resizing/rotation (replaces custom logic).
2.  Implement Selection logic (click to select, click background to deselect).
3.  Implement Z-ordering (Bring to Front / Send to Back).

### Phase 3: Advanced Features
1.  **Zoom/Pan:** Implement `stage.scale` and `stage.position` logic with gestures.
2.  **Text Support:** Add `Text` nodes.
3.  **Performance:** Implement `perfectDrawEnabled={false}` for dragging, and layer caching for static content.

### Phase 4: Migration Strategy
*   **Data Compatibility:** Write a utility to convert existing `DrawingPath` and `MediaLayer` JSON into the new Konva-compatible structure on load.
*   **Fallback:** Keep the old component available behind a feature flag if needed during transition.

## 6. Technical Considerations

*   **Sizing:** We must maintain the concept of "Logical Width" (1000 units) to ensure drawings look the same on all devices, regardless of Zoom level.
*   **Saving:** Konva supports `stage.toJSON()`, but we should stick to our own compact JSON schema (`WorkspaceData`) to save storage, mapping it to/from Konva nodes at runtime.
*   **Images:** Continue using `browser-image-compression` before adding to the canvas.

## 7. Mockup Concepts

### Toolbar (Floating Bottom)
`[ ✋ | 🖊️ | 🖍️ | 🧹 | ➕ Image | ↩️ ↪️ ]`

### Context Menu (On Selection)
When an image is selected:
`[ 🗑️ Delete | ⬆️ Bring to Front | ⬇️ Send to Back ]`

This approach avoids "over-engineering" a custom engine while delivering the "Figma-lite" experience users expect.
