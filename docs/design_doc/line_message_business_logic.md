# LINE Message Business Logic

## Overview

This document describes when LINE messages are sent to users and the business logic that determines whether notifications should be sent. The system distinguishes between **free reply messages** (using `reply_token`) and **paid push messages** (proactive notifications).

## Message Types

### Free Messages (Reply Messages)
- **Cost**: FREE
- **When**: Sent within 24 hours of a user message using `reply_token`
- **Use Case**: AI replies to patient messages
- **Implementation**: Uses `LINEService.send_text_message()` with `reply_token` parameter

### Paid Messages (Push Messages)
- **Cost**: PAID (consumes LINE message quota)
- **When**: Proactive notifications sent to users
- **Use Case**: Appointment confirmations, cancellations, reminders, etc.
- **Implementation**: Uses `LINEService.send_text_message()` without `reply_token` parameter

## Notification Rules

### General Principle
**Skip notifications when the user already knows about the change** (e.g., they see confirmation in UI).

### Patient Notifications

#### General Rule
**Patient-triggered changes**: NO notification to patient (they already see confirmation in UI)  
**Clinic-triggered changes**: YES notification to patient

#### Exception
**If clinic admin confirms auto-assignment OR changes from auto-assigned to another practitioner AND time did not change**: NO notification to patient

**Rationale**: When clinic confirms/changes auto-assignment without time change, patient still sees "不指定" (no specific practitioner), so no notification needed.

#### Appointment Creation
- ✅ **Send notification** if:
  - Clinic admin creates appointment (`line_user_id=None`)
  - Appointment is manually assigned (not auto-assigned)
- ❌ **Skip notification** if:
  - Patient creates appointment themselves (`line_user_id` provided)
  - Appointment is auto-assigned (patient will get reminder later)

**Rationale**: Patients see confirmation in UI when they create appointments. Auto-assigned appointments don't need immediate confirmation since patient will receive reminder later.

#### Appointment Cancellation
- ✅ **Send notification** if:
  - Clinic cancels appointment (`cancelled_by='clinic'`)
- ❌ **Skip notification** if:
  - Patient cancels appointment themselves (`cancelled_by='patient'`)

**Rationale**: Patients already know they cancelled since they initiated the action.

#### Appointment Edit/Reschedule
- ✅ **Send notification** if:
  - Clinic edits appointment (`reassigned_by_user_id` is not None)
  - AND (time changed OR not originally auto-assigned OR practitioner didn't change from auto-assigned)
- ❌ **Skip notification** if:
  - Patient edits appointment themselves (`reassigned_by_user_id=None`)
  - Clinic confirms auto-assignment AND time didn't change
  - Clinic changes from auto-assigned to another practitioner AND time didn't change

**Rationale**: Patients see confirmation in UI when they edit appointments. For originally auto-assigned appointments, patients only need to know about time changes (they still see "不指定" for practitioner).

#### Appointment Reminders
- ✅ **Send reminder** if:
  - Appointment is confirmed
  - Appointment is not auto-assigned
  - Reminder hasn't been sent yet (`reminder_sent_at` is None)
  - Appointment was created **before** the reminder window (more than `reminder_hours_before` hours ago)
- ❌ **Skip reminder** if:
  - Appointment was created **within** the reminder window (less than `reminder_hours_before` hours ago)

**Rationale**: If appointment was just created, patient already knows about it and doesn't need a reminder so soon.

**Configuration**: `clinic.reminder_hours_before` (default: 24 hours)

### Practitioner Notifications

#### New Appointment Notification
- ✅ **Send notification** if:
  - Appointment is manually assigned to practitioner
  - Practitioner has LINE account linked
- ❌ **Skip notification** if:
  - Appointment is auto-assigned (practitioners don't see auto-assigned appointments)

#### Appointment Cancellation/Edit Notifications
- ✅ **Send notification** when:
  - Practitioner's appointment is cancelled
  - Appointment is reassigned away from practitioner
  - Appointment time changes (if practitioner is still assigned)

**Note**: Practitioner notifications are always sent (no skip logic) since practitioners need to know about changes to their schedule.

### Admin Notifications

#### Auto-Assigned Appointment Notifications
- ✅ **Send notification** if:
  - Clinic has pending auto-assigned appointments
  - Admin has LINE account linked
  - Current time matches admin's configured notification time
- **Frequency**: Once per day (at configured time, default 21:00)

### Availability Notifications

#### Slot Availability Alerts
- ✅ **Send notification** if:
  - Slots matching user's notification preferences become available
  - User hasn't been notified today (`last_notified_date != today`)
  - Notification has future dates in time windows
- **Frequency**: Up to 3 times per day (9am, 3pm, 9pm Taiwan time)
- **Deduplication**: Only one notification per day per notification preference

## Implementation Details

### Trigger Source Tracking

All push messages are tracked with `trigger_source` label:
- `patient_triggered`: Action initiated by patient
- `clinic_triggered`: Action initiated by clinic admin
- `system_triggered`: Automated system notification (reminders, availability alerts)

### Notification Service Methods

- `send_appointment_confirmation()`: Sends confirmation when appointment is created
- `send_appointment_cancellation()`: Sends cancellation notification
- `send_appointment_edit_notification()`: Sends edit/reschedule notification
- `send_practitioner_appointment_notification()`: Notifies practitioner of new appointment
- `send_practitioner_cancellation_notification()`: Notifies practitioner of cancellation
- `send_practitioner_edit_notification()`: Notifies practitioner of appointment changes

### Reminder Service

- Runs hourly to check for appointments needing reminders
- Calculates reminder window: `current_time` to `current_time + reminder_hours_before + window_size`
- Skips reminders for appointments created within reminder window
- Marks `reminder_sent_at` after sending (or skipping) to prevent duplicates

## Cost Optimization

The current implementation reduces LINE message costs by:

1. **Skipping redundant patient notifications**: When patients create/edit/cancel appointments, they already see UI confirmation
2. **Skipping auto-assigned confirmations**: Patients will receive reminders later if needed
3. **Skipping reminders for recent appointments**: Appointments created within reminder window don't need immediate reminders
4. **Using free reply messages**: AI responses use `reply_token` (free within 24 hours)

## Future Considerations

Potential further optimizations:
- User preference toggles for notification types
- Batch notifications for multiple events
- Smart reminders based on user engagement
- Cooldown periods for availability notifications

## Related Documentation

- `docs/line_message_reduction_analysis.md`: Detailed analysis of all message scenarios and reduction options
- `docs/design_doc/clinic_dashboard.md`: Dashboard tracking for push messages and AI replies
