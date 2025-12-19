# Appointments - Business Logic & Technical Design

## Overview

This document defines the business logic, permissions, and technical design for appointment management in the clinic system. It covers appointment creation, editing, cancellation, duplication, rescheduling, and recurring appointments.

---

## Key Business Logic

### 1. Auto-Assignment Visibility Principle

**Core Rule**: Auto-assigned practitioners **never know** about appointments until they are actually assigned (by admin or cron job).

- Auto-assigned appointments are **hidden** from practitioners:
  - Not visible on calendar page for any user (including admins)
  - Visible on patient detail page, but practitioner name hidden for non-admins
  - No LINE notifications sent
  - Practitioner is unaware of the appointment's existence
- This applies to:
  - Appointments created with "不指定" (no specific practitioner)
  - Appointments changed to "不指定" by patients
- Practitioners only become aware when:
  - Admin manually reassigns the appointment to them
  - Cron job automatically makes it visible at the recency limit (`minimum_booking_hours_ahead` hours before appointment)

**Rationale**: Allows clinic to review and reassign appointments without practitioners being prematurely notified.

### 2. Patient Perspective on Auto-Assignment

**Core Rule**: Patients who originally selected "不指定" **never know** about practitioner changes.

- Patients always see "不指定" as the practitioner name for auto-assigned appointments
- This remains true even if:
  - Admin reassigns to a specific practitioner
  - Admin reassigns to a different practitioner
  - System auto-assigns at recency limit
- Patients are **only notified** about:
  - Time changes (if time is modified)
  - Not about practitioner changes (since they still see "不指定")

**Rationale**: From the patient's perspective, they selected "不指定", so practitioner changes are internal clinic operations.

### 3. Booking Restrictions

**Core Rule**: **Clinic admins bypass all booking restrictions; patients must follow them.**

#### Clinic Admin Operations
- **No booking restrictions enforced**:
  - Can create appointments at any time (no `minimum_booking_hours_ahead` requirement)
  - Can create appointments beyond `max_booking_window_days`
  - Can exceed `max_future_appointments` limit
  - Can edit appointments without restriction checks
- **Must specify practitioner** (cannot use "不指定")

#### Patient Operations
- **All booking restrictions enforced**:
  - `minimum_booking_hours_ahead`: Must book/reschedule at least X hours in advance
  - `max_booking_window_days`: Cannot book more than X days in advance
  - `max_future_appointments`: Cannot exceed maximum number of future appointments
  - `minimum_cancellation_hours_before`: Must edit/cancel at least X hours before appointment
- **Practitioner is optional** (can select "不指定") unless `allow_patient_practitioner_selection = False`

**Rationale**: Clinic admins need flexibility for administrative purposes, while patients must follow clinic policies.

### 4. Appointment Type Settings

**`allow_patient_practitioner_selection`**: Controls whether patients can specify a practitioner when booking.

- **Default**: `True` (backward compatible)
- **When `False`**:
  - Patients cannot select practitioner during booking (step skipped in LIFF flow)
  - Appointments are auto-assigned (`is_auto_assigned = True`)
  - Patients cannot change practitioner during reschedule (can keep current if was manually assigned)
  - Backend validates and rejects practitioner changes if setting is `False`

**Rationale**: Some services require clinic to assign practitioners based on availability or expertise.

### 5. Receipt Constraints

**Critical Business Rules**:

1. **Previously Checked Out Appointments Cannot Be Modified**
   - If an appointment has **any receipt** (active or voided), it cannot be:
     - Deleted (enforced by database FK constraint `ON DELETE RESTRICT` and application validation)
     - Edited (all fields immutable: time, practitioner, appointment type, patient notes)
     - Rescheduled (time/practitioner changes blocked)
     - Cancelled (status change blocked)
   - **Exception**: Clinic notes (`clinic_notes`) can be updated even when receipts exist, as they are internal administrative notes that don't affect appointment details or accounting
   - Applies to both clinic users and patients
   - **Rationale**: Maintains accounting integrity and audit trail

2. **Cancelled Appointments Cannot Be Checked Out**
   - Cancelled appointments cannot have receipts created
   - Enforced in `ReceiptService.create_receipt()` (validates `status == "confirmed"`)
   - "Cancelled" includes both `canceled_by_patient` and `canceled_by_clinic` statuses

3. **Receipt Visibility**
   - **Patients**: Can only see **active receipts** (not voided)
   - **Clinic Users**: Can see **all receipts** (active and voided)

---

## Appointment Creation

### By Clinic

When a clinic admin creates an appointment on behalf of a patient:

- **Booking Constraints**: Does NOT enforce booking restrictions
- **Practitioner Requirements**: Must specify a practitioner (cannot use "不指定")
- **Notifications**: Both practitioner and patient receive LINE notifications

### By Patient

When a patient creates an appointment through the LIFF interface:

- **Booking Constraints**: Must enforce all booking restrictions
- **Practitioner Selection**: 
  - Optional if `allow_patient_practitioner_selection = True` (can select "不指定")
  - Auto-assigned if `allow_patient_practitioner_selection = False` (step skipped)
- **Auto-Assignment Behavior**:
  - When patient selects "不指定" or setting is `False`:
    - System auto-assigns a temporary practitioner
    - Auto-assigned practitioner does NOT receive LINE notification
    - Auto-assigned practitioner does NOT see event on calendar
    - Patient receives LINE notification (shows "不指定" as practitioner name)
    - Appointment marked as `is_auto_assigned = True` and `originally_auto_assigned = True`

---

## Appointment Editing

### By Clinic

When a clinic admin edits an appointment:

- **Booking Constraints**: Does NOT enforce booking restrictions
- **Practitioner Requirements**: Must specify a practitioner (cannot use "不指定")
- **Auto-Assigned Appointment Reassignment**:
  - Old practitioner never knows about original assignment (was hidden)
  - New practitioner receives notification **as if patient made the appointment**
  - Reassignment is completely behind the scenes
  - After reassignment: `is_auto_assigned = False`, `reassigned_by_user_id` set to admin's user ID
- **Time Changes**:
  - If time changes: Patient is notified about time change
  - If only practitioner changes (time unchanged): Patient is NOT notified (still sees "不指定")
  - If both change: Patient is notified about time change only

### By Patient

When a patient edits their appointment through LIFF:

- **Booking Constraints**: Must enforce all booking restrictions
  - `minimum_booking_hours_ahead`: Applies to the NEW appointment time
  - `minimum_cancellation_hours_before`: Applies to the CURRENT appointment time
- **Practitioner Selection**: 
  - Optional if `allow_patient_practitioner_selection = True`
  - Cannot change if `allow_patient_practitioner_selection = False` (can keep current)
- **Changing to "不指定"**:
  - `is_auto_assigned` set to `True`
  - If was previously manually assigned: Original practitioner receives cancellation notification
- **Changing to Specific Practitioner**:
  - Both new and old practitioner are notified
  - If was previously auto-assigned: Old practitioner never knew, stays silent
  - If was previously manually assigned: Old practitioner receives cancellation notification

---

## Appointment Features

### Duplication

**User Flow**:
1. User clicks "複製" (Duplicate) button in EventModal
2. `CreateAppointmentModal` opens with all fields pre-filled from original appointment:
   - Patient: Pre-selected
   - Appointment Type: Pre-selected
   - Practitioner: Pre-selected (hidden for auto-assigned when user is not admin)
   - Date/Time: Pre-selected (same date/time initially, but user can change)
   - Clinic Notes: Pre-filled
   - Resources: Pre-selected
3. User can modify any field (especially date/time) before saving

**Data Mapping**:
- **Copied**: Patient ID, Appointment Type ID, Practitioner ID, Date/Time, Clinic Notes, Resources
- **NOT Copied**: Calendar Event ID, Appointment ID, Patient Notes, Status, Auto-assignment flags

**Permissions**: All visible appointments can be duplicated (no ownership check)

**Technical Design**: Uses `useAppointmentForm` hook with `mode='duplicate'`. Initializes `selectedTime` as empty string to avoid immediate conflict triggers while keeping `selectedDate` for context. Calendar auto-expands for duplication mode.

### Rescheduling

**User Flow** (LIFF only):
1. Patient clicks "改期" (Reschedule) button on appointment card
2. Reschedule flow opens with existing appointment details pre-filled
3. Patient can change time and/or practitioner (if allowed)
4. Patient can edit notes
5. Confirmation step shows old vs new time comparison

**Constraints**:
- Must be at least `minimum_booking_hours_ahead` hours before NEW appointment time
- Must be at least `minimum_cancellation_hours_before` hours before CURRENT appointment time
- Cannot change practitioner if `allow_patient_practitioner_selection = False` (can keep current)
- Cannot reschedule if appointment has any receipt (active or voided)

**Technical Design**: Reuses `AppointmentFlow` components (`Step2SelectPractitioner`, `Step3SelectDateTime`, `Step5AddNotes`). Backend uses unified `AppointmentService.update_appointment()` method with `apply_booking_constraints=True` for patients.

### Recurring Appointments

**User Flow**:
1. User enables "重複" (Repeat) toggle in `CreateAppointmentModal`
2. User selects pattern: "每 [x] 週, 共 [y] 次" (Every x weeks, y times)
3. System generates occurrences and checks for conflicts
4. User reviews conflicts and can delete/reschedule individual occurrences
5. User confirms and creates all occurrences

**Pattern**:
- Weekly recurrence only
- Maximum 50 occurrences
- Each occurrence is created in separate transaction (allows partial success)

**Resource Allocation**: Each occurrence gets its own resource allocation (independent selection)

**Notifications**: Consolidated notification sent after all occurrences are created (prevents duplicate notifications)

**Technical Design**: Backend endpoint `/clinic/appointments/recurring` creates appointments one by one. Frontend calls `/clinic/appointments/check-recurring-conflicts` to preview conflicts before creation.

---

## Permissions

### View & Duplicate Permissions

| Context | Admin | Practitioner (Regular) | Practitioner (Auto-Assigned) |
|---------|-------|----------------------|----------------------------|
| **Calendar Page** | ✅ All visible appointments | ✅ All visible appointments | ❌ No (filtered by backend) |
| **Patient Detail Page** | ✅ All appointments | ✅ All appointments | ✅ All (shows "不指定") |

**Notes**:
- Duplicate permission is the same as View permission
- Calendar page: Auto-assigned appointments are filtered out by backend for ALL users (including admins)
- Patient detail page: All appointments visible, but `practitioner_id` is hidden for auto-assigned when user is not admin

### Edit & Delete Permissions

| Context | Admin | Practitioner (Own, Regular) | Practitioner (Own, Auto-Assigned) | Practitioner (Others') |
|---------|-------|----------------------------|----------------------------------|----------------------|
| **Calendar Page** | ✅ Any appointment | ✅ Yes | ❌ No | ❌ No |
| **Patient Detail Page** | ✅ Any appointment | ✅ Yes | ❌ No | ❌ No |

**Notes**:
- Delete permission is always the same as Edit permission
- Admin: Can edit/delete any appointment
- Practitioner (Own, Regular): Can edit/delete own appointments that are not auto-assigned
- Practitioner (Own, Auto-Assigned): Cannot edit/delete auto-assigned appointments, even if assigned to them
- Practitioner (Others'): Cannot edit/delete other practitioners' appointments

**Implementation**: Shared utility functions in `frontend/src/utils/appointmentPermissions.ts`:
- `canEditAppointment(event, userId, isAdmin)`: Checks `is_auto_assigned` flag and ownership
- `canDuplicateAppointment(event)`: Returns true if event is an appointment (all visible appointments can be duplicated)

---

## Edge Cases

### Inactive or Deleted Practitioner

**Scenario**: Auto-assigned practitioner becomes inactive or is deleted.

- **System Behavior**:
  - When cron job tries to make appointment visible: System re-assigns to an available practitioner if original is inactive/deleted
  - When patient tries to edit appointment: System automatically re-assigns to an available practitioner (if original is unavailable)
  - When admin tries to reassign: Admin can reassign to any active practitioner
- **Admin Responsibility**: System should warn admin about future appointments when they try to delete/deactivate a practitioner

### Soft-Deleted Appointment Types

**Scenario**: Appointment type is soft-deleted after appointment is created.

- **Rule**: Editing is **still allowed** for appointments with soft-deleted types
- **Display**: Appointment type name shows as "已刪除服務類型" (Deleted Service Type) in UI
- **Behavior**: Appointment functionality remains intact, only display name changes

### Cancelled Appointments

**Scenario**: Attempting to edit a cancelled appointment.

- **Rule**: Cancelled appointments **cannot be edited** by anyone (patient or admin)
- **Status Check**: System validates appointment status before allowing edits
- **Error Message**: Clear message indicating appointment is cancelled and cannot be modified

### Past Appointments

**Scenario**: Attempting to edit an appointment that is in the past.

- **Rule**: Past appointments **cannot be edited**
- **Validation**: System checks appointment start time against current time
- **Exception**: Clinic admins can use Override Mode to schedule in the past (for administrative purposes)

### Appointment Type Changes

**Scenario**: Attempting to change appointment type during edit.

- **Rule**: Appointment type **can be changed** during edit operations, with validation that the practitioner offers the new appointment type. Resource allocations are cleared and re-allocated based on new requirements.
- **Rationale**: Allows flexibility to correct appointment type selection while maintaining data integrity

### Concurrent Edits

**Scenario**: Admin and patient try to edit the same appointment simultaneously.

- **Approach**: Database-level optimistic locking with `with_for_update(nowait=True)`
- **Expected Behavior**: 
  - First write succeeds, second fails with conflict error (409)
  - System provides clear error messages to the user whose edit was rejected
  - Consider showing a warning if appointment was recently modified

### Notification Failures

**Scenario**: LINE notification fails to send during appointment edit.

- **Rule**: Notification failures **do NOT block** the appointment edit
- **Behavior**: 
  - Appointment edit succeeds even if notification fails
  - Notification failure is logged for investigation
  - User receives success confirmation for the edit
- **Rationale**: Notification is a side effect, not a core requirement for the edit operation

---

## Technical Design

### Form Architecture

**Shared Logic Hook**: `useAppointmentForm`
- **Location**: `frontend/src/hooks/useAppointmentForm.ts`
- **Modes**: `'create' | 'edit' | 'duplicate'`
- **Features**:
  - Parallel initialization (practitioners and resources fetched together)
  - Request cancellation via `AbortController`
  - Centralized validation
  - Auto-deselection of dependent fields

**Shared Components**: Located in `frontend/src/components/calendar/form/`
- `AppointmentReferenceHeader`: Shows original appointment time for context
- `AppointmentTypeSelector`: Handles sorting and "(原)" label logic
- `PractitionerSelector`: Handles loading and empty states
- `AppointmentFormSkeleton`: Loading state for entire form

**Single-Page Form**: Both `CreateAppointmentModal` and `EditAppointmentModal` use single-page form design (not multi-step). All fields visible at once, similar to Google Calendar.

### Notification System

**Post-Action Flow**: Notifications are decoupled from appointment modifications.

- **Workflow**: Commit appointment change → Success state → Follow-up notification modal
- **Benefits**: 
  - Appointment changes succeed even if notification fails
  - User can customize notification message before sending
  - Explicit "Send" vs "Skip" choice
- **Implementation**: Backend returns `notification_preview` in response, frontend shows `NotificationModal` after success

### State Management

**Auto-Assignment State**:
- **`is_auto_assigned`** (current state): `True` = hidden from practitioner, `False` = visible
- **`originally_auto_assigned`** (historical flag): Never changes once set, preserves historical fact

**State Transitions**:
- `is_auto_assigned = True` → `False`: Appointment becomes visible to practitioner
- `is_auto_assigned = False` → `True`: Appointment becomes hidden from practitioner
- `originally_auto_assigned`: Immutable once set

### Recency Limit Automatic Assignment

**Core Rule**: Auto-assigned appointments automatically become visible when they reach the recency limit.

- When appointment is within `minimum_booking_hours_ahead` hours:
  - System automatically makes it visible (`is_auto_assigned = False`)
  - Original temp-assigned practitioner receives notification
  - Notification appears **as if patient booked directly**
- **Patient reschedules are blocked** if new time would be within recency limit
- Automatic assignment only happens via background cron job processing

**Rationale**: Ensures practitioners are notified in time to prepare, while preventing last-minute patient bookings.

---

## Summary

This document covers:
- Core business logic for appointment creation, editing, and cancellation
- Auto-assignment visibility and notification rules
- Booking restrictions (clinic admins bypass, patients must follow)
- Receipt constraints (previously checked out appointments cannot be modified)
- Appointment features (duplication, rescheduling, recurring)
- Permissions (view, edit, delete, duplicate)
- Edge cases (inactive practitioners, soft-deleted types, cancelled appointments, concurrent edits)
- Technical design (form architecture, notification system, state management)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

