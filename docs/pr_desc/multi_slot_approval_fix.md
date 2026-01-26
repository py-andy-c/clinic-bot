# PR Description: Multi-Slot Appointment Approval and Visibility Fix

## Summary
This PR resolves a high-priority bug where appointments with multiple time slot selection would require two separate approval steps (time confirmation + practitioner assignment) and remain in the clinic's "Pending Review" dashboard longer than intended.

## Changes

### 1. Backend Service Consolidation (Core Fix)
- **Unified logic in `AppointmentService.update_appointment`**: Merged the time confirmation logic directly into the main update flow.
- **Critical Bug Fix (Notification Timing)**: Fixed a bug where the appointment state was being modified before capturing the "old" state for notification processing. This ensures that practitioners correctly receive notifications about new confirmed appointments.
- **Improved Visibility Logic**: Explicitly clearing `is_auto_assigned = False` and `alternative_time_slots = None` when a clinic user confirms a time slot.
- **Refined Notifications**: Integrated a check to send `send_appointment_confirmation` instead of a generic edit notification when a multi-slot appointment is resolved. Forced this notification to always send even if the tentatively held time didn't change, ensuring the patient is informed when the review is complete.

### 2. Auto-Confirmation Service Update
- Updated `AutoTimeConfirmationService` to clear `is_auto_assigned` and `alternative_time_slots` when the system auto-locks a slot.
- **Improved Audit Trail**: Now correctly sets `confirmed_at` and `confirmed_by_user_id (null)` for auto-confirmations.

### 3. API Optimization
- Modified `edit_clinic_appointment` in `api/clinic/appointments.py` to pass a pre-fetched `appointment` object to the service layer. This prevents redundant database queries and ensures consistency across the update transaction.

### 4. Technical Debt Removal
- **Deleted `confirm_appointment_time`**: This legacy method was redundant following the unification of the update flow.

### 5. Documentation
- Created `docs/design_doc/multi_slot_lifecycle_technical_details.md` to document the lifecycle of multi-slot appointments and the logic behind these fixes.

## Impact
- **Clinic Staff**: Will now see appointments disappear from the "Pending Review" list immediately after a single confirmation.
- **Patients**: Will receive a single, clearly-typed confirmation notification instead of multiple or generic edit notices.
- **System**: Improved database efficiency and reduced risk of race conditions during concurrent edits.

## Testing Performed
- Verified with unit tests that a single call to `update_appointment` correctly clears visibility flags and updates all related models.
- Manual verification of the notification flow for `clinic_triggered` events.
