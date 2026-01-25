# PR: Calendar Drag-and-Drop UX Improvements & Optimistic UI

## Overview
This PR significantly enhances the Calendar Drag-and-Drop experience by resolving several critical UX issues related to interaction handling, state synchronization, and perceived performance.

## Key Changes

### 1. Robust Interaction Handling
- **Drag Threshold**: Added a 5px movement threshold for desktop dragging. This prevents quick clicks (intended to open event details) from being incorrectly interpreted as accidental moves.
- **Sticky Drag Fix**: Global `mouseup` and `touchend` listeners are now activated immediately upon grabbing an event. This ensures that the drag state is always cleaned up properly, even if the movement threshold isn't met or if the interaction is canceled by another UI element (like a modal).
- **Auto-Dismiss FABs**: Open time-slot menus (FABs) are now automatically closed the moment an event interaction begins, ensuring a clear and focused UI context.

### 2. Performance & Perceived Speed
- **Optimistic UI Updates**: Implemented manual cache updates via `queryClient.setQueriesData` for availability exceptions. This eliminates the "jump back" behavior (where an event would briefly return to its old position while waiting for API confirmation), providing an instantaneous, zero-latency feel.
- **Redundant Update Guard**: Added a `hasMoved` check that compares the drop position with the original state. If an event is dropped back in its starting position, redundant API calls and "Success" modals are suppressed.

### 3. Visual & UX Polish
- **Premium Alert Integration**: Migrated drag-and-drop feedback (e.g., "Cannot move to unavailable slot") from browser-default `alert()` to the application's high-quality `ModalContext` system.
- **Z-Index & Formatting**: Improved the layering of drag ghosts and previews to ensure they correctly overlap grid elements without clipping.

### 4. Technical Quality & Stability
- **Test Suite Updates**: Updated `CalendarGrid` unit tests and keyboard navigation tests with proper mocks for `ModalContext`, ensuring full coverage and preventing CI/CD regressions.
- **Consistent Layout**: Enforced use of the `CALENDAR_GRID_TIME_COLUMN_WIDTH` constant to prevent layout shifts across different calendar views.

## Verification Results
- ✅ All frontend unit tests passed.
- ✅ Manual verification of click vs. drag differentiation on desktop and touch.
- ✅ Verified zero-latency optimistic updates for exception moves.
- ✅ Verified automatic cleanup of drag state on interaction cancellation.
