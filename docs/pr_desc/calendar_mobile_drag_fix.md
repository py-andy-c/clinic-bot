# PR Description: Fix Mobile Drag-and-Drop Scaling & Scrolling Issues

## Goal
Resolve critical orientation and alignment issues when dragging calendar events on mobile devices, especially when the grid expands horizontally (multiple practitioners).

## Issues Addressed
1.  **Horizontal Alignment Bug**: The drag preview ("ghost") would often shrink or fall between columns because positioning was based on viewport percentages rather than the actual scrollable content width.
2.  **Scroll Context Loss**: Dragging horizontally didn't account for the current `scrollLeft` position, making it impossible to target columns outside the initial viewport correctly.
3.  **Visual Clutter**: The drag ghost and placeholder originally contained redundant practitioner labels that crowded the UI on narrow screens.

## Changes
1.  **Physics-Based Measurement**:
    *   Added a `resourceGridRef` for robust container access.
    *   Calculates `columnWidth` once per drag gesture start, significantly improving performance compared to per-move calculation.
2.  **Pixel-Perfect Positioning**:
    *   Moved the `drop-preview` element inside the `.resourceGrid` container (the scrolling content area).
    *   Switched from percentage-based (`%`) to pixel-based (`px`) `left` and `width` styling.
    *   Calculated absolute horizontal position as `colIndex * measuredColumnWidth`.
3.  **Scroll Awareness**:
    *   Updated the `cursorX` calculation to include `gridRef.current.scrollLeft`, ensuring the mouse position is correctly mapped to the target column in the expanded grid.
4.  **Polish & Aesthetics**:
    *   **Dynamic Colors**: The drag ghost now changes color to match the target practitioner's color code as it is dragged across the grid.
    *   **Ghost Simplified**: Removed practitioner names ("From/To") from the ghost and the original position placeholder for a cleaner look.
    *   **Full-Width Stays**: The dashed placeholder ("original position") now always fills the full column width, even if the appointment was originally part of an overlapping group.

## Verification
-   **Tests**: All frontend tests passed.
-   **Architecture**: Optimized measurement logic to minimize DOM access during drag interactions.
