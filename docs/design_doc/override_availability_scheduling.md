# Override Availability Scheduling Design

## Overview

Allow clinic users (admins and practitioners) to schedule appointments at any time, regardless of practitioner default availability or availability exceptions. This provides flexibility for urgent appointments, special arrangements, or administrative overrides.

## Goals

1. **Flexibility**: Enable scheduling outside normal business hours
2. **Transparency**: Clearly indicate when scheduling outside normal availability
3. **Simplicity**: Simplified frontend logic - no complex skip conditions or per-occurrence override tracking
4. **Consistency**: Maintain existing UI patterns where possible

## User Experience Flow

### DateTimePicker Behavior

**Default Mode (Override Toggle OFF)**:
- Shows only available time slots within practitioner's default availability
- Dates without availability are disabled
- Time dropdown shows filtered slots only

**Override Mode (Toggle ON)**:
- All dates become selectable (even if no normal availability)
- Time selection changes to **free-form time input** (12-hour format: H:MM AM/PM or 24-hour: HH:MM)
- Allows any time selection regardless of availability
- Real-time conflict detection and display (see Conflict Display section)

**Override Toggle**:
- Checkbox labeled "允許預約在非可用時間" (Allow scheduling outside availability)
- Located below date/time selection area
- Amber/orange accent when active
- Default: OFF

### Conflict Detection and Display

**Conflict Detection Priority** (checked in order, show highest priority conflict):
1. **Past Appointment** (Highest Priority) - Warning style
2. **Appointment Conflict** - Red/Error style
3. **Availability Exception Conflict** (Medium Priority) - Orange/Warning style
4. **Outside Default Availability** (Lowest Priority) - Blue/Info style

**When Conflicts Are Detected**:
- **DateTimePicker (Time Selection)**: Show conflict warning with full details below time input
  - Real-time updates as user types/selects time (debounced 300ms)
  - Full conflict details always visible
  - Color-coded border around time input based on conflict type
- **Conflict Resolution Step**: Show warning icon (⚠️) next to conflicting occurrences
  - Click icon to show conflict details in popover
  - Conflict status updates immediately when editing occurrences
- **Review/Confirmation Step**: Show warning icon (⚠️) next to conflicting occurrences
  - Click icon to show conflict details in popover (same component as conflict resolution)

**Conflict Display Format** (same format in all contexts):

**1. Past Appointment**:
```
⚠️ 此預約時間在過去
```

**2. Appointment Conflict**:
```
⚠️ 時間衝突：與現有預約重疊
   病患：張三
   預約時間：2024-01-15 14:00-14:30
   預約類型：物理治療
```

**3. Availability Exception Conflict**:
```
⚠️ 與治療師不可用時間衝突
   不可用時間：2024-01-15 14:00-16:00
   原因：個人請假
```

**4. Outside Default Availability**:
```
ℹ️ 非正常可用時間
   正常可用時間：週一 09:00-18:00
```

**Visual Indicators**:
- **Warning Icon (⚠️)**: Used for all conflict types (not red marking)
- **Popover**: Shows full conflict details when icon is clicked
- **Color-coded borders**: Red (appointment) > Orange (exception) > Blue (availability) - only in DateTimePicker
- Only show ONE conflict message at a time (highest priority)

### Recurring Appointments Flow

**Step 1: Time Selection (First Occurrence)**
- User selects date/time for first occurrence in DateTimePicker
- Override mode toggle available (same as single appointment)
- If override mode ON: Free-form time input, real-time conflict detection
- If override mode OFF: Dropdown with filtered slots only
- Conflict display shows conflicts for first occurrence only at this stage

**Step 2: Recurrence Pattern Selection**
- User selects recurrence pattern (weekly) and count
- System generates all occurrence dates/times based on first occurrence
- **All occurrences are included** (including past dates - not filtered out)
- System checks conflicts for all generated occurrences (including past appointment detection)

**Step 3: Conflict Resolution (if any conflicts exist)**
- **Always shown if any occurrence has conflict** (including first occurrence)
- Shows list of **all occurrences** (including past ones - not filtered out)
- Each conflicting occurrence shows warning icon (⚠️)
- Click icon to show conflict details in popover
- User can:
  - **Keep conflict slots unchanged** → Proceed with conflicts (override implicit for clinic users)
  - **Edit occurrence** → Use DateTimePicker to select non-conflict slot
  - **Edit with override mode** → Use DateTimePicker with override toggle ON to select any time
- When editing occurrence:
  - Time starts unselected, override toggle starts OFF
  - Real-time conflict detection as user selects time
  - Conflict status updates immediately when conflict is resolved or new conflict appears
- "下一步" button always enabled (simplified logic - just check if occurrences exist)

**Step 4: Review/Confirmation**
- Shows **all occurrences** (including past ones - not filtered out)
- Conflicting occurrences show warning icon (⚠️)
- Click icon to show conflict details in popover (same component as conflict resolution)
- "確認建立" button allows proceeding with conflicts (including past appointments)

### Single Appointment Flow

**Time Selection**:
- Same DateTimePicker behavior as recurring appointments
- Real-time conflict detection and display

**Confirmation Step**:
- Shows standard appointment confirmation details
- If conflict exists, shows warning icon (⚠️) next to date/time
- Click icon to show conflict details in popover
- "確認建立" button allows proceeding with conflicts

### Edit Appointment Flow

**In EditAppointmentModal**:
- If editing appointment scheduled outside normal hours:
  - Override toggle pre-enabled
  - Shows conflict indicators if user changes time
- If editing appointment in normal hours:
  - Override toggle available but OFF by default
  - User can enable to move outside normal hours
- Confirmation step: Shows conflict indicators same as create flow

## Simplified Frontend Logic

### Key Simplifications

1. **No Skip Logic**: Conflict resolution always shown if any conflicts exist (simpler than conditional skip)
2. **No Per-Occurrence Override Tracking**: Override is implicit for clinic users - they can proceed with conflicts
3. **Unified Conflict Display**: Same warning icon + popover pattern in all contexts
4. **Immediate Status Updates**: Conflict status updates immediately when editing (no need to wait for confirmation)
5. **Always Enabled Proceed Button**: "下一步" and "確認建立" always enabled (users can proceed with conflicts)

### State Management

- Override mode state managed in DateTimePicker (local state)
- Conflict info stored per occurrence in conflict resolution step
- No need to track per-occurrence override states (override implicit for clinic users)
- Conflict info cached per (date, time, practitioner) combination

## Edge Cases

### No Default Availability
- If practitioner has no default availability set:
  - Override mode should be enabled by default
  - Show message: "此治療師尚未設定可用時間，請手動選擇時間"
  - All times available for selection

### Conflict Detection Timing
- Check conflicts in real-time as user types/selects time
- Debounce conflict checks (300ms) to avoid excessive API calls
- Show loading state while checking conflicts
- Cache conflict results for recently checked times

### Past Dates/Times
- **Clinic users can schedule appointments in the past** (with warning)
- Past appointments are detected and shown as highest priority conflict type
- Past appointments are **not filtered out** on conflict resolution or review pages
- Backend returns `conflict_type: "past_appointment"` for appointments scheduled before current Taiwan time
- Patient bookings (non-clinic users) are still prevented from scheduling in the past

### Invalid Time Format
- If user enters invalid time format:
  - Show validation error: "請輸入有效的時間格式 (H:MM AM/PM 或 HH:MM)"
  - Don't trigger conflict detection until valid time entered
  - Clear conflict display on invalid input

### Conflict Detection API Failure
- If conflict detection API fails:
  - Show error message: "無法檢查時間衝突，請稍後再試"
  - Allow user to proceed (override mode still works)
  - Log error for debugging
  - Don't block appointment creation

### Field Changes After Time Selection
- **Toggling Override Mode OFF**: Clear selected time if outside normal availability, switch to dropdown, clear conflict display
- **Toggling Override Mode ON**: Keep selected time if valid, switch to free-form input, trigger conflict detection
- **Appointment Type Change**: Re-check conflicts (duration may have changed), keep selected time, update conflict display
- **Practitioner Change**: Clear selected time, reset override mode to OFF, clear conflict display
- **Date Change**: Keep selected time if valid, re-check conflicts for new date, update conflict display

### Editing Existing Appointment
- When editing, exclude current appointment from conflict detection
- Use `exclude_calendar_event_id` parameter in conflict API
- If editing moves appointment to conflict with itself, don't show conflict

## UI Components

### DateTimePicker

**Props**:
- `allowOverride?: boolean` - Enable override mode toggle
- `onOverrideChange?: (enabled: boolean) => void` - Callback when toggle changes
- `isOverrideMode?: boolean` - Current override state (for edit mode)

**State**:
- `overrideMode: boolean` - Whether override is enabled
- `freeFormTime: string` - Free-form time input value
- `conflictInfo: ConflictInfo | null` - Detected conflict details
- `isCheckingConflict: boolean` - Loading state for conflict detection

**UI Elements**:
- Override toggle checkbox
- Free-form time input (when override enabled)
- Conflict display area with full details (time selection)
- Real-time conflict detection

### ConflictIndicator Component

**Usage**: Used in conflict resolution step and review/confirmation step

**Props**:
- `conflictInfo: ConflictInfo` - Conflict details to display
- `compact?: boolean` - Compact mode (just icon, details in popover)

**Behavior**:
- Shows warning icon (⚠️)
- Click icon to show conflict details in popover
- Popover shows same format as DateTimePicker conflict display

### CreateAppointmentModal

**Conflict Resolution Step**:
- Shows list of all occurrences
- Conflicting occurrences show ConflictIndicator component
- User can edit occurrences using DateTimePicker
- "下一步" button always enabled

**Review/Confirmation Step**:
- Shows all occurrences
- Conflicting occurrences show ConflictIndicator component
- Same popover component as conflict resolution

## Technical Implementation

### Backend

**Conflict Detection Endpoint**:
```
GET /clinic/practitioners/{practitioner_id}/availability/conflicts
Query params:
  - date: YYYY-MM-DD
  - start_time: HH:MM
  - appointment_type_id: int
  - exclude_calendar_event_id?: int (for edit mode)
```

**Response Structure**:
```json
{
  "has_conflict": boolean,
  "conflict_type": "past_appointment" | "appointment" | "exception" | "availability" | null,
  "appointment_conflict": {
    "appointment_id": int,
    "patient_name": string,
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "appointment_type": string
  } | null,
  "exception_conflict": {
    "exception_id": int,
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "reason": string | null
  } | null,
  "default_availability": {
    "is_within_hours": boolean,
    "normal_hours": "週一 09:00-18:00" | null
  }
}
```

**Implementation Notes**:
- Backend accepts any time for clinic-created appointments (override is frontend-only concept)
- Backend detects past appointments by comparing scheduled datetime with current Taiwan time
- Past appointment detection only applies to clinic users (not patient bookings)
- Conflict detection includes scheduling buffer in calculations
- Reuse existing conflict checking logic
- Past appointment has highest priority in conflict detection

### Frontend

**API Service**:
```typescript
async checkSchedulingConflicts(
  practitioner_id: number,
  date: string,
  start_time: string,
  appointment_type_id: number,
  exclude_calendar_event_id?: number
): Promise<SchedulingConflictResponse>
```

**Conflict Detection**:
- Real-time detection with 300ms debounce
- Show loading state while checking
- Cache results per (date, time, practitioner) combination
- Update conflict status immediately when editing occurrences

**State Management**:
- Override mode: Local state in DateTimePicker
- Conflict info: Stored per occurrence in conflict resolution step
- No per-occurrence override state tracking needed (override implicit)

## User Permissions

**Who can use override mode**:
- Clinic admins: ✅ Always available
- Practitioners: ✅ Always available  
- Read-only users: ❌ Not available (cannot create appointments anyway)

## Success Criteria

1. ✅ Clinic users can schedule appointments at any time
2. ✅ Override mode is clearly indicated and easy to enable
3. ✅ Users understand conflict reasons with clear priority-based messaging
4. ✅ Simplified frontend logic (no complex skip conditions)
5. ✅ Users can proceed with conflicts (override implicit)
6. ✅ Consistent conflict display across all contexts
7. ✅ Real-time conflict feedback as user selects time
8. ✅ Existing normal scheduling flow remains unchanged
