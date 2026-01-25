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

### 2. Availability Display (Gray-out) Fix
- **Logic Update**: Implemented availability checks against the **current logged-in user** for Week View slots.
- **Data Guard**: Updated `useCalendarEvents` hook to **always** fetch the current user's availability, even if they are not currently selected in the sidebar filter. This ensures the "unavailable" visual state is always accurate for the viewer.

### 3. Critical Bug Fix in Availability Parsing
- **Fixed Overwrite Issue**: `extractPractitionerAvailability` was incorrectly overwriting the availability object for each result item. This caused data loss where only the last processed day's schedule was preserved (e.g., seeing only Saturday's availability).
- **Merge Logic**: Updated the function to correctly **merge** daily schedules into the practitioner's availability object.
- **Code Cleanup**: Removed accidental duplicate code block in `isTimeSlotAvailable` that was causing potential syntax/logic errors.

## Technical Details

- **`frontend/src/components/calendar/CalendarGrid.tsx`**: Separate logic path for `view === CalendarViews.WEEK`. Corrected `weekDaysData` memoization to group events by day.
- **`frontend/src/utils/practitionerAvailability.ts`**: Changed assignment to spread merge: `schedule: { ...(prev?.schedule || {}), [date]: schedule }`.
- **`frontend/src/hooks/queries/useCalendarEvents.ts`**: modified `fetchCalendarEvents` to include `currentUserId` in the fetch set if distinct from `selectedPractitioners`.

## Testing
- Verified Week View now shows 7 columns (Sun-Sat).
- Verified unavailability (gray background) correctly reflects the logged-in user's schedule (e.g., gray on weekends if not working).
- Verified events from multiple practitioners appear in the correct day columns.
- Verified standard keyboard navigation works in the new layout.
- Ran all frontend unit tests (PASSED).
