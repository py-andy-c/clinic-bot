# Recurring Appointments Design

## Overview

Enable clinic users to create recurring weekly appointments for patients, with conflict detection and resolution to prevent overlapping appointments.

## Goals

1. **Simple UX**: Weekly recurrence pattern only - "每 x 週, 共 y 次"
2. **Conflict Prevention**: Detect and handle conflicts before creating appointments
3. **Flexible Resolution**: Allow users to delete conflicts or reschedule individual occurrences
4. **Clear Feedback**: Show preview table with conflict status and resolution options
5. **Code Reuse**: Reuse existing date/time picker and other components

## Proposed UX Flow

### 1. Recurrence Toggle

Add a "重複" (Repeat) toggle/checkbox in `CreateAppointmentModal`:
- Default: OFF (single appointment)
- When ON: Show recurrence pattern inputs

**Location**: Below date/time picker, above clinic notes

### 2. Recurrence Pattern Selection

**Simple Weekly Pattern**:
- Input fields: "每 [x] 週, 共 [y] 次"
  - `x` (weeks): Number input, defaults to 1, minimum 1
  - `y` (occurrences): Number input, required, minimum 1, maximum 50 (reduced for better UX and performance)
- Example: "每 1 週, 共 5 次" = Every week, 5 times
- Example: "每 2 週, 共 3 次" = Every 2 weeks, 3 times

**Pattern Display**:
- Always show: "每 x 週, 共 y 次" (the original pattern inputs)
- Pattern display does not change when user returns from conflict resolution page
- User can modify x and y values at any time
- If user changes x or y, conflicts will be recalculated on next "下一步" click

### 3. Conflict Detection & Preview

**When to Trigger Conflict Detection**:

**Decision**: Trigger on "下一步" click from form page.

**Flow**:
1. User fills form and clicks "下一步"
2. System checks conflicts for all occurrences in pattern
   - Show loading state during conflict checking (spinner or progress indicator)
   - For large occurrence counts, show progress if possible
3. **If no conflicts detected**: Go directly to confirmation/preview page
4. **If conflicts detected**: Show conflict resolution page with preview table
5. User can navigate back to form page from conflict resolution
6. When returning to form page, pattern display remains "每 x 週, 共 y 次" (current input values)
7. User can modify any form fields
8. User clicks "下一步" again:
   - **If any dependency changed**: Conflicts are recalculated (previous conflict resolution edits discarded)
     - Dependencies that trigger recalculation: appointment type, practitioner, base date/time, recurrence pattern (x or y), recurrence toggle
   - **If no dependencies changed**: Return to conflict resolution page (previous edits preserved)
9. **Error handling**: If conflict checking fails (network error, etc.):
   - Show error message: "無法檢查衝突，請稍後再試"
   - Allow user to retry or go back to modify form
   - Do not proceed to conflict resolution or confirmation if check failed

**Preview Table** (shown in conflict resolution view):
- Generate list of appointment dates based on pattern
- Check each date for conflicts:
  - Practitioner availability (default schedule + exceptions)
  - Existing appointments (same practitioner + time)
- Display table with columns:
  ```
  | # | 日期 | 時間 | 狀態 | 操作 |
  |---|------|------|------|------|
  | 1 | 2024-01-15 | 09:00 | ✓ 可用 | [刪除] [選擇時間] |
  | 2 | 2024-01-22 | 09:00 | ✗ 衝突 | [刪除] [選擇時間] |
  | 3 | 2024-01-29 | 09:00 | ✓ 可用 | [刪除] [選擇時間] |
  | ... | ... | ... | ... | ... |
  | [+ 新增] | | | | |
  ```
- Show count in first column (#) for each occurrence
- Status badge: "✓ 可用" (green) or "✗ 衝突" (red)
- All occurrences show [刪除] and [選擇時間] buttons (regardless of conflict status)

### 4. Conflict Resolution

**For All Occurrences** (conflicting and non-conflicting):
- **Delete**: [刪除] button removes the occurrence from the list
  - If deleted occurrence had conflict, check if "下一步" should be enabled (all remaining are valid)
- **Reschedule**: [選擇時間] button opens date/time picker
  - Reuse existing `DateTimePicker` component
  - Auto-select original date (user can change)
  - User selects new date/time
  - Update occurrence in table with new date/time
  - **Note**: `DateTimePicker` only shows available slots, so selected time should be conflict-free
  - **Note**: Backend will validate availability again before creating appointments (handles concurrency edge cases)
  - **Update conflict status** in preview table after selection (mark as "✓ 可用" since DateTimePicker only shows available slots)
  - **Enable "下一步" button** if rescheduling resolves the last conflict
  - Available for all occurrences, not just conflicts

**Add New Occurrence**:
- Show "+ 新增" row at end of table
- Clicking opens date/time picker
- User selects date/time for new occurrence
- Before adding to table:
  - Check for conflicts with existing appointments and availability
  - Check for duplicates within the occurrences list
  - If duplicate found, show warning and prevent adding
- Add to table and show conflict status
- New occurrence can be deleted or rescheduled like others

**Pattern Display**:
- Pattern display always shows "每 x 週, 共 y 次" with current input values
- Pattern display does not change when returning from conflict resolution page
- User can modify x (weeks interval) or y (occurrence count) at any time

**State Preservation** (Simplified):
- When user navigates back from conflict resolution to form page:
  - Pattern inputs (x, y) remain editable and show current values
  - **Simplified Rule**: 
    - **Preserve conflict resolution state** if pattern (x, y) unchanged AND no availability-affecting fields changed
    - **Recalculate conflicts** if pattern (x, y) changed OR any availability-affecting field changed:
      - Appointment type
      - Practitioner
      - Base date/time
      - Recurrence toggle (enabled/disabled)
  - **Note**: Patient and clinic notes changes preserve state (constraints handled by backend)
- When recalculating, previous conflict resolution edits are discarded
- When preserving, previous conflict resolution edits are maintained
- **State does NOT persist** if user closes modal and reopens - starts fresh
- **Visual indicator**: Show subtle indicator when state is preserved vs. recalculated (optional UX enhancement)

**Date/Time Picker Reuse**:
- Reuse existing `DateTimePicker` component
- When opened for conflict resolution:
  - Pass `initialDate` prop (original date for reschedule, today for new)
  - Pass `selectedPractitionerId` and `appointmentTypeId` (from form)
  - On selection, update the occurrence in the table
  - Can be shown inline in table row or as modal overlay

### 5. Navigation Flow

**Three-Step Flow**:
1. **Form Page**: User enters appointment details and recurrence pattern
2. **Conflict Resolution Page** (if conflicts detected): User resolves conflicts
3. **Confirmation Page**: User reviews and confirms all appointments

**Navigation Rules**:
- Form → Conflict Resolution: Triggered by "下一步" click, shows conflict resolution if conflicts found
- Form → Confirmation: Triggered by "下一步" click, goes directly if no conflicts
- Conflict Resolution → Form: User clicks "返回" or "上一步"
- Conflict Resolution → Confirmation: User clicks "下一步" after resolving conflicts
- Confirmation → Form: User clicks "返回修改"

**State Management**:
- When navigating Conflict Resolution → Form:
  - Pattern display remains "每 x 週, 共 y 次" with current input values
  - Preserve conflict resolution edits if user only changes non-availability fields
  - Recalculate conflicts if user changes **any dependency** (appointment type, practitioner, date/time, or recurrence settings)
- **State does NOT persist** if user closes modal:
  - All state is reset when modal is closed
  - Reopening modal starts fresh (no conflict resolution state preserved)
  - This ensures clean state and prevents stale data

### 6. Confirmation Step

**Enhanced Confirmation**:
- Show recurrence pattern summary: "每 x 週, 共 y 次"
- Show actual count: "將建立 n 個預約" (n may differ from y if occurrences were deleted/added in conflict resolution)
- List all dates that will be created (limit to first 10, show "... 還有 5 個" if more)
- Show clinic notes (will be replicated to all appointments)

## Technical Design

### Backend Changes

**New Endpoint**: `POST /clinic/appointments/recurring`
```python
class RecurringAppointmentCreateRequest(BaseModel):
    patient_id: int
    appointment_type_id: int
    practitioner_id: int
    clinic_notes: Optional[str]
    occurrences: List[Occurrence]  # List of specific date/time occurrences (max 50)

class Occurrence(BaseModel):
    start_time: str  # ISO datetime
    # Note: Each occurrence is independent, allowing custom dates/times

# Response should indicate which occurrences succeeded/failed
class RecurringAppointmentCreateResponse(BaseModel):
    success: bool
    created_count: int
    failed_count: int
    created_appointments: List[Dict]  # Details of successfully created appointments
    failed_occurrences: List[FailedOccurrence]  # Details of failed occurrences with error messages

class FailedOccurrence(BaseModel):
    start_time: str  # ISO datetime
    error_code: str  # "conflict", "booking_restriction", "past_date", "max_window", etc.
    error_message: str  # Human-readable error message
```

**Implementation Notes**:
- **Transaction handling**: Each occurrence is created in separate transaction (allows partial success)
- **Idempotency**: Endpoint is NOT idempotent - calling twice will create duplicates
- **Validation**: Validate all occurrences before creating any (fail fast if all invalid)
- **Performance**: Batch create occurrences where possible, but handle failures individually

**Conflict Detection Endpoint**: `POST /clinic/appointments/check-recurring-conflicts`
- Accepts list of date/time occurrences to check
- Returns conflict status for each occurrence
- Used for preview before creation
- **Performance**: Batch check all occurrences in single query (not sequential individual checks)
- **Timeout**: 10 seconds max - return partial results if timeout exceeded
- **Duplicate Detection**: Also checks for duplicates within the provided list (same date/time appears multiple times)
- **Booking Restrictions**: 
  - For clinic admins: Only checks availability and existing appointments (bypasses booking restrictions)
  - For patients: Also checks minimum_booking_hours_ahead and max_booking_window_days per occurrence

**Request**:
```python
class CheckRecurringConflictsRequest(BaseModel):
    practitioner_id: int
    appointment_type_id: int
    occurrences: List[str]  # List of ISO datetime strings
```

**Response**:
```python
class ConflictCheckResult(BaseModel):
    occurrences: List[OccurrenceConflictStatus]

class OccurrenceConflictStatus(BaseModel):
    start_time: str  # ISO datetime
    has_conflict: bool
    is_duplicate: bool  # True if duplicate within the provided list
    duplicate_index: Optional[int]  # Index of duplicate occurrence in list (if is_duplicate=True)
    conflicting_appointment: Optional[Dict]  # Details if conflict with existing appointment
    violation_type: Optional[str]  # "availability", "booking_restriction", "existing_appointment", "duplicate"
```

**Implementation**:
- For each occurrence datetime, check:
  - Practitioner default availability for that day of week
  - Availability exceptions for that date
  - Existing appointments at that time
- Return conflict details for each occurrence

**Note on Conflict Checking**:
- `DateTimePicker` component only displays available slots (already filtered by backend)
- When user reschedules an occurrence via `DateTimePicker`, the selected time should be conflict-free
- Backend validates availability again before creating appointments:
  - `AppointmentService._assign_practitioner()` checks availability using `_is_practitioner_available_at_slot()`
  - Raises HTTPException (409 CONFLICT) if slot is unavailable
  - Database-level integrity checks also catch conflicts
- This handles concurrency edge cases (e.g., another user booking the slot between selection and submission)
- Re-checking conflicts in preview table after rescheduling is optional (for UX feedback) but not strictly necessary

**Notification**:
- When creating recurring appointments, send **one consolidated notification** to patient
- **Only send if at least one appointment was created successfully**
- Notification format:
  - Summary: "已為您建立 n 個預約"
  - Date range: "預約時間：YYYY-MM-DD 至 YYYY-MM-DD" (if multiple dates)
  - List of appointment dates/times (limit to first 10, show "... 還有 X 個" if more)
  - Link to view all appointments in LINE app
  - **Does NOT include clinic notes** (internal only)
- **If notification fails**: Log error but don't block appointment creation
- **Retry logic**: Retry notification up to 3 times with exponential backoff

**Clinic Notes Replication**:
- Clinic notes (診所備注) entered in the form are **replicated to all recurring appointments**
- All appointments in the series will have the same clinic notes
- If user edits clinic notes after resolving conflicts, the updated notes apply to all appointments

### Frontend Changes

**CreateAppointmentModal Updates**:
- Add recurrence toggle state
- Add recurrence pattern inputs (weeks, occurrences)
- Add conflict resolution view (shown when conflicts detected)
- Reuse existing `DateTimePicker` component for rescheduling
- Update confirmation step to show recurring summary

**New Components**:
- `RecurrencePatternInput`: Simple input for "每 x 週, 共 y 次"
- `RecurrenceOccurrencesTable`: Table showing all occurrences with conflict status
  - Reuses `DateTimePicker` for rescheduling (inline or modal)
  - Shows delete and reschedule buttons for each occurrence
  - Shows "+ 新增" row at end

**State Management**:
```typescript
interface RecurrenceState {
  enabled: boolean;
  weeksInterval: number; // x in "每 x 週", defaults to 1
  occurrenceCount: number | null; // y in "共 y 次", required when enabled
  hasEditedOccurrences: boolean; // true if user has edited occurrences (deleted, rescheduled, or added)
  occurrences: Array<{
    id: string; // Unique ID for each occurrence
    date: string; // YYYY-MM-DD
    time: string; // HH:mm
    hasConflict: boolean;
    isRescheduled: boolean; // true if user changed from original pattern
    isNew: boolean; // true if user added this occurrence manually
  }>;
  // Track fields that affect availability for state preservation
  lastAvailabilityCheck: {
    appointmentTypeId: number | null;
    practitionerId: number | null;
    baseDate: string | null;
    baseTime: string | null;
    weeksInterval: number | null;
    occurrenceCount: number | null;
  };
}
```

**Code Reuse**:
- **DateTimePicker**: Reuse for rescheduling conflicts and adding new occurrences
  - Pass `initialDate` prop for rescheduling (original date)
  - Pass `selectedPractitionerId` and `appointmentTypeId` from form
  - Can be rendered inline in table or as modal overlay
- **Conflict Detection Logic**: Reuse existing conflict checking from appointment creation
- **Form Validation**: Reuse existing validation patterns

## Edge Cases

### Pattern Limits
- **Maximum occurrences**: 50 appointments per creation (reduced from 100 for better UX and performance)
- **Minimum occurrences**: 1 (required)
- **Weeks interval**: Minimum 1
- **Pagination**: If occurrences exceed 20, show pagination in conflict resolution table (20 per page)

### No Valid Dates / Invalid Occurrences
- If any occurrences have conflicts (✗ 衝突 status), disable "下一步" button
- User must delete or reschedule ALL conflicting occurrences before proceeding
- Show message: "請刪除或重新安排所有衝突的時段後才能繼續"
- If all occurrences are deleted, show error: "至少需要一個預約時段"
- Disable "下一步" button until:
  - At least one occurrence exists, AND
  - All occurrences are valid (no conflicts)

### Pattern Changes
- Pattern inputs (x, y) always remain editable on form page
- When user returns from conflict resolution to form page:
  - Pattern display shows "每 x 週, 共 y 次" with current input values
  - User can modify pattern (x or y) at any time
  - If user changes pattern (x or y), base appointment time, practitioner, or appointment type:
    - Conflict resolution state is discarded
    - On "下一步" click, conflicts are recalculated from new settings
    - User will see fresh conflict resolution page or confirmation page
  - If user only changes clinic notes:
    - Conflict resolution state is preserved
    - On "下一步" click, user returns to conflict resolution page with previous edits intact

### Adding/Removing Occurrences
- When user adds occurrence via "+ 新增":
  - Check for conflicts immediately (against existing appointments and availability)
  - **Also check for conflicts with other occurrences in the same list** (prevent duplicates)
  - Show conflict status in table
  - **If new occurrence has conflict**: "下一步" button remains disabled (if other conflicts exist) or becomes disabled (if this is the only conflict)
  - User can delete or reschedule if needed
- When user deletes occurrence:
  - Remove from table immediately
  - Update occurrence count in table
  - **If deleted occurrence had conflict**: Check if "下一步" should be enabled (all remaining occurrences are valid)
  - If all occurrences deleted:
    - Show error message: "至少需要一個預約時段"
    - Disable "下一步" button
    - User must add occurrences or go back to modify pattern

### Duplicate Occurrences
- Prevent duplicate date/time combinations in the occurrences list
- **Duplicate detection**: Exact match on date + time (case-insensitive, same timezone)
- **Time granularity**: Exact match required (same date and same time slot)
- When user reschedules or adds occurrence:
  - Check if date/time already exists in the list (excluding current occurrence being edited)
  - If duplicate found, show warning: "此時間已在列表中，請選擇其他時間"
  - Prevent adding duplicate or update existing occurrence instead
- **Client-side and server-side**: Check duplicates both in frontend (for immediate feedback) and backend (for validation)

### Recurrence Toggle Disabled
- If user disables recurrence toggle after resolving conflicts:
  - Conflict resolution state is discarded
  - Form returns to single appointment mode
  - User can re-enable toggle to start fresh

### Rescheduling Occurrences
- When user clicks "選擇時間":
  - Open `DateTimePicker` with original date pre-selected
  - `DateTimePicker` only shows available slots (filtered by backend)
  - User selects new date/time from available slots
  - **If user cancels/closes DateTimePicker without selecting**: No change, occurrence remains as-is (conflict status unchanged)
  - On selection:
    - Check for duplicate date/time in occurrences list (excluding current occurrence being edited)
    - If duplicate, show warning: "此時間已在列表中，請選擇其他時間" and prevent update
    - If not duplicate, update occurrence in table with new date/time
    - Mark occurrence as rescheduled (`isRescheduled: true`)
    - **Update conflict status to "✓ 可用"** (since DateTimePicker only shows available slots)
    - **Check if "下一步" should be enabled**: If this was the last conflict, enable "下一步" button
  - **Conflict checking**: 
    - `DateTimePicker` already filters to show only available slots
    - Backend validates availability again before creating appointments (via `_assign_practitioner` method)
    - Backend handles concurrency edge cases (e.g., another user booking the slot between selection and submission)
  - User can reschedule again or delete if needed

### Practitioner Availability Changes
- Conflict check is based on current availability
- If availability changes between preview and creation, backend will catch conflicts
- Show error for any occurrences that became invalid
- User can reschedule invalid occurrences or delete them

### Booking Restrictions
- **Clinic admins bypass all booking restrictions** (minimum_booking_hours_ahead, max_booking_window_days)
- For clinic admin users creating recurring appointments:
  - All occurrences bypass booking restrictions
  - Only availability and existing appointments are checked during conflict detection
- **For patients** (if this feature is extended to patient-facing):
  - Booking restrictions are checked during conflict detection (not just at creation)
  - Occurrences that violate restrictions show as "✗ 衝突" with reason
  - This prevents UX confusion (showing "✓ 可用" but then failing at creation)
- **Note**: Booking restrictions are enforced per occurrence by backend during creation
- If an occurrence violates restrictions, backend will return error for that specific occurrence

### Past Dates and Future Limits
- **Frontend validation**: Validate base date/time is in future before generating pattern
- All occurrences must be in the future (backend validates)
- If base date/time is in the past:
  - Show validation error: "無法預約過去的時間"
  - Prevent pattern generation
  - User must select future date/time first
- If pattern generates occurrences in the past:
  - Filter them out during pattern generation
  - Show warning if any were filtered: "部分日期已過期，已自動排除"
  - Adjust actual count (n) to reflect only valid occurrences
- If pattern generates occurrences beyond max_booking_window_days:
  - Frontend filters them during conflict checking (for better UX)
  - Show warning if any were filtered: "部分日期超出預約範圍，已自動排除"
  - Backend will also reject those occurrences during creation (double validation)
- If all occurrences are filtered out (all past or all beyond limit):
  - Show error: "所有日期都無效，請調整日期或模式"
  - Disable "下一步" button

### Partial Creation Failure
- If backend creation fails for some occurrences but succeeds for others:
  - Backend should return details of which occurrences succeeded/failed
  - Frontend should show summary: "已建立 X 個預約，Y 個失敗"
  - List failed occurrences with specific error reasons:
    - "時段已被預約" (conflict)
    - "預約必須至少提前 X 小時" (booking restriction)
    - "超出預約範圍" (max_booking_window_days)
    - "無法預約過去的時間" (past date)
  - **Retry mechanism**: 
    - User can click "重試失敗的預約" to retry only failed occurrences
    - Failed occurrences are preserved in state for retry
    - User can also go back to conflict resolution to manually fix failed ones
  - Notification should only be sent if at least one appointment was created successfully
  - **Transaction handling**: Each occurrence is created in separate transaction (allows partial success)

### Notification
- Send **one consolidated notification** when creating recurring appointments
- Include summary and list of all appointments
- Patient receives single notification instead of multiple

### Clinic Notes Replication
- Clinic notes (診所備注) entered in the form are replicated to **all** recurring appointments
- All appointments in the series will have identical clinic notes
- If user edits clinic notes after resolving conflicts, the updated notes apply to all appointments

## User Experience Flow

### Main Flow

1. **Form Page**: User fills appointment form (patient, type, practitioner, date/time)
2. User enables "重複" toggle
3. User enters pattern: "每 [x] 週, 共 [y] 次" (x defaults to 1, y is required)
4. User enters clinic notes (will be replicated to all appointments)
5. User clicks "下一步"

6. **Conflict Detection**:
   - Show loading state: "正在檢查衝突..." with spinner/progress indicator
   - For large occurrence counts (>20), show progress: "正在檢查衝突... (X/Y)"
   - System checks conflicts for all occurrences in pattern (batch check, not sequential)
   - **If conflict check fails** (network error, timeout, etc.):
     - Show error: "無法檢查衝突，請稍後再試"
     - Allow user to retry (up to 3 times) or go back to modify form
     - Form data is preserved during retry
     - Do not proceed to next step until check succeeds
   - **If conflict check times out** (10 seconds):
     - Return partial results if available
     - Show warning: "部分衝突檢查未完成，請重試"
     - Allow user to proceed with available results or retry
   - **If no conflicts detected**: Go directly to step 9 (Confirmation Page)
   - **If conflicts detected**: Go to step 7 (Conflict Resolution Page)

7. **Conflict Resolution Page** (if conflicts detected):
   - Show preview table with all occurrences (numbered)
   - Each occurrence shows status badge (✓ 可用 or ✗ 衝突)
   - All occurrences show [刪除] and [選擇時間] buttons (regardless of conflict status)
   - User can delete, reschedule, or add occurrences
   - **"下一步" button is DISABLED if any occurrences have conflicts (✗ 衝突)**
   - Show message when conflicts exist: "請刪除或重新安排所有衝突的時段後才能繼續"
   - User must resolve ALL conflicts (delete or reschedule) before "下一步" is enabled
   - Once all conflicts are resolved, "下一步" button becomes enabled
   - User clicks "下一步" to proceed to confirmation (only when all valid)
   - User clicks "返回" to go back to form page

8. **Returning to Form Page** (from conflict resolution):
   - Pattern display remains "每 x 週, 共 y 次" (shows current input values)
   - User can modify any form fields, including pattern (x, y):
     - **If user changes any dependency**: Appointment type, practitioner, date/time, or recurrence pattern (x or y)
       - Conflict resolution state is **discarded**
       - Conflicts will be **recalculated** on next "下一步" click
     - **If user only changes**: Clinic notes or patient (if constraints allow)
       - Conflict resolution state is **preserved**
       - Previous edits to occurrences are maintained
   - User clicks "下一步" again:
     - **If any dependency changed**: Recalculate conflicts
       - If conflicts found: Show conflict resolution page (fresh state)
       - If no conflicts: Go to confirmation page
     - **If no dependencies changed**: Return to conflict resolution page (with previous edits preserved)

9. **Confirmation Page**:
   - Show recurrence pattern summary: "每 x 週, 共 y 次"
   - Show actual count: "將建立 n 個預約" (n may differ from y if occurrences were deleted/added in conflict resolution)
   - List all dates that will be created
   - Show clinic notes (will be replicated to all appointments)
   - User clicks "確認建立" to create all appointments

10. **Appointment Creation**:
    - Backend creates all occurrences (may succeed partially)
    - Clinic notes are replicated to all successfully created appointments
    - **One consolidated notification** sent to patient (only if at least one appointment created)
    - Success message:
      - If all succeeded: "已建立 n 個預約"
      - If partial: "已建立 X 個預約，Y 個失敗" (with details of failures)
    - Show error details for any failed occurrences

## Implementation Notes

### Code Reuse Strategy

1. **DateTimePicker Component**:
   - Reuse for rescheduling conflicts and adding new occurrences
   - Accept props: `initialDate`, `selectedPractitionerId`, `appointmentTypeId`
   - Can be rendered inline in table row or as modal overlay

2. **Conflict Detection**:
   - Reuse existing conflict checking logic from appointment creation
   - Extend to handle batch checking for multiple occurrences

3. **Form Validation**:
   - Reuse existing validation patterns
   - Add validation for recurrence pattern inputs

4. **Notification System**:
   - Extend existing appointment creation notification
   - Add logic to consolidate multiple appointments into one notification

### Component Structure

```
CreateAppointmentModal
├── (existing form fields)
├── RecurrenceToggle
├── RecurrencePatternInput (when toggle ON)
│   ├── Weeks interval input
│   └── Occurrence count input
├── RecurrenceOccurrencesTable (when conflicts detected)
│   ├── OccurrenceRow (for each occurrence)
│   │   ├── Date/Time display
│   │   ├── Conflict status badge
│   │   ├── Delete button
│   │   └── Reschedule button → DateTimePicker
│   └── AddOccurrenceRow → DateTimePicker
└── (confirmation step with recurring summary)
```

