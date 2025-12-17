# DateTimePicker State Management and Business Logic

## Overview

This document describes the business logic and state management for the DateTimePicker component, focusing on initial validation, auto-expand behavior, and override mode management.

## Initial State and Validation

### Form Load Behavior

**When opening appointment form (edit, new, duplicate):**
- Try to populate date/time picker with original selection time (edit and duplicate only)
- Original time is only applicable to appointment editing and duplicate flows

**Initial Validation Logic:**
1. If `selectedTime` is empty → Auto-expand immediately (new appointment flow)
2. If `selectedTime` is populated → Wait for slots to load, then validate:
   - Show loading state while slots are loading
   - After slots load, check if `selectedTime` exists in `allTimeSlots`
   - **If valid**: Keep picker collapsed, keep time selected
   - **If invalid**: Expand picker, deselect time, set override mode to `false`

**Validation Criteria:**
- Valid = time exists in available slots returned by slots endpoint
- Do NOT check conflicts during initial validation (only slot existence)
- Slots endpoint already excludes current appointment in edit mode via `exclude_calendar_event_id`

**Error Handling:**
- If slots fail to load (API error, practitioner doesn't offer appointment type):
  - If `selectedTime` exists → Expand picker, deselect time, override mode OFF
  - This ensures user can still select a time

## Auto-Expand Behavior

### When to Auto-Expand

1. **Initial Load:**
   - If `selectedTime` is empty → Auto-expand
   - If `selectedTime` is invalid (not in slots) → Auto-expand

2. **After Initial Validation:**
   - Only trigger when `overrideMode` is OFF
   - Skip if user manually collapsed (respect `userCollapsedRef`)
   - Trigger when:
     - Practitioner changes → time becomes invalid → auto-expand and deselect
     - Appointment type changes → time becomes invalid → auto-expand and deselect
     - Date changes → time becomes invalid → auto-expand and deselect

### When NOT to Auto-Expand

- If `overrideMode` is ON (user intentionally selected invalid time)
- If user manually collapsed picker (respect user intent)
- During initial validation (handled separately)

## Override Mode Management

### State Ownership

- **Parent components** (EditAppointmentModal/CreateAppointmentModal):
  - Do NOT set initial `overrideMode` value (always starts as false)
  - Do NOT pass `isOverrideMode` prop (or pass `undefined`/`false`)
  - Do NOT try to control override mode after initial load

- **DateTimePicker**:
  - Always starts with `overrideMode = false` on mount (ignores `isOverrideMode` prop if provided)
  - Manages override mode internally after mount
  - Calls `onOverrideChange` callback when override mode changes (for parent tracking)

### Override Mode Behavior

**On Form Load:**
- Always start with `overrideMode = false` (never enabled on initial load)
- Parent components should never set initial override mode via `isOverrideMode` prop
- If time is invalid, expand and deselect (override mode remains false)

**After Form Load:**
- User can toggle override mode on/off
- If user enables override mode with valid time selected → Immediately check conflicts for that time
- Override mode persists across re-renders (internal state)
- **Override mode resets to OFF when slot candidates change:**
  - Practitioner changes → Reset override mode to OFF
  - Appointment type changes → Reset override mode to OFF
  - Date changes → Reset override mode to OFF
- This ensures user starts fresh with new slot candidates rather than staying in override mode

**When Override Mode is Enabled:**
- Switch to free-form time input
- Real-time conflict detection (debounced 300ms)
- Show conflict warnings with full details

## Conflict Detection

### When Conflicts Are Checked

1. **Initial Validation:** NO conflict checks (only slot existence check)
2. **Override Mode Enabled:** Real-time conflict detection as user types/selects time
3. **Manual Time Selection in Override Mode:** Trigger conflict check

### Conflict Check Details

- Uses `/availability/conflicts` endpoint
- Includes `exclude_calendar_event_id` in edit mode (backend handles exclusion)
- Returns detailed conflict information (appointment conflicts, exception conflicts, availability conflicts)
- Shows highest priority conflict only

## State Management Summary

### DateTimePicker Internal State

```typescript
const [overrideMode, setOverrideMode] = useState(false);
const [isExpanded, setIsExpanded] = useState(false);
const hasCompletedInitialValidationRef = useRef(false);
const userCollapsedRef = useRef(false);
```

### State Flow

1. **Mount:**
   - Initialize `overrideMode = false` (always, regardless of parent prop)
   - If `selectedTime` empty → Set `isExpanded = true`
   - If `selectedTime` exists → Wait for slots, then validate

2. **After Slots Load:**
   - If `selectedTime` in slots → Keep collapsed
   - If `selectedTime` not in slots → Expand, deselect, `overrideMode = false`
   - Set `hasCompletedInitialValidationRef.current = true`

3. **User Interactions:**
   - Toggle override mode → Update internal state, call `onOverrideChange`
   - Change practitioner/type/date → Reset override mode to OFF, check if time invalid, auto-expand if needed
   - Manual collapse → Set `userCollapsedRef.current = true`

## Edge Cases

### Edit Mode: Appointment Scheduled with Override

- When loading slots with `exclude_calendar_event_id`, backend should include current appointment's time in available slots
- If time doesn't appear in slots → Treat as invalid, expand and deselect
- Backend handles this via `exclude_calendar_event_id` parameter

### Duplicate Flow

- Duplicate flow will have conflict with original appointment
- Behavior same as invalid time: expand and deselect

### Re-renders

- Override mode state persists across re-renders (internal state)
- Override mode resets to OFF when slot candidates change (practitioner/appointment type/date)

