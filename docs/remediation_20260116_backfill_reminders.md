# Remediation Report: Backfilling Missing Reminders

## Overview
Due to a logic bug in `ReminderSchedulingService.py` (fixed on 2026-01-16), appointments created between approximately 2026-01-10 and 2026-01-16 failed to have their pre-appointment reminders scheduled. 

This document explains the remediation strategy and the script created to fix existing future appointments.

## Target Identification
We identify missing reminders using the following SQL logic:
1.  **Selection**: Confirmed appointments that are manually assigned (`is_auto_assigned = False`).
2.  **Filter**: The `AppointmentType` (e.g. 複診) must have `send_reminder = True`.
3.  **Future Only**: The appointment must occur more than **3 hours** in the future from the current time.
4.  **Missing Check**: No record exists in the `scheduled_line_messages` table for that `appointment_id`.

## Remediation Logic (The "Catch-up")
The script `backend/scripts/backfill_missing_reminders.py` processes each missing appointment as follows:

1.  **Calculate Ideal Timing**: Determine when the reminder *should* have been sent according to clinic settings (e.g., 24 hours before).
2.  **Scenario A: Ideal Time is in the Future**:
    *   The reminder is scheduled for its original ideal time.
3.  **Scenario B: Ideal Time has already passed (Catch-up)**:
    *   If the appointment is still at least **3 hours away**, the reminder is scheduled for **immediate delivery** (Current Time + 1 minute).
4.  **Scenario C: Appointment is < 3 hours away**:
    *   Skipped. Sending a reminder so close to the appointment is considered likely to cause confusion or be redundant.

## Execution Instructions

### Dry Run (Safety First)
To see which appointments will be affected without making changes:
```bash
python backend/scripts/backfill_missing_reminders.py
```

### Real Execution
To write the missing reminders to the production database:
```bash
python backend/scripts/backfill_missing_reminders.py --real
```

## Dry Run Results (Ran 2026-01-16 20:32)
*   **Total Identified Missing Reminders**: 160
    *   *Note: This count only includes appointments at least 3 hours into the future.*
*   **Execution Plan**:
    *   **Normal Scheduling**: ~155 appointments (scheduled for their ideal 24h/previous-day time).
    *   **Catch-up Scheduling**: ~5 appointments (scheduled for immediate delivery because the ideal time already passed).
*   **Skipped**: ~93 appointments (occurring within the next 3 hours or already completed).

## Execution Confirmation
*   **Status**: Pending User Confirmation
*   **Command**: `python3 backend/scripts/backfill_missing_reminders.py --real`
