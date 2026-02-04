# Incident Report: Missing Pre-appointment Reminders (Feb 2026)

**Date**: 2026-02-04\
**Status**: Resolved (Root Cause Identified, Fix Ready)\
**Severity**: High (Patient Communication Failure)\
**Affected Scope**: Clinic 3 (透視物理治療所 台北中山) only

## 1. Executive Summary

Clinic 3 reported that pre-appointment reminders via LINE were not being delivered starting in early February 2026. Investigation revealed a logic bug in the `ReminderSchedulingService` that specifically affected the "Previous Day" (`previous_day`) reminder mode used by Clinic 3. The bug prevented reminders from being scheduled for any future appointments.

The issue appeared to "start" in February because a manual backfill script run on Jan 17th had successfully scheduled reminders for all appointments existing at that time, masking the underlying code defect for approximately two weeks.

## 2. Issue Description & Observations

* **Symptom**: Patients at Clinic 3 were not receiving the automated "Check-in Reminder" LINE messages the day before their appointment.
* **Scope**:
  * **Clinic 3 Only**: Other clinics (e.g., Clinic 2) using the standard `hours_before` mode were unaffected.
  * **Notification Type**: Only "Appointment Reminders" were missing. Confirmations and other system messages were working fine (ruling out quota or credential issues).
  * **Timeline**: The system worked correctly throughout January but failed starting February.

## 3. Root Cause Analysis

The root cause was a logic error in `backend/src/services/reminder_scheduling_service.py` introduced during the implementation of the "Previous Day" reminder mode.

### The Bug

In the `schedule_reminder` method, a block of code intended to handle edge cases (preventing "previous day" reminders for same-day appointments) was implemented incorrectly:

```python
# Faulty Logic
if reminder_send_time.date() >= current_time.date():
    return  # <--- CRITICAL ERROR
```

* **Intent**: Verify that we aren't trying to send a reminder in the past (e.g., sending a "previous day" reminder for an appointment created today).
* **Reality**: This condition is **True for ALL future appointments**. If an appointment is next week, the "previous day" reminder is also next week (future date), so the code immediately returned, effectively silently cancelling the reminder.

### why did it work in January? (The "Jan 17th" Factor)

The bug was introduced on **Jan 7th** (Commit `827d733...`), so the code was broken from the start. However, manual intervention masked the issue:

1. **Jan 16/17 Backfill**: A deployment (Commit `458e03d...`) included a script `backfill_missing_reminders.py`.
2. **Manual Correction**: This script was run against the production database. Importantly, **the script logic was correct** and bypassed the buggy service code.
3. **Result**: Every appointment that existed in the system on Jan 17th (which covered most of the January schedule) had a reminder manually inserted by this script.
4. **The Gap**: Any appointment booked *after* the backfill script ran (i.e., new bookings for February) relied on the live `ReminderSchedulingService` code. Because of the bug, these new bookings never had a reminder scheduled, leading to the "sudden" failure in February.

## 4. Timeline of Events

* **2026-01-07**: Feature "Previous Day Reminder" committed (`827d733`). Bug introduced.
* **2026-01-17**: Fix deployment (`458e03d`) ran `backfill_missing_reminders.py`. This successfully scheduled reminders for Jan 17–Jan 31.
* **2026-01-17 to 2026-01-31**: Reminders sent successfully (created by backfill). New appointments for Feb are being created but **silently failing** to schedule reminders.
* **2026-02-01**: The "Buffer" of backfilled reminders runs out. Appointments booked purely by the buggy system start coming due.
* **2026-02-03**: Clinic reports missing reminders.

## 5. Remediation Plan

### Immediate Fix (Code)

Modified `reminder_scheduling_service.py` to remove the incorrect date comparison check. The service already includes a validation check further down to ensure `reminder_send_time` is not in the past (`if reminder_send_time < current_time`), which effectively handles the same-day edge case correctly.

### Data Repair (Backfill)

We must re-run the `backfill_missing_reminders.py` script to catch up on the missed February appointments.

* **Logic Verified**: The script has been dry-run and correctly identifies:
  1. **Catch-up**: Appointments in the immediate future (tomorrow) where the reminder should have already gone out. It schedules these to send *immediately*.
  2. **Standard**: Appointments further in the future. It schedules these for the correct previous-day time.

## 6. Next Steps

1. **Deploy Fix**: Merge and deploy the fix to `backend/src/services/reminder_scheduling_service.py`.
2. **Execute Backfill**: Run the following command in production to repair missing data:
   ```bash
   export DATABASE_URL="<PROD_DB_URL>"
   python3 backend/scripts/backfill_missing_reminders.py --real
   ```
