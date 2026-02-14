# Scheduler Frequencies Documentation

## Overview

This document describes the frequency and purpose of all background schedulers in the system. Understanding these frequencies helps with performance tuning, debugging, and system monitoring.

## Time-Sensitive Message Schedulers (Every 10 Minutes)

### 1. Scheduled Message Scheduler
**File:** `backend/src/services/scheduled_message_scheduler.py`  
**Frequency:** Every 10 minutes (`:00, :10, :20, :30, :40, :50`)  
**Purpose:** Processes all time-sensitive scheduled LINE messages from the `scheduled_line_messages` table

**Message Types Handled:**
- Follow-up messages (after appointments)
- Appointment reminders (before appointments)
- Patient forms (before/after appointments)
- Any other scheduled LINE messages

**Why 10 Minutes:**
- Provides good responsiveness (messages arrive within 10 min of scheduled time)
- Minimal performance impact (lightweight queries, quick processing)
- Better UX for time-sensitive notifications
- Well within LINE API rate limits

**Performance Characteristics:**
- Batch size: 100 messages per run
- Query: Indexed on `scheduled_send_time` and `status`
- Expected duration: <10 seconds per run
- Database load: Minimal (6 runs/hour vs 1/hour previously)

---

## Daily Summary Schedulers (Hourly)

### 2. Practitioner Daily Notification Service
**File:** `backend/src/services/practitioner_daily_notification_service.py`  
**Frequency:** Every hour at `:01`  
**Purpose:** Sends daily appointment summaries to practitioners

**Why Hourly:**
- These are daily summaries, not time-sensitive
- Only need to be sent once per day at a specific time
- Checking every 10 minutes would be wasteful

### 3. Admin Daily Reminder Service
**File:** `backend/src/services/admin_daily_reminder_service.py`  
**Frequency:** Every hour at `:02`  
**Purpose:** Sends daily appointment notifications to admins

**Why Hourly:**
- Daily summaries for admin oversight
- Not time-critical
- Reduces unnecessary processing

### 4. Admin Auto-Assigned Notification Service
**File:** `backend/src/services/admin_auto_assigned_notification_service.py`  
**Frequency:** Every hour at `:05`  
**Purpose:** Notifies admins about auto-assigned appointments

**Why Hourly:**
- Informational notifications for admins
- Batching reduces notification fatigue
- Not time-critical

---

## Business Logic Schedulers (Hourly)

### 5. Auto Assignment Service
**File:** `backend/src/services/auto_assignment_service.py`  
**Frequency:** Every hour at `:03`  
**Purpose:** Auto-assigns appointments that have reached their recency limit

**Why Hourly:**
- Business logic processing, not messaging
- Recency limits are typically measured in hours/days
- Hourly granularity is sufficient

### 6. Auto Time Confirmation Service
**File:** `backend/src/services/auto_time_confirmation_service.py`  
**Frequency:** Every hour at `:04`  
**Purpose:** Auto-confirms time slots that have reached their confirmation deadline

**Why Hourly:**
- Business logic processing
- Confirmation deadlines are typically measured in hours
- Hourly granularity is sufficient

---

## Cleanup Schedulers (Daily)

### 7. LINE Message Cleanup
**File:** `backend/src/services/line_message_cleanup.py`  
**Frequency:** Daily at 3:00 AM Taiwan time  
**Purpose:** Cleans up old LINE messages from the database

**Why Daily:**
- Maintenance task, not time-sensitive
- Runs during low-traffic hours
- Reduces database bloat

### 8. Test Session Cleanup
**File:** `backend/src/services/test_session_cleanup.py`  
**Frequency:** Daily at 3:00 AM Taiwan time  
**Purpose:** Cleans up old test chat sessions

**Why Daily:**
- Maintenance task
- Runs during low-traffic hours

### 9. Medical Record Cleanup
**File:** `backend/src/services/cleanup_scheduler.py`  
**Frequency:** Daily at 3:00 AM Taiwan time  
**Purpose:** Cleans up old medical records and photos

**Why Daily:**
- Maintenance task
- Runs during low-traffic hours
- Handles large data cleanup

---

## Special Schedulers

### 10. Availability Notification Service
**File:** `backend/src/services/availability_notification_service.py`  
**Frequency:** Specific hours (configurable via `NOTIFICATION_CHECK_HOURS`)  
**Purpose:** Checks and sends availability notifications at specific times

**Why Specific Hours:**
- Notifications should be sent at specific times of day
- Avoids notification fatigue
- Configurable based on business needs

**Cleanup:** Daily at configured hour (via `NOTIFICATION_CLEANUP_HOUR`)

### 11. Reminder Service (DEPRECATED)
**File:** `backend/src/services/reminder_service.py`  
**Frequency:** Every hour at `:07`  
**Status:** Deprecated - functionality moved to `scheduled_message_scheduler.py`

**Note:** This service is kept for backward compatibility but should not be used for new features.

---

## Scheduler Timing Strategy

To avoid resource contention, schedulers are staggered:
- `:00` - Scheduled messages (every 10 min)
- `:01` - Practitioner daily notifications (hourly)
- `:02` - Admin daily reminders (hourly)
- `:03` - Auto assignment (hourly)
- `:04` - Auto time confirmation (hourly)
- `:05` - Admin auto-assigned notifications (hourly)
- `:07` - Reminder service (deprecated, hourly)
- `:10` - Scheduled messages (every 10 min)
- `:20` - Scheduled messages (every 10 min)
- ... and so on

This staggering ensures that multiple schedulers don't compete for database resources at the same time.

---

## Performance Monitoring

When monitoring scheduler performance, watch for:

1. **Execution Duration:** Each run should complete in <10 seconds
2. **Database Load:** CPU and memory should remain stable
3. **Message Backlog:** Queue should stay near zero
4. **LINE API Errors:** Watch for rate limit (429) errors
5. **Misfire Events:** Jobs that couldn't run on time (logged by APScheduler)

---

## Future Considerations

### Potential Optimizations:
1. **Dynamic Frequency:** Adjust frequency based on message volume
2. **Priority Queues:** High-priority messages checked more frequently
3. **Regional Scheduling:** Different frequencies for different timezones
4. **Load-Based Throttling:** Reduce frequency during high-load periods

### Scaling Considerations:
- Current setup can handle hundreds of clinics
- For thousands of clinics, consider:
  - Horizontal scaling (multiple worker instances)
  - Message queue system (RabbitMQ, Redis)
  - Dedicated message processing service

---

## Change History

| Date | Change | Reason |
|------|--------|--------|
| 2026-02-15 | Increased scheduled message frequency from hourly to 10 minutes | Improve responsiveness for time-sensitive messages (follow-ups, reminders, patient forms) |
| 2025-01-30 | Deprecated reminder_service.py | Functionality moved to scheduled_message_scheduler.py |

