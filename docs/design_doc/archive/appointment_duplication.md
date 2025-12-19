# Appointment Duplication Feature

## Overview

Add the ability to duplicate appointments, similar to Google Calendar's duplicate event functionality. This allows users to quickly create similar appointments by copying an existing appointment's details.

## Google Calendar Reference

Google Calendar offers two methods for duplicating events:

1. **Context Menu**: Click event → three dots menu → "Duplicate" option
2. **Keyboard Shortcut**: Hold Ctrl/Cmd while dragging an event to a new time slot

For this implementation, we'll focus on the context menu approach (method 1) as it's more discoverable and aligns with our existing UI patterns.

## User Experience

### Flow

1. User clicks on an appointment in the calendar view
2. `EventModal` opens showing appointment details
3. User clicks "複製" (Duplicate) button
4. `CreateAppointmentModal` opens with all fields pre-filled from the original appointment:
   - Patient: Pre-selected (same patient)
   - Appointment Type: Pre-selected (same type)
   - Practitioner: Pre-selected (same practitioner)
   - Date/Time: Pre-selected (same date/time initially, but user can change)
   - Clinic Notes: Pre-filled (same notes)
5. User can modify any field (especially date/time) before saving
6. User clicks "確認建立" to create the duplicate appointment

### UI Changes

**EventModal:**
- Update button labels: "複製" (Duplicate), "編輯" (Edit), "刪除" (Delete)
- Button order: 複製, 編輯, 刪除 (left to right)
- Button styling:
  - 複製: Green or blue (positive action)
  - 編輯: Blue (current styling)
  - 刪除: Red (destructive action)
- Only show "複製" for appointments (not availability exceptions)
- Only show "複製" if user has permission to create appointments (same permission check as create appointment)

**CreateAppointmentModal:**
- No changes needed - already supports pre-filling via props:
  - `preSelectedPatientId`: Pre-select patient
  - `initialDate`: Pre-select date
  - Can pass initial practitioner and appointment type via new props if needed

## Implementation Details

### Frontend Changes

1. **EventModal Component** (`frontend/src/components/calendar/EventModal.tsx`):
   - Add `onDuplicateAppointment?: () => void` prop
   - Update button labels: Change "調整預約" to "編輯", "刪除預約" to "刪除"
   - Add "複製" button in the action buttons section (first button, before "編輯")
   - Button should call `onDuplicateAppointment` callback

2. **CalendarView Component** (`frontend/src/components/CalendarView.tsx`):
   - Add `handleDuplicateAppointment` function
   - Convert `CalendarEvent` to `CreateAppointmentModal` props:
     - Extract `patient_id` from `event.resource.patient_id`
     - Extract `appointment_type_id` from `event.resource.appointment_type_id`
     - Extract `practitioner_id` from `event.resource.practitioner_id`
     - Extract date from `event.start`
     - Extract time from `event.start`
     - Extract `clinic_notes` from `event.resource.clinic_notes`
   - Open `CreateAppointmentModal` with pre-filled data
   - Set modal state to `'create_appointment'` with pre-filled data

3. **CreateAppointmentModal Component** (`frontend/src/components/calendar/CreateAppointmentModal.tsx`):
   - Add optional props for pre-filling:
     - `preSelectedAppointmentTypeId?: number`
     - `preSelectedPractitionerId?: number`
     - `preSelectedTime?: string` (HH:mm format)
   - Initialize form state with pre-filled values when provided
   - Ensure date/time picker respects pre-filled values

4. **PatientAppointmentsList Component** (`frontend/src/components/patient/PatientAppointmentsList.tsx`):
   - Add `handleDuplicateAppointment` function (similar to CalendarView)
   - Pass `onDuplicateAppointment` prop to `EventModal`
   - Open `CreateAppointmentModal` with pre-filled data

5. **AutoAssignedAppointmentsPage** (`frontend/src/pages/AutoAssignedAppointmentsPage.tsx`):
   - Add duplicate functionality if needed (similar pattern)

### Data Mapping

When duplicating, copy the following fields:
- ✅ Patient ID (`patient_id`)
- ✅ Appointment Type ID (`appointment_type_id`)
- ✅ Practitioner ID (`practitioner_id`)
- ✅ Date/Time (`start_time` - initially same, but user can change)
- ✅ Clinic Notes (`clinic_notes`) - Internal clinic notes are replicated (similar to Google Calendar replicating notes)

**Do NOT copy:**
- ❌ Calendar Event ID (new appointment gets new ID)
- ❌ Appointment ID (new appointment gets new ID)
- ❌ Patient Notes (`notes` - these are patient-provided, context-specific to original appointment)
- ❌ Status (new appointment starts as "confirmed")
- ❌ Auto-assignment flags (new appointment is manually created)

**Field Replication Rationale:**
- **Clinic Notes**: Internal notes are typically general instructions or reminders that apply to multiple appointments, so they should be replicated
- **Patient Notes**: Patient-provided notes are context-specific to the original appointment (e.g., "Please bring X-ray results"), so they should NOT be replicated
- **Google Calendar Behavior**: Google Calendar replicates the single "notes" field, but our system has two separate note fields with different purposes

### Permission Checks

- User must have permission to create appointments (same as create appointment flow)
- No additional permission checks needed beyond existing create appointment permissions

### Booking Restrictions

- **Clinic admins bypass ALL booking restrictions** (confirmed from business logic)
- Only scheduling conflicts are checked (same as normal create appointment flow)
- No need to validate:
  - `minimum_booking_hours_ahead`
  - `max_booking_window_days`
  - `max_future_appointments`
  - `minimum_cancellation_hours_before`
- **Rationale**: Clinic admins need flexibility for administrative purposes

## Edge Cases & Questions

### Questions to Resolve

1. **Cancelled Appointments**: Should "複製" be available for cancelled appointments?
   - **Recommendation**: Yes - allow duplicating cancelled appointments to recreate them
   - **Rationale**: User might want to recreate a cancelled appointment with a new date/time

2. **Past Appointments**: Should "複製" be available for past appointments?
   - **Recommendation**: Yes - allow duplicating past appointments (user can change date/time)
   - **Rationale**: User might want to create a similar appointment for a future date

3. **Button Visibility**: Should "複製" button be disabled (instead of hidden) when user lacks permission?
   - **Recommendation**: Hide the button (same as current "調整預約" behavior)
   - **Rationale**: Consistent with existing UI patterns

4. **Date/Time Pre-fill Strategy**: If original appointment is in the past, what should we pre-fill?
   - **Option A**: Pre-fill with original date/time (user can change)
   - **Option B**: Pre-fill with today's date and same time
   - **Option C**: Pre-fill with next available slot for that practitioner
   - **Decision**: Option A - pre-fill with original date/time, let user change it

5. **Patient Notes**: Should patient notes be copied?
   - **Decision**: No - patient notes are context-specific to the original appointment

6. **Auto-assigned Appointments**: If original was auto-assigned (no practitioner), how to handle?
   - **Decision**: Option A - leave practitioner empty, user must select one (clinic admins must specify practitioner)

### Invalid Pre-filled Data

- **Patient no longer exists**: Show error, allow user to select different patient
- **Appointment type no longer exists**: Clear selection, show error message
- **Practitioner no longer available for appointment type**: Clear practitioner selection, show filtered list
- **Original date/time in the past**: Pre-fill with original date/time (user can change to future date)
- **Original date/time conflicts**: User can change date/time in the form (normal conflict handling applies)
- **Cancelled appointment**: Allow duplication (creates new "confirmed" appointment)
- **Clinic notes context mismatch**: If patient/appointment type changes, clinic notes might not match - user can edit or clear them
- **Empty clinic notes**: If original has no clinic notes, duplicate will also have no clinic notes (null/empty)
- **Auto-assigned appointment (no practitioner)**: If original appointment was auto-assigned (practitioner_id is null), cannot pre-fill practitioner (clinic admins must specify practitioner). Show practitioner dropdown empty, user must select one.

### State Management

- Pre-filled values should be editable (user can change any field)
- If user changes appointment type, clear practitioner and date/time (existing auto-deselection logic)
- If user changes practitioner, clear date/time (existing auto-deselection logic)
- Clinic notes are copied but can be edited or cleared

### User Actions

- **User closes modal**: Discard all changes (normal behavior)
- **User modifies and saves**: Create new appointment with modified values
- **User modifies and cancels**: No appointment created (normal behavior)

### Notifications

- **Normal notification rules apply** when duplicating (same as creating a new appointment):
  - Patient receives confirmation notification (if patient has LINE account)
  - Practitioner receives notification (if practitioner is assigned and NOT auto-assigned)
  - Notifications are handled automatically by `AppointmentService.create_appointment()`
- **No special handling needed** - duplication creates a new appointment, so standard notification flow applies

## Benefits

1. **Efficiency**: Quickly create similar appointments without re-entering all details
2. **Consistency**: Ensures related appointments have consistent settings
3. **Familiar UX**: Matches Google Calendar's duplicate functionality
4. **Flexibility**: User can modify any field before saving

## Future Enhancements (Out of Scope)

- Keyboard shortcut (Ctrl/Cmd + drag) for duplicating appointments
- Bulk duplication (duplicate multiple appointments at once)
- Duplicate with recurrence pattern (create recurring appointments from a single appointment)

