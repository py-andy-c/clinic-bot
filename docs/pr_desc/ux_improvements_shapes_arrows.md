# PR Description: Canvas UX Improvements for Shapes and Arrows

## Issue Description
This PR addresses several UX issues in the medical record canvas related to shape manipulation and creation:

1. **Scaling Stroke Weights**: Previously, when resizing shapes (rectangles, circles, arrows) using the transformer, the shapes behaved like images—their stroke weights and arrowheads scaled up or down, leading to inconsistent line widths across the document.
2. **Clunky Arrow Interaction**: Arrows used a standard bounding box transformer, which was unintuitive for linear shapes. Users expect to drag the start and end points of an arrow directly, similar to Google Slides.
3. **Circle Creation Discrepancy**: During circle creation, the visual preview (the "ghost" shape) was twice as large as the final shape created after the mouse was released.

## Fixes and Improvements

### 1. Constant Stroke Weights during Resize
- Modified the `onTransform` handlers for [SelectableLine](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx), [SelectableText](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx), and [SelectableShape](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx).
- The logic now forces the node's `scaleX` and `scaleY` to `1` in every frame of the transformation.
- The underlying geometry (`width`, `height`, or `points`) is updated manually to match the transformer's bounding box, ensuring the visual stroke weight remains constant.

### 2. Point-to-Point Arrow Interaction
- Refactored [SelectableShape](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx) specifically for arrows.
- Bypassed the standard Konva `Transformer` for arrow types.
- Implemented two custom `Circle` anchors at the tail and head of the arrow.
- Added a `handleAnchorDrag` function that allows users to move endpoints independently, automatically updating the arrow's position and vector.

### 3. Aligned Circle Creation Preview
- Updated the `handleMouseMove` logic in [ClinicalWorkspace.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx) for the `circle` tool.
- The `radiusX` and `radiusY` of the preview ellipse are now set to half of the mouse delta (`dx/2`).
- The center of the preview ellipse is dynamically adjusted to stay exactly between the start point and the current mouse position, matching the final creation logic in `handleMouseUp`.

## Technical Details
- Added `Circle` to the `react-konva` imports.
- Standardized coordinate mapping for shape creation to ensure "drag from corner" behavior results in predictable placement.
- Improved cursor feedback for arrow anchors to indicate resize direction.

## Verification Results
- [x] Resizing rectangles and circles no longer thickens or thins their borders.
- [x] Arrows can be reshaped by dragging their endpoints without a bounding box.
- [x] The circle preview during drawing now perfectly matches the size and position of the final shape.
