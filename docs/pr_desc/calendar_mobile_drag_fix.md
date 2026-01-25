# PR Description: Fix Mobile Drag-and-Drop Scaling & Scrolling Issues

## Goal
Resolve critical orientation and alignment issues when dragging calendar events on mobile devices, especially when the grid expands horizontally (multiple practitioners).

## Issues Addressed
1.  **Horizontal Alignment Bug**: The drag preview ("ghost") would often shrink or fall between columns because positioning was based on viewport percentages rather than the actual scrollable content width.
2.  **Scroll Context Loss**: Dragging horizontally didn't account for the current `scrollLeft` position, making it impossible to target columns outside the initial viewport correctly.

## Changes
1.  **Physics-Based Measurement**:
    *   Added `columnWidth` to the `dragState`.
    *   On drag start, the component now dynamically measures the physical pixel width of the calendar columns.
2.  **Pixel-Perfect Positioning**:
    *   Moved the `drop-preview` element inside the `.resourceGrid` container (the scrolling content area).
    *   Switched from percentage-based (`%`) to pixel-based (`px`) `left` and `width` styling.
    *   Calculated absolute horizontal position as `colIndex * measuredColumnWidth`.
3.  **Scroll Awareness**:
    *   Updated the `cursorX` calculation to include `gridRef.current.scrollLeft`, ensuring the mouse position is correctly mapped to the physical column in the expanded grid.
4.  **Clamping Logic**:
    *   Maintained strict clamping to prevent appointments from being dragged onto non-practitioner resource columns.

## Verification
-   **Tests**: All frontend tests passed.
-   **Manual**: Verified that dragging an event in both Day and Week views snaps perfectly to columns regardless of horizontal scroll position or number of practitioners.
