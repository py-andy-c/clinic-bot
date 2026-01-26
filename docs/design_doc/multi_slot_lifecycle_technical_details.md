# Technical Detail: Multi-Slot Appointment Lifecycle and Approval Fix

## Overview
This document describes the technical lifecycle of appointments that allow multiple time slot selection, specifically addressing a bug where these appointments were not correctly cleared from the clinic review queue.

## The Problem (Bug)
Previously, multi-slot appointments that were pending review would often require two approvals or remain in the "Pending Review" dashboard even after the first approval. This was due to:
1.  **Early Return in Service**: The `AppointmentService.update_appointment` method used an early return pattern for time confirmations, which bypassed the final steps of the update flow.
2.  **Stale Visibility Flags**: Because of the early return, the `is_auto_assigned` flag (which controls dashboard visibility) was not being set to `False` until a second manual "practitioner assignment" edit was made.
3.  **Redundant Notifications**: The system would sometimes send "Appointment Edit" notifications instead of "Appointment Confirmation" notifications during the approval step.

## Corrected Appointment Lifecycle

### 1. Creation Phase (Patient Booking)
When a patient selects multiple time slots:
- **`status`**: `confirmed`
- **`pending_time_confirmation`**: `True`
- **`is_auto_assigned`**: `True` (Ensures it appears in the Clinic Review dashboard)
- **`alternative_time_slots`**: Array of ISO strings (patient preferences)
- **`start_time`**: Set to the earliest of the patient's selected slots (tentative holder)

### 2. Review Phase (Clinic Action)
The appointment remains in the `AutoAssignedAppointmentsPage` (Review Queue) as long as `is_auto_assigned == True` or `pending_time_confirmation == True`.

### 3. Resolution Phase (Manual Clinic Approval)
When an admin or practitioner selects a final slot and clicks "Confirm":
- **Single Atomic Step**: The backend now processes the time confirmation *and* the internal status resolution in one step.
- **Key Field Transitions**:
    | Field | Change | Result |
    | :--- | :--- | :--- |
    | `pending_time_confirmation` | `True` → `False` | Resolves the "Pending" status for the patient. |
    | `is_auto_assigned` | `True` → `False` | **Removes the appointment from the Review Queue.** |
    | `alternative_time_slots` | `[...]` → `None` | Clears proposal options. |
    | `confirmed_by_user_id` | `null` → `User ID` | Audit trail for time selection. |
    | `reassigned_by_user_id` | `null` → `User ID` | Audit trail for final practitioner assignment. |
- **Notification**: The system triggers a `send_appointment_confirmation` notification (using the clinic's preferred template) instead of a generic edit notification.

### 4. Final State
The appointment is now a standard, assigned appointment:
- It is visible on the calendar under the selected practitioner.
- It is **no longer visible** in the review queue.
- The patient sees a confirmed time in their LINE interface.

## Critical Implementation Detail: State Capture Timing
To ensure that practitioners receive the correct notifications when an appointment transitions from "Auto-Assigned" to "Confirmed", the backend captures the `old_is_auto_assigned` state at the very beginning of the `update_appointment` method. This prevents the "early resolution" of visibility flags from breaking the notification logic that relies on the state prior to the update.

## Implementation Details (Backend)
The fix involved merging the `confirm_appointment_time` logic directly into the core `update_appointment` flow in `AppointmentService`. 

By removing the `return` statement after time confirmation and setting a local `is_resolving_time_confirmation` flag, the service now continues through to the final blocks of `_update_appointment_core`, which handle:
- Practitioner ID resolution (preserving the assignment).
- Resource re-allocation (ensuring equipment is booked for the final slot).
- Setting `is_auto_assigned = False` based on the acting user.

## References
- [Multiple Time Slot Selection](./multiple_time_slot_selection.md)
- [Multi-Timeslot Appointment Editing](./multi_timeslot_appointment_editing.md)
