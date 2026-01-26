# Calendar: Dual FAB Actions on Time Slot Click (+ 預約 / + 休診)

## Summary
Adds a compact dual-FAB menu that appears when clicking a time slot in the calendar. Users can choose to:
- + 預約: Start the create appointment flow (existing behavior), with slot-derived prefill.
- + 休診: Open the 新增休診時段 (availability exception) modal with prefilled date/time and practitioner per view rules.

This also fixes placement issues: FABs stay adjacent to the clicked slot, do not overflow the screen, and remain aligned while scrolling.

## Changes
- frontend/src/components/calendar/CalendarGrid.tsx
  - Added a lightweight slot action menu (two stacked FABs) with consistent gray styling.
  - Anchored FABs to the clicked slot and rendered via a portal into the scrollable viewport for stable scrolling behavior.
  - Implemented clamping/flip logic within the viewport to prevent overflow and shape changes.
  - Preserved keyboard accessibility (Enter/Space directly triggers appointment flow).
- frontend/src/pages/AvailabilityPage.tsx
  - Implemented `handleSlotExceptionClick` with prefill logic:
    - Day view: use clicked column practitioner if present; otherwise current user.
    - Week view: always current user.
  - Wired `onSlotExceptionClick` into `CalendarGrid`.
- frontend/src/components/calendar/__tests__/CalendarGrid.test.tsx
  - Updated tests to reflect the FAB workflow (slot click → select FAB).

## UX Details
- FAB menu placement: 2px to the right of the slot, aligned to the slot’s top, vertically stacked, and non-wrapping.
- Scrolling: FABs move with the grid; relative position to the slot remains fixed during scrolling.
- Edge behavior: Clamps to viewport and flips above the slot if needed.
- Accessibility: Keyboard activation (Enter/Space) still starts the appointment flow without needing the FAB menu.

## Rationale
- Provides clear, discoverable choice between creating an appointment and creating a temporary availability exception.
- Keeps UI compact and avoids obstructing the grid.
- Portal-based rendering simplifies scroll handling versus manual scroll listeners.

## Testing
- Unit tests updated:
  - Click slot → click + 預約 → `onSlotClick` called with practitioner context.
  - Click slot → click + 休診 → `onSlotExceptionClick` called.
- Keyboard navigation tests unaffected; all pass.
- Verified TypeScript checks.
- `./run_tests.sh` passes.

## Risk / Rollout
- Localized to calendar UI; no backend changes.
- Placement logic guarded by clamping/flip to mitigate edge overflows.
- Manual QA suggested:
  - Day view: click multiple practitioners; verify practitioner prefill in + 休診.
  - Week view: verify current user prefill in + 休診.
  - Near right/bottom edges; verify clamping/flip.
  - Scroll behavior on desktop and mobile.

## Follow-ups (Optional)
- Add Escape to close FAB menu and optional `role="menu"/role="menuitem"` for enhanced a11y.
- Minor lint cleanup: remove an unrelated `useMemo` dependency warning noted in CalendarGrid.
- Optional pointer/arrow UI to visually tie the FAB menu to the slot.
