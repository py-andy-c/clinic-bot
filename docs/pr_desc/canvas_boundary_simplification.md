# PR Description: Canvas Boundary Simplification and Content Constraints

## Summary
This PR simplifies the medical record canvas implementation by unifying region definitions and enforcing strict boundaries for content creation and movement.

## Changes

### 1. Unified 896px Content Boundary
- Introduced `getClampedPointerPosition` in [ClinicalWorkspace.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/ClinicalWorkspace.tsx) to ensure all pointer inputs (mouse/touch) are clamped to the 896px "desk" region.
- This prevents "leakage" where pen strokes, shapes, or text boxes could previously be initialized in the outer stage buffer.

### 2. Robust Boundary Enforcement
- **Unified Transformation Logic**: Abstracted complex clamping math into a shared `handleTransformClamping` utility. This ensures consistent resizing behavior (clamping dimensions and resetting scale) across Images, Text, and Shapes.
- **Ellipse Support**: Correctly handles Ellipse center-positioning during both drag and transform operations, preventing center-aligned objects from leaking.
- **Arrow Fixes**: Updated Arrow components to track width and height, enabling precise boundary enforcement during drag and head/tail anchor manipulation.
- **Text Creation**: Fixed text box initialization to allow the full 896px width when created near the left edge.

### 3. Standardized Drag & Transform Limits
- Updated all selectable components to consistently use the same `dragLimits` based on the 896px boundary.
- Updated unit tests to reflect the expanded boundary (1027 logical units instead of 1000).
- Ensured that resizing and moving objects cannot push them beyond the physical limits of the workspace.

### 4. Clear Region Hierarchy
- **Content (896px)**: The hard limit for all document data.
- **View (850px)**: The white "paper" region. Non-selected content is clipped to this area for a clean workspace and accurate print representation.
- **UI Stage (976px)**: An invisible buffer zone strictly reserved for Transformer handles (resize/rotate). This ensures that objects at the very edge of the desk remain fully interactable.

## Rationale
The previous implementation had multiple overlapping width definitions (850px, 896px, 976px) that allowed inconsistent behavior, such as drawing starting in the "empty" space outside the desk. These changes provide a more intuitive "physical" feel to the workspace.

## Verification
- **Manual Verification**: Verified that drawing and shape creation are now correctly clamped to the gray desk area.
- **Automated Tests**: Ran `./run_frontend_tests.sh`.
    - `ClinicalWorkspace.test.tsx`: Passed
    - `ClinicalWorkspaceText.test.tsx`: Passed
