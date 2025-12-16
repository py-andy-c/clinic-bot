# Override Availability Scheduling Design

## Overview

Allow clinic users (admins and practitioners) to schedule appointments at any time, regardless of practitioner default availability or availability exceptions. This provides flexibility for urgent appointments, special arrangements, or administrative overrides.

## Goals

1. **Flexibility**: Enable scheduling outside normal business hours
2. **Transparency**: Clearly indicate when scheduling outside normal availability
3. **Safety**: Prevent accidental overrides while maintaining ease of use
4. **Consistency**: Maintain existing UI patterns where possible

## User Experience Flow

### Current Behavior
- DateTimePicker only shows time slots within practitioner's default availability
- Dates with no availability are disabled
- Users cannot select times outside availability windows

### Proposed Behavior

#### 1. Availability Override Toggle

**Location**: DateTimePicker component, below the date/time selection area

**UI Element**: 
- Checkbox or toggle switch labeled "允許預約在非可用時間" (Allow scheduling outside availability)
- Optional: Info icon with tooltip explaining this bypasses normal availability rules

**Behavior**:
- When **OFF** (default): Current behavior - only show available slots within normal hours
- When **ON**: Enable free-form time selection for any date/time

#### 2. Time Selection Modes

**Mode 1: Normal Availability (Toggle OFF)**
- Shows only available time slots (current behavior)
- Dates without availability are disabled
- Time dropdown shows filtered slots only

**Mode 2: Override Mode (Toggle ON)**
- All dates become selectable (even if no normal availability)
- Time selection changes to **free-form time input** (HH:MM format)
  - Text input field with time picker or manual entry
  - Validates HH:MM format (00:00-23:59)
  - Allows any time selection regardless of availability
- Real-time conflict detection and display (see Conflict Visibility section)

#### 3. Conflict Visibility and Visual Indicators

**When to Show Conflicts**: 
- **Time Selection**: Show conflicts immediately when time is selected (in DateTimePicker) with full details
- **Confirmation Step**: Show simple conflict indicators (icon/status) that expand to show details on click
  - Single appointments: One indicator if conflict exists
  - Recurring appointments: One indicator per conflicting occurrence
- **Conflict Resolution Step** (Recurring only): Show full conflict details for all occurrences
  - **Skip conflict resolution** if: First occurrence has conflict (override ON) AND all future occurrences have no conflicts
  - **Show conflict resolution** if: Any future occurrence has conflicts OR first occurrence has conflict (override OFF)

**Conflict Detection Priority** (checked in order, show highest priority conflict):
1. **Appointment Conflict** (Highest Priority)
2. **Availability Exception Conflict** (Medium Priority)
3. **Outside Default Availability** (Lowest Priority)

**When Override Mode is Active**:
- **Toggle/Checkbox**: Highlighted or colored differently (e.g., amber/orange)
- **Conflict Display Area** (Time Selection): Show below or next to time input
  - Real-time updates as user types/selects time
  - Clear visual hierarchy based on conflict type
  - Always show the highest priority conflict if multiple exist
  - Full details always visible
- **Conflict Indicators** (Confirmation Step): Simple icon/status badge
  - Collapsed by default, expand on click to show full details
  - Same conflict details format as time selection

**Conflict Display Details**:

**1. Appointment Conflict (Priority 1 - Red/Error Style)**:
```
⚠️ 時間衝突：與現有預約重疊
   病患：張三
   預約時間：2024-01-15 14:00-14:30
   預約類型：物理治療
```
- Red border around time input
- Error icon (⚠️ or 🚫)
- Show conflicting appointment details:
  - Patient name
  - Appointment time range
  - Appointment type
- Still allow scheduling (override mode)

**2. Availability Exception Conflict (Priority 2 - Orange/Warning Style)**:
```
⚠️ 與治療師不可用時間衝突
   不可用時間：2024-01-15 14:00-16:00
   原因：個人請假
```
- Orange/amber border around time input
- Warning icon (⚠️)
- Show exception details:
  - Time range of exception
  - Exception reason/description (if available)
- Still allow scheduling (override mode)

**3. Outside Default Availability (Priority 3 - Info Style)**:
```
ℹ️ 非正常可用時間
   正常可用時間：週一 09:00-18:00
```
- Blue/gray border around time input
- Info icon (ℹ️)
- Show practitioner's default availability hours for that day
- Subtle visual indicator (less prominent than conflicts)

**Visual Hierarchy**:
- Only show ONE conflict message at a time (highest priority)
- If appointment conflict exists, don't show exception or availability warnings
- If exception conflict exists (no appointment conflict), don't show availability warning
- Color intensity: Red (appointment) > Orange (exception) > Blue (availability)

#### 4. Confirmation Step

**In CreateAppointmentModal confirmation step**:
- Show standard appointment confirmation details:
  - Patient name
  - Appointment type
  - Practitioner
  - Date and time
  - Clinic notes (if any)

**Conflict Indicators**:
- **Single Appointments**: If conflict exists, show simple indicator (⚠️ icon or status badge) next to date/time
  - Click to expand and show conflict details (same format as time selection)
  - Collapsed by default
- **Recurring Appointments**: Show indicator for each conflicting occurrence
  - Each occurrence row shows indicator if it has a conflict
  - Click indicator to expand details for that specific occurrence
  - Indicators collapsed by default
- **Visual**: Small, non-intrusive indicators that don't block the confirmation view
- "確認建立" button remains same (no additional confirmation needed)

#### 5. Edit Appointment Flow

**In EditAppointmentModal**:
- If editing an appointment scheduled outside normal hours:
  - Show same override toggle (pre-enabled)
  - Show same conflict indicators during time selection (if user changes time)
  - Allow changing to normal hours (toggle off) or keeping override
- If editing an appointment in normal hours:
  - Toggle available but off by default
  - User can enable to move outside normal hours
- **Confirmation step**: Show conflict indicators same as create flow (if conflicts exist)

## UI Components

### DateTimePicker Updates

**New Props**:
- `allowOverride?: boolean` - Enable override mode toggle
- `onOverrideChange?: (enabled: boolean) => void` - Callback when toggle changes
- `isOverrideMode?: boolean` - Current override state

**New State**:
- `overrideMode: boolean` - Whether override is enabled
- `conflictInfo: ConflictInfo | null` - Detected conflict details
  ```typescript
  type ConflictInfo = 
    | { type: 'appointment', appointment: AppointmentDetails }
    | { type: 'exception', exception: ExceptionDetails }
    | { type: 'availability', normalHours: string }
  ```

**New UI Elements**:
- Override toggle checkbox/switch
- Free-form time input (when override enabled)
- Conflict display area with dynamic messages (time selection)
- Conflict indicators with expandable details (confirmation step)
- Real-time conflict detection and display

### CreateAppointmentModal Updates

**Confirmation Step**:
- Add conflict indicators (icon/status) next to date/time or occurrence rows
- Indicators are clickable to expand/collapse conflict details
- For recurring appointments: Show indicator per conflicting occurrence
- Keep existing appointment details display
- Indicators collapsed by default, expand on click

## Edge Cases

### No Default Availability
- If practitioner has no default availability set:
  - Override mode should be enabled by default
  - Show message: "此治療師尚未設定可用時間，請手動選擇時間"
  - All times available for selection
  - No conflict warnings shown (no default hours to compare against)

### All Times Outside Default Availability
- If user selects date with no default availability:
  - Override mode automatically suggested (but not auto-enabled)
  - Show message: "此日期無正常可用時間，請啟用覆蓋模式以預約"
  - Once override enabled, show Priority 3 info (outside default availability)

### Multiple Conflicts
- If selected time has multiple conflicts (e.g., appointment + exception, or multiple appointments):
  - Show only the highest priority conflict (appointment conflict takes priority)
  - If multiple appointments conflict: Show one with count indicator (e.g., "⚠️ 時間衝突：與 2 個現有預約重疊")
  - User can still schedule (override mode)
  - Backend will handle the actual conflict resolution

### Conflict Detection Timing
- Check conflicts in real-time as user types/selects time
- Debounce conflict checks (e.g., 300ms) to avoid excessive API calls
- Show loading state while checking conflicts
- Cache conflict results for recently checked times

### Past Dates/Times
- Override mode does NOT bypass past date/time validation
- Still prevent scheduling in the past (same as current behavior)

### Appointment Duration Spanning Conflicts
- Conflict detection must check the full appointment duration (start_time to end_time)
- If appointment spans multiple conflict types (e.g., starts in exception, ends in appointment):
  - Show highest priority conflict (appointment conflict)
  - Backend calculates end_time = start_time + duration_minutes + scheduling_buffer_minutes

### Invalid Time Format
- If user enters invalid time format (e.g., "25:00", "abc"):
  - Show validation error: "請輸入有效的時間格式 (HH:MM)"
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

### Recurring Appointments

**Override Mode Behavior**:
- Override mode is **per-occurrence** (not series-wide)
- Each occurrence can independently use override mode or normal mode
- First occurrence's override mode is set during initial time selection
- Later occurrences can individually enable override mode in conflict resolution step
- Override mode for an occurrence allows scheduling that specific occurrence outside normal availability

**User Experience Flow**:

**Step 1: Time Selection (First Occurrence)**
- User selects date/time for first occurrence in DateTimePicker
- Override mode toggle is available (same as single appointment)
- If override mode ON: Free-form time input, real-time conflict detection for first occurrence
- If override mode OFF: Dropdown with filtered slots only
- Conflict display shows conflicts for the **first occurrence only** at this stage
- Override mode state for first occurrence is saved

**Step 2: Recurrence Pattern Selection**
- User selects recurrence pattern (daily, weekly, etc.) and count
- System generates all occurrence dates/times based on first occurrence
- Each generated occurrence initially inherits the override mode state from first occurrence
- System checks conflicts for all generated occurrences

**Step 3: Conflict Resolution (conditional)**
- **Skip conflict resolution if**: First occurrence has conflict (override ON) AND all future occurrences have no conflicts
  - User proceeds directly to confirmation
  - First occurrence will be created with override (despite conflict)
  - All other occurrences are conflict-free
- **Show conflict resolution if**: Any future occurrence has conflicts OR first occurrence has conflict (override OFF)
  - Shows conflict resolution table with all occurrences
  - Each occurrence shows its individual conflict status and override mode state
  - User can:
    - Enable override mode for specific conflicting occurrences (per-occurrence toggle)
    - Reschedule individual occurrences
    - Proceed with all (override mode allows creating despite conflicts)

**Scenario Details**:

**Scenario 1: First appointment has conflict (override ON), others don't**
- **Time Selection**: Shows conflict warning for first occurrence (e.g., "⚠️ 時間衝突：與現有預約重疊")
- **After Recurrence Generation**: System checks all occurrences
- **Conflict Resolution Step**: **SKIPPED** (first has conflict with override ON, all others conflict-free)
  - User proceeds directly to confirmation
- **Confirmation Step**: 
  - First occurrence shows conflict indicator (⚠️) - click to expand details
  - Other occurrences show no indicators (conflict-free)
  - First occurrence will be created with override (despite conflict)
  - All other occurrences are conflict-free and will be created normally

**Scenario 2: First appointment has conflict (override ON), some others also have conflicts**
- **Time Selection**: Shows conflict warning for first occurrence
- **After Recurrence Generation**: System checks all occurrences, finds additional conflicts
- **Conflict Resolution Step**: **SHOWN**
  - First occurrence marked with conflict (red indicator, override mode ON)
  - Some other occurrences also marked with conflicts (e.g., occurrences 3, 5, 7)
  - Each conflicting occurrence shows its specific conflict details
  - User can enable override mode for specific occurrences or reschedule
- **Confirmation Step**:
  - First occurrence shows conflict indicator (⚠️) - click to expand details
  - Occurrences 3, 5, 7 also show conflict indicators - each clickable for details
  - Other occurrences show no indicators
- **Summary**: "共 X 個預約有衝突" shown in conflict resolution step

**Scenario 3: First appointment has no conflict (override ON), others don't**
- **Time Selection**: No conflict warning shown (first occurrence is within normal hours or outside but no conflicts)
- **After Recurrence Generation**: All occurrences checked, no conflicts found
- **Conflict Resolution Step**: **SKIPPED** (no conflicts exist)
- **Confirmation Step**: No conflict indicators shown (all occurrences conflict-free)

**Scenario 4: First appointment has no conflict (override OFF), others don't**
- **Time Selection**: No conflict warning (first occurrence is within normal availability)
- **Recurrence Generation**: All occurrences generated within normal availability slots
- **Conflict Resolution Step**: **SKIPPED** (no conflicts exist)
- **Confirmation Step**: No conflict indicators shown (all occurrences conflict-free)

**Scenario 5: First appointment has no conflict (override OFF), some later occurrences have conflicts**
- **Time Selection**: No conflict warning (first occurrence is within normal availability)
- **After Recurrence Generation**: System checks all occurrences, finds conflicts in later occurrences
- **Conflict Resolution Step**: **SHOWN**
  - First occurrence shows no conflict (normal mode)
  - Some later occurrences marked with conflicts (e.g., occurrences 3, 5, 7)
  - User can enable override mode for specific occurrences or reschedule
- **Confirmation Step**:
  - First occurrence shows no indicator (conflict-free)
  - Occurrences 3, 5, 7 show conflict indicators (⚠️) - each clickable for details
  - Other occurrences show no indicators

**Key Points**:
- Override mode is per-occurrence (each can independently use override)
- Conflict detection is per-occurrence
- Conflict resolution skipped if: First has conflict (override ON) AND all others conflict-free
- User can enable override mode for specific occurrences in conflict resolution step
- Override mode allows creating appointments despite conflicts

### Timezone Handling
- All times in Taiwan timezone (Asia/Taipei)
- Conflict detection uses same timezone as existing appointments
- Free-form input accepts local time, converts to Taiwan timezone

### Scheduling Buffer
- Backend includes `scheduling_buffer_minutes` in conflict detection
- Frontend conflict display shows actual appointment time (without buffer)
- Buffer is internal calculation only

## Design Decisions

1. **Multiple Conflicting Appointments**: Show one with count indicator (e.g., "與 2 個現有預約重疊")
2. **Recurring Appointments**: Override mode is per-occurrence (allows mixing normal and override modes)
3. **Override Mode Persistence**: Reset to OFF on modal open (safer default)
4. **Conflict Details**: Show time range + reason/description (if available) for exceptions
5. **Performance**: Debounce 300ms, cache results, limit to 10 checks/second max

## User Permissions

**Who can use override mode**:
- Clinic admins: ✅ Always available
- Practitioners: ✅ Always available  
- Read-only users: ❌ Not available (cannot create appointments anyway)

## Visual Design

- **Toggle**: Amber/orange accent when active
- **Conflict Indicators**: 
  - Time selection: Full details always visible
  - Confirmation: Collapsed by default, expand on click
  - Priority-based styling: Red (appointment) > Orange (exception) > Blue (availability)
- **Consistency**: Match existing warning/info patterns in the app

## Technical Implementation

### Backend Implementation

**New Conflict Detection Endpoint**:
```python
GET /clinic/practitioners/{practitioner_id}/availability/conflicts
Query params:
  - date: YYYY-MM-DD
  - start_time: HH:MM
  - appointment_type_id: int (for duration calculation)
  - exclude_calendar_event_id?: int (for edit mode)
```

**Response Structure**:
```python
{
  "has_conflict": bool,
  "conflict_type": "appointment" | "exception" | "availability" | null,
  "appointment_conflict": {
    "appointment_id": int,
    "patient_name": str,
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "appointment_type": str
  } | null,
  "exception_conflict": {
    "exception_id": int,
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "reason": str | null
  } | null,
  "default_availability": {
    "is_within_hours": bool,
    "normal_hours": "週一 09:00-18:00" | null
  }
}
```

**Implementation Logic**:
1. Calculate appointment end_time = start_time + duration_minutes + scheduling_buffer_minutes
2. Check conflicts in priority order:
   - Query confirmed appointments overlapping time range
   - Query availability exceptions overlapping time range
   - Check if time falls within default availability intervals
3. Return highest priority conflict found
4. Reuse existing `_check_appointment_conflicts()` and availability checking logic

**Service Method**:
```python
@staticmethod
def check_scheduling_conflicts(
    db: Session,
    practitioner_id: int,
    date: date,
    start_time: time,
    appointment_type_id: int,
    clinic_id: int,
    exclude_calendar_event_id: Optional[int] = None
) -> Dict[str, Any]:
    # Calculate end time with duration + buffer
    # Check appointments, exceptions, default availability
    # Return structured conflict data
```

### Frontend Implementation

**DateTimePicker Component Changes**:

1. **New State**:
```typescript
const [overrideMode, setOverrideMode] = useState(false);
const [freeFormTime, setFreeFormTime] = useState('');
const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
const [isCheckingConflict, setIsCheckingConflict] = useState(false);
```

2. **Time Input Component**:
```typescript
// When override mode ON, replace dropdown with:
<TimeInput
  value={freeFormTime}
  onChange={handleTimeInputChange}
  format="HH:mm"
  validation={validateTimeFormat}
  error={timeFormatError}
/>
```

3. **Conflict Detection Hook**:
```typescript
const checkConflicts = useCallback(
  debounce(async (date: string, time: string, appointmentTypeId: number) => {
    if (!time || !isValidTimeFormat(time)) return;
    
    setIsCheckingConflict(true);
    try {
      const response = await apiService.checkSchedulingConflicts({
        practitioner_id: selectedPractitionerId,
        date,
        start_time: time,
        appointment_type_id: appointmentTypeId,
        exclude_calendar_event_id: excludeCalendarEventId
      });
      setConflictInfo(parseConflictResponse(response));
    } catch (error) {
      // Show error but don't block
      logger.error('Conflict check failed:', error);
    } finally {
      setIsCheckingConflict(false);
    }
  }, 300),
  [selectedPractitionerId, appointmentTypeId, excludeCalendarEventId]
);
```

4. **Conflict Display Component**:
```typescript
<ConflictDisplay
  conflictInfo={conflictInfo}
  isLoading={isCheckingConflict}
  priority={getConflictPriority(conflictInfo)}
/>
```

**API Service Method**:
```typescript
async checkSchedulingConflicts(params: {
  practitioner_id: number;
  date: string;
  start_time: string;
  appointment_type_id: number;
  exclude_calendar_event_id?: number;
}): Promise<ConflictResponse> {
  // Call backend endpoint
  // Return structured conflict data
}
```

**State Management**:
- Override mode state managed in DateTimePicker (local state) for first occurrence
- For recurring appointments: Override mode state stored per-occurrence in conflict resolution step
- Conflict info cleared when override mode toggled OFF
- Conflict info cached per (date, time, practitioner) combination
- Per-occurrence override states stored in conflict resolution table state

### Integration Points

**CreateAppointmentModal**:
- Pass `allowOverride={true}` to DateTimePicker
- Handle override mode state for first occurrence (optional, can be internal to DateTimePicker)
- For recurring appointments: Store per-occurrence override states in conflict resolution step
- Skip conflict resolution step if conditions met (first has conflict with override ON, all others conflict-free)
- Add conflict indicators to confirmation step (collapsed by default)

**EditAppointmentModal**:
- Pass `allowOverride={true}` and `excludeCalendarEventId={appointmentId}`
- Pre-enable override if appointment outside default hours
- Same conflict detection flow

**Existing Availability Service**:
- Reuse `fetch_practitioner_schedule_data()` for efficiency
- Extend conflict checking logic, don't replace
- Maintain backward compatibility with existing endpoints

## Implementation Notes

- **Backend**: Override is frontend-only concept; backend accepts any time for clinic-created appointments
- **Frontend**: Add conflict indicators to confirmation step (both single and recurring appointments)
- **Performance**: Debounce conflict checks, cache results, show loading states
- **Reuse**: Leverage existing conflict checking logic and availability services

## Success Criteria

1. ✅ Clinic users can schedule appointments at any time
2. ✅ Override mode is clearly indicated and easy to enable
3. ✅ Users understand conflict reasons with clear priority-based messaging
4. ✅ Appointment conflicts are most visible (highest priority)
5. ✅ Users can see which appointment conflicts (if any)
6. ✅ No confusion between normal and override scheduling
7. ✅ Existing normal scheduling flow remains unchanged
8. ✅ Real-time conflict feedback as user selects time

