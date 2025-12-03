# Appointment Notification Flow Review

## Summary

This document reviews all appointment creation, deletion, edit, reschedule, and reassign flows on both the clinic side and LIFF side to ensure no duplicate LINE notifications are sent.

## Status: ✅ All Flows Verified - No Duplicates Found

### Fixed Issue
- **Clinic Appointment Creation**: Removed duplicate notification code from `/clinic/appointments` POST endpoint. The `AppointmentService.create_appointment()` method already handles all notifications.

---

## 1. Appointment Creation

### LIFF Side (`/liff/appointments` POST)
- **Endpoint**: `backend/src/api/liff.py:867-898`
- **Flow**: 
  - Calls `AppointmentService.create_appointment()` directly
  - No additional notifications sent in endpoint
- **Notifications Sent** (in `AppointmentService.create_appointment()`):
  - Patient: `NotificationService.send_appointment_confirmation()` (lines 178-192)
  - Practitioner: `NotificationService.send_practitioner_appointment_notification()` (lines 172-176) - only if NOT auto-assigned
- **Status**: ✅ No duplicates

### Clinic Side (`/clinic/appointments` POST)
- **Endpoint**: `backend/src/api/clinic.py:1645-1695`
- **Flow**: 
  - Calls `AppointmentService.create_appointment()` directly
  - **FIXED**: Removed duplicate manual notification code (previously lines 1679-1720)
- **Notifications Sent** (in `AppointmentService.create_appointment()`):
  - Patient: `NotificationService.send_appointment_confirmation()` (lines 178-192)
  - Practitioner: `NotificationService.send_practitioner_appointment_notification()` (lines 172-176) - only if NOT auto-assigned
- **Status**: ✅ No duplicates (fixed)

---

## 2. Appointment Cancellation

### LIFF Side (`/liff/appointments/{id}` DELETE)
- **Endpoint**: `backend/src/api/liff.py:1037-1064`
- **Flow**: 
  - Calls `AppointmentService.cancel_appointment()` directly
  - No additional notifications sent in endpoint
- **Notifications Sent** (in `AppointmentService.cancel_appointment()`):
  - Patient: `NotificationService.send_appointment_cancellation()` (lines 616-620)
  - Practitioner: `NotificationService.send_practitioner_cancellation_notification()` (lines 611-614)
- **Status**: ✅ No duplicates

### Clinic Side (`/clinic/appointments/{id}` DELETE)
- **Endpoint**: `backend/src/api/clinic.py:1517-1594`
- **Flow**: 
  - Calls `AppointmentService.cancel_appointment()` directly
  - No additional notifications sent in endpoint
- **Notifications Sent** (in `AppointmentService.cancel_appointment()`):
  - Patient: `NotificationService.send_appointment_cancellation()` (lines 616-620)
  - Practitioner: `NotificationService.send_practitioner_cancellation_notification()` (lines 611-614)
- **Status**: ✅ No duplicates

---

## 3. Appointment Edit/Reschedule/Reassign

### LIFF Side (`/liff/appointments/{id}/reschedule` POST)
- **Endpoint**: `backend/src/api/liff.py:1083-1155`
- **Flow**: 
  - Calls `AppointmentService.update_appointment()` directly
  - No additional notifications sent in endpoint
- **Notifications Sent** (in `AppointmentService._update_appointment_core()`):
  - Patient: `NotificationService.send_appointment_edit_notification()` (lines 949-959) - only if `should_send_notification` is True
  - Practitioner notifications based on scenario (lines 940-1000):
    - **Scenario 1**: Changing from specific to auto-assigned → Cancellation to old practitioner (lines 940-946)
    - **Scenario 2**: Changing from specific to specific (admin edit) → Reassignment notification to both old and new (lines 970-972)
    - **Scenario 3**: Changing from specific to specific (patient edit) → Cancellation to old, appointment to new (lines 975-984)
    - **Scenario 4**: Auto-assigned becomes visible → Appointment notification to practitioner (lines 986-991)
    - **Scenario 5**: Time changed, practitioner unchanged → Edit notification to practitioner (lines 994-1000)
- **Status**: ✅ No duplicates (all scenarios are mutually exclusive)

### Clinic Side (`/clinic/appointments/{id}` PUT)
- **Endpoint**: `backend/src/api/clinic.py:1811-1893`
- **Flow**: 
  - Calls `AppointmentService.update_appointment()` directly
  - No additional notifications sent in endpoint
- **Notifications Sent** (same as LIFF side, in `AppointmentService._update_appointment_core()`):
  - Patient: `NotificationService.send_appointment_edit_notification()` (lines 949-959) - only if `should_send_notification` is True
  - Practitioner notifications based on scenario (same scenarios as LIFF side)
- **Status**: ✅ No duplicates

---

## Notification Logic Analysis

### Key Design Principles

1. **Single Responsibility**: All notification logic is centralized in `AppointmentService` methods. API endpoints only call service methods and do not send notifications directly.

2. **Mutually Exclusive Conditions**: The notification conditions in `_update_appointment_core()` are designed to be mutually exclusive:
   - Line 940: `old_practitioner and not old_is_auto_assigned and is_auto_assign and practitioner_actually_changed`
   - Line 963: `practitioner_actually_changed and not old_is_auto_assigned and not is_auto_assign`
   - Line 986: `old_is_auto_assigned and not appointment.is_auto_assigned and new_practitioner is not None`
   - Line 994: `time_actually_changed and not practitioner_actually_changed and not old_is_auto_assigned and old_practitioner`

3. **Idempotent Cancellation**: The `cancel_appointment()` method checks if appointment is already cancelled before sending notifications (line 572).

4. **Conditional Patient Notifications**: Patient edit notifications are only sent when `should_send_notification` is True, which is determined by:
   - Whether `send_patient_notification` parameter is True
   - Whether there are actual changes (`_has_appointment_changes()`)
   - Special handling for originally auto-assigned appointments (only notify if time changed)

---

## Verification Checklist

- [x] LIFF appointment creation - no duplicates
- [x] Clinic appointment creation - no duplicates (fixed)
- [x] LIFF appointment cancellation - no duplicates
- [x] Clinic appointment cancellation - no duplicates
- [x] LIFF appointment reschedule - no duplicates
- [x] Clinic appointment edit - no duplicates
- [x] All notification conditions are mutually exclusive
- [x] No manual notification sends in API endpoints (except webhook handler)

---

## Files Modified

1. `backend/src/api/clinic.py` (lines 1667-1685)
   - Removed duplicate notification code from `create_clinic_appointment` endpoint
   - Added comment explaining that service handles notifications

---

## Conclusion

All appointment flows have been reviewed and verified. The notification system is properly centralized in the service layer, and all API endpoints correctly delegate notification sending to the service methods without duplicating the logic.

**No duplicate notifications should occur in any of the reviewed flows.**

