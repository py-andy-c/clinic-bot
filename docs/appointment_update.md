# Appointment User Experience Redesign

## Overview

This document outlines the redesign of appointment management features to support:
1. Clinic users creating appointments on behalf of existing patients
2. Clinic users editing appointments (time and practitioner) with conflict checking
3. Clinic users viewing and reassigning system-assigned appointments

## Requirements Summary

### Important: Auto-Assignment Display Behavior

**Key Change**: When a patient creates an appointment without specifying a practitioner (auto-assigned), the system should display "不指定" instead of the system-assigned practitioner name. This applies to:
- LIFF appointment flow (Steps 6 & 7 - confirmation and success screens)
- Calendar events (both clinic and patient views)
- LINE appointment reminders
- All appointment displays

**Rationale**: This allows clinic flexibility to reassign practitioners without patients seeing intermediate assignments. Patients only see a specific practitioner name once the clinic has manually assigned one.

**Notification Behavior Decision Tree**:
1. **No notification if**:
   - Only changing from 不指定 (auto-assigned) to specific practitioner (patient never saw practitioner)
   - Only notes changed
   - No changes made

2. **Send notification if**:
   - Time changed (regardless of practitioner state)
   - Practitioner changed from specific → specific (patient saw both)
   - Practitioner changed from specific → 不指定 (patient saw practitioner, now unspecified)

### Requirement 1: Create Appointment on Behalf of Patient

- **Who**: Clinic users (admin, practitioner)
- **What**: Create appointment for existing patient without LINE authentication
- **Notification**: Send LINE notification to patient
- **Access**: 
  - **Admin**: Can create appointments for any patient
  - **Practitioner**: Can create appointments for any patient
  - **Read-only**: Cannot create appointments (read-only access)

### Requirement 2: Edit Appointment

- **Who**: Clinic users (admin, practitioner)
- **What**: Edit appointment time and/or practitioner
- **Conflict Check**: Validate new time/practitioner availability before saving
- **Notification**: Send LINE notification with custom note (preview before sending)
- **UX Pattern**: Similar to cancellation flow (note input → preview → confirm)
- **Combined Changes**: Allow changing both practitioner and time in same edit
- **Access**:
  - **Admin**: Can edit any appointment in the clinic
  - **Practitioner**: Can edit only their own appointments (where they are the assigned practitioner)
  - **Read-only**: Cannot edit appointments

### Requirement 3: View and Reassign System-Assigned Appointments

- **Who**: All practitioners (not just assigned practitioner)
- **What**: View appointments that were auto-assigned, see availability, and reassign
- **Purpose**: Allow practitioners to review and optimize auto-assignments
- **Access**:
  - **Admin**: Can view and reassign any appointment
  - **Practitioner**: Can view all appointments (read-only for others' appointments), can reassign auto-assigned appointments
  - **Read-only**: Can view appointments but cannot reassign

## User Experience Design

### 1. Create Appointment on Behalf of Patient

#### Entry Points
- **Calendar View**: "Create Appointment" button in calendar toolbar
- **Patients Page**: "New Appointment" button next to each patient

#### Flow
1. User clicks "Create Appointment"
2. **Step 1: Select Patient**
   - Search/filter existing patients
   - Display: Name, Phone, LINE status
   - If patient has no LINE account: Show warning but allow creation
3. **Step 2: Select Appointment Type**
   - List of active appointment types for clinic
   - Show duration for each type
4. **Step 3: Select Practitioner** (Optional)
   - List of practitioners who offer selected appointment type
   - "Auto-assign" option (default)
   - If auto-assign: Show "Will be assigned automatically" message
5. **Step 4: Select Date & Time**
   - Calendar date picker
   - Time slot selector (filtered by practitioner availability if selected)
   - If auto-assign: Show availability across all practitioners
   - Conflict validation in real-time
6. **Step 5: Add Notes** (Optional)
   - Text area for appointment notes
7. **Step 6: Confirm & Create**
   - Summary of appointment details
   - Show "不指定" if auto-assigned (don't show the system-assigned practitioner name)
   - "Create Appointment" button
   - On success: Show success message, refresh calendar, send LINE notification

#### LINE Notification
- **When**: Immediately after successful creation
- **Content**: Standard appointment confirmation message
- **Format**: Same as patient-created appointments
- **Error Handling**: If LINE notification fails, appointment is still created (log error)

#### Edge Cases
- **Patient has no LINE account**: Create appointment, skip notification, show info message
- **No available practitioners**: Show error, prevent creation
- **Time slot becomes unavailable**: Show conflict error, allow retry
- **Patient doesn't exist**: Redirect to patient creation flow (future enhancement)

### 2. Edit Appointment

#### Entry Points
- **Calendar View**: Click appointment → "Edit Appointment" button in EventModal
- **EventModal**: "Edit Appointment" button (replaces or alongside "Delete Appointment")

#### Flow
1. User clicks "Edit Appointment" on an appointment
2. **Edit Modal Opens**
   - **Current Details Display**:
     - Patient name (read-only)
     - Current appointment type (read-only, can't change type)
     - Current practitioner (editable dropdown)
     - Current date & time (editable)
     - Current notes (editable)
   
   - **Edit Controls**:
     - **Practitioner Dropdown**: 
       - List of practitioners who offer this appointment type
       - Current practitioner pre-selected (or "不指定" if auto-assigned)
       - "Keep current" option (or "不指定" option if currently auto-assigned)
     - **Date Picker**: Current date pre-selected
     - **Time Slot Selector**: 
       - Shows available slots for selected practitioner (or all if changing practitioner)
       - Current time pre-selected
       - Real-time conflict checking
       - If changing practitioner: Show availability calendar for new practitioner
     - **Notes Field**: Current notes pre-filled (can edit)
   
   - **Conflict Detection**:
     - Check availability when practitioner or time changes
     - Show error message if conflict detected
     - Disable "Save" button if conflict exists
     - Highlight conflicting time slots in red

3. **User Makes Changes**
   - Can change practitioner only, time only, or both
   - Real-time validation as user selects
   - Show preview of changes

4. **User Clicks "Save Changes"**
   - If no changes: Show message "No changes to save", close modal
   - If changes detected: Proceed to note input step

5. **Note Input Step** (if changes made)
   - **Custom Note Field** (Optional):
     - Text area for custom message to patient
     - Placeholder: "例如：因治療師調度，已為您調整預約時間"
     - Character limit: 200 characters
     - Pre-filled with default message (can edit)
   
   - **Default Message Preview**:
     - Show what default message would be if no custom note
     - Format: "您的預約已調整：[old time] → [new time], [old practitioner] → [new practitioner]"
   
   - **Buttons**:
     - "Back" (return to edit form)
     - "Preview LINE Message" (proceed to preview)

6. **LINE Message Preview Step**
   - **Preview Display**:
     - Show exactly what patient will receive
     - Include: Old appointment details, new appointment details, custom note
     - Format similar to cancellation preview
   
   - **Message Format**:
     ```
     {patient_name}，您的預約已調整：
     
     原預約：{old_date_time} - 【{appointment_type}】{old_practitioner_display}治療師
     新預約：{new_date_time} - 【{appointment_type}】{new_practitioner_display}治療師
     
     備註：{custom_note}
     
     如有疑問，請聯繫診所。
     ```
     - Note: `old_practitioner_display` and `new_practitioner_display` show "不指定" if auto-assigned
   
   - **Buttons**:
     - "Back" (return to note input)
     - "Confirm & Send" (save changes and send notification)

7. **Confirmation & Save**
   - Save appointment changes to database
   - Update CalendarEvent (date, time, user_id if practitioner changed)
   - Update Appointment (notes if changed)
   - Send LINE notification
   - Show success message
   - Refresh calendar view
   - Close modal

#### Conflict Checking Logic
- **When Practitioner Changes**:
  - Check if new practitioner offers the appointment type
  - Check if new practitioner is available at current time
  - If current time not available: Show available slots for new practitioner
  - Allow user to select different time for new practitioner

- **When Time Changes**:
  - Check if current practitioner is available at new time
  - If not available: Show error, suggest alternative times
  - If practitioner also changed: Check new practitioner at new time

- **When Both Change**:
  - Check new practitioner availability at new time
  - Show available slots if conflict

#### Edge Cases
- **Appointment already cancelled**: Show error, prevent edit
- **Patient has no LINE account**: Allow edit, skip notification, show info message
- **Practitioner no longer offers appointment type**: Show error, prevent saving
- **Time slot becomes unavailable between preview and save**: Re-check on save, show error if conflict, suggest alternatives
- **No changes made**: Show message, close modal without notification
- **Only notes changed**: Save notes, no LINE notification needed
- **Changing from 不指定 to specific practitioner**: No notification needed (patient never saw specific practitioner)
- **Changing from specific practitioner to 不指定**: Show notification (patient saw practitioner, now it's unspecified)
- **Concurrent edits**: Use optimistic locking or re-validate on save, show error if conflict detected
- **Practitioner deleted**: Show "不指定" or "[已離職]" in display, prevent assignment to deleted practitioner
- **Time zone handling**: All times in clinic's timezone (Taiwan time), ensure consistent handling

### 3. View and Reassign System-Assigned Appointments

#### Identifying System-Assigned Appointments

**Database Change**:
- Add `is_auto_assigned: bool` field to `Appointment` model (default: False)
- Set to `True` when `practitioner_id=None` in `create_appointment`
- Migration: Set `is_auto_assigned=True` for existing appointments where we can infer (optional, not critical)

**Alternative (No DB Change)**:
- Infer from appointment creation: If `practitioner_id` was None during creation
- Store in appointment notes or metadata (less clean)
- **Recommended**: Add `is_auto_assigned` field for clarity

#### Entry Points
- **Calendar View**: 
  - Visual indicator on auto-assigned appointments (badge/icon)
  - Filter: "Show Auto-Assigned Only"
  - Appointments show "不指定" instead of practitioner name when auto-assigned
- **EventModal**: 
  - Badge: "系統指派" if auto-assigned
  - Show "不指定" instead of practitioner name when auto-assigned
  - "Reassign" button (always visible for auto-assigned, optional for manual)

**Note**: "Appointment List" refers to a potential future feature for clinic admins to view appointments in a list/table format. For now, the primary interface is the Calendar View. If implemented, it would include assignment status columns and filters.

#### Viewing Auto-Assigned Appointments

**Calendar View**:
- **Visual Indicator**: 
  - Small badge/icon on appointment: "系統指派" or "Auto"
  - Different color or border style
  - Tooltip on hover: "此預約由系統自動指派"
- **Practitioner Display**:
  - Show "不指定" instead of practitioner name when `is_auto_assigned=True`
  - This allows clinic flexibility to reassign without patient seeing intermediate assignments

**EventModal**:
- **Badge Display**:
  - Show "系統指派" badge at top if auto-assigned
  - Show "不指定" instead of practitioner name when auto-assigned
  - Show "Reassign" button

#### Reassigning Appointments

**Flow**:
1. User clicks "Reassign" on auto-assigned appointment
2. **Reassign Modal Opens**
   - **Current Assignment Display**:
     - Current practitioner: Show "不指定" if auto-assigned, otherwise show practitioner name
     - Current date & time
     - Appointment type
     - Patient name
   
   - **Reassignment Options**:
     - **Practitioner Selector**:
       - Dropdown of all practitioners who offer this appointment type
       - Current practitioner pre-selected (or "不指定" if currently auto-assigned)
       - Show availability indicator next to each practitioner
     
     - **Time Selector** (if changing practitioner):
       - If keeping current time: Show if new practitioner available at current time
       - If not available: Show available time slots for new practitioner
       - Calendar view showing availability
       - Allow changing time if needed
     
     - **Keep Current Time** checkbox:
       - If checked: Only show practitioners available at current time
       - If unchecked: Allow time selection
   
   - **Availability Display**:
     - Show available time slots for selected practitioner
     - Highlight current time slot
     - Show conflicts in red

3. **User Selects New Practitioner and/or Time**
   - Real-time conflict checking
   - Show preview of changes

4. **User Clicks "Confirm Reassignment"**
   - **If only practitioner changes, time stays same**:
     - Check availability at current time
     - If available: Save, send notification
     - If not available: Show error, require time change
   
   - **If both change**:
     - Check availability at new time
     - Save, send notification

5. **Note Input & Preview** (conditional)
   - **If reassigning from auto-assigned (不指定) to specific practitioner**:
     - No notification needed (patient never saw a specific practitioner)
     - Skip note input and preview steps
     - Save directly
   - **If reassigning from one practitioner to another**:
     - Optional custom note
     - Preview LINE message
     - Confirm & send

6. **Save & Notify**
   - Update appointment
   - **Update tracking fields**:
     - Set `is_auto_assigned=False` (now manually assigned)
     - Set `reassigned_by_user_id=current_user.user_id` (track who reassigned)
     - Set `reassigned_at=now()` (track when reassigned)
     - **Keep `originally_auto_assigned=True`** (preserve historical fact that it was originally auto-assigned)
   - **Notification logic** (using decision tree):
     - If reassigning from 不指定 to specific: No notification
     - If reassigning from specific to specific: Send notification
     - If time also changes: Send notification
   - Refresh view

**Important Note on Reassignment Tracking**:
- When an auto-assigned appointment is reassigned, we update `is_auto_assigned=False` to reflect current state
- However, we **preserve** `originally_auto_assigned=True` to maintain historical record
- We also track `reassigned_by_user_id` and `reassigned_at` to know who reassigned it and when
- This allows us to:
  - Track that the appointment was originally auto-assigned (for analytics/reporting)
  - Know who made the reassignment decision (for audit trail)
  - Display appropriate information in UI (e.g., "Originally auto-assigned, reassigned by Dr. Smith on 2025-01-15")

#### Access Control

**Permission Model Summary**:
- **Admin**: 
  - View: ✅ All appointments
  - Create: ✅ Any appointment
  - Edit: ✅ Any appointment
  - Delete: ✅ Any appointment
  - Reassign: ✅ Any appointment

- **Practitioner**: 
  - View: ✅ All appointments (read-only for others' appointments)
  - Create: ✅ Any appointment
  - Edit: ✅ Only own appointments (where they are assigned practitioner)
  - Delete: ✅ Only own appointments
  - Reassign: ✅ Any appointment (can reassign auto-assigned appointments)

- **Read-only**: 
  - View: ✅ All appointments
  - Create: ❌ Cannot create
  - Edit: ❌ Cannot edit
  - Delete: ❌ Cannot delete
  - Reassign: ❌ Cannot reassign

#### Edge Cases
- **No other practitioners available**: Show message, prevent reassignment
- **Current practitioner no longer offers type**: Allow reassignment, show warning
- **Time slot becomes unavailable**: Re-check on save, show error, suggest alternatives
- **Patient has no LINE account**: Allow reassignment, skip notification, show info
- **Reassigning from 不指定**: No notification needed (patient never saw specific practitioner)
- **Concurrent reassignments**: Re-validate on save, show error if conflict
- **Practitioner deleted**: Prevent assignment to deleted practitioner, show error

## Technical Design

### Database Changes

#### 1. Add Auto-Assignment Tracking Fields to Appointment Model

```python
# models/appointment.py
class Appointment(Base):
    # ... existing fields ...
    is_auto_assigned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    originally_auto_assigned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reassigned_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reassigned_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
```

**Field Definitions**:
- `is_auto_assigned`: Current state - `True` if currently auto-assigned (shows "不指定"), `False` if manually assigned
- `originally_auto_assigned`: Historical flag - `True` if appointment was originally created without practitioner specified (never changes)
- `reassigned_by_user_id`: Tracks who reassigned the appointment (if it was reassigned from auto-assigned)
- `reassigned_at`: Timestamp of when reassignment occurred

**Invariants**:
- `is_auto_assigned=True` → `practitioner_id` is set (system assigned a practitioner, but we show "不指定" to patient)
- `is_auto_assigned=False` → `practitioner_id` is set (manually assigned)
- `originally_auto_assigned=True` → Appointment was created with `practitioner_id=None`
- `reassigned_by_user_id IS NOT NULL` → Appointment was reassigned from auto-assigned state

**Migration**:
- Add all columns with appropriate defaults
- Set `originally_auto_assigned=False` for existing appointments (we can't infer historical state)
- Optional: Set `originally_auto_assigned=True` for existing appointments where we can infer (not critical)

### API Endpoints

#### 1. Create Appointment (Clinic User)

**Endpoint**: `POST /api/clinic/appointments`

**Request**:
```python
class ClinicAppointmentCreateRequest(BaseModel):
    patient_id: int
    appointment_type_id: int
    start_time: datetime
    practitioner_id: Optional[int] = None  # None = auto-assign
    notes: Optional[str] = None
```

**Response**: Same as existing appointment creation

**Changes**:
- Remove `line_user_id` validation (clinic users don't need LINE auth)
- If `practitioner_id=None`: 
  - System auto-assigns practitioner
  - Set `is_auto_assigned=True`
  - Set `originally_auto_assigned=True`
- If `practitioner_id` is provided:
  - Set `is_auto_assigned=False`
  - Set `originally_auto_assigned=False`
- Send LINE notification after creation

#### 2. Edit Appointment

**Endpoint**: `PUT /api/clinic/appointments/{appointment_id}`

**Request**:
```python
class AppointmentEditRequest(BaseModel):
    practitioner_id: Optional[int] = None  # None = keep current
    start_time: Optional[datetime] = None  # None = keep current
    notes: Optional[str] = None
```

**Response**:
```python
class AppointmentEditResponse(BaseModel):
    success: bool
    appointment_id: int
    message: str
```

**Logic**:
- Validate appointment exists and belongs to clinic
- **Check permissions**:
  - Admin: Can edit any appointment
  - Practitioner: Can only edit appointments where `CalendarEvent.user_id == current_user.user_id`
  - Read-only: Cannot edit (403 Forbidden)
- **Conflict checking**:
  - Exclude current appointment from conflict checks (use `appointment_id` to filter out)
  - If practitioner changes: Validate new practitioner offers appointment type
  - If time changes: Check availability at new time (consider appointment duration from appointment_type)
  - If both change: Check new practitioner availability at new time
  - Re-check conflicts immediately before saving (handle race conditions)
- **Update logic**:
  - Use database transaction to ensure atomicity
  - Update CalendarEvent (date, time, user_id if practitioner changed)
  - Update Appointment (notes if changed)
  - **Update tracking fields**:
    - If changing from auto-assigned (不指定) to specific practitioner: 
      - Set `is_auto_assigned=False` (now manually assigned)
      - Set `reassigned_by_user_id=current_user.user_id` (track who reassigned)
      - Set `reassigned_at=now()` (track when reassigned)
      - **Keep `originally_auto_assigned=True`** (preserve historical fact that it was originally auto-assigned)
    - If changing from specific to specific: 
      - Keep `is_auto_assigned=False` (already manually assigned)
      - Don't update reassignment fields (not a reassignment from auto-assigned)
    - If changing from specific to auto-assigned: 
      - Set `is_auto_assigned=True` (rare case, but possible)
      - Don't update reassignment fields (not a reassignment scenario)
- **Notification logic**: See notification decision tree above
- Return success

#### 3. Preview Edit Notification

**Endpoint**: `POST /api/clinic/appointments/{appointment_id}/edit-preview`

**Request**:
```python
class AppointmentEditPreviewRequest(BaseModel):
    new_practitioner_id: Optional[int] = None
    new_start_time: Optional[datetime] = None
    note: Optional[str] = None
```

**Response**:
```python
class AppointmentEditPreviewResponse(BaseModel):
    preview_message: Optional[str]  # None if no notification needed
    old_appointment_details: dict
    new_appointment_details: dict
    conflicts: List[str]  # List of conflict messages if any
    is_valid: bool  # Whether changes are valid (no conflicts)
    will_send_notification: bool  # Whether notification will be sent
```

**Logic**:
- **Validate conflicts** (same logic as edit endpoint):
  - Exclude current appointment from conflict checks
  - Check practitioner availability if changing
  - Check time availability if changing
  - Return conflict details if any
- **Determine notification need** (using decision tree):
  - Check if notification will be sent based on changes
- **Generate preview message** (if notification needed):
  - Include old and new details
  - Include custom note if provided
  - Return preview without saving
- Return preview with validation results

#### 4. Confirm Edit (with notification)

**Endpoint**: `PUT /api/clinic/appointments/{appointment_id}` (same as edit endpoint)

**Note**: The edit endpoint handles both preview and confirmation. Use the preview endpoint for preview, and the main edit endpoint for actual updates.

**Alternative Design** (if keeping separate endpoints):
**Endpoint**: `POST /api/clinic/appointments/{appointment_id}/edit-confirm`

**Request**:
```python
class AppointmentEditConfirmRequest(BaseModel):
    practitioner_id: Optional[int] = None
    start_time: Optional[datetime] = None
    notes: Optional[str] = None
    notification_note: Optional[str] = None
```

**Response**: Same as edit response

**Logic**:
- Re-validate conflicts immediately before saving (handle race conditions)
- Use database transaction for atomicity
- Check notification need using decision tree
- Save changes (update CalendarEvent and Appointment)
- Update `is_auto_assigned` and reassignment tracking fields (see edit endpoint logic)
- Send LINE notification with custom note (if needed, don't rollback on notification failure)
- Return success

#### 5. List Appointments (with auto-assigned filter)

**Endpoint**: `GET /api/clinic/appointments`

**Query Parameters**:
- `auto_assigned_only: bool = False` - Filter for auto-assigned only
- (existing filters: date, practitioner_id, status)

**Response**: Include `is_auto_assigned` field in appointment data

#### 6. Reassign Appointment

**Endpoint**: `POST /api/clinic/appointments/{appointment_id}/reassign`

**Request**:
```python
class AppointmentReassignRequest(BaseModel):
    practitioner_id: int  # Required (must change)
    start_time: Optional[datetime] = None  # Optional (can keep current)
    notification_note: Optional[str] = None
```

**Response**: Same as edit response

**Logic**:
- Validate appointment exists and belongs to clinic
- **Check permissions**:
  - Admin: Can reassign any appointment
  - Practitioner: Can reassign any appointment (not limited to own)
  - Read-only: Cannot reassign (403 Forbidden)
- Check new practitioner availability (exclude current appointment from conflicts)
- Use database transaction for atomicity
- Update appointment:
  - Update CalendarEvent (user_id, date, time if changed)
  - Update Appointment
  - **Update tracking fields**:
    - Set `is_auto_assigned=False` (now manually assigned)
    - Set `reassigned_by_user_id=current_user.user_id`
    - Set `reassigned_at=now()`
    - Keep `originally_auto_assigned=True` (preserve historical fact that it was originally auto-assigned)
- **Notification logic** (using decision tree):
  - If reassigning from 不指定 to specific: No notification
  - If reassigning from specific to specific: Send notification
  - If time also changes: Send notification
- Send LINE notification (if needed, don't rollback on failure)
- Return success

### Service Layer Changes

#### 1. AppointmentService Updates

**New Methods**:
- `create_appointment_for_patient()` - Create without LINE user validation
- `edit_appointment()` - Edit appointment with conflict checking
- `preview_edit_notification()` - Generate preview message with conflict validation
- `reassign_appointment()` - Reassign auto-assigned appointment
- `check_appointment_edit_conflicts()` - Check conflicts excluding current appointment
- `should_send_edit_notification()` - Determine if notification needed (decision tree)

**Modified Methods**:
- `create_appointment()` - Set `is_auto_assigned` and `originally_auto_assigned` flags
- `_assign_practitioner()` - No changes needed

**Conflict Checking Helper**:
```python
def check_appointment_edit_conflicts(
    db: Session,
    appointment_id: int,  # Current appointment to exclude
    new_practitioner_id: Optional[int],
    new_start_time: Optional[datetime],
    appointment_type_id: int,  # For duration calculation
    clinic_id: int
) -> tuple[bool, Optional[str], List[str]]:
    """
    Check if appointment edit would cause conflicts.
    
    Args:
        appointment_id: ID of appointment being edited (exclude from conflict check)
        new_practitioner_id: New practitioner ID (None = keep current)
        new_start_time: New start time (None = keep current)
        appointment_type_id: Appointment type ID (for duration)
        clinic_id: Clinic ID
    
    Returns:
        (is_valid, error_message, conflict_details)
        - is_valid: True if no conflicts
        - error_message: Human-readable error if invalid
        - conflict_details: List of specific conflicts found
    """
    # Get appointment type for duration
    # Calculate end_time from start_time + duration
    # Exclude appointment_id from conflict queries
    # Check practitioner availability
    # Check time slot conflicts
    # Return results
```

#### 2. NotificationService Updates

**New Methods**:
- `generate_edit_preview()` - Generate edit notification preview
- `send_appointment_edit_notification()` - Send edit notification

#### 3. ReminderService Updates

**Modified Methods**:
- `format_reminder_message()` - Show "不指定" when `is_auto_assigned=True`
- `_send_reminder_for_appointment()` - Check `is_auto_assigned` flag

**Changes**:
- When `appointment.is_auto_assigned=True`: Show "不指定" instead of practitioner name in reminder
- When `appointment.is_auto_assigned=False`: Show practitioner name as before

**Reminder Message Format**:
```python
# In format_reminder_message():
if appointment.is_auto_assigned:
    therapist_name = "不指定"
else:
    therapist_name = association.full_name if association else user.email
```

**Message Format**:
```python
def generate_edit_notification(
    old_datetime: str,
    old_practitioner: Optional[str],  # None or "不指定" if auto-assigned
    new_datetime: str,
    new_practitioner: Optional[str],  # None or "不指定" if auto-assigned
    appointment_type: str,
    patient_name: str,
    note: Optional[str] = None
) -> str:
    # Format practitioner names (show "不指定" if None or empty)
    old_practitioner_display = old_practitioner if old_practitioner else "不指定"
    new_practitioner_display = new_practitioner if new_practitioner else "不指定"
    
    message = f"{patient_name}，您的預約已調整：\n\n"
    message += f"原預約：{old_datetime} - 【{appointment_type}】{old_practitioner_display}治療師\n"
    message += f"新預約：{new_datetime} - 【{appointment_type}】{new_practitioner_display}治療師\n"
    if note:
        message += f"\n備註：{note}\n"
    message += "\n如有疑問，請聯繫診所。"
    return message
```

**Notification Logic Decision Tree**:
```python
def should_send_edit_notification(
    old_appointment: Appointment,
    new_practitioner_id: Optional[int],
    new_start_time: Optional[datetime],
    old_notes: str,
    new_notes: str
) -> bool:
    """
    Determine if LINE notification should be sent for appointment edit.
    
    Rules (in priority order):
    1. No notification if only notes changed
    2. No notification if no changes made
    3. No notification if changing from 不指定 (is_auto_assigned=True) to specific practitioner
       (patient never saw practitioner name)
    4. Send notification if time changed (regardless of practitioner state)
    5. Send notification if practitioner changed from specific to another specific
    6. Send notification if practitioner changed from specific to 不指定
    """
    # Check if only notes changed
    if old_notes != new_notes and not new_practitioner_id and not new_start_time:
        return False
    
    # Check if no changes
    if not new_practitioner_id and not new_start_time:
        return False
    
    # Check if changing from 不指定 to specific
    if old_appointment.is_auto_assigned and new_practitioner_id:
        return False  # No notification (patient never saw practitioner)
    
    # Check if time changed
    if new_start_time:
        return True  # Always notify on time change
    
    # Check if practitioner changed
    if new_practitioner_id and not old_appointment.is_auto_assigned:
        return True  # Practitioner changed (specific to specific or specific to 不指定)
    
    return False
```

### Frontend Changes

#### 1. New Components

**CreateAppointmentModal**:
- Multi-step form (patient → type → practitioner → time → notes → confirm)
- Patient search/selector
- Reuse existing appointment type and time selection logic

**EditAppointmentModal**:
- Edit form with current values pre-filled
- Practitioner and time selectors
- Conflict detection display
- Note input step
- Preview step (reuse CancellationPreviewModal pattern)

**ReassignAppointmentModal**:
- Similar to EditAppointmentModal but focused on reassignment
- Show "系統指派" badge
- Practitioner selector with availability
- Time selector (optional)

#### 2. Modified Components

**EventModal**:
- Add "Edit Appointment" button (for admin/practitioner)
- Add "系統指派" badge if auto-assigned
- Add "Reassign" button if auto-assigned

**CalendarView**:
- Add "Create Appointment" button in toolbar
- Visual indicator for auto-assigned appointments
- Filter for auto-assigned appointments

**Appointment List** (if exists):
- Add "Assignment" column
- Add filter dropdown
- Add "Edit" and "Reassign" buttons

#### 3. State Management

**Appointment Store** (if using Zustand):
- Add `isEditingAppointment: boolean`
- Add `editingAppointmentId: number | null`
- Add methods for edit flow

### Conflict Checking

#### Implementation

**Reuse Existing Logic**:
- `AvailabilityService.fetch_practitioner_schedule_data()` - Get schedule
- `AvailabilityService.is_slot_within_default_intervals()` - Check default hours
- `AvailabilityService.has_slot_conflicts()` - Check conflicts

**New Helper**:
```python
def check_appointment_edit_conflicts(
    db: Session,
    appointment_id: int,
    new_practitioner_id: Optional[int],
    new_start_time: Optional[datetime],
    clinic_id: int
) -> tuple[bool, Optional[str]]:
    """
    Check if appointment edit would cause conflicts.
    
    Returns:
        (is_valid, error_message)
    """
    # Get current appointment
    # Check new practitioner availability if changed
    # Check new time availability if changed
    # Return (True, None) if valid, (False, error_msg) if conflict
```

### Permission Checks

#### Who Can Do What

**Create Appointment**:
- Admin: ✅ (any appointment)
- Practitioner: ✅ (any appointment)
- Read-only: ❌ (cannot create)

**Edit Appointment**:
- Admin: ✅ (any appointment in clinic)
- Practitioner: ✅ (only own appointments - where they are assigned practitioner)
- Read-only: ❌ (cannot edit)

**Reassign Appointment**:
- Admin: ✅ (any appointment)
- Practitioner: ✅ (any appointment - can reassign auto-assigned appointments)
- Read-only: ❌ (cannot reassign)

**View Appointment**:
- Admin: ✅ (all appointments)
- Practitioner: ✅ (all appointments - read-only for others' appointments)
- Read-only: ✅ (all appointments - read-only)

**View Auto-Assigned**:
- All users: ✅

## Edge Cases & Error Handling

### Create Appointment
- **Patient not found**: 404 error
- **No available practitioners**: 409 conflict, show message
- **Time slot conflict**: 409 conflict, suggest alternatives
- **LINE notification fails**: Log error, appointment still created

### Edit Appointment
- **Appointment cancelled**: 400 error, `appointment_cancelled`, message: "此預約已取消，無法編輯"
- **Permission denied**: 403 error, `permission_denied`, message: "您只能編輯自己的預約" (for practitioners)
- **No changes made**: 200 success, no notification, message: "沒有變更"
- **Conflict detected on save**: 409 conflict, `conflict`, message: "此時段已被預約，請選擇其他時間"
- **Practitioner doesn't offer type**: 400 error, `validation_error`, message: "此治療師不提供此預約類型"
- **Patient has no LINE**: Allow edit, skip notification, log info
- **Concurrent edit conflict**: 409 conflict, `conflict`, message: "預約已被其他使用者修改，請重新載入"

### Reassign Appointment
- **Permission denied**: 403 error, `permission_denied`, message: "您沒有權限重新指派預約"
- **Not auto-assigned**: Still allow (manual reassignment), but track as reassignment
- **No other practitioners**: 409 error, `conflict`, message: "無其他可用治療師"
- **Time conflict**: 409 error, `conflict`, message: "此時段不可用，請選擇其他時間"
- **Practitioner doesn't offer type**: 400 error, `validation_error`, message: "此治療師不提供此預約類型"

## Testing Considerations

### Unit Tests
- **Conflict checking logic**:
  - Exclude current appointment from conflicts
  - Handle appointment duration in conflict checks
  - Test time zone handling
- **Notification decision tree**:
  - All branches of `should_send_edit_notification()`
  - Test each rule in isolation
- **Auto-assignment tracking**:
  - `is_auto_assigned` flag setting
  - `originally_auto_assigned` preservation
  - Reassignment tracking fields (`reassigned_by_user_id`, `reassigned_at`)
- **Permission checks**:
  - Admin can edit any appointment
  - Practitioner can only edit own appointments
  - Read-only cannot edit

### Integration Tests
- **Create appointment flow**:
  - With and without practitioner specified
  - Auto-assignment logic
  - LINE notification sending
- **Edit appointment flow**:
  - Permission checks (admin vs practitioner)
  - Conflict detection and resolution
  - Notification sending based on decision tree
  - Transaction rollback on errors
- **Reassign appointment flow**:
  - Reassignment tracking fields
  - Notification logic for reassignments
  - Permission checks
- **Concurrency tests**:
  - Two users editing same appointment simultaneously
  - Time slot becoming unavailable between preview and save
  - Practitioner availability changing during edit
- **Error handling**:
  - LINE notification failures
  - Database transaction failures
  - Invalid input validation

### E2E Tests
- **Full create appointment flow**:
  - Multi-step wizard completion
  - Auto-assignment display ("不指定")
  - LINE notification receipt
- **Edit appointment flow**:
  - Edit with preview and confirmation
  - Conflict detection and resolution
  - Notification sending
- **Reassign auto-assigned appointment**:
  - Reassignment tracking
  - No notification for 不指定 → specific
  - Notification for specific → specific
- **Permission scenarios**:
  - Practitioner trying to edit others' appointments (should fail)
  - Admin editing any appointment (should succeed)
  - Read-only user trying to create/edit (should fail)

## Migration Plan

### Phase 1: Database
1. Add `is_auto_assigned`, `originally_auto_assigned`, `reassigned_by_user_id`, `reassigned_at` columns to `appointments` table
2. Set defaults appropriately:
   - `is_auto_assigned`: Default `False`
   - `originally_auto_assigned`: Default `False` (we can't infer historical state)
   - `reassigned_by_user_id`: Default `NULL`
   - `reassigned_at`: Default `NULL`
3. Add foreign key constraint for `reassigned_by_user_id` → `users.id`
4. Add indexes if needed for querying (e.g., on `is_auto_assigned`, `originally_auto_assigned`)
5. Optional: Backfill `originally_auto_assigned` for existing appointments (not critical, defaults to False)

### Phase 2: Backend
1. Update AppointmentService to set `is_auto_assigned` and `originally_auto_assigned`
2. Add edit and reassign endpoints with permission checks
3. Add notification preview endpoints with conflict validation
4. Update conflict checking (exclude current appointment, handle duration)
5. Implement notification decision tree logic
6. Add reassignment tracking (reassigned_by_user_id, reassigned_at)

### Phase 3: Frontend
1. Add CreateAppointmentModal
2. Add EditAppointmentModal
3. Add ReassignAppointmentModal
4. Update EventModal and CalendarView
5. Add visual indicators for auto-assigned

### Phase 4: Testing & Deployment
1. Comprehensive testing
2. Deploy to staging
3. User acceptance testing
4. Deploy to production

## Additional Technical Considerations

### Transaction Management
- **Atomicity**: Use database transactions for multi-step operations (edit + notification tracking)
- **Rollback Strategy**: 
  - If appointment update fails: Rollback all changes
  - If LINE notification fails: Log error but don't rollback appointment changes (notification is best-effort)
- **Isolation**: Use appropriate isolation levels to prevent dirty reads during conflict checking

### Performance Considerations
- **Conflict Checking**: 
  - Cache practitioner availability data for short periods (1-5 minutes)
  - Use database indexes on `CalendarEvent` (date, user_id, clinic_id, event_type)
  - Batch availability queries when possible
- **Notification Sending**: 
  - Consider async/background job for notifications (don't block API response)
  - Implement retry logic with exponential backoff
  - Queue system for high-volume scenarios
- **Rate Limiting**: 
  - Consider rate limiting for conflict checking endpoints
  - Prevent abuse of edit endpoints

### Data Consistency
- **Invariants to Maintain**:
  - `is_auto_assigned=True` → `practitioner_id IS NOT NULL` (system assigned)
  - `is_auto_assigned=False` → `practitioner_id IS NOT NULL` (manually assigned)
  - `reassigned_by_user_id IS NOT NULL` → `originally_auto_assigned=True` (was reassigned)
- **Periodic Validation**: Consider background job to check data consistency

### Time Zone Handling
- **All times in Taiwan timezone**: Clinic local time (Asia/Taipei)
- **API accepts**: Timezone-aware datetimes or naive datetimes interpreted as Taiwan time
- **Storage**: Store as naive datetime in database, interpreted as Taiwan time
- **Display**: Always show in Taiwan timezone

### Conflict Checking Details
- **Exclude Current Appointment**: Always exclude `appointment_id` from conflict queries
- **Duration Consideration**: Check for overlapping time slots, not just exact matches
  - Example: If appointment is 30 minutes, check conflicts from `start_time` to `start_time + 30 minutes`
- **Patient Double-Booking**: Currently allowed (patient can have multiple appointments), but consider adding validation if needed
- **Cancelled Appointments**: Exclude cancelled appointments from conflict checks

## Future Enhancements

1. **Bulk Reassignment**: Reassign multiple auto-assigned appointments at once
2. **Reassignment Suggestions**: AI-suggested optimal reassignments based on availability
3. **Appointment History**: Track detailed edit history (who changed what when) - audit trail
4. **Notification Preferences**: Let patients opt out of edit notifications
5. **Recurring Appointment Edits**: Edit all occurrences in a series
6. **Appointment Templates**: Save common appointment configurations
7. **Conflict Resolution UI**: Show alternative available times when conflicts detected

