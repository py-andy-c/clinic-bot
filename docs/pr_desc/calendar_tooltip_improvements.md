# PR Description: Custom Instant Tooltip for Calendar Events

## Overview
This PR improves the user experience for viewing event details on the calendar by replacing the native browser tooltip with a custom, high-performance **Instant Tooltip**.

## Problem
The native HTML `title` attribute has an uncontrollable OS-level delay (usually ~1 second) before appearing. In a high-density calendar where names are frequently truncated, this delay forces users to wait just to read the patient's name, which slows down workflow significantly.

## Solution
Implemented a custom `Tooltip` component using React Portals.

### Key Features
1.  **Zero Delay**: The tooltip appears instantly (`onMouseEnter`) via React state, removing the friction of waiting.
2.  **Smart Positioning (Collision Detection)**:
    *   The placement logic dynamically checks the viewport boundaries.
    *   **Right Edge**: Flips to the left of the cursor if it would overflow the screen width.
    *   **Bottom Edge**: Flips above the cursor if it would overflow the screen height.
3.  **Portal Rendering**: Renders directly into `document.body` (z-index: 9999) to ensure it is never clipped by the calendar's internal scrolling containers (`overflow: hidden`).
4.  **Native Tooltip Removal**: Stripped the standard `title` attribute from event cards to prevent duplicate/overlapping tooltips.

## Technical Details
- **Component**: `Tooltip` (internal to `CalendarGrid.tsx`).
- **Hooks**: Used `useRef` for measuring dimensions and `useEffect` for recalculating position on render.
- **Performance**: Position updates are driven by `onMouseMove` for fluid tracking, but the component is lightweight enough to not cause layout thrashing.

## Testing
- Verified tooltip appears instantly on hover.
- Verified tooltip tracks mouse movement.
- Verified tooltip flips correctly when hovering events near the right edge and bottom edge of the screen.
- Verified no double tooltips appear.
