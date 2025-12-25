# Post-Appointment Follow-Up Messages - Design

## Overview

Automated follow-up messages sent to patients after appointments. Uses a **generalized scheduled LINE message system** that handles all asynchronous message sending (follow-ups, reminders, practitioner notifications).

## Core Features

1. **Per-service-item configuration** - Each appointment type can have multiple follow-up messages
2. **Two timing modes:**
   - **Mode A**: X hours after appointment end time
   - **Mode B**: Specific time on Y days after appointment date
3. **Message templates** - Customizable with placeholders (same as confirmation/reminder messages)
4. **UI warnings** - Warns when delays exceed 90 days

## Database Schema

### `follow_up_messages` (Configuration)
- Stores follow-up message settings per appointment type
- Fields: `timing_mode`, `hours_after`, `days_after`, `time_of_day`, `message_template`, `is_enabled`, `display_order`
- Constraint: Timing mode consistency (Mode A requires `hours_after`, Mode B requires `days_after` + `time_of_day`)

### `scheduled_line_messages` (Generalized Scheduling)
- Unified table for all scheduled LINE messages (follow-ups, reminders, practitioner notifications)
- Fields: `recipient_type`, `recipient_line_user_id`, `message_type`, `message_template`, `message_context` (JSONB), `scheduled_send_time`, `status`, `retry_count`
- Indexes: `(status, scheduled_send_time, clinic_id)` for efficient cron job queries

## Architecture

### Message Scheduling Flow

**When appointment is created/confirmed:**
1. Query enabled follow-up messages for appointment type
2. Calculate `scheduled_send_time` based on timing mode
3. Create `ScheduledLineMessage` records with status='pending'
4. Auto-adjust if calculated time is in past (Mode B only: move to next day)

**Hourly cron job (`ScheduledMessageScheduler`):**
1. Query pending messages with `SELECT FOR UPDATE SKIP LOCKED` (supports concurrent instances)
2. Process in batches of 100 to avoid long-running transactions
3. For each message:
   - Validate appointment still exists, is confirmed, and appointment type is not deleted
   - Build context and render message template
   - Send via LINE API (creates `LinePushMessage` record with analytics labels)
   - Update status to 'sent' or handle errors with retry logic

### Validation Before Sending

**`validate_appointment_for_message()` checks:**
- Appointment exists and status is 'confirmed'
- Appointment type exists and `is_deleted = false` (prevents sending for deleted types)
- Patient has LINE user
- Follow-up message is still enabled (if applicable)
- Reminder is enabled for appointment type (if reminder message)
- Practitioner daily: At least one appointment with non-deleted appointment type

### Rate Limiting

**Design Decision:** No artificial delays between message sends.

- LINE API allows 2,000 requests/second per channel
- Our usage: Hourly batches of ~100 messages (well below limits)
- If 429 errors occur, retry logic with exponential backoff handles them
- **Monitoring:** Production logs should be monitored for 429 errors. If frequent, consider per-clinic rate limiting.

**Rationale:** Fixed delays would unnecessarily slow down message sending, especially when scaling to many clinics. The retry logic provides safety while maximizing throughput.

### Retry Logic

- Max 3 retries with exponential backoff: 1 hour, 2 hours, 4 hours
- After max retries: Mark as permanently failed, log error
- Future: Add admin notifications for permanently failed messages

## Edge Cases

### Appointment Cancellations
- When canceled: Mark all pending scheduled messages as 'skipped'
- **Re-activation:** Logic in place to reschedule when status changes from cancelled → confirmed
  - **Note:** Currently blocked by validation that prevents editing cancelled appointments
  - **TODO:** Update `_get_and_validate_appointment_for_update()` to allow status changes, or add separate `re_activate_appointment()` method

### Appointment Edits (Time Changes)
- Cancel all pending messages (mark as 'skipped')
- Reschedule all follow-up messages with new appointment time
- Also reschedules reminders and practitioner notifications

### Appointment Type Deletion
- When appointment type is soft-deleted (`is_deleted = true`):
  - Validation skips scheduled messages for deleted appointment types
  - Prevents sending messages for appointments with deleted types
  - Applied to all message types: follow-ups, reminders, practitioner daily

### Follow-Up Message Disabled After Scheduling
- Validation checks `is_enabled` flag when sending
- Messages for disabled follow-ups are skipped

### Mode B: Time in Past
- If `days_after=0` and calculated time is before appointment end time:
  - Auto-adjust to next day at same time
  - Log auto-adjustment

### Very Long Delays
- No hard limit on delay duration
- **UI Warning:** Shows warning if delay > 90 days (per design doc recommendation)
  - Mode A: Warning when `hours_after > 2160` (90 days)
  - Mode B: Warning when `days_after > 90`

### Failed Sends
- Mark as 'failed', store error message
- Retry with exponential backoff (max 3 retries)
- After max retries: Permanently failed, log for monitoring

## Message Type to Analytics Labels

**Labels structure:**
```python
{
    'recipient_type': 'patient' | 'practitioner',
    'trigger_source': 'system_triggered',
    'event_type': 'appointment_follow_up' | 'appointment_reminder' | 'practitioner_daily_notification'
}
```

Labels are minimal - only `event_type` needed for dashboard grouping. Detailed timing config stored in source tables.

## Migration Status

### ✅ Completed
- Follow-up messages: Fully implemented using `scheduled_line_messages`
- Appointment reminders: Migrated to `scheduled_line_messages` via `ReminderSchedulingService`
- Practitioner daily notifications: Migrated to `scheduled_line_messages` via `PractitionerNotificationSchedulingService`

### Legacy Code
- `ReminderService`: **DEPRECATED** - Scheduler methods deprecated, only `format_reminder_message()` used for preview
- `PractitionerDailyNotificationService`: **DEPRECATED** - Scheduler methods deprecated, not started in `main.py`

All scheduled messages now use the unified `ScheduledMessageScheduler` and `ScheduledMessageService`.

## Design Decisions

1. **No rate limiting delays:** Removed fixed delays (0.5-1s) to maximize throughput. LINE API limits (2,000/sec) far exceed our usage. Retry logic handles 429 errors.

2. **Appointment type deletion validation:** Added checks to prevent sending messages for deleted appointment types. Applied to all message types.

3. **Re-activation logic:** Prepared for future support. Currently blocked by validation, but logic will automatically reschedule messages when enabled.

4. **UI warnings:** Show warnings for delays > 90 days to help prevent configuration errors.

5. **Template storage:** Store template in `scheduled_line_messages` for audit trail. Resolved text tracked in `line_push_messages` when sent.

6. **Batch processing:** Process 100 messages per batch to avoid long-running transactions.

7. **Concurrent scheduler support:** Use `SELECT FOR UPDATE SKIP LOCKED` for safe concurrent execution.

8. **No backfill:** Only schedule messages for new appointments created after deployment.

## Summary

The generalized scheduled message system provides:
- **Unified scheduling** - All asynchronous LINE messages use `scheduled_line_messages`
- **Efficient delivery** - Pre-scheduled messages with indexed queries
- **Comprehensive validation** - Appointment type deletion, status checks, enabled flags
- **Performance optimized** - No unnecessary delays, batch processing
- **Analytics integration** - Messages tracked with minimal labels for dashboard grouping
- **Edge case handling** - Cancellations, edits, deletions, retries

All asynchronous message sending has been migrated to this unified system.
