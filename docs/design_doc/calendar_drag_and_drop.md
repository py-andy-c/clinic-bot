# Calendar Drag and Drop - Business Logic & Technical Design

## Overview

This feature enables users to reschedule appointments and availability exceptions by dragging and dropping them within the calendar grid. It aims to improve administrative efficiency by providing a direct manipulation interface for common scheduling tasks.

---

## Key Business Logic

### 1. Permission-Based Dragging
Only users with edit permissions for a specific practitioner's schedule can drag events belonging to that practitioner.
- **Rationale**: Prevent unauthorized changes to schedules.

### 2. View-Specific Behavior

| View | Drag Type | Action on Drop | Constraints |
| :--- | :--- | :--- | :--- |
| **Daily** | Appointment | Open Edit Modal | Can move between times and practitioners. |
| **Daily** | Exception | Update Immediately | Vertical move only (time change). |
| **Weekly** | Both | Same as Daily | Can move between days and times across the week. **No horizontal moves between practitioners.** |
| **Monthly** | None | Disabled | N/A |

### 3. Exception vs Appointment Drop Logic
- **Availability Exceptions**: Dropping an exception updates its start and end times immediately in the database. No confirmation modal is shown to keep it lightweight.
- **Appointments**: Dropping an appointment opens the `EditAppointmentModal` with the new time and practitioner pre-populated. This allows the user to review potential conflicts, adjust other details, or cancel the change.

---

## Technical Design

### State Management Strategy

#### UI State (Zustand or Local State)
We will introduce a `useCalendarDragStore` (or extend local state in `CalendarGrid`) to track:
- `activeDragEvent`: The `CalendarEvent` being dragged.
- `dragPosition`: `{ x, y }` coordinates relative to the calendar grid.
- `dropPreview`: `{ start, end, practitionerId, dayIndex }` snapped to the grid.
- `isScrolling`: Boolean to prevent multiple scroll triggers.

### Component Architecture

#### 1. Drag Sensor Implementation
We will implement custom event handlers in `CalendarEventComponent` and `CalendarGrid`:
- **Desktop**: `mousedown`, `mousemove`, `mouseup`.
- **Mobile**: `touchstart`, `touchmove`, `touchend`.

#### 2. Mobile Interaction Flow (Long Press)
1. `touchstart`: Start a 400ms timer.
2. If `touchmove` exceeds 10px before timer fires, cancel timer (it's a scroll).
3. If timer fires:
   - Provide haptic feedback (`navigator.vibrate(50)`).
   - Set `activeDragEvent`.
   - Show a "drag ghost" that follows the finger.
   - **Lift Effect**: The event will scale up slightly (e.g., `scale(1.05)`) and gain a subtle drop-shadow to indicate it is floating.
   - The ghost will be slightly offset upwards so it's not hidden by the finger.

#### 3. Grid Mapping Logic
Calculate the target slot and practitioner based on coordinates:
- **Daily View**:
  - `targetTime` = `Math.floor(y / SLOT_HEIGHT_PX)` * `SLOT_DURATION_MINUTES`.
  - `targetPractitionerId` = Get practitioner column at `x`.
- **Weekly View**:
  - `targetDay` = `Math.floor(x / COLUMN_WIDTH)`.
  - `targetTime` = same as Daily.

#### 4. Auto-Scrolling
An `IntersectionObserver` or a simple `requestAnimationFrame` loop will check if the `dragPosition` is within a "scroll zone" (e.g., 60px from the edges of `.calendarGridContainer`).
- If in zone, scroll `scrollTop` or `scrollLeft` by a constant increment (e.g., 10px per frame).

#### 5. Layout Reaction During Drag
While an event is being dragged:
- The original event component is hidden or replaced by a subtle "ghost" at its original position.
- Remaining overlapping events in the same time slot will instantly re-calculate their widths (expanding to fill the available space) to provide a reactive and polished feel.

---

## User Interaction Flows

### Flow 1: Move Availability Exception (Daily View)
1. User long-presses (mobile) or clicks (desktop) an exception.
2. User drags it vertically.
3. A preview rectangle shows the new time range snapped to 15-min intervals.
4. User releases.
5. `updateExceptionMutation` is called.
6. Grid UI updates via React Query cache invalidation.

### Flow 2: Reschedule Appointment (Weekly View)
1. User drags an appointment from Tuesday 10:00 AM to Wednesday 11:30 AM.
2. User releases.
3. `EditAppointmentModal` opens with:
   - `date`: Wednesday's date.
   - `start_time`: 11:30 AM.
4. User clicks "Save".

---

## Edge Cases and Error Handling

- **Dragging near edges**: Auto-scroll must be smooth and not cause jitter.
- **Dropping on unavailable slots**: The preview should visually indicate if a slot is "unavailable" (e.g., red tint), though the modal will handle the final validation for appointments.
- **Network Failure**: If the immediate update of an exception fails, revert the optimistic UI update and show a toast error.
- **Resource Events**: "Events under the resource can’t be dragged". We will check `event.resource.is_resource_event` and disable dragging if true.

---

## Open Questions / Future Enhancements

- **Q: Should we support resizing events via dragging?**
  - **A**: The current request only mentions moving (dragging to a different time/practitioner). Resizing (changing duration) is a candidate for future improvement.
- **Q: How to handle multi-column horizontal scrolling on mobile during drag?**
  - **A**: If the calendar container has `overflow-x: auto`, we need to trigger horizontal auto-scroll when near left/right edges.

---

## Implementation Plan

1. **Phase 1**: Add dragging state and basic mouse/touch handlers to `CalendarEventComponent`.
2. **Phase 2**: Implement the "Drop Preview" overlay in `CalendarGrid`.
3. **Phase 3**: Implement auto-scroll logic.
4. **Phase 4**: Hook up drop actions (Mutation for exceptions, Modal for appointments).
5. **Phase 5**: Mobile Polish (Long press, vibration, offset ghost).
