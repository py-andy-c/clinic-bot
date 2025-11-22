# Appointment Business Logic

This document defines the expected business logic for appointment creation and editing in the clinic system.

## Table of Contents
- [Key Concepts and Principles](#key-concepts-and-principles)
- [Appointment Creation](#appointment-creation)
  - [By Clinic](#by-clinic)
  - [By Patient](#by-patient)
- [Appointment Editing](#appointment-editing)
  - [By Clinic](#by-clinic-1)
  - [By Patient](#by-patient-1)
- [Edge Cases](#edge-cases)
- [Implementation Notes](#implementation-notes)

---

## Key Concepts and Principles

### 1. Auto-Assignment Visibility Principle

**Core Rule**: Auto-assigned practitioners **never know** about appointments until they are actually assigned (by admin or cron job).

- Auto-assigned appointments are **hidden** from practitioners:
  - Not visible on their calendar
  - No LINE notifications sent
  - Practitioner is unaware of the appointment's existence
- This applies to:
  - Appointments created with "不指定" (no specific practitioner)
  - Appointments changed to "不指定" by patients
- Practitioners only become aware when:
  - Admin manually reassigns the appointment to them
  - Cron job automatically makes it visible at the recency limit (`minimum_booking_hours_ahead` hours before appointment)

**Rationale**: This allows the clinic to review and reassign appointments without practitioners being prematurely notified.

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
- **Practitioner is optional** (can select "不指定")

**Rationale**: Clinic admins need flexibility for administrative purposes, while patients must follow clinic policies.

### 4. Notification Rules Based on Visibility

**Core Rule**: Notifications are sent based on **who knows about the appointment**.

#### Practitioner Notifications
- **If practitioner never knew** about appointment (was auto-assigned):
  - No notification when appointment changes
  - No notification when appointment is reassigned
  - Silent changes
- **If practitioner already knew** about appointment (was manually assigned):
  - Receives notification when appointment changes
  - Receives cancellation notification if patient changes to "不指定"
  - Receives reassignment notification if practitioner changes

#### Patient Notifications
- **Always notified** about their own appointment changes
- **Exception**: If originally auto-assigned and only practitioner changes (no time change), patient is NOT notified (still sees "不指定")

#### Admin Reassignment Notifications
- When admin reassigns auto-assigned appointments:
  - New practitioner receives notification **as if patient made the appointment**
  - Notification format is identical to patient booking (practitioner cannot distinguish)
  - Old practitioner (if any) never knew, so no notification needed

**Rationale**: Notifications should reflect what each party knows and needs to know.

### 5. Auto-Assignment State Management

**Core Rule**: System tracks both **current state** and **historical state** of auto-assignment.

#### State Fields
- **`is_auto_assigned`** (current state):
  - `True`: Appointment is currently auto-assigned (hidden from practitioner, shows "不指定" to patient)
  - `False`: Appointment is manually assigned (visible to practitioner, shows practitioner name to patient)
  - Can change during appointment lifecycle
- **`originally_auto_assigned`** (historical flag):
  - `True`: Appointment was originally created without practitioner specified
  - `False`: Appointment was originally created with practitioner specified
  - **Never changes** once set (preserves historical fact)

#### State Transitions
- `is_auto_assigned = True` → `False`: Appointment becomes visible to practitioner
- `is_auto_assigned = False` → `True`: Appointment becomes hidden from practitioner
- `originally_auto_assigned`: Immutable once set

**Rationale**: Historical tracking enables analytics and understanding of appointment flow.

### 6. Recency Limit Automatic Assignment

**Core Rule**: Auto-assigned appointments automatically become visible when they reach the recency limit.

- When appointment is within `minimum_booking_hours_ahead` hours:
  - System automatically makes it visible (`is_auto_assigned = False`)
  - Original temp-assigned practitioner receives notification
  - Notification appears **as if patient booked directly**
- **Patient reschedules are blocked** if new time would be within recency limit
- Automatic assignment only happens via:
  - Background cron job processing
  - NOT during patient reschedules (blocked by booking constraint)

**Rationale**: Ensures practitioners are notified in time to prepare, while preventing last-minute patient bookings.

### 7. Practitioner Assignment Logic

**Core Rule**: System attempts to preserve practitioner assignments when possible.

#### Patient Editing Auto-Assigned Appointments
- When patient edits time but keeps "不指定":
  - System attempts to **keep same practitioner** if available at new time
  - Only re-assigns if original practitioner is NOT available
  - Re-assignment uses load balancing (practitioner with least appointments)

#### Patient Changing from Visible to "不指定"
- If appointment was made visible by cron job:
  - If old practitioner still available: Assign to old practitioner, keep visible
  - If old practitioner not available: Auto-assign new, hide appointment

**Rationale**: Minimizes disruption by keeping same practitioner when possible.

---

## Appointment Creation

### By Clinic

When a clinic admin creates an appointment on behalf of a patient:

#### Booking Constraints
- **Does NOT enforce** booking restrictions:
  - `booking_restriction_type`
  - `minimum_booking_hours_ahead`
  - `max_future_appointments`
  - `max_booking_window_days`

#### Practitioner Requirements
- **Must specify a practitioner** (cannot use "不指定" / auto-assignment)
- Practitioner must be explicitly selected

#### Notifications
- **Both practitioner and patient** receive LINE notifications
  - Practitioner receives appointment notification
  - Patient receives appointment confirmation notification

---

### By Patient

When a patient creates an appointment through the LIFF interface:

#### Booking Constraints
- **Must enforce** all booking restrictions:
  - `booking_restriction_type`: Type of restriction (e.g., minimum hours required)
  - `minimum_booking_hours_ahead`: Minimum hours in advance required
  - `max_future_appointments`: Maximum number of active future appointments
  - `max_booking_window_days`: Maximum days in advance appointments can be booked

#### Practitioner Selection
- **Practitioner is optional** (can select "不指定" / auto-assignment)
- If practitioner is specified, must be a valid practitioner for the appointment type

#### Auto-Assignment Behavior
When patient selects "不指定" (no specific practitioner):
- System **auto-assigns** a temporary practitioner
- The auto-assigned practitioner:
  - **Does NOT receive** a LINE notification
  - **Does NOT see** the event on their calendar
- The patient:
  - **Receives** a LINE notification
  - Notification shows "不指定" as the practitioner name
- On LIFF:
  - Future appointments list shows "不指定" as the practitioner
  - Appointment is marked as `is_auto_assigned = True`
  - Appointment is marked as `originally_auto_assigned = True`

#### Notifications (Practitioner Specified)
If practitioner is specified:
- **Both practitioner and patient** receive LINE notifications
  - Practitioner receives appointment notification
  - Patient receives appointment confirmation notification

---

## Appointment Editing

### By Clinic

When a clinic admin edits an appointment (from calendar page or auto-assigned-appointments page):

#### Booking Constraints
- **Does NOT enforce** booking restrictions:
  - `booking_restriction_type`
  - `minimum_booking_hours_ahead`
  - `max_future_appointments`
  - `max_booking_window_days`

#### Practitioner Requirements
- **Must specify a practitioner** (cannot use "不指定")

#### Auto-Assigned Appointment Reassignment

**Scenario: Editing an auto-assigned appointment**

When clinic admin reassigns an auto-assigned appointment:
- Old practitioner **never knows** about the original assignment (was hidden from them)
- New practitioner (can be different or same as old) receives notification **as if the patient made the appointment**
- Reassignment by admin is **completely behind the scenes**
- After reassignment:
  - `is_auto_assigned` is set to `False`
  - `reassigned_by_user_id` is set to the admin's user ID
  - `reassigned_at` is set to current timestamp

**Automatic Assignment at Recency Limit:**
- If admin hasn't reassigned the appointment before `minimum_booking_hours_ahead` hours prior to the appointment:
  - System automatically assigns it to the original temp-assigned practitioner
  - `is_auto_assigned` is set to `False`
  - The practitioner receives a notification **as if the patient made the appointment**

**Time Changes:**
- If time changes during reassignment:
  - Patient **is notified** about the time change
- If only practitioner changes (time unchanged):
  - Patient **is NOT notified** (still shows "不指定" from patient's perspective)
  - Patient continues to see "不指定" as the practitioner on LIFF
- If both practitioner and time change:
  - Patient **is notified** about the time change only (not about practitioner change)
  - Patient continues to see "不指定" as the practitioner on LIFF

**Admin Confirmation Without Changes:**
- If admin views an auto-assigned appointment and confirms it without changing practitioner or time:
  - `is_auto_assigned` is set to `False`
  - `reassigned_by_user_id` is set to the admin's user ID
  - `reassigned_at` is set to current timestamp
  - Practitioner receives notification **as if the patient made the appointment**
  - Practitioner **never knows** about the admin's reassignment (notification format is identical to patient booking)

**Admin Reassignment to Same Practitioner:**
- If admin reassigns an auto-assigned appointment to the same practitioner (just confirming):
  - Same behavior as "Admin Confirmation Without Changes" above
  - Practitioner receives notification **as if the patient just made a new appointment**

#### Manually Assigned Appointment Editing

**Scenario: Editing a non-auto-assigned appointment**

When clinic admin edits a manually assigned appointment:
- **Both old and new practitioner** are notified about:
  - Practitioner change (if changed)
  - Time change (if changed)
- **Patient is notified** about:
  - Practitioner change (if changed)
  - Time change (if changed)

---

### By Patient

When a patient edits their appointment through LIFF:

#### Booking Constraints
- **Must enforce** all booking restrictions:
  - `booking_restriction_type`
  - `minimum_booking_hours_ahead`: **Applies to the NEW appointment time** (patient cannot reschedule to a time within this limit)
  - `max_future_appointments`
  - `max_booking_window_days`

#### Cancellation Window
- **Must be edited** at least `minimum_cancellation_hours_before` hours before the appointment
- This restriction applies to the **current** appointment time (not the new time)

#### Practitioner Selection
- **Practitioner is optional** (can select "不指定" / auto-assignment)

#### Notifications
- **Patient always receives** a notification about the edit

#### Changing to "不指定" (Auto-Assignment)

**Scenario: Patient changes appointment to "不指定"**

When patient changes practitioner to "不指定":
- `is_auto_assigned` is set to `True`
- System waits for clinic admin to review and reassign
- Auto-assigned practitioner:
  - **Does NOT see** the calendar event
  - **Does NOT receive** a notification

**Special Case: Previously Manually Assigned**
If the appointment was previously manually assigned (`is_auto_assigned = False`):
- Original practitioner **already saw** this event (calendar and notification)
- When patient changes to "不指定":
  - Original practitioner receives notification **as if the patient cancelled the appointment**
  - Appointment becomes hidden from practitioner's calendar

#### Changing to Specific Practitioner

**Scenario: Patient specifies a practitioner**

If practitioner is specified:
- **Both new and old practitioner** are notified
- Notification informs them that **the patient made the change**
- Patient receives notification about the change

**Special Case: Changing from "不指定" to Specific Practitioner**
- If appointment was previously auto-assigned (`is_auto_assigned = True`):
  - Old auto-assigned practitioner **never knew** about the appointment (was hidden)
  - Old practitioner receives **NO notification** (silent change)
  - New practitioner receives notification **as if the patient just made a new appointment**
- If appointment was previously manually assigned (`is_auto_assigned = False`):
  - Old practitioner **already knew** about the appointment (was visible)
  - Old practitioner receives notification **as if the patient cancelled the appointment**
  - New practitioner receives notification **as if the patient just made a new appointment**

#### Editing Auto-Assigned Appointment (Keeping "不指定")

**Scenario: Patient edits time but keeps "不指定"**

When patient edits an auto-assigned appointment (e.g., changes time but keeps "不指定"):
- System attempts to **keep the same auto-assigned practitioner** if they're still available at the new time
- If original practitioner is **NOT available** at the new time:
  - System re-assigns based on load balancing (practitioner with least appointments that day)
  - Old practitioner receives **NO notification** (never knew about original assignment)
  - New practitioner receives **NO notification** (still auto-assigned, hidden)
- If original practitioner **IS available** at the new time:
  - Same practitioner is kept
  - Practitioner receives **NO notification** (still auto-assigned, hidden)
- **Patient receives notification** about the time change (still shows "不指定" as practitioner)

#### Editing Specific Practitioner Appointment (Time Change Only)

**Scenario: Patient changes time but keeps same specific practitioner**

When patient edits an appointment with a specific practitioner but only changes the time:
- **Both patient and practitioner** receive notifications about the time change
- Practitioner receives appointment edit notification
- Patient receives appointment edit notification

#### Changing from Visible to "不指定" (Previously Made Visible by Cron)

**Scenario: Appointment was auto-assigned, made visible by cron job, then patient changes to "不指定" again**

If appointment was originally auto-assigned but cron job already made it visible (`is_auto_assigned = False`, `originally_auto_assigned = True`):
- If the original assigned practitioner is **still available** at the selected time:
  - Assign to the old practitioner
  - `is_auto_assigned` is set to `False` (stays visible to practitioner)
  - Practitioner receives **NO notification** (no change from their perspective)
- If the old practitioner is **NOT available** at the selected time:
  - Auto-assign based on load balancing
  - `is_auto_assigned` is set to `True` (becomes hidden again)
  - Old practitioner receives notification **as if the patient cancelled the appointment**
  - New practitioner receives **NO notification** (still auto-assigned, hidden)

---

## Edge Cases

### Inactive or Deleted Practitioner

**Scenario: Auto-assigned practitioner becomes inactive or is deleted**

- **Admin Responsibility**: System should warn admin about future appointments when they try to delete/deactivate a practitioner. Admin is responsible for ensuring appointments are properly reassigned.
- **System Behavior**:
  - When patient tries to edit appointment: System should automatically re-assign to an available practitioner (if original is unavailable)
  - When cron job tries to make appointment visible: System should re-assign to an available practitioner if original is inactive/deleted
  - When admin tries to reassign: Admin can reassign to any active practitioner

### Concurrent Edits

**Scenario: Admin and patient try to edit the same appointment simultaneously**

- **Recommended Approach**: Use database-level optimistic locking or transactions to prevent race conditions
- **Expected Behavior**: 
  - Last write wins (or first write succeeds, second fails with conflict error)
  - System should provide clear error messages to the user whose edit was rejected
  - Consider showing a warning if appointment was recently modified

### Cancelled Appointments

**Scenario: Attempting to edit a cancelled appointment**

- **Rule**: Cancelled appointments **cannot be edited** by anyone (patient or admin)
- **Status Check**: System should validate appointment status before allowing edits
- **Error Message**: Clear message indicating appointment is cancelled and cannot be modified

### Appointment Type Changes

**Scenario: Attempting to change appointment type during edit**

- **Rule**: Appointment type **cannot be changed** during edit operations
- **Rationale**: Appointment type is a core attribute that defines the service being provided
- **Alternative**: If type change is needed, appointment should be cancelled and recreated

### Past Appointments

**Scenario: Attempting to edit an appointment that is in the past**

- **Rule**: Past appointments **cannot be edited**
- **Validation**: System should check appointment start time against current time
- **Error Message**: Clear message indicating appointment is in the past and cannot be modified

### Multiple Rapid Edits

**Scenario: Patient or admin makes multiple edits in quick succession**

- **Rule**: No restrictions on multiple time changes
- **Behavior**: Each edit is processed independently
- **Consideration**: System should handle rapid edits gracefully (no special throttling)

### Notification Failures

**Scenario: LINE notification fails to send during appointment edit**

- **Rule**: Notification failures **do NOT block** the appointment edit
- **Behavior**: 
  - Appointment edit succeeds even if notification fails
  - Notification failure is logged for investigation
  - User receives success confirmation for the edit
- **Rationale**: Notification is a side effect, not a core requirement for the edit operation

### Appointment Conflicts During Edit

**Scenario: Another appointment is created between loading edit form and submitting**

- **Rule**: Edit should **fail** if a conflict is detected
- **Conflict Detection**: System checks for scheduling conflicts at edit time
- **Error Message**: Clear message indicating the time slot is no longer available
- **User Action**: User should refresh and try again with available time slots

### Soft-Deleted Appointment Types

**Scenario: Appointment type is soft-deleted after appointment is created**

- **Rule**: Editing is **still allowed** for appointments with soft-deleted types
- **Display**: Appointment type name shows as "已刪除服務類型" (Deleted Service Type) in UI
- **Behavior**: Appointment functionality remains intact, only display name changes

### Deleted Patients

**Scenario: Patient is deleted (hard delete)**

- **Rule**: Appointments for deleted patients **cannot be edited**
- **Validation**: System should check patient exists before allowing edits
- **Error Message**: Clear message indicating patient no longer exists

### Clinic Settings Changes

**Scenario: Clinic booking settings change after appointment is created**

- **Rule**: Existing appointments are **grandfathered** under old settings
- **Behavior**: 
  - Existing appointments are not affected by settings changes
  - Only new appointments and edits are subject to new settings
  - Edit operations use current settings, not settings at appointment creation time

### Appointment Type Duration Changes

**Scenario: Appointment type duration is updated after appointment is created**

- **Rule**: Existing appointments **keep their original end time**
- **Behavior**: 
  - Original appointment end time is preserved
  - Duration changes only affect new appointments
  - Edit operations use current appointment type duration for new time slots

### Timezone Considerations

**Scenario: Appointments near midnight or across day boundaries**

- **Rule**: All times are stored and processed in Taiwan timezone (UTC+8)
- **Behavior**:
  - Date boundaries are based on Taiwan timezone
  - Midnight edge cases (e.g., 23:30-00:30 appointments) are handled correctly
  - System should validate that start_time and end_time are on the same date in Taiwan timezone

### Appointment State Transitions

**Key State Transitions:**
- `is_auto_assigned = True` → `is_auto_assigned = False`: Appointment becomes visible to practitioner
- `is_auto_assigned = False` → `is_auto_assigned = True`: Appointment becomes hidden from practitioner
- `originally_auto_assigned`: Never changes once set (historical record)
- `status = 'confirmed'` → `status = 'canceled_by_patient'` or `'canceled_by_clinic'`: Appointment is cancelled (cannot be edited)

---

## Implementation Notes

### Operational Constraints
- **Single Appointment Operations**: All appointment operations (create, edit, cancel) are performed one appointment at a time. No bulk operations are supported.
- **Authorization**: Authorization checks (e.g., patient can only edit their own appointments) are handled separately by the API layer and are not part of the core business logic documented here.
- **Validation Error Messages**: Specific validation error messages are implementation details and may vary, but should be clear and user-friendly.

### Notification Rules Summary

| Scenario | Patient Notified | Practitioner Notified | Notes |
|----------|-----------------|----------------------|-------|
| **Creation by Clinic** | ✅ | ✅ | Practitioner must be specified |
| **Creation by Patient (specified)** | ✅ | ✅ | Both notified |
| **Creation by Patient (不指定)** | ✅ | ❌ | Shows "不指定" to patient |
| **Edit by Clinic (auto→manual, time only)** | ✅ | ✅ | Patient notified about time change |
| **Edit by Clinic (auto→manual, practitioner only)** | ❌ | ✅ | Patient not notified, still sees "不指定" |
| **Edit by Clinic (auto→manual, both)** | ✅ Time only | ✅ | Patient notified about time change only |
| **Edit by Clinic (manual→manual)** | ✅ | ✅ Both | Both practitioners notified |
| **Edit by Patient (→不指定)** | ✅ | ⚠️ Cancel if was manual | Original practitioner sees cancellation if was visible |
| **Edit by Patient (不指定→specified)** | ✅ | ✅ New only | Old practitioner never knew, stays silent |
| **Edit by Patient (specified→specified)** | ✅ | ⚠️ Cancel old, notify new | Old sees cancellation, new sees appointment |
| **Edit by Patient (不指定→不指定, time change)** | ✅ | ❌ | Keep same practitioner if available, re-assign if not |
| **Edit by Patient (specified→same, time change)** | ✅ | ✅ | Both notified about time change |
| **Edit by Patient (visible→不指定, old available)** | ✅ | ❌ | Assign to old practitioner, stays visible (is_auto_assigned=False) |
| **Edit by Patient (visible→不指定, old unavailable)** | ✅ | ⚠️ Cancel old | Auto-assign new, old sees cancellation, new hidden |
