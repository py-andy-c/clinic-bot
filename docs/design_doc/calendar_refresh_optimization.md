# Calendar Page Refresh Optimization

## Problem Statement

When editing event names or clinic notes from the calendar page's EventModal, there is a visible refresh/flicker that degrades user experience. The entire calendar view re-renders with a loading state, causing a noticeable visual disruption.

In contrast, the same operations on the patient detail page feel much smoother - the modal updates seamlessly without visible refresh.

## Current Behavior

### Calendar Page (Visible Refresh)
1. User saves event name or clinic notes in EventModal
2. `onEventNameUpdated` callback triggers `fetchCalendarData(true)` with `forceRefresh=true`
3. `setLoading(true)` is called, showing a loading spinner/overlay
4. Full calendar refresh: All events for the visible date range are re-fetched via API
5. `setAllEvents(events)` replaces all events
6. React Big Calendar re-renders the entire calendar view
7. `setLoading(false)` hides the loading state
8. **Result**: Visible flicker/refresh as the entire calendar re-renders

### Patient Detail Page (Smooth)
1. User saves event name or clinic notes in EventModal
2. `onEventNameUpdated` callback triggers `refreshAppointmentsList()`
3. Appointments list data is refreshed in the background
4. `useEffect` automatically updates `selectedEvent` state when data changes
5. EventModal receives updated event prop seamlessly
6. **Result**: No visible refresh - modal updates smoothly

## Root Cause

The calendar page uses a **full calendar refresh** approach:
- Shows loading state (`setLoading(true)`)
- Fetches all events for the visible date range
- Re-renders the entire React Big Calendar component
- This causes visible flicker even for simple field updates (event name, clinic notes)

The patient detail page uses a **localized update** approach:
- No loading state shown
- Only the appointments list data is refreshed
- Modal state is updated via `useEffect` when data changes
- Update is localized to the modal, not the entire page

## Proposed Solution

### Option 1: Optimistic Updates with Background Refresh (Recommended)

**For simple updates (event name, clinic notes):**
1. Update `modalState.data` immediately with new values (optimistic update)
2. Refresh calendar data in the background **without** `setLoading(true)`
3. Let the existing `useEffect` sync modal state when calendar data updates
4. User sees instant feedback, calendar updates silently

**For structural changes (time/practitioner):**
- Keep current full refresh with loading state (necessary for calendar layout changes)

**Benefits:**
- ✅ Instant UI feedback (no waiting for API)
- ✅ No visible loading spinner for simple updates
- ✅ Calendar updates in background without blocking UI
- ✅ Matches patient detail page behavior

### Option 2: Direct Modal State Update from API Response

1. After API call succeeds, update `modalState.data` directly with response data
2. Refresh calendar silently in background
3. Modal shows updated value immediately

### Option 3: Selective Update Strategy

- **Simple updates** (event name, clinic notes): Optimistic update + silent background refresh
- **Structural changes** (time/practitioner): Full refresh with loading state

## Implementation Considerations

1. **Optimistic Updates**: Need to handle rollback on API failure
2. **Loading State Logic**: Distinguish between simple updates (no loading) and structural changes (show loading)
3. **Cache Invalidation**: Still need to invalidate cache for the updated event's date
4. **Error Handling**: Ensure errors are properly displayed even with optimistic updates

## Future Work

This optimization is planned for future implementation to improve the user experience on the calendar page. The patient detail page already demonstrates the desired smooth behavior that should be replicated.

## Related Files

- `frontend/src/components/CalendarView.tsx` - Main calendar component
- `frontend/src/components/calendar/EventModal.tsx` - Event modal with edit functionality
- `frontend/src/components/patient/PatientAppointmentsList.tsx` - Reference implementation with smooth updates
