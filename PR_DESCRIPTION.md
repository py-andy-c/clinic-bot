# Add Scroll-to-9AM for Week View

## Issue

The calendar's day view automatically scrolls to 9 AM when opened, but the week view did not have this behavior. Users had to manually scroll down to see appointments later in the day, which was inconsistent with the day view experience.

## Observations

During implementation and testing, we discovered a timing issue:

- **Immediate switch to week view**: If the page is reloaded and the user immediately switches to week view, the scroll to 9 AM works correctly.
- **Delayed switch to week view**: If the page is reloaded, the user waits 2+ seconds, then switches to week view, it would initially scroll to 12 AM instead of 9 AM.

### Root Cause Analysis

The issue was caused by React Big Calendar's `scrollToTime` prop being applied to all views, including week view. When the calendar had time to fully render (after a delay), React Big Calendar's internal scroll logic would execute and override our manual scroll implementation, resetting the scroll position to 12 AM (midnight).

## What We Tried

### Attempt 1: Basic Manual Scroll
- Added a `useEffect` hook to manually scroll the week view container to 9 AM
- Used double `requestAnimationFrame` and a 100ms delay
- **Result**: Worked for immediate switches but failed when there was a delay before switching

### Attempt 2: Increased Delay
- Increased the delay to 300ms to give the calendar more time to render
- **Result**: Still had timing issues with delayed switches

### Attempt 3: Retry Logic
- Added retry logic (up to 30 retries) to wait for time slots to be rendered
- Added validation checks for calendar readiness
- **Result**: More reliable but still had race conditions

### Attempt 4: Disable scrollToTime for Week View (Final Solution)
- **Key insight**: React Big Calendar's `scrollToTime` prop was interfering with our manual scroll
- Changed `scrollToTime={scrollToTime}` to `scrollToTime={view === Views.DAY ? scrollToTime : undefined}`
- Only apply `scrollToTime` to day view, not week view
- Simplified the scroll logic with a 300ms delay and retry mechanism (up to 10 retries)
- **Result**: Works consistently regardless of timing

## Final Solution

### Changes Made

1. **Conditional scrollToTime prop**:
   ```typescript
   scrollToTime={view === Views.DAY ? scrollToTime : undefined}
   ```
   - Only applies React Big Calendar's built-in scroll for day view
   - Prevents interference with manual scroll in week view

2. **Manual scroll implementation for week view**:
   - Added `useEffect` hook that runs when `view === Views.WEEK` or `currentDate` changes
   - Finds the 9 AM time slot label in the time gutter
   - Calculates scroll position accounting for sticky header height
   - Falls back to estimated position if 9 AM label not found
   - Uses double `requestAnimationFrame` + 300ms delay + retry logic

3. **Code simplifications**:
   - Extracted constants (`SCROLL_DELAY_MS`, `HOURS_TO_9AM`, `ESTIMATED_SLOT_HEIGHT_PX`)
   - Removed duplicate header height calculation
   - Simplified loop logic (forEach → for...of with early break)
   - Unified scroll position calculation

### Files Changed

- `frontend/src/components/CalendarView.tsx`
  - Added scroll-to-9AM effect for week view
  - Made `scrollToTime` conditional based on view type
  - Extracted constants and simplified code

## Known Issue / Limitation

⚠️ **Visible delay when switching views**: When switching between week view and other views (day/month), there is a visible delay where the calendar first shows 12 AM, then jumps to 9 AM after ~300ms. This creates a brief "flash" or "jump" effect.

**Why this happens**: The calendar renders at 12 AM (default position), then our scroll logic executes after the delay, causing the jump to 9 AM.

**Question for reviewers**: Do you have any ideas on how to improve this? Potential approaches we've considered:
- Using CSS to hide the calendar until scroll is complete (might cause blank screen)
- Pre-calculating scroll position before render (complex, might not work with React Big Calendar's lifecycle)
- Using a loading state during the scroll transition (might feel slower)
- Reducing the delay (might cause timing issues to return)

## Testing

- ✅ Immediate switch to week view: Scrolls to 9 AM correctly
- ✅ Delayed switch to week view: Scrolls to 9 AM correctly (after 2+ second wait)
- ✅ Switching between views: Works but has visible delay/jump
- ✅ Navigation within week view: Maintains scroll position correctly
- ✅ Mobile view: Works correctly with responsive layout

## Related Commits

- Previous commit: "Fix calendar week view alignment and scrolling issues" - Added week view scrolling container and alignment fixes
- This commit: "Add scroll-to-9am for week view and simplify code" - Added scroll-to-9AM functionality


