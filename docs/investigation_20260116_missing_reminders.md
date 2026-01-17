# Investigation Report: Appointment Reminder Failure (2026-01-16)

## Observation
A patient ("范欣悅") registered with the clinic "透視物理治療所 桃園青埔" did not receive their pre-appointment reminder 24 hours prior to their appointment scheduled for 2026-01-17 11:00. 

The clinic user reported that:
1. The appointment confirmation LINE message was received correctly.
2. The pre-appointment reminder was NOT received.
3. The clinic user had to send a manual reminder.

## Investigation Steps
1.  **Database Inspection**:
    *   Found appointment ID `321` for patient ID `34` (范欣悅).
    *   Status was correctly `confirmed`.
    *   Created at `2026-01-15 01:34 UTC` (09:34 Taiwan Time).
    *   Checked table `scheduled_line_messages` and found **zero** entries for this appointment ID.
2.  **Log Analysis**:
    *   Analyzed `logs.1768621059424.log` matching the creation time.
    *   **Found Log Entry**: `2026-01-15 01:34:25,574 - services.reminder_scheduling_service - INFO - Skipping reminder for appointment 321: created 0.0 hours ago (less than 24 hour reminder window)`
    *   This confirmed the system intentionally skipped scheduling the reminder.
3.  **Widespread Impact**:
    *   Ran a query to find upcoming confirmed appointments missing a scheduled reminder.
    *   Found **51 upcoming appointments** with the same issue.

## Root Cause
The bug was a logic error in `ReminderSchedulingService.py`. 

### The problematic code:
```python
appointment_created_at = appointment.created_at
if appointment_created_at:
    # ...
    time_since_creation = current_time - appointment_created_at
    hours_since_creation = time_since_creation.total_seconds() / 3600
    
    if hours_since_creation < reminder_hours_before:
        # SKIP SCHEDULING
        return
```

### Analysis:
*   This code was likely ported from a previous polling-based `ReminderService`.
*   In the current architecture, reminders are **pre-scheduled** the moment the appointment is created.
*   At creation time, `hours_since_creation` is always effectively `0`.
*   Since `0 < 24` (or whatever the clinic's reminder window is), the system would **always** skip scheduling reminders for new appointments that were booked in advance.

## Fix
The "creation recency" check has been removed from `ReminderSchedulingService.py`. The service now relies on the `reminder_send_time < current_time` check to skip "past-due" reminders (e.g., if someone books an appointment only 12 hours in advance and the reminder was supposed to go out 24 hours in advance), while correctly scheduling future reminders for appointments booked further out.

## Next Steps
- [x] Apply code fix to `ReminderSchedulingService.py`.
- [ ] (Recommended) Run a backfill script to manually schedule the 51 missing reminders for upcoming appointments in production.
