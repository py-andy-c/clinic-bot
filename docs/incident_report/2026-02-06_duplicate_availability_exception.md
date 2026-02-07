# Incident Report: Duplicate Availability Exceptions

**Date:** 2026-02-06
**Reporter:** Antigravity (AI Assistant)
**Status:** Investigated & Root Cause Identified

***

## 1. Incident Overview

A production user (**羅士倫** at **透視物理治療所 桃園青埔**) reported that creating an availability exception resulted in duplicate entries appearing on the calendar. The incident was captured in a screenshot at **2026-02-06 08:14 AM Taiwan Time**.

## 2. Production Investigation Findings

* **Database Record**: Found `CalendarEvent` **ID 827** created at `2026-02-06 00:14:55 UTC` (08:14:55 AM Taiwan time), matching the screenshot.
* **ID Sequence Gap**: Investigation revealed a gap in the ID sequence. Records **825** and **826** were missing, suggesting they were the duplicate entries created concurrently and subsequently deleted by the user or admin.
* **Clinic/User Match**: Confirmed User ID 5 (羅士倫) and Clinic ID 2 (桃園青埔) matched the reported incident.

## 3. Local Reproduction Results

Temporary logging was added to both the frontend and backend to trace the execution flow during reproduction.

### Frontend Logs:

```text
AvailabilityPage.tsx:1158 [DEBUG] onCreate Exception: user_id=1, practitioner_id=1, data= {date: '2026-02-03', startTime: '12:00', endTime: '13:00', practitionerId: 1}
AvailabilityPage.tsx:1158 [DEBUG] onCreate Exception: user_id=1, practitioner_id=1, data= {date: '2026-02-03', startTime: '12:00', endTime: '13:00', practitionerId: 1}
```

* **Observation**: Rapid clicking of the "儲存休診時段" button triggered the `onCreate` function **twice** before the modal could close.

### Backend Logs:

```text
2026-02-06 22:50:19,151 [inf] [DEBUG] create_availability_exception START: user_id=1, ...
2026-02-06 22:50:19,171 [inf] [DEBUG] create_availability_exception DONE: user_id=1, calendar_event_id=822
2026-02-06 22:50:19,175 [inf] [DEBUG] create_availability_exception START: user_id=1, ...
2026-02-06 22:50:19,182 [inf] [DEBUG] create_availability_exception DONE: user_id=1, calendar_event_id=823
```

* **Observation**: The backend processed both requests sequentially within **31 milliseconds**. Since the second request started almost immediately after the first finished, no existing record was detected (as no check was performed), resulting in two distinct database entries.

## 4. Root Cause Analysis

### **A. Primary Cause (Frontend)**

The `AvailabilityPage` component lacks **submission locking**.

* The "儲存休診時段" (Save) button in the `ExceptionModal` and the "仍要建立" (Confirm) button in the `ConflictWarningModal` do not have a `loading` state or `disabled` attribute.
* This allows multiple `POST` requests to be dispatched if the user clicks quickly or if the network has high latency.

### **B. Secondary Cause (Backend)**

The `availability_exceptions` creation endpoint is **not idempotent**.

* The service faithfully creates a new record for every valid request.
* While overlapping exceptions are allowed by design, the system lacks logic to detect or prevent *identical* exceptions (same practitioner, date, and exact time window) created within a very short interval.

## 5. Next Steps

1. Add `isSubmitting` state to `AvailabilityPage.tsx` to disable buttons during API calls.
2. Implement a server-side idempotency check or rate-limiting for identical exception creation.
