# PR: Fix Week View Rendering and Availability Display

## Summary
This PR addresses critical issues in the Calendar Week View implementation where the layout was incorrectly rendering practitioner columns instead of day columns, and unavailable time slots were not being grayed out correctly due to missing availability data.

## Key Changes

### 1. Week View Architecture Fix
- **Refactored `CalendarGrid.tsx`**: separated rendering logic for `Day` vs `Week` views.
- **Correct Layout**: The Week View now renders 7 fixed columns (Sunday to Saturday) instead of dynamic practitioner columns.
- **Event Grouping**: Events from all selected practitioners are now correctly merged and displayed in their respective day columns.
- **Interaction Updates**: 
  - `handleSlotClick` now correctly identifies the date of the clicked column in Week View.
  - Added specific keyboard navigation (Left/Right arrow keys) for the 7-day layout.
- **UI Refinements**: 
  - Weekday headers now display in Traditional Chinese (e.g., "18 (日)").
  - Compact "Date First" layout for headers to save vertical space.
  - Reduced header padding for a sleeker look.
- **Interaction**:
  - Clicking a date header in Week View now instantly switches to the Day View for that specific date.
  - This view change is persisted to URL and local storage immediately.

### 2. Availability Display (Gray-out) Fix
- **Logic Update**: Implemented availability checks against the **current logged-in user** for Week View slots.
- **Data Guard**: Updated `useCalendarEvents` hook to **always** fetch the current user's availability, even if they are not currently selected in the sidebar filter. This ensures the "unavailable" visual state is always accurate for the viewer.

### 3. Critical Bug Fix in Availability Parsing
- **Fixed Overwrite Issue**: `extractPractitionerAvailability` was incorrectly overwriting the availability object for each result item. This caused data loss where only the last processed day's schedule was preserved (e.g., seeing only Saturday's availability).
- **Merge Logic**: Updated the function to correctly **merge** daily schedules into the practitioner's availability object.
- **Code Cleanup**: Removed accidental duplicate code block in `isTimeSlotAvailable` that was causing potential syntax/logic errors.

### 3. Month View Overhaul
- **Alignment Fix**: Completely refactored Month View to use the shared sticky header architecture (`PractitionerRow`).
- **Layout**: Implemented a responsive 7-column grid that perfectly overlaps with the week-day headers.
- **Styling updates**:
  - Increased day cell minimum height to 180px for better event visibility.
  - Centered date numbers within cells.
  - Removed misalignment caused by extra borders and padding.
  - **Visual Distinction**: Darkened "other month" days to gray (#e5e7eb) and highlighted "today" in blue (#dbeafe) for clear separation. Borders adjusted to remain visible.
  - **Interaction**: Clicking any date number in Month View immediately jumps to the Day View for that specific date.
  - **Event Density**: Optimized layout to display up to 6 events per day (vs 3 previously) with a compact `+X` overflow indicator.
- **`frontend/src/utils/practitionerAvailability.ts`**: Changed assignment to spread merge: `schedule: { ...(prev?.schedule || {}), [date]: schedule }`.
- **`frontend/src/hooks/queries/useCalendarEvents.ts`**: modified `fetchCalendarEvents` to include `currentUserId` in the fetch set if distinct from `selectedPractitioners`.

## Testing
- Verified Week View now shows 7 columns (Sun-Sat).
- Verified unavailability (gray background) correctly reflects the logged-in user's schedule (e.g., gray on weekends if not working).
- Verified events from multiple practitioners appear in the correct day columns.
- Verified standard keyboard navigation works in the new layout.
- Ran all frontend unit tests (PASSED).
