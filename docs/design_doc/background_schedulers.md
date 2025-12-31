# Background Schedulers - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for background schedulers (cron jobs) that run automated tasks in the clinic system. All schedulers use APScheduler with Taiwan timezone to ensure correct timing regardless of server timezone.

---

## Key Business Logic

### 1. Appointment Reminder Scheduler

**Purpose**: Send automated reminders to patients before their appointments via LINE messaging

**Schedule**: Runs every hour

**Window Logic**: 
- **Start**: Current time (checks from now)
- **End**: Current time + `reminder_hours_before` + `REMINDER_WINDOW_SIZE_MINUTES` (35 minutes)
- **Overlap**: 10-minute overlap between hourly runs ensures no appointments are missed

**Catch-Up Logic**: Automatically catches up on missed reminders during downtime and handles `reminder_hours_before` setting increases

**Clinic-Specific**: Each clinic has its own `reminder_hours_before` setting (default: 24 hours)

**Rationale**: Hourly checks with overlapping windows ensure reliable reminder delivery even if scheduler runs late or settings change.

### 2. Auto-Assignment Scheduler

**Purpose**: Automatically make auto-assigned appointments visible when booking recency limit is reached

**Schedule**: Runs every hour

**Logic**: Finds appointments where:
- `is_auto_assigned = True`
- `status = 'confirmed'`
- Appointment time is within `minimum_booking_hours_ahead` hours from now
- Makes appointment visible to assigned practitioner

**Immediate Run**: Runs immediately on startup to catch up on any missed appointments

**Rationale**: Ensures auto-assigned appointments become visible to practitioners at the appropriate time, allowing them to prepare.

### 3. Availability Notification Scheduler

**Purpose**: Send LINE notifications to users when appointment slots become available matching their notification preferences

**Schedule**: 
- **Notification Checks**: Runs at 9am, 3pm, 9pm Taiwan time (`NOTIFICATION_CHECK_HOURS`)
- **Cleanup**: Runs daily at 3 AM Taiwan time (`NOTIFICATION_CLEANUP_HOUR`)

**Notification Logic**:
- Checks user's availability notification preferences
- Finds available slots matching preferences
- Sends notifications (respects `MAX_TIME_WINDOWS_PER_NOTIFICATION` and `MAX_NOTIFICATIONS_PER_USER` limits)
- Deduplicates to prevent sending duplicate notifications

**Cleanup Logic**: Removes expired notifications older than `NOTIFICATION_DATE_RANGE_DAYS` (30 days)

**Immediate Run**: Runs immediately on startup to catch up on missed notifications (deduplication prevents duplicates)

**Rationale**: Scheduled checks at specific times reduce notification spam while ensuring users are informed of availability.

### 4. Practitioner Daily Notification Scheduler

**Purpose**: Send daily notifications to practitioners about their appointments for the next day

**Schedule**: Runs every hour

**Logic**: 
- Checks each practitioner's individual `daily_notification_time` setting
- If current hour matches practitioner's notification time, sends notification
- Notification includes all appointments for the next day

**Individual Timing**: Each practitioner can configure their preferred notification time (e.g., 8:00, 9:00, 21:00)

**Rationale**: Hourly checks allow practitioners to have different notification times throughout the day.

### 5. Admin Auto-Assigned Notification Scheduler

**Purpose**: Send daily notifications to clinic admins about pending auto-assigned appointments that need confirmation/reassignment

**Schedule**: Runs every hour

**Logic**:
- Finds pending auto-assigned appointments (still `is_auto_assigned = True`, confirmed, in future)
- Checks each admin's individual `auto_assigned_notification_time` setting
- If current hour matches admin's notification time, sends notification
- Notification includes all pending auto-assigned appointments

**Individual Timing**: Each admin can configure their preferred notification time (default: 21:00)

**Rationale**: Hourly checks allow admins to have different notification times, ensuring they're informed about appointments needing attention.

### 6. LINE Message Cleanup Scheduler

**Purpose**: Clean up old LINE messages from database to manage storage

**Schedule**: Runs daily at 3 AM Taiwan time

**Retention**: Deletes messages older than `LINE_MESSAGE_RETENTION_HOURS` (240 hours = 10 days)

**Safety**: Retention period is longer than chat session expiry (7 days) to ensure conversation history is available

**Immediate Run**: Runs immediately on startup (non-blocking) to catch up on cleanup

**Rationale**: Prevents database bloat while maintaining sufficient history for conversation context.

### 7. Test Session Cleanup Scheduler

**Purpose**: Clean up old test chat sessions from AI chatbot

**Schedule**: Runs daily at 3 AM Taiwan time

**Retention**: Deletes test sessions older than 1 hour (`CHAT_TEST_SESSION_EXPIRY_HOURS` = 12 hours for safety, but cleanup uses 1 hour)

**Session Format**: Only deletes sessions with `test-` prefix for safety

**Immediate Run**: Runs immediately on startup to catch up on cleanup

**Rationale**: Test sessions are temporary and should be cleaned up quickly to prevent database bloat.

---

## Edge Cases

### 1. Scheduler Startup Failure

**Scenario**: One or more schedulers fail to start during application startup

**Behavior**: Server still starts successfully. Failed schedulers are logged but don't block startup. Scheduler failures are logged with `❌` prefix

**Rationale**: Ensures application availability even if background jobs fail (graceful degradation).

### 2. Overlapping Scheduler Runs

**Scenario**: Previous scheduler run hasn't finished when next run starts

**Behavior**: `max_instances=1` prevents overlapping runs. New run is skipped if previous run is still executing

**Rationale**: Prevents duplicate processing and database conflicts.

### 3. Database Session Staleness

**Scenario**: Long-running scheduler uses stale database session

**Behavior**: Each scheduler creates fresh database session for each run using `get_db_context()`

**Rationale**: Ensures schedulers always work with current data and avoid transaction conflicts.

### 4. Timezone Mismatch

**Scenario**: Server timezone differs from Taiwan timezone

**Behavior**: All schedulers use `AsyncIOScheduler(timezone=TAIWAN_TZ)` to ensure correct timing regardless of server timezone

**Rationale**: Critical for reminder timing and notification scheduling to match clinic operations in Taiwan.

### 5. Clinic LINE Credentials Missing

**Scenario**: Clinic has no LINE channel credentials configured

**Behavior**: Schedulers skip clinics without credentials. Logs debug message and continues with other clinics

**Rationale**: Prevents errors from affecting other clinics and allows clinics to configure LINE later.

### 6. Reminder Setting Changes

**Scenario**: Clinic changes `reminder_hours_before` setting after some reminders should have been sent

**Behavior**: Window logic automatically catches up on missed reminders. Window end = current_time + new_setting + window_size, so old reminders are included

**Rationale**: Ensures no reminders are missed when settings change.

### 7. Scheduler Shutdown

**Scenario**: Application is shutting down

**Behavior**: All schedulers are gracefully stopped via `stop_scheduler()` methods. Uses `scheduler.shutdown(wait=True)` to ensure clean shutdown

**Rationale**: Prevents data corruption and ensures in-progress operations complete.

---

## Technical Design

### Scheduler Infrastructure

**Library**: APScheduler (`AsyncIOScheduler`) for async background job scheduling

**Timezone**: All schedulers use `TAIWAN_TZ` (UTC+8) to ensure correct timing

**Trigger Type**: Cron triggers for time-based scheduling (hourly, daily at specific times)

**Max Instances**: All schedulers use `max_instances=1` to prevent overlapping runs

### Database Session Management

**Fresh Sessions**: Each scheduler run creates a new database session via `get_db_context()`

**No Session Sharing**: Schedulers do not share database sessions to avoid stale data and transaction conflicts

**Error Handling**: Database errors are logged but don't crash the scheduler

### Startup & Shutdown

**Startup**: All schedulers started concurrently during application lifespan startup:
```python
await asyncio.gather(
    start_reminder_scheduler(),
    start_auto_assignment_scheduler(),
    ...
    return_exceptions=True  # Don't fail if any scheduler fails
)
```

**Shutdown**: All schedulers stopped gracefully during application lifespan shutdown

**Error Isolation**: Scheduler failures are isolated - one failing scheduler doesn't affect others

### Reminder Window Overlap

**Window Size**: `REMINDER_WINDOW_SIZE_MINUTES = 35` minutes

**Window Width**: 2 × 35 = 70 minutes

**Run Interval**: 60 minutes (hourly)

**Overlap**: 70 - 60 = 10 minutes

**Example**: 
- Run at 2:00 PM: checks appointments at 2:00 PM next day ± 35min (window: 1:25 PM - 2:35 PM)
- Run at 3:00 PM: checks appointments at 3:00 PM next day ± 35min (window: 2:25 PM - 3:35 PM)
- Overlap: 2:25 PM - 2:35 PM (10 minutes)

**Rationale**: Overlap ensures no appointments are missed at window boundaries.

### Notification Deduplication

**Purpose**: Prevents sending duplicate availability notifications

**Implementation**: Tracks sent notifications to avoid duplicates within notification period

**Startup Catch-Up**: Immediate run on startup uses deduplication to prevent sending old notifications

---

## Summary

This document covers:
- Seven background schedulers (reminder, auto-assignment, availability notification, practitioner daily notification, admin auto-assigned notification, LINE message cleanup, test session cleanup)
- Scheduling logic (hourly, daily at specific times, window-based checks)
- Edge cases (startup failures, overlapping runs, stale sessions, timezone issues, missing credentials, setting changes, shutdown)
- Technical design (APScheduler, timezone handling, database session management, startup/shutdown, window overlap, deduplication)

All schedulers use Taiwan timezone and create fresh database sessions for each run to ensure reliability and correctness.



