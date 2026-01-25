# PR Description: Fix Mobile Drag-and-Drop Scrolling & Selection Issues

## Goal
Resolve critical interaction issues on mobile devices:
1.  Dragging a calendar event would sometimes cause the page to scroll instead of moving the event.
2.  Long-pressing empty areas or events would trigger native text selection/copy menus, disrupting the UI.

## The Problem
1.  **Scrolling**: Modern browsers treat touch event listeners as **passive** by default. This causes `e.preventDefault()`—which is needed to stop scrolling during a drag—to be ignored, allowing the grid to scroll under the user's finger.
2.  **Text Selection**: The calendar grid lacked CSS properties to disable user selection, causing native OS selection handles to appear during touch interactions.

## The Solution
1.  **Non-Passive Listener**: We replaced the standard React `onTouchMove` prop with a manually attached `touchmove` listener using `{ passive: false }`.
    *   **Implementation**: Added a `containerRef` and used `useEffect` to attach the listener. Inside, we call `e.preventDefault()` only when `dragState.isDragging` is true.
2.  **Disable Selection**:
    *   Applied `user-select: none` and `-webkit-touch-callout: none` to the `.calendarGridContainer` class.
    *   Updated global `.no-selection` utility in `index.css`.
3.  **State Management**: Hardened the long-press logic to ensure flags like `isLongPressActiveRef` are correctly reset at the start of interactions, preventing race conditions.

## Verification
-   **Tests**: All frontend tests PASSED.
-   **Impact**:
    *   **Dragging**: Reliably suppresses scrolling during event moves.
    *   **Interaction**: Long-pressing no longer highlights text or brings up context menus.
