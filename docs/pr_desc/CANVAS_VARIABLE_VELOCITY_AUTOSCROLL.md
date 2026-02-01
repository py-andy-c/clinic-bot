# PR: Variable Velocity Auto-scroll for Medical Records Canvas

## Summary
This PR introduces a "Variable Velocity Auto-scroll" feature to the `ClinicalWorkspace` canvas. This allows users to drag items (images, text, shapes, or drawings) near the viewport edges to trigger automatic page scrolling. The implementation is optimized for fluidity and performance, particularly for tablet and mobile users navigating long documents.

## Key Changes

### 1. Auto-scroll Engine
- **Variable Velocity**: Implemented a calculation where scroll speed increases as the pointer moves closer to the screen edge (within an 80px "scroll zone").
- **Event-Driven Synchronization with Manual Offset**:
    - The loop now uses `stage.setPointersPositions(evt)` to keep Konva's pointer state accurate.
    - **Stationary Mouse Support**: For dragging operations, the loop now manually increments the node/anchor position by the scroll delta (`cvx/cvy`). This ensures the item follows the stationary mouse during auto-scroll.
    - **Native Logic Reuse**: Firing `dragmove` or `transform` events after the manual shift ensures that the component's existing clamping and downstream state updates (e.g., for Arrow bodies) are triggered correctly.
- **Dynamic Coordinate Mapping**: Eliminated stale coordinate issues by removing cached viewport rects. Coordinates are resolved dynamically relative to the Stage's position in the viewport.
- **Performance Optimization**: Used `requestAnimationFrame` for a smooth 60fps scroll loop without layout thrashing.

### 2. Component Integration
- **Universal Support**: Integrated into all canvas layer types: `UrlImage`, `SelectableLine`, `SelectableText`, and `SelectableShape`.
- **Transformer Support**: Wired into both `onDragMove` and `onTransform`, ensuring auto-scroll works during both movement and resizing (via Transformer handles).
- **Anchor Support**: Integrated into custom anchors for Arrows, ensuring long-distance stretching is supported.

### 3. Cleanup & Reliability
- Added proper cleanup for `requestAnimationFrame` on component unmount.
- Ensured `onDragEnd` and `onTransformEnd` stop the scroll loop and reset references.
- Leverages existing boundary clamping logic in component handlers to prevent items from scrolling off-canvas.

## Technical Implementation Details
- **File**: `frontend/src/components/medical-records/ClinicalWorkspace.tsx`
- **Refs Used**:
    - `scrollVelocityRef`: Stores current X/Y velocity.
    - `scrollRafRef`: Manages the active animation frame.
    - `draggingNodeRef`: Tracks the node being moved for event firing.
    - `lastPointerEventRef`: Captures the latest raw DOM event for pointer synchronization.
    - `isScrollLoopRunning`: Flag to prevent redundant loop initializations.

## Verification
- **Unit Tests**: All existing tests in `ClinicalWorkspace.test.tsx` and `ClinicalWorkspaceText.test.tsx` pass.
- **Manual Verification**: Confirmed that dragging an item to the bottom edge scrolls the page smoothly and the item stays aligned with the pointer.
- **Performance**: Verified no significant CPU spikes or layout shifts during sustained dragging.
